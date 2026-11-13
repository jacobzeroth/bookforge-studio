#!/usr/bin/env node
/*
 * BookForge Studio end-to-end tests.
 *
 * Zero dependencies. Launches a local static server, starts Edge/Chrome in
 * headless mode and drives the real app through the Chrome DevTools Protocol
 * (Node 22+ has a global WebSocket, so no npm packages are needed).
 *
 *   node tests/e2e.mjs
 *
 * Environment overrides:
 *   BF_TEST_PORT   static server port        (default 4189)
 *   BF_DEBUG_PORT  browser devtools port     (default 9229)
 *   BOOKFORGE_BROWSER  full path to msedge.exe / chrome.exe
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const APP_DIR = join(dirname(fileURLToPath(import.meta.url)), "..");
const APP_PORT = Number(process.env.BF_TEST_PORT || 4189);
const DEBUG_PORT = Number(process.env.BF_DEBUG_PORT || 9229);
const APP_URL = "http://127.0.0.1:" + APP_PORT + "/";

const results = [];
let failures = 0;

function out(line) { process.stdout.write(line + "\n"); }

async function test(name, fn) {
  const t0 = Date.now();
  try {
    await fn();
    results.push({ name, ok: true, ms: Date.now() - t0 });
    out("  ok   " + name + " (" + (Date.now() - t0) + " ms)");
  } catch (err) {
    failures++;
    results.push({ name, ok: false, ms: Date.now() - t0 });
    out("  FAIL " + name);
    out("       " + err.message);
  }
}

function assert(cond, msg) { if (!cond) throw new Error(msg || "Assertion failed"); }
function assertEq(actual, expected, msg) {
  if (actual !== expected) {
    throw new Error((msg || "Value mismatch") + " — got " + JSON.stringify(actual) + ", expected " + JSON.stringify(expected));
  }
}

/* ------------------------------------------------------------ CDP client */
class Client {
  constructor(ws) {
    this.ws = ws;
    this.nextId = 0;
    this.pending = new Map();
    this.errors = [];
    this._onEvent = () => {};
    ws.addEventListener("message", (ev) => this._message(ev.data));
  }

  static async connect(url) {
    const ws = new WebSocket(url);
    await new Promise((resolve, reject) => {
      ws.addEventListener("open", resolve, { once: true });
      ws.addEventListener("error", () => reject(new Error("Could not connect to " + url)), { once: true });
    });
    return new Client(ws);
  }

  _message(raw) {
    let msg;
    try { msg = JSON.parse(typeof raw === "string" ? raw : raw.toString()); } catch { return; }
    if (msg.id != null) {
      const entry = this.pending.get(msg.id);
      if (!entry) return;
      this.pending.delete(msg.id);
      if (msg.error) entry.reject(new Error(msg.method + ": " + msg.error.message));
      else entry.resolve(msg.result);
      return;
    }
    if (msg.method === "Page.javascriptDialogOpening") {
      this.send("Page.handleJavaScriptDialog", { accept: true }).catch(() => {});
    }
    if (msg.method === "Runtime.exceptionThrown") {
      const d = msg.params.exceptionDetails;
      const text = (d.exception && (d.exception.description || d.exception.value)) || d.text || "Page exception";
      this.errors.push("exception: " + String(text).split("\n")[0]);
    }
    if (msg.method === "Runtime.consoleAPICalled" && msg.params.type === "error") {
      const text = (msg.params.args || []).map((a) => a.value != null ? String(a.value) : (a.description || a.type)).join(" ");
      this.errors.push("console.error: " + text);
    }
    if (msg.method === "Log.entryAdded" && msg.params.entry.level === "error") {
      const e = msg.params.entry;
      if (!/favicon/i.test(e.url || "") && !/favicon/i.test(e.text || "")) {
        this.errors.push("log: " + e.text + (e.url ? " (" + e.url + ")" : ""));
      }
    }
    this._onEvent(msg);
  }

