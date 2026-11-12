/* BookForge Studio — optional cloud sync.
   Local-first stays the source of truth: IndexedDB is always written first, then a
   background push/pull reconciles with the sync service using last-write-wins on
   each book's `updatedAt`. Nothing here runs until the writer connects a sync code. */
(function () {
  "use strict";
  var BF = (window.BF = window.BF || {});
  var U = BF.util;

  var DEFAULT_SERVER = "https://bookforge-sync.bookforge-sync.workers.dev";
  var PUSH_DEBOUNCE_MS = 12000;
  var AUTO_INTERVAL_MS = 60000;

  var st = {
    enabled: false,
    code: "",
    server: DEFAULT_SERVER,
    lastSyncAt: 0,
    lastError: null,
    status: "off",       // off | idle | syncing | error
    busy: false,
    onChange: null,
    timer: null,
    pendingPush: {},
    pushTimer: null
  };

  function emit() {
    if (typeof st.onChange === "function") {
      try { st.onChange(status()); } catch (e) { /* UI listeners must not break sync */ }
    }
  }

  function status() {
    return {
      enabled: st.enabled,
      status: st.status,
      lastSyncAt: st.lastSyncAt,
      lastError: st.lastError,
      code: st.code,
      server: st.server,
      busy: st.busy
    };
  }

  function setStatus(next, error) {
    st.status = next;
    st.lastError = error || null;
    emit();
  }

  function randomCode() {
    var bytes = new Uint8Array(24);
    crypto.getRandomValues(bytes);
    var s = "";
    for (var i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
    return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }

  function cleanServer(url) {
    var v = String(url || "").trim().replace(/\/+$/, "");
    if (!v) return DEFAULT_SERVER;
    if (!/^https?:\/\//i.test(v)) v = "https://" + v;
    return v;
  }

  async function req(method, path, body) {
    var headers = { Authorization: "Bearer " + st.code };
    if (body !== undefined) headers["Content-Type"] = "application/json";
    var res = await fetch(st.server + path, {
      method: method,
      headers: headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      cache: "no-store"
    });
    var text = await res.text();
    var data = null;
    try { data = text ? JSON.parse(text) : null; } catch (e) { data = { error: text }; }
    if (!res.ok) {
      var msg = (data && (data.error || data.message)) || ("Sync server returned " + res.status);
      throw new Error(msg);
    }
    return data;
  }

  /* ------------------------------------------------------------------ setup */
  function init(meta) {
    var saved = (meta && meta.sync) || {};
    st.code = saved.code || "";
    st.server = cleanServer(saved.server || DEFAULT_SERVER);
    st.enabled = !!saved.enabled && !!st.code;
    st.lastSyncAt = Number(saved.lastSyncAt) || 0;
    st.status = st.enabled ? "idle" : "off";
    if (st.enabled) {
      startAuto();
      setTimeout(function () { syncNow({ quiet: true }); }, 1500);
    }
    emit();
  }

  function persist() {
    return BF.storage.saveMeta({
      sync: {
        code: st.code,
        server: st.server,
        enabled: st.enabled,
        lastSyncAt: st.lastSyncAt
      }
    });
  }

  async function enable(code, server) {
    var c = String(code || "").trim();
    if (c.length < 16) throw new Error("A sync code is at least 16 characters.");
    st.code = c;
    st.server = cleanServer(server);
    st.enabled = true;
    st.status = "idle";
    st.lastError = null;
    await persist();
    startAuto();
    emit();
    return syncNow();
  }

  async function disable() {
    st.enabled = false;
    st.status = "off";
    st.lastError = null;
    stopAuto();
    await persist();
    emit();
  }

  function newCode() {
    st.code = randomCode();
    return st.code;
  }

  /* -------------------------------------------------------------- transport */
  function localMap(books) {
    var map = {};
    (books || []).forEach(function (b) { map[b.id] = b; });
    return map;
  }

  async function pushBook(book) {
    return req("PUT", "/v1/books/" + encodeURIComponent(book.id), {
      updatedAt: book.updatedAt || Date.now(),
      data: book
    });
  }

  async function pullBook(id) {
    var row = await req("GET", "/v1/books/" + encodeURIComponent(id));
    if (!row || !row.data) return null;
    return row.data;
  }

  /* ------------------------------------------------------------------- sync */
  async function syncNow(opts) {
    opts = opts || {};
    if (!st.enabled || st.busy) return { ok: false, reason: "disabled-or-busy" };
    st.busy = true;
    setStatus("syncing");
    var pushed = 0, pulled = 0, removed = 0, failed = 0;
    var changedIds = [], deletedIds = [];
    try {
      if (BF.app && BF.app.S && BF.app.S.dirty) {
        try { await BF.app.saveNow("sync"); } catch (e) { /* keep going with what is on disk */ }
      }

      var remote = await req("GET", "/v1/books");
      var remoteMap = {};
      ((remote && remote.books) || []).forEach(function (r) { remoteMap[r.id] = r; });

      var localBooks = await BF.storage.loadAllBooks();
      var locals = localMap(localBooks);

      var ids = Object.keys(locals);
      for (var i = 0; i < ids.length; i++) {
        var book = locals[ids[i]];
        var r = remoteMap[book.id];
        var localAt = Number(book.updatedAt) || 0;
        try {
          if (!r) {
            await pushBook(book); pushed++;
          } else if (r.deleted && r.updatedAt > localAt) {
            await BF.storage.deleteBook(book.id); removed++; deletedIds.push(book.id);
          } else if (!r.deleted && localAt > (Number(r.updatedAt) || 0)) {
            await pushBook(book); pushed++;
          } else if (!r.deleted && (Number(r.updatedAt) || 0) > localAt) {
            var fresh = await pullBook(book.id);
            if (fresh) {
              fresh.updatedAt = Number(r.updatedAt) || fresh.updatedAt;
              await BF.storage.putBookRaw(fresh);
              pulled++; changedIds.push(book.id);
            }
          }
        } catch (e) { failed++; st.lastError = e; }
      }

      var remoteIds = Object.keys(remoteMap);
      for (var j = 0; j < remoteIds.length; j++) {
        var id = remoteIds[j];
        if (locals[id]) continue;
        var rr = remoteMap[id];
        if (rr.deleted) continue;
        try {
          var data = await pullBook(id);
          if (data) {
            await BF.storage.putBookRaw(data);
            pulled++; changedIds.push(id);
          }
        } catch (e) { failed++; st.lastError = e; }
      }

      st.lastSyncAt = Date.now();
      if (!failed) st.lastError = null;
      await persist();
      setStatus(failed ? "error" : "idle", failed ? st.lastError : null);

      if (changedIds.length || deletedIds.length) {
        if (BF.app && BF.app.refreshAfterSync) await BF.app.refreshAfterSync(changedIds, deletedIds);
      }

      var summary = { ok: !failed, pushed: pushed, pulled: pulled, removed: removed, failed: failed };
      if (!opts.quiet && BF.app && BF.app.toast) {
        if (failed) BF.app.toast("Sync finished with " + failed + " error(s): " + (st.lastError && st.lastError.message), "error");
        else if (!pushed && !pulled && !removed) BF.app.toast("Already up to date");
        else BF.app.toast("Synced — " + pushed + " uploaded, " + pulled + " downloaded" + (removed ? ", " + removed + " removed" : ""));
      }
      return summary;
    } catch (e) {
      st.lastError = e;
      setStatus("error", e);
      if (!opts.quiet && BF.app && BF.app.toast) BF.app.toast("Sync failed: " + e.message, "error");
      return { ok: false, error: e };
    } finally {
      st.busy = false;
      emit();
    }
  }

  /* --------------------------------------------------------------- triggers */
  function queuePush(book) {
    if (!st.enabled || !book || !book.id) return;
    st.pendingPush[book.id] = true;
    if (st.pushTimer) clearTimeout(st.pushTimer);
    st.pushTimer = setTimeout(function () {
      st.pendingPush = {};
      syncNow({ quiet: true });
    }, PUSH_DEBOUNCE_MS);
  }

  function onBookSaved(book) {
    queuePush(book);
  }

  async function onBookDeleted(id) {
    if (!st.enabled || !id) return;
    try {
      await req("DELETE", "/v1/books/" + encodeURIComponent(id) + "?updatedAt=" + Date.now());
    } catch (e) {
      st.lastError = e;
      setStatus("error", e);
    }
  }

  function startAuto() {
    stopAuto();
    st.timer = setInterval(function () {
      if (document.visibilityState === "visible") syncNow({ quiet: true });
    }, AUTO_INTERVAL_MS);
  }

  function stopAuto() {
    if (st.timer) clearInterval(st.timer);
    st.timer = null;
    if (st.pushTimer) clearTimeout(st.pushTimer);
    st.pushTimer = null;
  }

  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState === "visible" && st.enabled) syncNow({ quiet: true });
  });
  window.addEventListener("online", function () {
    if (st.enabled) syncNow({ quiet: true });
  });

  BF.sync = {
    DEFAULT_SERVER: DEFAULT_SERVER,
    init: init,
    status: status,
    enable: enable,
    disable: disable,
    newCode: newCode,
    syncNow: syncNow,
    onBookSaved: onBookSaved,
    onBookDeleted: onBookDeleted,
    set onChange(fn) { st.onChange = fn; },
    get enabled() { return st.enabled; }
  };
})();
