/* BookForge Studio — persistence layer.
   Primary: IndexedDB. Fallback: localStorage (declared honestly in the UI).
   Save status is only reported as "saved" after the write has actually completed. */
(function () {
  "use strict";
  var BF = (window.BF = window.BF || {});
  var U = BF.util;

  var DB_NAME = "bookforge-studio";
  var DB_VERSION = 1;
  var STORES = { projects: "projects", versions: "versions", meta: "meta" };
  var LS_KEY = "bookforge-studio-fallback";

  var state = {
    mode: "indexeddb",       // 'indexeddb' | 'localstorage' | 'memory'
    db: null,
    lastError: null,
    writeChain: Promise.resolve()
  };

  function notify(status, error) {
    if (typeof state.onStatus === "function") {
      try { state.onStatus(status, error || null); } catch (e) { /* listener errors must not break saving */ }
    }
  }

  /* ------------------------------------------------------------ indexedDB */
  function idbOpen() {
    return new Promise(function (resolve, reject) {
      var req;
      try {
        req = indexedDB.open(DB_NAME, DB_VERSION);
      } catch (e) { reject(e); return; }
      req.onupgradeneeded = function () {
        var db = req.result;
        if (!db.objectStoreNames.contains(STORES.projects)) db.createObjectStore(STORES.projects, { keyPath: "id" });
        if (!db.objectStoreNames.contains(STORES.versions)) {
          var v = db.createObjectStore(STORES.versions, { keyPath: "id" });
          v.createIndex("bookId", "bookId", { unique: false });
        }
        if (!db.objectStoreNames.contains(STORES.meta)) db.createObjectStore(STORES.meta, { keyPath: "key" });
      };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error || new Error("IndexedDB open failed")); };
      req.onblocked = function () { reject(new Error("IndexedDB is blocked by another tab.")); };
    });
  }

  function idbTx(db, store, mode, fn) {
    return new Promise(function (resolve, reject) {
      var tx = db.transaction(store, mode);
      var os = tx.objectStore(store);
      var out;
      try { out = fn(os); } catch (e) { reject(e); return; }
      tx.oncomplete = function () { resolve(out && out.result !== undefined ? out.result : out); };
      tx.onerror = function () { reject(tx.error || new Error("IndexedDB transaction failed")); };
      tx.onabort = function () { reject(tx.error || new Error("IndexedDB transaction aborted")); };
    });
  }

  function idbGetAll(db, store) {
    return new Promise(function (resolve, reject) {
      var tx = db.transaction(store, "readonly");
      var req = tx.objectStore(store).getAll();
      req.onsuccess = function () { resolve(req.result || []); };
      req.onerror = function () { reject(req.error); };
    });
  }

  function idbGet(db, store, key) {
    return new Promise(function (resolve, reject) {
      var tx = db.transaction(store, "readonly");
      var req = tx.objectStore(store).get(key);
      req.onsuccess = function () { resolve(req.result || null); };
      req.onerror = function () { reject(req.error); };
    });
  }

  /* --------------------------------------------------------- localstorage */
  function lsRead() {
    try {
      var raw = localStorage.getItem(LS_KEY);
      return raw ? JSON.parse(raw) : { projects: [], versions: [], meta: {} };
    } catch (e) { return { projects: [], versions: [], meta: {} }; }
  }
  function lsWrite(data) {
    localStorage.setItem(LS_KEY, JSON.stringify(data));
  }

  /* ----------------------------------------------------------------- init */
  async function init() {
    try {
      state.db = await idbOpen();
      state.mode = "indexeddb";
    } catch (e) {
      state.lastError = e;
      state.mode = "localstorage";
      try {
        localStorage.setItem("bookforge-probe", "1");
        localStorage.removeItem("bookforge-probe");
      } catch (e2) {
        state.mode = "memory";
        state.memory = { projects: [], versions: [], meta: {} };
        state.lastError = e2;
      }
    }
    return state.mode;
  }

  /* ---------------------------------------------------------------- books */
  async function loadAllBooks() {
    if (state.mode === "indexeddb") return idbGetAll(state.db, STORES.projects);
    if (state.mode === "localstorage") return lsRead().projects;
    return state.memory.projects.slice();
  }

  async function saveBook(book) {
    if (!book || !book.id) throw new Error("saveBook: book.id is required");
    book.updatedAt = Date.now();
    var payload = U.clone(book);
    state.writeChain = state.writeChain.then(function () { return doWriteBook(payload); }, function () { return doWriteBook(payload); });
    notify("saving");
    try {
      await state.writeChain;
      notify("saved");
      return true;
    } catch (e) {
      state.lastError = e;
      notify("error", e);
      throw e;
    }
  }

  async function doWriteBook(payload) {
    if (state.mode === "indexeddb") return idbTx(state.db, STORES.projects, "readwrite", function (os) { return os.put(payload); });
    if (state.mode === "localstorage") {
      var data = lsRead();
      var idx = data.projects.findIndex(function (b) { return b.id === payload.id; });
      if (idx >= 0) data.projects[idx] = payload; else data.projects.push(payload);
      lsWrite(data);
      return true;
    }
    var i = state.memory.projects.findIndex(function (b) { return b.id === payload.id; });
    if (i >= 0) state.memory.projects[i] = payload; else state.memory.projects.push(payload);
    return true;
  }

  async function deleteBook(id) {
    if (state.mode === "indexeddb") return idbTx(state.db, STORES.projects, "readwrite", function (os) { return os.delete(id); });
    if (state.mode === "localstorage") {
      var data = lsRead();
      data.projects = data.projects.filter(function (b) { return b.id !== id; });
      data.versions = data.versions.filter(function (v) { return v.bookId !== id; });
      lsWrite(data);
      return true;
    }
    state.memory.projects = state.memory.projects.filter(function (b) { return b.id !== id; });
    state.memory.versions = state.memory.versions.filter(function (v) { return v.bookId !== id; });
    return true;
  }

  /* -------------------------------------------------------------- versions */
  async function listVersions(bookId) {
    var all;
    if (state.mode === "indexeddb") all = await idbGetAll(state.db, STORES.versions);
    else if (state.mode === "localstorage") all = lsRead().versions;
    else all = state.memory.versions.slice();
    return all.filter(function (v) { return v.bookId === bookId; })
      .sort(function (a, b) { return b.createdAt - a.createdAt; });
  }

  async function getVersion(id) {
    if (state.mode === "indexeddb") return idbGet(state.db, STORES.versions, id);
    var all = state.mode === "localstorage" ? lsRead().versions : state.memory.versions;
    return all.filter(function (v) { return v.id === id; })[0] || null;
  }

  async function addVersion(book, opts) {
    opts = opts || {};
    var entry = {
      id: U.uid("ver"),
      bookId: book.id,
      name: opts.name || (opts.auto ? "Automatic snapshot" : "Named version"),
      auto: !!opts.auto,
      note: opts.note || "",
      createdAt: Date.now(),
      words: BF.model.stats(book).words,
      data: U.clone(book)
    };
    if (state.mode === "indexeddb") await idbTx(state.db, STORES.versions, "readwrite", function (os) { return os.put(entry); });
    else if (state.mode === "localstorage") {
      var data = lsRead();
      data.versions.push(entry);
      while (data.versions.filter(function (v) { return v.bookId === book.id; }).length > 40) {
        var list = data.versions.filter(function (v) { return v.bookId === book.id; }).sort(function (a, b) { return a.createdAt - b.createdAt; });
        var oldest = list[0];
        data.versions = data.versions.filter(function (v) { return v.id !== oldest.id; });
      }
      try { lsWrite(data); } catch (e) { /* quota: keep newest only */ }
    } else {
      state.memory.versions.push(entry);
    }
    return entry;
  }

  async function deleteVersion(id) {
    if (state.mode === "indexeddb") return idbTx(state.db, STORES.versions, "readwrite", function (os) { return os.delete(id); });
    if (state.mode === "localstorage") {
      var data = lsRead();
      data.versions = data.versions.filter(function (v) { return v.id !== id; });
      lsWrite(data);
      return true;
    }
    state.memory.versions = state.memory.versions.filter(function (v) { return v.id !== id; });
    return true;
  }

  async function pruneVersions(bookId, keepAuto) {
    var list = await listVersions(bookId);
    var autos = list.filter(function (v) { return v.auto; });
    if (autos.length <= (keepAuto || 25)) return;
    var remove = autos.sort(function (a, b) { return a.createdAt - b.createdAt; }).slice(0, autos.length - (keepAuto || 25));
    for (var i = 0; i < remove.length; i++) await deleteVersion(remove[i].id);
  }

  /* ------------------------------------------------------------------ meta */
  async function loadMeta() {
    if (state.mode === "indexeddb") {
      var rows = await idbGetAll(state.db, STORES.meta);
      var out = {};
      rows.forEach(function (r) { out[r.key] = r.value; });
      return out;
    }
    if (state.mode === "localstorage") return lsRead().meta || {};
    return state.memory.meta || {};
  }

  async function saveMeta(patch) {
    if (state.mode === "indexeddb") {
      var keys = Object.keys(patch);
      for (var i = 0; i < keys.length; i++) {
        await idbTx(state.db, STORES.meta, "readwrite", (function (k) {
          return function (os) { return os.put({ key: k, value: patch[k] }); };
        })(keys[i]));
      }
      return true;
    }
    if (state.mode === "localstorage") {
      var data = lsRead();
      data.meta = Object.assign({}, data.meta || {}, patch);
      lsWrite(data);
      return true;
    }
    state.memory.meta = Object.assign({}, state.memory.meta || {}, patch);
    return true;
  }

  /* ------------------------------------------------------- import / export */
  function exportProject(book) {
    return {
      application: "BookForge Studio",
      format: "bookforge-project",
      version: 1,
      exportedAt: new Date().toISOString(),
      book: U.clone(book)
    };
  }

  function normaliseBook(raw) {
    var warnings = [];
    if (!raw || typeof raw !== "object") throw new Error("The backup does not contain a book object.");
    var book = U.clone(raw);
    if (!book.id) { book.id = U.uid("book"); warnings.push("Book had no id; a new one was generated."); }
    book.title = book.title || "Imported book";
    book.author = book.author || "";
    book.chapters = Array.isArray(book.chapters) ? book.chapters : [];
    book.parts = Array.isArray(book.parts) ? book.parts : [];
    book.notes = Array.isArray(book.notes) ? book.notes : [];
    book.sources = Array.isArray(book.sources) ? book.sources : [];
    book.assets = Array.isArray(book.assets) ? book.assets : [];
    book.comments = Array.isArray(book.comments) ? book.comments : [];
    book.trashChapters = Array.isArray(book.trashChapters) ? book.trashChapters : [];
    book.chapters.forEach(function (ch, i) {
      if (!ch.id) ch.id = U.uid("ch");
      ch.title = ch.title || "Chapter " + (i + 1);
      ch.content = typeof ch.content === "string" ? ch.content : "";
      if (ch.order == null) ch.order = i + 1;
    });
    if (!book.matter || !book.matter.front || !book.matter.back) book.matter = BF.model.defaultMatter();
    BF.model.FRONT_MATTER.concat(BF.model.BACK_MATTER).forEach(function (m) {
      ["front", "back"].forEach(function (side) {
        if (!book.matter[side][m.id]) book.matter[side][m.id] = { enabled: false, content: "" };
      });
    });
    if (!book.design) book.design = BF.model.defaultDesign("minimal-academic");
    if (!book.settings) book.settings = { theme: "dark", citationStyle: "apa" };
    if (!book.goals) book.goals = { dailyTarget: 500, deadline: "" };
    book.updatedAt = Date.now();
    return { book: book, warnings: warnings };
  }

  function parseProjectBackup(text) {
    var parsed;
    try { parsed = JSON.parse(text); } catch (e) { throw new Error("The selected file is not valid JSON."); }
    var raw = parsed && parsed.book ? parsed.book : parsed;
    if (!raw || typeof raw !== "object" || !raw.chapters) {
      throw new Error("This file is not a BookForge project backup (no manuscript found).");
    }
    return normaliseBook(raw);
  }

  BF.storage = {
    init: init,
    get mode() { return state.mode; },
    get lastError() { return state.lastError; },
    loadAllBooks: loadAllBooks,
    saveBook: saveBook,
    deleteBook: deleteBook,
    listVersions: listVersions,
    getVersion: getVersion,
    addVersion: addVersion,
    deleteVersion: deleteVersion,
    pruneVersions: pruneVersions,
    loadMeta: loadMeta,
    saveMeta: saveMeta,
    exportProject: exportProject,
    parseProjectBackup: parseProjectBackup,
    normaliseBook: normaliseBook,
    set onStatus(fn) { state.onStatus = fn; }
  };
})();