  send(method, params = {}) {
    const id = ++this.nextId;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  async evaluate(expression, opts = {}) {
    const res = await this.send("Runtime.evaluate", {
      expression,
      awaitPromise: opts.awaitPromise !== false,
      returnByValue: true,
      userGesture: true
    });
    if (res.exceptionDetails) {
      const d = res.exceptionDetails;
      const text = (d.exception && (d.exception.description || d.exception.value)) || d.text || "unknown";
      throw new Error("Page exception: " + String(text).split("\n").slice(0, 3).join(" | "));
    }
    return res.result ? res.result.value : undefined;
  }

  async waitFor(expression, timeoutMs, label) {
    const deadline = Date.now() + (timeoutMs || 15000);
    let lastErr = null;
    while (Date.now() < deadline) {
      try {
        const ok = await this.evaluate(expression, { awaitPromise: true });
        if (ok) return true;
      } catch (err) { lastErr = err; }
      await sleep(150);
    }
    throw new Error("Timed out waiting for " + (label || expression) + (lastErr ? " (" + lastErr.message + ")" : ""));
  }

  takeErrors() {
    const list = this.errors.slice();
    this.errors.length = 0;
    return list;
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function mouseClickAt(x, y) {
  await c.send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", buttons: 1, clickCount: 1 });
  await c.send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", buttons: 1, clickCount: 1 });
}

/* ------------------------------------------------------------- processes */
function findBrowser() {
  const candidates = [
    process.env.BOOKFORGE_BROWSER,
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe"
  ].filter(Boolean);
  for (const p of candidates) if (existsSync(p)) return p;
  throw new Error("No Chromium-based browser found. Set BOOKFORGE_BROWSER to msedge.exe or chrome.exe.");
}

async function waitHttp(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch { /* keep trying */ }
    await sleep(200);
  }
  throw new Error("Server did not start at " + url);
}

async function discoverPageTarget() {
  const deadline = Date.now() + 25000;
  while (Date.now() < deadline) {
    try {
      const res = await fetch("http://127.0.0.1:" + DEBUG_PORT + "/json/list");
      const targets = await res.json();
      const page = targets.find((t) => t.type === "page" && t.url && t.url.indexOf("devtools://") !== 0);
      if (page && page.webSocketDebuggerUrl) return { wsUrl: page.webSocketDebuggerUrl, url: page.url };
    } catch { /* browser still starting */ }
    await sleep(300);
  }
  throw new Error("Browser debugging endpoint did not come up on port " + DEBUG_PORT);
}

/* ------------------------------------------------------------------ main */
const BOOK_ID = "e2e-book-1";
const CH_ID = "e2e-ch-1";
const IMG_PX = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

let server = null;
let browser = null;
let profileDir = null;
let c = null;

async function bootWait() {
  await c.waitFor(
    "!!(window.BF && window.BF.bootReady && window.BF.storage && window.BF.storage.mode && window.BF.views && window.BF.exporters && document.querySelectorAll('#nav button').length >= 15 && document.getElementById('view').children.length > 0)",
    20000,
    "application boot"
  );
}

async function reload() {
  await c.send("Page.reload", { ignoreCache: true });
  await sleep(400);
  await bootWait();
}

try {
  out("BookForge Studio — end-to-end tests");
  out("");

  server = spawn(process.execPath, [join(APP_DIR, "server.mjs"), String(APP_PORT)], { cwd: APP_DIR, stdio: "ignore" });
  await waitHttp(APP_URL, 15000);
  out("  static server up at " + APP_URL);

  const exe = findBrowser();
  out("  browser: " + exe);
  profileDir = await mkdtemp(join(tmpdir(), "bookforge-e2e-"));
  browser = spawn(exe, [
    "--headless=new",
    "--disable-gpu",
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-extensions",
    "--disable-background-networking",
    "--disable-sync",
    "--mute-audio",
    "--remote-debugging-port=" + DEBUG_PORT,
    "--user-data-dir=" + profileDir,
    APP_URL
  ], { stdio: "ignore" });

  const target = await discoverPageTarget();
  c = await Client.connect(target.wsUrl);
  await c.send("Runtime.enable");
  await c.send("Log.enable");
  await c.send("Page.enable");
  if (target.url !== APP_URL) {
    await c.send("Page.navigate", { url: APP_URL });
    await sleep(500);
  }
  await bootWait();
  await sleep(500);
  out("  application booted");
  out("");

  await test("boot: namespaces, nav and storage mode are live", async () => {
    const info = await c.evaluate(`(() => ({
      views: Object.keys(BF.views).length,
      exporters: Object.keys(BF.exporters).length,
      mode: BF.storage.mode,
      nav: document.querySelectorAll("#nav button").length,
      title: document.title,
      hasEditorEngine: typeof BF.Editor === "function"
    }))()`);
    assert(info.views >= 17, "expected all 17 views, found " + info.views);
    assert(info.exporters >= 6, "expected exporter set, found " + info.exporters);
    assertEq(info.mode, "indexeddb", "IndexedDB should be the storage mode");
    assert(info.nav >= 15, "navigation not rendered");
    assertEq(info.title, "BookForge Studio", "document title");
    assert(info.hasEditorEngine, "BF.Editor missing");
    const overlay = await c.evaluate(`(() => {
      const o = document.getElementById("overlay");
      return { hidden: o.hidden, display: getComputedStyle(o).display };
    })()`);
    assert(overlay.hidden, "overlay should start hidden");
    assertEq(overlay.display, "none", "hidden overlay must not remain displayed and block clicks");
  });

  await test("create book, open it and edit in the real editor engine", async () => {
    const made = await c.evaluate(`(async () => {
      const b = BF.model.createBook({ title: "Test Manuscript", author: "Ada Lovelace", template: "blank" });
      b.id = ${JSON.stringify(BOOK_ID)};
      b.chapters[0].id = ${JSON.stringify(CH_ID)};
      b.chapters[0].content = "<p>Hello world paragraph.</p><h2>Section One</h2><p>Second paragraph with a few words.</p>";
      BF.app.S.books.push(b);
      await BF.storage.saveBook(b);
      await BF.app.openBook(b);
      return { view: BF.app.S.view, editor: !!document.querySelector("#view .manuscript[contenteditable]") };
    })()`);
    assertEq(made.view, "manuscript", "openBook should switch to the manuscript view");
    assert(made.editor, "editor surface did not render");

    const edit = await c.evaluate(`(async () => {
      const e = BF.app.S.editor;
      e.setHtml("<p>Edited through the editor engine with plenty of words for counting and export tests.</p>");
      BF.app.markDirty();
      const dirty = document.getElementById("saveStatus").dataset.state;
      await BF.app.saveNow("manual");
      return {
        dirty,
        saved: document.getElementById("saveStatus").dataset.state,
        label: document.getElementById("saveText").textContent,
        topTitle: document.getElementById("topBookTitle").textContent
      };
    })()`);
    assertEq(edit.dirty, "dirty", "markDirty should flip save status");
    assertEq(edit.saved, "saved", "saveNow should settle to saved");
    assertEq(edit.label, "Saved", "save label should be honest");
    assertEq(edit.topTitle, "Test Manuscript", "topbar should show the book title");
  });

  await test("persistence: reload restores the manuscript from IndexedDB", async () => {
    await reload();
    const state = await c.evaluate(`(async () => {
      const books = await BF.storage.loadAllBooks();
      const b = books.find((x) => x.id === ${JSON.stringify(BOOK_ID)});
      return {
        found: !!b,
        content: b ? b.chapters[0].content : "",
        reopened: BF.app.S.book ? BF.app.S.book.id : null,
        topTitle: document.getElementById("topBookTitle").textContent
      };
    })()`);
    assert(state.found, "book not found after reload");
    assert(state.content.indexOf("Edited through the editor engine") >= 0, "edited content was not persisted");
    assertEq(state.reopened, BOOK_ID, "last book should reopen automatically");
    assertEq(state.topTitle, "Test Manuscript", "topbar after reload");
  });

  await test("versioning: snapshot, mutate, restore through real pipeline", async () => {
    const snap = await c.evaluate(`(async () => {
      const b = BF.app.S.book;
      const v = await BF.storage.addVersion(b, { name: "E2E baseline" });
      b.chapters[0].content = "<p>Mutated sentence replacing everything else.</p>";
      await BF.storage.saveBook(b);
      const got = await BF.storage.getVersion(v.id);
      const saved = (await BF.storage.loadAllBooks()).find((x) => x.id === b.id);
      return {
        baseline: got.data.chapters[0].content.indexOf("Edited through") >= 0,
        current: saved.chapters[0].content.indexOf("Mutated") >= 0,
        count: (await BF.storage.listVersions(b.id)).length
      };
    })()`);
    assert(snap.baseline, "snapshot did not capture the baseline");
    assert(snap.current, "mutation was not saved");
    assert(snap.count >= 1, "version list empty");

    await c.evaluate(`(async () => {
      const b = BF.app.S.book;
      const v = (await BF.storage.listVersions(b.id)).find((x) => x.name === "E2E baseline");
      const restored = v.data;
      restored.id = b.id;
      restored.updatedAt = Date.now();
      const idx = BF.app.S.books.findIndex((x) => x.id === b.id);
      BF.app.S.books[idx] = restored;
      BF.app.S.book = restored;
      BF.app.S.chapterId = restored.chapters[0].id;
      await BF.storage.saveBook(restored);
      BF.app.setSaveState("saved");
      BF.app.render();
      return true;
    })()`);

    await reload();
    const after = await c.evaluate(`(async () => {
      const b = (await BF.storage.loadAllBooks()).find((x) => x.id === ${JSON.stringify(BOOK_ID)});
      return { content: b.chapters[0].content };
    })()`);
    assert(after.content.indexOf("Edited through") >= 0, "restored content missing after reload");
    assert(after.content.indexOf("Mutated") < 0, "mutated content should have been replaced by restore");
  });

  await test("exports: DOCX and EPUB are real zip packages with expected parts", async () => {
    const r = await c.evaluate(`(async () => {
      const b = BF.app.S.book;
      const clone = BF.util.clone(b);
      clone.chapters[0].content += '<p><img src="${IMG_PX}" alt="one pixel dot"></p>';
      const docx = await BF.exporters.buildDocx(clone);
      const epub = await BF.exporters.buildEpub(clone);
      const dbytes = new Uint8Array(await docx.arrayBuffer());
      const ebytes = new Uint8Array(await epub.arrayBuffer());
      const latin = new TextDecoder("latin1");
      const d = latin.decode(dbytes);
      const e = latin.decode(ebytes);
      return {
        docxLen: dbytes.length,
        docxSig: String.fromCharCode(dbytes[0], dbytes[1]),
        docxDocument: d.indexOf("word/document.xml") >= 0,
        docxContentTypes: d.indexOf("[Content_Types].xml") >= 0,
        docxMedia: d.indexOf("word/media/image1.png") >= 0,
        docxText: d.indexOf("Edited through") >= 0,
        epubLen: ebytes.length,
        epubSig: String.fromCharCode(ebytes[0], ebytes[1]),
        epubMimetypeFirst: e.slice(30, 38) === "mimetype",
        epubNav: e.indexOf("nav.xhtml") >= 0,
        epubContent: e.indexOf("content.opf") >= 0,
        epubText: e.indexOf("Edited through") >= 0
      };
    })()`);
    assertEq(r.docxSig, "PK", "DOCX is not a zip (magic bytes)");
    assert(r.docxLen > 2000, "DOCX suspiciously small: " + r.docxLen);
    assert(r.docxDocument && r.docxContentTypes, "DOCX missing OOXML parts");
    assert(r.docxMedia, "image was not embedded into word/media");
    assert(r.docxText, "DOCX does not contain the manuscript text");
    assertEq(r.epubSig, "PK", "EPUB is not a zip (magic bytes)");
    assert(r.epubLen > 1000, "EPUB suspiciously small: " + r.epubLen);
    assert(r.epubMimetypeFirst, "EPUB mimetype entry must be the first stored entry");
    assert(r.epubNav && r.epubContent, "EPUB missing navigation/package documents");
    assert(r.epubText, "EPUB does not contain the manuscript text");
  });

  await test("exports: HTML, Markdown, TXT and JSON carry real content", async () => {
    const r = await c.evaluate(`(() => {
      const b = BF.app.S.book;
      const html = BF.exporters.buildHtml(b);
      const md = BF.exporters.buildMarkdown(b);
      const txt = BF.exporters.buildTxt(b);
      const json = JSON.parse(BF.exporters.buildJson(b));
      return {
        htmlOk: html.indexOf("Test Manuscript") >= 0 && html.indexOf("Edited through") >= 0,
        htmlDoctype: html.indexOf("<!DOCTYPE html>") === 0,
        mdOk: md.indexOf("# ") >= 0 && md.indexOf("Edited through") >= 0,
        txtOk: txt.indexOf("Edited through") >= 0,
        jsonTitle: json.book.title,
        jsonCh: json.book.chapters.length,
        jsonApp: json.application
      };
    })()`);
    assert(r.htmlDoctype, "HTML export lacks doctype");
    assert(r.htmlOk, "HTML export missing content");
    assert(r.mdOk, "Markdown export missing heading/content");
    assert(r.txtOk, "TXT export missing content");
    assertEq(r.jsonTitle, "Test Manuscript", "JSON backup title");
    assert(r.jsonCh >= 1, "JSON backup lost chapters");
    assertEq(r.jsonApp, "BookForge Studio", "JSON backup application marker");
  });

  await test("image editor: resize and compress replaces the asset and inline copies", async () => {
    const setup = await c.evaluate(`(async () => {
      const b = BF.app.S.book;
      const canvas = document.createElement("canvas");
      canvas.width = 480;
      canvas.height = 360;
      const ctx = canvas.getContext("2d");
      const pixels = ctx.createImageData(canvas.width, canvas.height);
      for (let i = 0; i < pixels.data.length; i += 4) {
        pixels.data[i] = Math.floor(Math.random() * 256);
        pixels.data[i + 1] = Math.floor(Math.random() * 256);
        pixels.data[i + 2] = Math.floor(Math.random() * 256);
        pixels.data[i + 3] = 255;
      }
      ctx.putImageData(pixels, 0, 0);
      const dataUrl = canvas.toDataURL("image/png");
      const size = Math.round((dataUrl.length - dataUrl.indexOf(",") - 1) * 3 / 4);
      b.assets = [];
      const asset = BF.app.addAsset("noise.png", dataUrl, "image/png", size, "Noise sample", false);
      b.chapters[0].content = '<p>Image test paragraph.</p><figure contenteditable="false"><img src="' + dataUrl + '" alt="Noise sample"><figcaption>Noise</figcaption></figure>';
      await BF.app.saveNow("manual");
      BF.app.setView("assets");
      await new Promise((r) => setTimeout(r, 400));
      window.__e2eAssetId = asset.id;
      window.__e2eOldImageSrc = dataUrl;
      window.__e2eOldImageSize = size;
      return {
        size,
        button: Array.from(document.querySelectorAll("#view button")).some((x) => x.textContent.trim() === "Edit image"),
        dims: Array.from(document.querySelectorAll("#view .small.muted")).some((x) => /480 × 360/.test(x.textContent))
      };
    })()`);
    assert(setup.button, "Edit image button missing from the assets view");
    assert(setup.dims, "asset dimensions were not measured");

    const pos = await c.evaluate(`(() => {
      const button = Array.from(document.querySelectorAll("#view button")).find((x) => x.textContent.trim() === "Edit image");
      button.scrollIntoView({ block: "center" });
      const rect = button.getBoundingClientRect();
      const x = rect.left + rect.width / 2;
      const y = rect.top + rect.height / 2;
      const hit = document.elementFromPoint(x, y);
      return { x, y, hit: hit === button || button.contains(hit), overlay: getComputedStyle(document.getElementById("overlay")).display };
    })()`);
    assertEq(pos.overlay, "none", "overlay should be hidden before opening the editor");
    assert(pos.hit, "Edit image button is covered");
    await mouseClickAt(pos.x, pos.y);
    await c.waitFor(`!document.getElementById("overlay").hidden && !!document.querySelector("#overlay .img-editor")`, 6000, "image editor dialog");

    const initial = await c.evaluate(`(() => ({
      title: document.querySelector("#overlay .dialog-head h2").textContent,
      width: document.querySelector("#bfImgWidth").value,
      height: document.querySelector("#bfImgHeight").value,
      canvas: !!document.querySelector("#overlay .img-editor-canvas"),
      presets: document.querySelectorAll("#overlay .img-editor-presets button").length,
      formats: document.querySelectorAll("#bfImgFormat option").length,
      quality: !!document.querySelector("#bfImgQuality"),
      display: !!document.querySelector("#bfImgDisplay")
    }))()`);
    assert(initial.title.indexOf("Edit image") === 0, "wrong dialog title: " + initial.title);
    assertEq(initial.width, "480", "initial width");
    assertEq(initial.height, "360", "initial height");
    assert(initial.canvas, "preview canvas missing");
    assert(initial.presets >= 1, "size presets missing");
    assert(initial.formats >= 2, "format options missing");
    assert(initial.quality, "quality control missing");
    assert(!initial.display, "asset mode should not show manuscript display width");

    await c.evaluate(`(() => {
      const width = document.querySelector("#bfImgWidth");
      width.value = "240";
      width.dispatchEvent(new Event("input", { bubbles: true }));
      const format = document.querySelector("#bfImgFormat");
      format.value = "image/jpeg";
      format.dispatchEvent(new Event("change", { bubbles: true }));
      const quality = document.querySelector("#bfImgQuality");
      quality.value = "55";
      quality.dispatchEvent(new Event("input", { bubbles: true }));
      return true;
    })()`);

    const adjusted = await c.evaluate(`(() => ({
      height: document.querySelector("#bfImgHeight").value,
      format: document.querySelector("#bfImgFormat").value,
      quality: document.querySelector("#bfImgQualityOut").textContent,
      primaryDisabled: Array.from(document.querySelectorAll("#overlay .dialog-foot button")).find((b) => b.textContent.trim() === "Replace image").disabled
    }))()`);
    assertEq(adjusted.height, "180", "locked aspect ratio should update height");
    assertEq(adjusted.format, "image/jpeg", "format selection");
    assertEq(adjusted.quality, "55%", "quality output");
    assertEq(adjusted.primaryDisabled, false, "primary action should enable after edits");

    await c.waitFor(`(() => {
      const el = document.querySelector("#overlay .img-editor-new");
      const text = el ? el.textContent : "";
      return text.length > 0 && text.indexOf("Estimating") < 0 && text.indexOf("Encoding") < 0;
    })()`, 10000, "compressed size estimate");
    const estimate = await c.evaluate(`(() => document.querySelector("#overlay .img-editor-new").textContent)()`);
    assert(estimate.indexOf("smaller") >= 0, "estimate should show the size saving: " + estimate);

    const action = await c.evaluate(`(() => {
      const button = Array.from(document.querySelectorAll("#overlay .dialog-foot button")).find((b) => b.textContent.trim() === "Replace image");
      const rect = button.getBoundingClientRect();
      const x = rect.left + rect.width / 2;
      const y = rect.top + rect.height / 2;
      const hit = document.elementFromPoint(x, y);
      return { x, y, hit: hit === button || button.contains(hit) };
    })()`);
    assert(action.hit, "Replace image button is covered");
    await mouseClickAt(action.x, action.y);
    await c.waitFor(`document.getElementById("overlay").hidden`, 10000, "image editor to close");
    await sleep(200);

    const result = await c.evaluate(`(async () => {
      const b = BF.app.S.book;
      await BF.app.saveNow("manual");
      const asset = b.assets.find((x) => x.id === window.__e2eAssetId);
      const savedBook = (await BF.storage.loadAllBooks()).find((x) => x.id === b.id);
      const saved = savedBook.assets.find((x) => x.id === window.__e2eAssetId);
      const content = b.chapters[0].content;
      return {
        mime: asset.mime,
        width: asset.width,
        height: asset.height,
        size: asset.size,
        prefix: asset.dataUrl.slice(0, 23),
        inlineNew: content.indexOf(asset.dataUrl) >= 0,
        inlineOld: content.indexOf(window.__e2eOldImageSrc) >= 0,
        oldSize: window.__e2eOldImageSize,
        overlay: getComputedStyle(document.getElementById("overlay")).display,
        savedMime: saved ? saved.mime : null,
        savedWidth: saved ? saved.width : null
      };
    })()`);
    assertEq(result.mime, "image/jpeg", "edited asset mime");
    assertEq(result.width, 240, "edited asset width");
    assertEq(result.height, 180, "edited asset height");
    assert(result.size < result.oldSize / 2, "edited image should be much smaller (" + result.size + " vs " + result.oldSize + ")");
    assertEq(result.prefix, "data:image/jpeg;base64,", "edited asset should be a JPEG data URL");
    assert(result.inlineNew, "inline manuscript copy was not replaced");
    assert(!result.inlineOld, "old image data is still in the chapter");
    assertEq(result.overlay, "none", "overlay must be hidden after applying");
    assertEq(result.savedMime, "image/jpeg", "edited asset was not persisted");
    assertEq(result.savedWidth, 240, "edited asset dimensions were not persisted");
  });

  await test("image editor: double-click sets display width and DOCX honors it", async () => {
    await c.evaluate(`(async () => { BF.app.setView("manuscript"); await new Promise((r) => setTimeout(r, 450)); return true; })()`);
    const before = await c.evaluate(`(() => {
      const img = document.querySelector("#view .manuscript img");
      return { found: !!img, src: img ? (img.getAttribute("src") || "").slice(0, 23) : "" };
    })()`);
    assert(before.found, "manuscript image not rendered");
    assertEq(before.src, "data:image/jpeg;base64,", "manuscript should use the edited JPEG");

    const pos = await c.evaluate(`(() => {
      const img = document.querySelector("#view .manuscript img");
      img.scrollIntoView({ block: "center" });
      const rect = img.getBoundingClientRect();
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    })()`);
    await c.send("Input.dispatchMouseEvent", { type: "mousePressed", x: pos.x, y: pos.y, button: "left", buttons: 1, clickCount: 1 });
    await c.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: pos.x, y: pos.y, button: "left", buttons: 1, clickCount: 1 });
    await c.send("Input.dispatchMouseEvent", { type: "mousePressed", x: pos.x, y: pos.y, button: "left", buttons: 1, clickCount: 2 });
    await c.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: pos.x, y: pos.y, button: "left", buttons: 1, clickCount: 2 });
    await c.waitFor(`!document.getElementById("overlay").hidden && !!document.querySelector("#bfImgDisplay")`, 6000, "inline image editor");

    const initial = await c.evaluate(`(() => ({
      width: document.querySelector("#bfImgDisplay").value,
      original: document.querySelector("#overlay .img-editor-stat b").textContent,
      primary: Array.from(document.querySelectorAll("#overlay .dialog-foot button")).find((b) => b.textContent.trim() === "Apply to manuscript").disabled
    }))()`);
    assertEq(initial.width, "100", "initial display width");
    assertEq(initial.primary, true, "apply should be disabled until something changes");
    assert(initial.original.indexOf("240 × 180") >= 0, "editor should report the stored image size: " + initial.original);

    await c.evaluate(`(() => {
      const input = document.querySelector("#bfImgDisplay");
      input.value = "60";
      input.dispatchEvent(new Event("input", { bubbles: true }));
      return true;
    })()`);
    const enabled = await c.evaluate(`(() => ({
      out: document.querySelector("#bfImgDisplayOut").textContent,
      primary: Array.from(document.querySelectorAll("#overlay .dialog-foot button")).find((b) => b.textContent.trim() === "Apply to manuscript").disabled
    }))()`);
    assert(enabled.out.indexOf("60%") === 0, "display output should show 60%: " + enabled.out);
    assertEq(enabled.primary, false, "apply should enable after a width change");

    const action = await c.evaluate(`(() => {
      const button = Array.from(document.querySelectorAll("#overlay .dialog-foot button")).find((b) => b.textContent.trim() === "Apply to manuscript");
      const rect = button.getBoundingClientRect();
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    })()`);
    await mouseClickAt(action.x, action.y);
    await c.waitFor(`document.getElementById("overlay").hidden`, 8000, "inline image editor to close");
    await sleep(200);

    const applied = await c.evaluate(`(async () => {
      const ch = BF.app.S.book.chapters[0];
      const img = document.querySelector("#view .manuscript img");
      await BF.app.saveNow("manual");
      const saved = (await BF.storage.loadAllBooks()).find((x) => x.id === BF.app.S.book.id);
      return {
        style: img.style.width,
        dataWidth: img.getAttribute("data-bf-width"),
        contentStyle: /width:\\s*60%/.test(ch.content),
        contentData: ch.content.indexOf('data-bf-width="60"') >= 0,
        savedStyle: /width:\\s*60%/.test(saved.chapters[0].content),
        savedData: saved.chapters[0].content.indexOf('data-bf-width="60"') >= 0,
        srcPrefix: (img.getAttribute("src") || "").slice(0, 23),
        tag: ((ch.content.match(/<img[^>]*>/) || [""])[0]).replace(/src="[^"]*"/, 'src="…"')
      };
    })()`);
    assertEq(applied.style, "60%", "img style width");
    assertEq(applied.dataWidth, "60", "img data width");
    assert(applied.contentStyle, "chapter HTML did not keep the display width: " + applied.tag);
    assert(applied.contentData, "chapter HTML did not keep the width attribute");
    assert(applied.savedStyle && applied.savedData, "display width was not persisted");
    assertEq(applied.srcPrefix, "data:image/jpeg;base64,", "display width alone must not re-encode the image");

    const docx = await c.evaluate(`(async () => {
      const b = BF.app.S.book;
      const blob = await BF.exporters.buildDocx(b);
      const xml = new TextDecoder("latin1").decode(new Uint8Array(await blob.arrayBuffer()));
      const match = xml.match(/<wp:extent cx="(\\d+)" cy="(\\d+)"/);
      const geo = BF.layout.geometry(b);
      const fullPx = geo.contentW * 96 / 25.4;
      const original = b.chapters[0].content;
      b.chapters[0].content = original
        .replace(/width:\\s*60%/g, "width: 300%")
        .replace(/data-bf-width="60"/g, 'data-bf-width="300"');
      const clampedReplaced = b.chapters[0].content !== original;
      const wideBlob = await BF.exporters.buildDocx(b);
      const wideXml = new TextDecoder("latin1").decode(new Uint8Array(await wideBlob.arrayBuffer()));
      const wideMatch = wideXml.match(/<wp:extent cx="(\\d+)"/);
      b.chapters[0].content = original;
      return {
        cx: match ? Number(match[1]) : 0,
        cy: match ? Number(match[2]) : 0,
        expected: Math.round(fullPx * 0.6 * 9525),
        full: Math.round(fullPx * 9525),
        wideCx: wideMatch ? Number(wideMatch[1]) : 0,
        clampedReplaced
      };
    })()`);
    assert(docx.cx > 0, "DOCX has no image extent");
    assert(Math.abs(docx.cx - docx.expected) <= 9525, "DOCX width does not follow display width: " + docx.cx + " vs " + docx.expected);
    assert(Math.abs(docx.cy - Math.round(docx.cx * 0.75)) <= 9525, "DOCX height does not preserve the image aspect ratio");
    assert(docx.clampedReplaced, "test could not build the oversized image case");
    assert(Math.abs(docx.wideCx - docx.full) <= 9525, "oversized images must clamp to the text width");
  });

  await test("preflight and backup import round-trip work on the real model", async () => {
    const r = await c.evaluate(`(() => {
      const b = BF.app.S.book;
      const pf = BF.exporters.preflight(b);
      const parsed = BF.storage.parseProjectBackup(BF.exporters.buildJson(b));
      return {
        tech: Array.isArray(pf.technical),
        edit: Array.isArray(pf.editorial),
        note: typeof pf.note === "string" && pf.note.length > 40,
        title: parsed.book.title,
        ch: parsed.book.chapters.length,
        warningsArr: Array.isArray(parsed.warnings)
      };
    })()`);
    assert(r.tech && r.edit, "preflight report shape is wrong");
    assert(r.note, "preflight must carry the honest note");
    assertEq(r.title, "Test Manuscript", "imported backup title");
    assert(r.ch >= 1, "imported backup lost chapters");
    assert(r.warningsArr, "import warnings should be a list");
  });

  await test("pagination: measurement engine produces pages at the configured trim", async () => {
    const r = await c.evaluate(`(() => {
      const b = BF.app.S.book;
      const res = BF.layout.paginate(b);
      return {
        pages: res.pages.length,
        blocks: res.pages[0].blocks.length,
        trimW: res.geo.trimW,
        trimH: res.geo.trimH,
        labeled: typeof res.pages[0].pageLabel === "string" || typeof res.pages[0].pageLabel === "number"
      };
    })()`);
    assert(r.pages >= 1, "paginate produced no pages");
    assert(r.blocks >= 1, "first page has no blocks");
    assertEq(r.trimW, 210, "A4 trim width in mm");
    assertEq(r.trimH, 297, "A4 trim height in mm");
    assert(r.labeled, "pages should carry page labels");
  });

  await test("draft: page indicator maps the cursor to the printable chapter page", async () => {
    const r = await c.evaluate(`(async () => {
      const b = BF.app.S.book;
      const ch = b.chapters[0];
      BF.app.S.chapterId = ch.id;
      BF.app.setPageView(false);
      let html = "";
      for (let i = 1; i <= 50; i++) {
        html += "<p>" + "Draft page mapping sentence with enough words to fill a line. ".repeat(4) + "Marker " + i + ".</p>";
      }
      ch.content = html;
      ch.updatedAt = Date.now();
      BF.app.render();
      const started = Date.now();
      while (Date.now() - started < 5000) {
        const cur = document.getElementById("draftPageCurrent");
        if (cur && cur.textContent !== "—") break;
        await new Promise((res) => setTimeout(res, 100));
      }
      const indicator = document.getElementById("draftPageIndicator");
      const map = BF.layout.chapterPageMap(b, ch);
      const full = BF.layout.paginate(b).pages.filter((p) => p.chapterId === ch.id);
      const contentHost = document.createElement("div");
      contentHost.innerHTML = ch.content;
      const blockWords = Array.from(contentHost.children).reduce((n, el) => n + BF.util.countWords(el.textContent || ""), 0);
      const surface = document.querySelector("#view .manuscript[contenteditable]");
      const paras = surface.querySelectorAll("p");
      function setCaret(node) {
        const range = document.createRange();
        range.selectNodeContents(node);
        range.collapse(true);
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
        document.dispatchEvent(new Event("selectionchange"));
      }
      surface.focus();
      setCaret(paras[0]);
      await new Promise((res) => setTimeout(res, 80));
      const first = document.getElementById("draftPageCurrent").textContent;
      const sidebarFirst = document.getElementById("sidebarPageCurrent").textContent;
      setCaret(paras[paras.length - 1]);
      await new Promise((res) => setTimeout(res, 80));
      const last = document.getElementById("draftPageCurrent").textContent;
      return {
        visible: !!indicator,
        shownTotal: document.getElementById("draftPageTotal").textContent,
        mapTotal: map.total, fullTotal: full.length,
        mapWords: map.words, blockWords,
        first, last,
        sidebarTotal: document.getElementById("sidebarPageTotal").textContent,
        sidebarLast: document.getElementById("sidebarPageCurrent").textContent,
        sidebarFill: document.getElementById("sidebarPageFill").style.height
      };
    })()`);
    assert(r.visible, "draft page indicator is missing");
    assertEq(r.shownTotal, String(r.mapTotal), "indicator total should match the chapter map");
    assertEq(r.mapTotal, r.fullTotal, "chapter map should match full-book pagination");
    assertEq(r.mapWords, r.blockWords, "chapter map should cover all chapter words");
    assert(r.mapTotal > 1, "test chapter should span multiple pages");
    assertEq(r.first, "1", "caret at the start should report page 1");
    assert(Number(r.last) > 1, "caret at the end should report a later page: " + r.last);
    assert(Number(r.last) <= r.mapTotal, "reported page exceeds the chapter total");
    assertEq(r.sidebarTotal, String(r.mapTotal), "sidebar track total should match the chapter map");
    assertEq(r.sidebarLast, r.last, "sidebar track should mirror the cursor page in Draft");
    assert(Number(String(r.sidebarFill).replace("%", "")) > 0, "sidebar progress fill should be visible");
  });

  await test("pages view: full-book proof renders at trim size and hands off to chapter editing", async () => {
    await c.send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
    const seed = await c.evaluate(`(async () => {
      const b = BF.app.S.book;
      const ch1 = b.chapters[0];
      let html = "";
      for (let i = 1; i <= 70; i++) {
        html += "<p>" + "Page layout words flow across the measured column. ".repeat(6) + "Marker " + i + ".</p>";
      }
      ch1.content = html;
      let ch2 = b.chapters[1];
      if (!ch2) {
        ch2 = BF.model.createChapter("Second Chapter", { order: 2 });
        b.chapters.push(ch2);
      }
      ch2.title = "Second Chapter";
      ch2.content = "<p>" + "Second chapter words for the page proof. ".repeat(80) + "</p>";
      BF.app.S.chapterId = ch1.id;
      BF.app.setPageView(false);
      await BF.app.saveNow("manual");
      window.__e2eCh2 = ch2.id;
      return { ch1: ch1.id, ch2: ch2.id };
    })()`);
    await sleep(200);

    const toggle = await c.evaluate(`(() => {
      const b = Array.from(document.querySelectorAll("#view .seg button")).find((x) => x.textContent.trim() === "Pages");
      if (!b) return null;
      b.scrollIntoView({ block: "center" });
      const r = b.getBoundingClientRect();
      const x = r.left + r.width / 2, y = r.top + r.height / 2;
      const hit = document.elementFromPoint(x, y);
      return { x, y, hit: hit === b || b.contains(hit) };
    })()`);
    assert(toggle, "Pages toggle is missing from the manuscript bar");
    assert(toggle.hit, "Pages toggle is covered by another element");
    await mouseClickAt(toggle.x, toggle.y);
    await c.waitFor("document.querySelectorAll('#view .page-card').length >= 2 && !document.querySelector('#view .page-loading')", 15000, "pages view to render");
    await sleep(150);

    const view = await c.evaluate(`(() => {
      const cards = Array.from(document.querySelectorAll("#view .page-card"));
      const current = document.querySelector("#view .page-card.is-current");
      const sheet = current ? current.querySelector(".print-page") : null;
      const rect = sheet ? sheet.getBoundingClientRect() : null;
      return {
        pageView: BF.app.S.pageView,
        editorSurface: !!document.querySelector("#view .manuscript[contenteditable]"),
        editorNull: BF.app.S.editor === null,
        pages: cards.length,
        currentPages: document.querySelectorAll("#view .page-card.is-current").length,
        firstChapter: current ? current.dataset.chapter : null,
        currentTop: current ? Math.round(current.getBoundingClientRect().top) : -1,
        windowH: window.innerHeight,
        mainH: document.getElementById("main").clientHeight,
        ch2Pages: document.querySelectorAll('#view .page-card[data-chapter="' + window.__e2eCh2 + '"]').length,
        sheetW: rect ? Math.round(rect.width) : 0,
        sheetH: rect ? Math.round(rect.height) : 0,
        info: document.getElementById("pageViewInfo").textContent,
        status: document.getElementById("stPage").textContent,
        pagesMode: document.body.classList.contains("pages-mode"),
        zoomDisplay: getComputedStyle(document.getElementById("zoomRange")).display,
        undoDisabled: document.getElementById("btnUndo").disabled,
        editButtons: current ? Array.from(current.querySelectorAll("button")).map((b) => b.textContent.trim()) : [],
        badge: !!document.querySelector("#view .page-card-badge"),
        nestedEditable: !!document.querySelector("#view .page-card [contenteditable=true]"),
        sidebarShown: (() => {
          const el = document.getElementById("sidebarPageIndicator");
          return !!el && getComputedStyle(el).display !== "none";
        })(),
        sidebarTot: document.getElementById("sidebarPageTotal").textContent
      };
    })()`);
    assert(view.pageView, "Pages toggle did not enter page view");
    assert(!view.editorSurface && view.editorNull, "the draft editor must not be active in Pages");
    assert(view.pages >= 2, "expected a multi-page proof, found " + view.pages);
    assert(view.currentPages >= 1, "current chapter is not highlighted");
    assertEq(view.firstChapter, seed.ch1, "first highlighted page should belong to the current chapter");
    assert(view.ch2Pages >= 1, "second chapter did not appear in the page proof");
    assert(view.currentTop >= 0 && view.currentTop < view.windowH, "current page was not scrolled into view: " + view.currentTop);
    assert(view.sheetW > 300 && view.sheetH > view.sheetW, "page sheet has unexpected dimensions: " + view.sheetW + "x" + view.sheetH);
    assert(view.sheetH <= view.mainH, "page sheet does not fit the Pages viewport: " + view.sheetH + " > " + view.mainH);
    assert(/pages · 8\.27 × 11\.69 in · read-only proof/.test(view.info), "page metadata is wrong: " + view.info);
    assert(/pages \(exact\)/.test(view.status), "status bar does not show the exact page count: " + view.status);
    assert(view.pagesMode, "Pages mode class is missing");
    assertEq(view.zoomDisplay, "none", "the draft zoom control should be hidden in Pages");
    assert(view.undoDisabled, "undo should be disabled in Pages");
    assert(view.editButtons.indexOf("Edit chapter") >= 0, "Edit chapter action missing from the current page");
    assert(view.badge, "current chapter badge missing");
    assert(!view.nestedEditable, "page sheets must be read-only");
    assert(view.sidebarShown, "sidebar page progress track should be visible in Pages");
    assertEq(view.sidebarTot, String(view.pages), "sidebar track total should equal the proof page count");

    const track = await c.evaluate(`(async () => {
      const main = document.getElementById("main");
      const read = () => ({
        cur: Number(document.getElementById("sidebarPageCurrent").textContent),
        tot: Number(document.getElementById("sidebarPageTotal").textContent),
        fill: document.getElementById("sidebarPageFill").style.height
      });
      main.scrollTop = main.scrollHeight;
      await new Promise((res) => setTimeout(res, 320));
      const atBottom = read();
      main.scrollTop = 0;
      await new Promise((res) => setTimeout(res, 320));
      const atTop = read();
      return { atBottom, atTop, cards: document.querySelectorAll("#view .page-card").length };
    })()`);
    assertEq(track.atBottom.cur, track.cards, "sidebar track should follow scroll to the last proof page");
    assertEq(track.atBottom.tot, track.cards, "sidebar track total should equal the proof page count");
    assertEq(track.atBottom.fill, "100%", "sidebar fill should reach the bottom of the track");
    assertEq(track.atTop.cur, 1, "sidebar track should return to page 1 at the top");

    const edit = await c.evaluate(`(() => {
      const b = Array.from(document.querySelectorAll("#view .page-card.is-current button")).find((x) => x.textContent.trim() === "Edit chapter");
      if (!b) return null;
      b.scrollIntoView({ block: "center" });
      const r = b.getBoundingClientRect();
      const x = r.left + r.width / 2, y = r.top + r.height / 2;
      const hit = document.elementFromPoint(x, y);
      return { x, y, hit: hit === b || b.contains(hit) };
    })()`);
    assert(edit, "Edit chapter button is missing");
    assert(edit.hit, "Edit chapter button is covered");
    await mouseClickAt(edit.x, edit.y);
    await c.waitFor("!!document.querySelector('#view .manuscript[contenteditable]') && BF.app.S.pageView === false", 10000, "draft after Edit chapter");

    const draft = await c.evaluate(`(() => ({
      pageView: BF.app.S.pageView,
      editor: !!document.querySelector("#view .manuscript[contenteditable]"),
      marker: BF.app.S.book.chapters[0].content.indexOf("Marker 70") >= 0,
      chapterId: BF.app.S.chapterId,
      pagesMode: document.body.classList.contains("pages-mode"),
      undoDisabled: document.getElementById("btnUndo").disabled,
      barText: document.getElementById("pageViewInfo").textContent
    }))()`);
    assert(!draft.pageView && draft.editor, "Edit chapter did not return to the draft editor");
    assert(draft.marker, "chapter content was lost when switching back from Pages");
    assertEq(draft.chapterId, seed.ch1, "Edit chapter opened the wrong chapter");
    assert(!draft.pagesMode, "Pages mode class should be cleared in Draft");
    assert(!draft.undoDisabled, "undo should be enabled again in Draft");
    assert(draft.barText.indexOf("Page size 8.27 × 11.69 in") >= 0, "Draft bar does not show the page size: " + draft.barText);
    await c.send("Emulation.clearDeviceMetricsOverride");
  });

  await test("mobile: phone layout fits, drawer and menu work, dialogs are sheets", async () => {
    await c.send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 3, mobile: true });
    await reload();
    await sleep(300);

    const layout = await c.evaluate(`(() => {
      const d = document;
      const ws = document.getElementById("workspace");
      const r = (sel) => { const e = d.querySelector(sel); if (!e) return null; const b = e.getBoundingClientRect(); return { x: b.x, y: b.y, w: b.width, h: b.height, right: b.right }; };
      return {
        iw: innerWidth,
        ih: innerHeight,
        docSW: d.documentElement.scrollWidth,
        clientW: d.documentElement.clientWidth,
        tracks: getComputedStyle(ws).gridTemplateColumns.split(" ").length,
        context: getComputedStyle(d.querySelector(".context-panel")).display,
        settings: getComputedStyle(document.getElementById("btnSettings")).display,
        more: r("#btnMobileMore"),
        sidebar: r(".sidebar"),
        isMobile: BF.mobile.isMobile()
      };
    })()`);
    assertEq(layout.isMobile, true, "BF.mobile should detect the phone viewport");
    assert(layout.docSW <= layout.clientW, "phone layout overflows horizontally: " + layout.docSW + " > " + layout.clientW);
    assertEq(layout.tracks, 1, "workspace should collapse to a single column on a phone");
    assertEq(layout.context, "none", "context panel should be hidden on a phone");
    assertEq(layout.settings, "none", "desktop top-bar settings should be hidden on a phone");
    assert(layout.more && layout.more.w >= 36, "the more menu button should be visible on a phone");
    assert(layout.sidebar.right <= 1, "sidebar should start off-canvas on a phone");

    const drawer = await c.evaluate(`(async () => {
      const d = document;
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
      d.getElementById("btnSidebar").click();
      await sleep(340);
      const sb = d.querySelector(".sidebar").getBoundingClientRect();
      const bd = d.getElementById("navBackdrop");
      const open = d.body.classList.contains("nav-open");
      const backdrop = !bd.hidden && bd.getBoundingClientRect().width > 0;
      const first = [...d.querySelectorAll("#nav button")][0].getBoundingClientRect().height;
      bd.click();
      await sleep(340);
      return { open, sbX: sb.x, sbW: sb.width, backdrop, first, closed: !d.body.classList.contains("nav-open"), closedX: d.querySelector(".sidebar").getBoundingClientRect().x };
    })()`);
    assert(drawer.open, "hamburger should open the navigation drawer");
    assert(drawer.sbX >= 0 && drawer.sbX + drawer.sbW <= 391, "open drawer should be inside the viewport");
    assert(drawer.backdrop, "drawer should show a backdrop");
    assert(drawer.first >= 44, "drawer nav rows should be touch sized, got " + drawer.first);
    assert(drawer.closed && drawer.closedX < 0, "backdrop tap should close the drawer");

    const menu = await c.evaluate(`(async () => {
      const d = document;
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
      d.getElementById("btnMobileMore").click();
      await sleep(180);
      const menus = [...d.body.children].filter((e) => e.classList && e.classList.contains("menu"));
      const m = menus[menus.length - 1];
      const b = m.getBoundingClientRect();
      const item = m.querySelector("button").getBoundingClientRect().height;
      const items = m.querySelectorAll("button").length;
      m.remove();
      return { left: b.left, right: b.right, top: b.top, bottom: b.bottom, items, item, iw: innerWidth, ih: innerHeight };
    })()`);
    assert(menu.items >= 3, "the more menu should list actions");
    assert(menu.left >= 0 && menu.right <= menu.iw && menu.top >= 0 && menu.bottom <= menu.ih,
      "more menu must stay inside the viewport: " + JSON.stringify(menu));
    assert(menu.item >= 44, "menu rows should be touch sized, got " + menu.item);

    const sheet = await c.evaluate(`(async () => {
      const d = document;
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
      BF.app.openSettings();
      await sleep(300);
      const dlg = d.querySelector("#overlay .dialog");
      const b = dlg.getBoundingClientRect();
      const input = d.querySelector("#overlay .field input");
      const foot = d.querySelector("#overlay .dialog-foot");
      const res = {
        w: b.width, h: b.height, iw: innerWidth, ih: innerHeight,
        fs: input ? getComputedStyle(input).fontSize : null,
        inputH: input ? input.getBoundingClientRect().height : null,
        footBottom: foot ? foot.getBoundingClientRect().bottom : null,
        scrolls: (() => { const body = d.querySelector("#overlay .dialog-body"); return body.scrollHeight >= body.clientHeight; })()
      };
      const ov = d.getElementById("overlay");
      ov.hidden = true; ov.innerHTML = "";
      return res;
    })()`);
    assert(sheet.w >= sheet.iw - 2 && sheet.h >= sheet.ih - 2, "phone dialog should fill the screen: " + JSON.stringify(sheet));
    assertEq(sheet.fs, "16px", "phone inputs should use 16px to avoid iOS zoom");
    assert(sheet.inputH >= 44, "phone inputs should be touch sized, got " + sheet.inputH);
    assert(sheet.footBottom <= sheet.ih + 1, "dialog footer should stay inside the screen");

    const manuscript = await c.evaluate(`(async () => {
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
      BF.app.setView("manuscript");
      await sleep(900);
      const r = (sel) => { const e = document.querySelector(sel); return e ? e.getBoundingClientRect() : null; };
      const tb = r(".editor-toolbar"), cv = r(".canvas-wrap"), mn = r(".manuscript");
      return { iw: innerWidth, docSW: document.documentElement.scrollWidth, tbW: tb && tb.width, cvW: cv && cv.width, mnW: mn && mn.width, tbScrolls: (() => { const e = document.querySelector(".editor-toolbar"); return e ? e.scrollWidth > e.clientWidth : false; })() };
    })()`);
    assert(manuscript.docSW <= manuscript.iw, "manuscript overflows the phone: " + manuscript.docSW + " > " + manuscript.iw);
    assert(manuscript.tbW <= manuscript.iw + 1, "editor toolbar is wider than the phone");
    assert(manuscript.cvW <= manuscript.iw + 1, "editor canvas is wider than the phone");
    assert(manuscript.mnW <= manuscript.iw + 1, "manuscript text column is wider than the phone");
    assert(manuscript.tbScrolls, "the editor toolbar should scroll horizontally instead of wrapping");

    await c.send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
    await reload();
    await sleep(300);
    const desktop = await c.evaluate(`(() => ({
      sidebarX: document.querySelector(".sidebar").getBoundingClientRect().x,
      context: getComputedStyle(document.querySelector(".context-panel")).display,
      isMobile: BF.mobile.isMobile()
    }))()`);
    assertEq(desktop.isMobile, false, "desktop width should leave phone mode");
    assert(desktop.sidebarX >= 0, "desktop sidebar should be visible again");
    assert(desktop.context !== "none", "desktop context panel should be visible again");
  });

  await test("clean-up: local corrections preview, save a safety version and apply", async () => {
    const seed = await c.evaluate(`(async () => {
      const b = BF.app.S.book;
      const ch = BF.app.currentChapter();
      ch.content = '<p>This  is a test.  "Hello," she said.Next sentence...</p>' +
        '<p>Wait -- what?</p>' +
        '<p>&nbsp;</p>' +
        '<p>Dr. smith arrived.  e.g. this stays.</p>' +
        '<p class="section-break" contenteditable="false"></p><p><br></p>' +
        '<p>Keep <code>a  --  b</code> unchanged.</p>';
      BF.app.render();
      await BF.app.saveNow("manual");
      const cleaned = BF.textTools.clean(ch.content);
      return { id: ch.id, before: ch.content, cleaned: cleaned.html, changed: cleaned.changed, stats: cleaned.stats };
    })()`);
    assert(seed.changed, "clean-up reported no changes for dirty input");
    assert(seed.cleaned.indexOf("This is a test. “Hello,” she said. Next sentence…") >= 0, "text corrections are wrong: " + seed.cleaned);
    assert(seed.cleaned.indexOf("Wait — what?") >= 0, "double hyphen was not normalized");
    assert(seed.cleaned.indexOf("Dr. smith arrived. e.g. this stays.") >= 0, "abbreviations were not preserved: " + seed.cleaned);
    assert(seed.cleaned.indexOf("&nbsp;") < 0, "empty paragraph was not removed");
    assert(seed.cleaned.indexOf("section-break") >= 0, "section break was removed");
    assert(seed.cleaned.indexOf("<p><br></p>") >= 0, "paragraph placeholder after a break was removed");
    assert(seed.cleaned.indexOf("<code>a  --  b</code>") >= 0, "code content must not be rewritten");
    assert(seed.stats.empty >= 1, "empty-paragraph count is missing");

    const opened = await c.evaluate(`(() => {
      const b = Array.from(document.querySelectorAll("#view .manuscript-bar button")).find((x) => x.textContent.trim() === "Clean up & format");
      if (!b) return false;
      b.click();
      return true;
    })()`);
    assert(opened, "Clean up & format button is missing");
    await c.waitFor("!document.getElementById('overlay').hidden", 5000, "clean-up dialog");

    const dialog = await c.evaluate(`(() => {
      const d = document.querySelector("#overlay .dialog");
      if (!d) return null;
      const apply = d.querySelector(".dialog-foot .btn.primary");
      return {
        title: d.querySelector("h2").textContent,
        checkboxes: d.querySelectorAll(".cleanup-option input[type=checkbox]").length,
        scope: d.querySelector("#cleanupScope").value,
        summary: d.querySelector(".cleanup-summary").textContent,
        samples: d.querySelectorAll(".cleanup-sample .diff").length,
        hasDiff: /<(ins|del)>/.test(d.querySelector(".cleanup-sample .diff").innerHTML),
        applyLabel: apply ? apply.textContent : "",
        applyDisabled: apply ? apply.disabled : true
      };
    })()`);
    assert(dialog, "clean-up dialog did not open");
    assertEq(dialog.title, "Clean up & format", "clean-up dialog title");
    assertEq(dialog.checkboxes, 8, "expected all eight correction options");
    assertEq(dialog.scope, "chapter", "clean-up should default to the current chapter");
    assert(dialog.summary.indexOf("No changes") < 0 && dialog.summary.length > 10, "live summary is empty");
    assert(dialog.samples >= 1 && dialog.hasDiff, "diff preview is missing");
    assertEq(dialog.applyLabel, "Apply to chapter", "apply button label");
    assert(!dialog.applyDisabled, "apply button should be enabled");

    await c.evaluate(`(() => {
      const b = document.querySelector("#overlay .dialog-foot .btn.primary");
      b.click();
      return true;
    })()`);
    await c.waitFor("document.getElementById('overlay').hidden && BF.app.S.book.chapters[0].content.indexOf('This is a test.') >= 0 && BF.app.S.book.chapters[0].content.indexOf('This  is') < 0", 8000, "clean-up to apply");
    await c.waitFor(`(async () => {
      const saved = (await BF.storage.loadAllBooks()).find((x) => x.id === ${JSON.stringify(BOOK_ID)});
      return !!(saved && saved.chapters[0].content.indexOf("This is a test.") >= 0);
    })()`, 5000, "clean-up to persist");

    const after = await c.evaluate(`(async () => {
      const b = BF.app.S.book;
      const versions = await BF.storage.listVersions(b.id);
      const safety = versions.find((v) => v.name.indexOf("Before clean-up") === 0);
      const saved = (await BF.storage.loadAllBooks()).find((x) => x.id === b.id);
      return {
        content: b.chapters[0].content,
        editor: BF.app.S.editor ? BF.app.S.editor.getHtml() : "",
        safetyName: safety ? safety.name : null,
        safetyOriginal: safety ? safety.data.chapters[0].content.indexOf("This  is a test.") >= 0 : false,
        storedCleaned: saved ? saved.chapters[0].content.indexOf("This is a test.") >= 0 : false,
        pageView: BF.app.S.pageView
      };
    })()`);
    assert(after.content.indexOf("This is a test. “Hello,” she said. Next sentence…") >= 0, "clean-up was not applied to the model");
    assert(after.editor.indexOf("This is a test.") >= 0, "clean-up was not reflected in the editor");
    assert(!after.pageView, "clean-up should return to the draft editor");
    assert(after.safetyName && after.safetyName.indexOf("Before clean-up") === 0, "safety version was not created");
    assert(after.safetyOriginal, "safety version does not preserve the pre-clean-up text");
    assert(after.storedCleaned, "cleaned text was not persisted");
  });

  await test("print: print root is filled with pages and window.print is invoked once", async () => {
    const r = await c.evaluate(`(() => {
      const b = BF.app.S.book;
      let called = 0;
      const orig = window.print;
      window.print = function () { called++; };
      let pages = 0, err = null;
      try { pages = BF.layout.print(b).pages.length; } catch (e) { err = e.message; }
      window.print = orig;
      return { called, pages, domPages: document.querySelectorAll("#print-root .print-page").length, err };
    })()`);
    assertEq(r.err, null, "print threw: " + r.err);
    assertEq(r.called, 1, "window.print should be invoked exactly once");
    assert(r.pages >= 1, "no pages prepared for print");
    assertEq(r.domPages, r.pages, "print root does not match prepared pages");
  });

  await test("design studio: live preview renders paginated pages with controls", async () => {
    await c.evaluate(`(async () => { BF.app.setView("design"); await new Promise((r) => setTimeout(r, 900)); return true; })()`);
    const r = await c.evaluate(`(() => ({
      pages: document.querySelectorAll("#view .print-page").length,
      controls: document.querySelectorAll("#view select, #view input, #view textarea").length
    }))()`);
    assert(r.pages >= 1, "design preview rendered no pages");
    assert(r.controls >= 5, "design controls missing");
  });

  await test("library UI: delete asks for confirmation, trashes, and restores", async () => {
    await c.evaluate(`(async () => { BF.app.setView("books"); await new Promise((r) => setTimeout(r, 200)); return true; })()`);

    const renameOpened = await c.evaluate(`(() => {
      const row = Array.from(document.querySelectorAll("#view tbody tr")).find((tr) => tr.textContent.indexOf("Test Manuscript") >= 0);
      if (!row) return false;
      const b = Array.from(row.querySelectorAll("button")).find((x) => x.textContent.trim() === "Rename");
      if (b) b.click();
      return !!b;
    })()`);
    assert(renameOpened, "rename button not found");
    const renamed = await c.evaluate(`(() => {
      const input = document.querySelector("#overlay #f_title");
      if (!input) return false;
      input.value = "Test Manuscript Revised";
      const submit = Array.from(document.querySelectorAll("#overlay .dialog-foot button")).find((b) => b.textContent.trim() === "Rename");
      if (submit) submit.click();
      return !!submit;
    })()`);
    assert(renamed, "rename dialog form was not usable");
    await sleep(400);
    const renameSaved = await c.evaluate(`(async () => {
      const saved = (await BF.storage.loadAllBooks()).find((x) => x.id === ${JSON.stringify(BOOK_ID)});
      return { title: saved ? saved.title : null, overlayClosed: document.getElementById("overlay").hidden };
    })()`);
    assertEq(renameSaved.title, "Test Manuscript Revised", "rename was not persisted (formDialog regression)");
    assert(renameSaved.overlayClosed, "dialog should close after submitting");

    const clicked = await c.evaluate(`(() => {
      const row = Array.from(document.querySelectorAll("#view tbody tr")).find((tr) => tr.textContent.indexOf("Test Manuscript") >= 0);
      if (!row) return { found: false };
      const del = Array.from(row.querySelectorAll("button")).find((b) => b.textContent.trim() === "Delete");
      if (!del) return { found: true, hasDelete: false };
      del.click();
      return { found: true, hasDelete: true };
    })()`);
    assert(clicked.found && clicked.hasDelete, "delete button not found in the library row");

    const dialog = await c.evaluate(`(() => {
      const overlay = document.getElementById("overlay");
      const d = overlay.querySelector(".dialog");
      return {
        visible: !overlay.hidden && !!d,
        title: d ? d.querySelector("h2").textContent : "",
        buttons: d ? Array.from(d.querySelectorAll("button")).map((b) => b.textContent.trim()) : []
      };
    })()`);
    assert(dialog.visible, "confirmation dialog did not open");
    assertEq(dialog.title, "Move to trash", "confirmation dialog title");
    assert(dialog.buttons.indexOf("Move to trash") >= 0, "confirm button missing");

    await c.evaluate(`(() => {
      const d = document.querySelector("#overlay .dialog");
      Array.from(d.querySelectorAll("button")).find((b) => b.textContent.trim() === "Move to trash").click();
      return true;
    })()`);
    await sleep(400);

    const trashed = await c.evaluate(`(async () => {
      const saved = (await BF.storage.loadAllBooks()).find((x) => x.id === ${JSON.stringify(BOOK_ID)});
      const mem = BF.app.S.books.find((x) => x.id === ${JSON.stringify(BOOK_ID)});
      return { saved: !!(saved && saved.trashed), mem: !!(mem && mem.trashed), cleared: BF.app.S.book === null };
    })()`);
    assert(trashed.saved, "book was not trashed in storage");
    assert(trashed.mem, "book was not trashed in memory");
    assert(trashed.cleared, "trashing the open book should close it");

    await c.evaluate(`(async () => { BF.app.setView("trash"); await new Promise((r) => setTimeout(r, 200)); return true; })()`);
    const restoreClick = await c.evaluate(`(() => {
      const row = Array.from(document.querySelectorAll("#view .issue")).find((el) => el.textContent.indexOf("Test Manuscript") >= 0);
      const btn = row ? Array.from(row.querySelectorAll("button")).find((b) => b.textContent.trim() === "Restore") : null;
      if (btn) btn.click();
      return { row: !!row, button: !!btn };
    })()`);
    assert(restoreClick.row, "trashed book row not found in the trash view");
    assert(restoreClick.button, "restore button not found");

    const deadline = Date.now() + 4000;
    let restored = null;
    while (Date.now() < deadline) {
      restored = await c.evaluate(`(async () => {
        const saved = (await BF.storage.loadAllBooks()).find((x) => x.id === ${JSON.stringify(BOOK_ID)});
        return { trashed: !!(saved && saved.trashed) };
      })()`);
      if (restored && restored.trashed === false) break;
      await sleep(200);
    }
    assertEq(restored.trashed, false, "restore from trash did not persist");
  });

  await test("new-book wizard creates a project through the actual UI", async () => {
    await c.evaluate(`(async () => { BF.app.setView("dashboard"); await new Promise((r) => setTimeout(r, 200)); return true; })()`);
    const createBtn = await c.evaluate(`(() => {
      const b = Array.from(document.querySelectorAll("#view button")).find((x) => x.textContent.trim() === "Create book");
      if (!b) return null;
      b.scrollIntoView({ block: "center" });
      const r = b.getBoundingClientRect();
      const x = r.left + r.width / 2;
      const y = r.top + r.height / 2;
      const hit = document.elementFromPoint(x, y);
      return {
        x, y,
        hit: hit === b || b.contains(hit),
        overlay: getComputedStyle(document.getElementById("overlay")).display
      };
    })()`);
    assert(createBtn, "create-book button missing from the dashboard");
    assertEq(createBtn.overlay, "none", "hidden overlay must not cover the interface");
    assert(createBtn.hit, "create-book button is covered by another element");
    await mouseClickAt(createBtn.x, createBtn.y);
    await sleep(200);
    const step1 = await c.evaluate(`(() => {
      const d = document.querySelector("#overlay .dialog");
      if (!d) return null;
      const card = d.querySelector('[data-template="fiction"]');
      if (card) card.click();
      const next = Array.from(d.querySelectorAll(".dialog-foot button")).find((b) => b.textContent.trim() === "Create book");
      const selected = d.querySelector("[data-template][aria-pressed='true']");
      return { title: d.querySelector("h2").textContent, cards: d.querySelectorAll("[data-template]").length, selected: selected ? selected.dataset.template : null, next: !!next };
    })()`);
    assert(step1, "wizard dialog did not open");
    assertEq(step1.title, "Create a new book", "wizard title");
    assert(step1.cards >= 11, "template cards missing");
    assertEq(step1.selected, "fiction", "template selection did not register");
    assert(step1.next, "wizard next button missing");

    await c.evaluate(`(() => {
      const d = document.querySelector("#overlay .dialog");
      Array.from(d.querySelectorAll(".dialog-foot button")).find((b) => b.textContent.trim() === "Create book").click();
      return true;
    })()`);
    const step2 = await c.evaluate(`(() => {
      const title = document.querySelector("#overlay #wz_title");
      const author = document.querySelector("#overlay #wz_author");
      if (title) title.value = "Wizard Novel";
      if (author) author.value = "Grace Hopper";
      return { hasTitle: !!title, hasAuthor: !!author };
    })()`);
    assert(step2.hasTitle && step2.hasAuthor, "wizard details step is missing fields");

    await c.evaluate(`(() => {
      const d = document.querySelector("#overlay .dialog");
      Array.from(d.querySelectorAll(".dialog-foot button")).find((b) => b.textContent.trim() === "Create book").click();
      return true;
    })()`);
    const step3 = await c.evaluate(`(() => ({
      trim: !!document.querySelector("#overlay #wz_trim"),
      isbn: !!document.querySelector("#overlay #wz_isbn"),
      active: document.querySelectorAll("#overlay .wizard-steps [data-active='true']").length
    }))()`);
    assert(step3.trim && step3.isbn, "wizard production step is missing fields");
    assertEq(step3.active, 1, "wizard should show one active step");

    await c.evaluate(`(() => {
      const d = document.querySelector("#overlay .dialog");
      Array.from(d.querySelectorAll(".dialog-foot button")).find((b) => b.textContent.trim() === "Create book").click();
      return true;
    })()`);
    await sleep(700);
    const made = await c.evaluate(`(async () => {
      const saved = (await BF.storage.loadAllBooks()).find((x) => x.title === "Wizard Novel");
      return {
        overlayClosed: document.getElementById("overlay").hidden,
        overlayDisplay: getComputedStyle(document.getElementById("overlay")).display,
        openTitle: BF.app.S.book ? BF.app.S.book.title : null,
        saved: !!saved,
        template: saved ? saved.template : null,
        chapters: saved ? saved.chapters.length : 0,
        editor: !!document.querySelector("#view .manuscript[contenteditable]")
      };
    })()`);
    assert(made.overlayClosed, "wizard did not close after creating the book");
    assertEq(made.overlayDisplay, "none", "overlay must be fully hidden after the wizard closes");
    assertEq(made.openTitle, "Wizard Novel", "wizard should open the new book");
    assert(made.saved, "wizard book was not saved to storage");
    assertEq(made.template, "fiction", "selected template was not applied");
    assert(made.chapters >= 1, "template chapters missing");
    assert(made.editor, "manuscript editor did not open");
  });

  await test("every workspace view renders without errors", async () => {
    const views = ["dashboard", "books", "recent", "manuscript", "outline", "chapters", "notes", "research", "references", "assets", "comments", "versions", "export", "trash", "design", "review", "matter"];
    for (const view of views) {
      await c.evaluate(`(async () => { BF.app.setView(${JSON.stringify(view)}); await new Promise((r) => setTimeout(r, 250)); return true; })()`);
      const state = await c.evaluate(`(() => ({ children: document.getElementById("view").children.length, text: document.getElementById("view").innerText.trim().length }))()`);
      assert(state.children > 0 && state.text > 0, "view rendered empty: " + view);
    }
  });

  await test("no console errors or uncaught exceptions during the whole run", async () => {
    const errors = c.takeErrors();
    assertEq(errors.length, 0, "page reported errors:\n       " + errors.slice(0, 5).join("\n       "));
  });

  out("");
  const passed = results.filter((r) => r.ok).length;
  out(failures === 0
    ? "PASS — " + passed + "/" + results.length + " tests"
    : "FAIL — " + passed + "/" + results.length + " tests, " + failures + " failing");
} catch (err) {
  failures++;
  out("");
  out("HARNESS ERROR: " + err.message);
} finally {
  if (browser) { try { browser.kill(); } catch {} }
  if (server) { try { server.kill(); } catch {} }
  if (profileDir) { try { await rm(profileDir, { recursive: true, force: true, maxRetries: 3 }); } catch {} }
}

process.exit(failures ? 1 : 0);
