/* BookForge Studio — application shell: state, saving, navigation, dialogs. */
(function () {
  "use strict";
  var BF = (window.BF = window.BF || {});
  var U = BF.util;
  var $ = U.qs;

  var S = {
    books: [],
    book: null,
    view: "dashboard",
    chapterId: null,
    mode: "studio",
    sidebarCollapsed: false,
    contextVisible: true,
    saveState: "saved",
    saveError: null,
    dirty: false,
    editor: null,
    zoom: 100,
    lastSnapshot: 0,
    sessionStart: Date.now(),
    aiOutput: "",
    pageView: false,
    storageMode: "indexeddb"
  };

  var refs = {};

  /* ------------------------------------------------------------------ icons */
  var ICON_PATHS = {
    dashboard: "M2 2h5v5H2zM9 2h5v5H9zM2 9h5v5H2zM9 9h5v5H9z",
    books: "M3 2h7a2 2 0 0 1 2 2v8a3 3 0 0 0-3-3H3zM3 2v9M12 4h1v10H4",
    clock: "M8 4v4l3 2M8 14A6 6 0 1 0 8 2a6 6 0 0 0 0 12z",
    outline: "M2 3h2M6 3h8M2 8h2M6 8h8M2 13h2M6 13h8",
    chapters: "M3 2h10v12H3zM5 5h6M5 8h6M5 11h4",
    write: "M3 13l1-3 7-7 2 2-7 7zM10 4l2 2",
    notes: "M4 2h8v12l-4-3-4 3z",
    research: "M7 13a5 5 0 1 0 0-10 5 5 0 0 0 0 10zM14 14l-3-3",
    refs: "M4 2h7l3 3v9H4zM7 6h5M7 9h5",
    assets: "M2 3h12v10H2zM2 10l3-3 3 3 2-2 4 4M11 6h.01",
    comments: "M2 3h12v8H6l-4 3z",
    versions: "M8 2v6l4 2M8 14A6 6 0 1 0 8 2a6 6 0 0 0 0 12zM2 5l-.5-3M2 5l3-.5",
    export: "M8 2v8M5 7l3 3 3-3M2 13h12",
    design: "M2 2h12v12H2zM2 6h12M6 6v8",
    review: "M8 2l5 2v4c0 3-2 5-5 6-3-1-5-3-5-6V4zM6 8l1.5 1.5L10 7",
    matter: "M3 2h10v3H3zM3 7h10v7H3z",
    trash: "M3 4h10M6 4V2h4v2M5 4l1 10h4l1-10",
    ai: "M8 2l1.6 4.4L14 8l-4.4 1.6L8 14l-1.6-4.4L2 8l4.4-1.6z"
  };

  function icon(name) {
    var d = ICON_PATHS[name] || ICON_PATHS.dashboard;
    return '<svg class="nav-ico" width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="' + d + '"/></svg>';
  }

  /* ------------------------------------------------------------------ toast */
  var toastTimer = null;
  function toast(message, kind) {
    var el = document.getElementById("toast");
    el.textContent = message;
    el.dataset.kind = kind || "info";
    el.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.classList.remove("show"); }, kind === "error" ? 5200 : 2600);
  }

  /* ----------------------------------------------------------------- saving */
  function setSaveState(state, error) {
    S.saveState = state;
    S.saveError = error || null;
    var box = refs.saveStatus;
    if (!box) return;
    box.dataset.state = state;
    var labels = { saved: "Saved", dirty: "Unsaved changes", saving: "Saving…", error: "Save failed" };
    refs.saveText.textContent = state === "error" ? "Save failed — click to retry" : labels[state] || state;
    box.title = state === "error" && error ? error.message : labels[state] || "";
  }

  function markDirty() {
    S.dirty = true;
    setSaveState("dirty");
    scheduleSave();
  }

  var scheduleSave = U.debounce(function () { saveNow("autosave"); }, 900);

  async function saveNow(reason) {
    if (!S.book) return false;
    try {
      await BF.storage.saveBook(S.book);
      S.dirty = false;
      setSaveState("saved");
      maybeSnapshot(reason);
      return true;
    } catch (e) {
      setSaveState("error", e);
      toast("Save failed: " + e.message, "error");
      return false;
    }
  }

  async function saveBookNow(book) {
    if (!book || !book.id) return false;
    try {
      await BF.storage.saveBook(book);
      return true;
    } catch (e) {
      toast('Could not save "' + (book.title || "book") + '": ' + e.message, "error");
      return false;
    }
  }

  function maybeSnapshot(reason) {
    if (!S.book) return;
    var now = Date.now();
    if (reason === "manual") return;
    if (now - S.lastSnapshot < 5 * 60 * 1000) return;
    S.lastSnapshot = now;
    BF.storage.addVersion(S.book, { auto: true, name: "Recovery snapshot" })
      .then(function () { return BF.storage.pruneVersions(S.book.id, 25); })
      .catch(function () { /* snapshot failures must not break writing */ });
  }

  function retrySave() {
    saveNow("retry").then(function (ok) {
      if (ok) toast("Saved successfully");
    });
  }

  /* ------------------------------------------------------------------ theme */
  function applyTheme(theme) {
    document.documentElement.setAttribute("data-theme", theme);
    if (S.book) {
      S.book.settings.theme = theme;
      S.book.design = S.book.design || {};
      if (window.BF.globalSettings) {
        BF.globalSettings.theme = theme;
        BF.storage.saveMeta({ globalSettings: BF.globalSettings });
      }
    }
  }

  /* ---------------------------------------------------------------- dialogs */
  function openDialog(opts) {
    var overlay = refs.overlay;
    overlay.hidden = false;
    overlay.innerHTML = "";
    var dialog = U.el("div", { class: "dialog" + (opts.wide ? " wide" : "") + (opts.narrow ? " narrow" : ""), role: "dialog", "aria-modal": "true", "aria-label": opts.title || "Dialog" });
    var head = U.el("div", { class: "dialog-head" }, [
      U.el("h2", { text: opts.title || "" }),
      U.el("button", { class: "icon-btn", title: "Close", "aria-label": "Close", onclick: function () { close(); } }, ["✕"])
    ]);
    var body = U.el("div", { class: "dialog-body" });
    if (typeof opts.body === "string") body.innerHTML = opts.body;
    else if (opts.body) body.appendChild(opts.body);
    dialog.appendChild(head);
    dialog.appendChild(body);
    var foot = null;
    if (opts.actions && opts.actions.length) {
      foot = U.el("div", { class: "dialog-foot" });
      opts.actions.forEach(function (a) {
        foot.appendChild(U.el("button", {
          class: "btn " + (a.primary ? "primary" : a.danger ? "danger" : "ghost"),
          text: a.label,
          onclick: function () { if (a.onClick) a.onClick(close, body); else close(); }
        }));
      });
      dialog.appendChild(foot);
    }
    overlay.appendChild(dialog);
    function close() {
      overlay.hidden = true;
      overlay.innerHTML = "";
      overlay.onmousedown = null;
      document.removeEventListener("keydown", onKey);
      if (opts.onClose) opts.onClose();
    }
    function onKey(e) {
      if (e.key === "Escape") { e.preventDefault(); close(); }
      if (e.key === "Tab") trapFocus(e, dialog);
    }
    document.addEventListener("keydown", onKey);
    var focusable = dialog.querySelector("input, select, textarea, button.primary, button");
    if (focusable) setTimeout(function () { focusable.focus(); }, 30);
    overlay.onmousedown = function (e) { if (e.target === overlay) close(); };
    return { close: close, body: body, dialog: dialog, foot: foot };
  }

  function trapFocus(e, container) {
    var items = U.qsa('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])', container)
      .filter(function (el) { return el.offsetParent !== null; });
    if (!items.length) return;
    var first = items[0], last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }

  function confirmDialog(opts) {
    return new Promise(function (resolve) {
      var settled = false;
      function done(value) {
        if (settled) return;
        settled = true;
        resolve(value);
      }
      openDialog({
        title: opts.title || "Please confirm",
        narrow: true,
        body: U.el("div", {}, [U.el("p", { text: opts.message || "Are you sure?" })]),
        actions: [
          { label: opts.cancelLabel || "Cancel", onClick: function (close) { done(false); close(); } },
          {
            label: opts.confirmLabel || "Confirm", primary: !opts.danger, danger: !!opts.danger,
            onClick: function (close) { done(true); close(); }
          }
        ],
        onClose: function () { done(false); }
      });
    });
  }

  function formDialog(opts) {
    return new Promise(function (resolve) {
      var settled = false;
      function done(value) {
        if (settled) return;
        settled = true;
        resolve(value);
      }
      var form = U.el("form", { class: "bf-form", onsubmit: function (e) { e.preventDefault(); submit(closeRef); } });
      var inputs = {};
      (opts.fields || []).forEach(function (f) {
        var field = U.el("div", { class: "field" });
        if (f.type !== "checkbox") field.appendChild(U.el("label", { for: "f_" + f.name, text: f.label }));
        var input;
        if (f.type === "textarea") {
          input = U.el("textarea", { id: "f_" + f.name, rows: f.rows || 5, placeholder: f.placeholder || "" });
          input.value = f.value || "";
        } else if (f.type === "select") {
          input = U.el("select", { id: "f_" + f.name });
          (f.options || []).forEach(function (o) {
            var option = U.el("option", { value: o.value, text: o.label });
            if (String(o.value) === String(f.value)) option.selected = true;
            input.appendChild(option);
          });
        } else if (f.type === "checkbox") {
          input = U.el("input", { id: "f_" + f.name, type: "checkbox" });
          input.checked = !!f.value;
          field.appendChild(U.el("label", { class: "check", for: "f_" + f.name }, [input, U.el("span", { text: f.label })]));
        } else {
          input = U.el("input", { id: "f_" + f.name, type: f.type || "text", placeholder: f.placeholder || "" });
          input.value = f.value == null ? "" : f.value;
        }
        if (input.tagName !== "LABEL") field.appendChild(input);
        if (f.help) field.appendChild(U.el("div", { class: "help", text: f.help }));
        inputs[f.name] = input;
        form.appendChild(field);
      });
      var actions = [];
      if (opts.extraActions) actions = actions.concat(opts.extraActions);
      actions.push({ label: "Cancel", onClick: function (close) { done(null); close(); } });
      actions.push({ label: opts.submitLabel || "Save", primary: true, onClick: function () { submit(closeRef); } });

      var closeRef = openDialog({
        title: opts.title,
        wide: opts.wide,
        body: form,
        actions: actions,
        onClose: function () { done(null); }
      });

      function submit(close) {
        var values = {};
        (opts.fields || []).forEach(function (f) {
          var input = inputs[f.name];
          values[f.name] = f.type === "checkbox" ? input.checked : input.value;
        });
        var error = null;
        (opts.fields || []).forEach(function (f) {
          if (f.required && !values[f.name] && !error) error = f.label + " is required.";
        });
        if (error) { toast(error, "error"); return; }
        var result = opts.onSubmit ? opts.onSubmit(values) : values;
        if (result === false) return;
        done(result === undefined ? values : result);
        var doClose = typeof close === "function" ? close : (close && close.close);
        if (doClose) doClose();
      }
    });
  }

  function promptDialog(opts) {
    return formDialog({
      title: opts.title,
      narrow: true,
      fields: [{ name: "value", label: opts.label, value: opts.value || "", required: opts.required !== false, type: opts.type || "text", help: opts.help }],
      submitLabel: opts.submitLabel || "OK"
    }).then(function (r) { return r ? r.value : null; });
  }

  /* ------------------------------------------------------------ context menu */
  function contextMenu(items, x, y) {
    var menu = U.el("div", { class: "menu", style: "position:fixed;z-index:80;left:" + x + "px;top:" + y + "px;display:block" });
    items.forEach(function (it) {
      menu.appendChild(U.el("button", { text: it.label, onclick: function () { document.body.removeChild(menu); it.onClick(); } }));
    });
    document.body.appendChild(menu);
    setTimeout(function () {
      document.addEventListener("mousedown", function close(ev) {
        if (!menu.contains(ev.target)) { menu.remove(); document.removeEventListener("mousedown", close); }
      });
    }, 0);
  }

  /* ------------------------------------------------------------------- nav */
  var NAV = [
    { group: "Workspace" },
    { id: "dashboard", label: "Dashboard", icon: "dashboard" },
    { id: "books", label: "All books", icon: "books" },
    { id: "recent", label: "Recent projects", icon: "clock" },
    { group: "Writing" },
    { id: "manuscript", label: "Manuscript", icon: "write" },
    { id: "outline", label: "Book outline", icon: "outline" },
    { id: "chapters", label: "Chapters", icon: "chapters" },
    { group: "Material" },
    { id: "notes", label: "Notes", icon: "notes" },
    { id: "research", label: "Research library", icon: "research" },
    { id: "references", label: "References", icon: "refs" },
    { id: "assets", label: "Assets & images", icon: "assets" },
    { group: "Production" },
    { id: "design", label: "Design studio", icon: "design" },
    { id: "review", label: "Editorial review", icon: "review" },
    { id: "matter", label: "Front & back matter", icon: "matter" },
    { id: "export", label: "Export center", icon: "export" },
    { id: "versions", label: "Version history", icon: "versions" },
    { id: "comments", label: "Comments", icon: "comments" },
    { group: "System" },
    { id: "trash", label: "Trash", icon: "trash" }
  ];

  function renderNav() {
    var nav = refs.nav;
    nav.innerHTML = "";
    NAV.forEach(function (item) {
      if (item.group) { nav.appendChild(U.el("div", { class: "nav-group", text: item.group })); return; }
      var b = U.el("button", { type: "button", title: item.label, onclick: function () { setView(item.id); } });
      b.innerHTML = icon(item.icon) + '<span>' + item.label + "</span>";
      b.dataset.view = item.id;
      nav.appendChild(b);
    });
  }

  function setView(view) {
    S.view = view;
    U.qsa(".nav button", refs.nav).forEach(function (b) {
      if (b.dataset.view === view) b.setAttribute("aria-current", "page");
      else b.removeAttribute("aria-current");
    });
    if (view === "manuscript" && !S.chapterId && S.book && S.book.chapters.length) {
      S.chapterId = S.book.chapters[0].id;
    }
    render();
  }

  function render() {
    syncTopbar();
    renderContext();
    renderStatus();
    var pagesMode = S.view === "manuscript" && !!S.pageView && !!S.book;
    document.body.classList.toggle("pages-mode", pagesMode);
    document.body.classList.toggle("manuscript-draft", S.view === "manuscript" && !S.pageView && !!S.book);
    document.body.classList.toggle("manuscript-pages", pagesMode);
    var fn = BF.views[S.view];
    var main = refs.view;
    main.innerHTML = "";
    var wide = S.view === "manuscript" || S.view === "design";
    main.classList.toggle("wide", wide);
    if (typeof fn === "function") {
      var node = fn();
      if (node) main.appendChild(node);
    } else {
      main.appendChild(U.el("div", { class: "empty" }, [U.el("h3", { text: "Not available" })]));
    }
    if (S.view === "manuscript" && S.editor) {
      setTimeout(function () { S.editor.focus(); }, 60);
    }
    var editable = S.view === "manuscript" && !!S.editor && !!S.book;
    refs.btnUndo.disabled = !editable;
    refs.btnRedo.disabled = !editable;
  }

  function syncTopbar() {
    var b = S.book;
    refs.topBookTitle.textContent = b ? b.title : "No book open";
    refs.topBookSub.textContent = b ? ((b.author || "No author") + " · " + BF.model.stats(b).words.toLocaleString() + " words") : "Create or open a book to begin";
    document.getElementById("avatarLetter").textContent = (b && b.author ? b.author.trim().charAt(0) : "A").toUpperCase();
    var exportMenuButtons = U.qsa("#exportMenu button", refs.exportMenu);
    exportMenuButtons.forEach(function (btn) { btn.disabled = !b; });
    refs.btnPrint.disabled = !b;
    var modeSelect = refs.modeSelect;
    if (modeSelect.value !== S.mode) modeSelect.value = S.mode;
    document.body.dataset.mode = S.mode;
  }

  function renderStatus() {
    var b = S.book;
    var ch = currentChapter();
    var stats = b ? BF.model.stats(b) : { words: 0, chars: 0, readingMinutes: 0, progress: 0 };
    var chWords = ch ? BF.model.chapterWords(ch) : 0;
    refs.stChapter.textContent = ch ? ch.title : (b ? "No chapter selected" : "No book open");
    refs.stWords.textContent = b ? stats.words.toLocaleString() + " words" : "0 words";
    refs.stChars.textContent = b ? stats.chars.toLocaleString() + " characters" : "0 characters";
    refs.stRead.textContent = (ch ? U.readingMinutes(chWords) : stats.readingMinutes) + " min read";
    refs.stTarget.textContent = b && b.targetWords ? "Target " + b.targetWords.toLocaleString() + " words (" + Math.round(stats.progress * 100) + "%)" : "No target set";
    refs.stPage.textContent = b ? "~" + Math.max(1, Math.round(stats.words / estimateWordsPerPage(b))) + " pages (estimate)" : "—";
    refs.stZoom.textContent = S.zoom + "%";
  }

  function estimateWordsPerPage(book) {
    var d = book.design || {};
    var geo = BF.layout.geometry(book);
    var lineHeightMm = ((Number(d.bodySize) || 11) * (Number(d.lineHeight) || 1.5)) * (25.4 / 72);
    var lines = Math.max(10, Math.floor(geo.contentH / lineHeightMm));
    return Math.max(150, Math.round(lines * 11));
  }

  /* --------------------------------------------------------------- context */
  function renderContext() {
    var panel = refs.context;
    panel.innerHTML = "";
    if (!S.contextVisible) { refs.workspace.classList.add("context-hidden"); return; }
    refs.workspace.classList.remove("context-hidden");
    var b = S.book;

    panel.appendChild(U.el("div", { class: "view-head", style: "margin-bottom:10px" }, [
      U.el("h3", { text: "Context", style: "margin:0" }),
      U.el("button", {
        class: "icon-btn", title: "Hide context panel", "aria-label": "Hide context panel",
        onclick: function () { S.contextVisible = false; renderContext(); }
      }, ["✕"])
    ]));

    if (!b) {
      panel.appendChild(U.el("p", { class: "small muted", text: "Open a book to see chapter details, targets and research." }));
      return;
    }

    var stats = BF.model.stats(b);
    var ch = currentChapter();

    var docBlock = U.el("div", { class: "ctx-block" }, [
      U.el("h3", { text: "Document" }),
      list([
        ["Title", b.title],
        ["Author", b.author || "—"],
        ["Chapters", String(b.chapters.length)],
        ["Words", stats.words.toLocaleString()],
        ["Target", b.targetWords ? b.targetWords.toLocaleString() : "not set"],
        ["Template", (BF.model.TEMPLATES.filter(function (t) { return t.id === b.template; })[0] || {}).name || "—"]
      ])
    ]);
    panel.appendChild(docBlock);

    if (ch) {
      panel.appendChild(U.el("div", { class: "ctx-block" }, [
        U.el("h3", { text: "Current chapter" }),
        list([
          ["Title", ch.title],
          ["Words", BF.model.chapterWords(ch).toLocaleString()],
          ["Status", ch.status],
          ["Headings", String(BF.model.headingsFromHtml(ch.content).length)]
        ])
      ]));
      var linked = (b.notes || []).filter(function (n) { return n.chapterId === ch.id; });
      if (linked.length) {
        panel.appendChild(U.el("div", { class: "ctx-block" }, [
          U.el("h3", { text: "Linked notes" })
        ].concat(linked.slice(0, 6).map(function (n) {
          return U.el("p", { class: "small", style: "margin:4px 0", text: "• " + n.title });
        }))));
      }
    }

    panel.appendChild(U.el("div", { class: "ctx-block" }, [
      U.el("h3", { text: "Writing target" }),
      U.el("p", { class: "small muted", text: b.goals && b.goals.dailyTarget ? "Daily goal: " + b.goals.dailyTarget + " words" : "No daily goal set" }),
      progressBar(b.targetWords ? stats.progress : 0),
      U.el("p", { class: "small muted", style: "margin-top:6px", text: stats.words.toLocaleString() + " of " + (b.targetWords || 0).toLocaleString() + " words" })
    ]));

    var cited = BF.model.citedIds(b);
    panel.appendChild(U.el("div", { class: "ctx-block" }, [
      U.el("h3", { text: "References" }),
      list([
        ["Sources", String((b.sources || []).length)],
        ["Cited in text", String(cited.length)],
        ["Style", (b.settings.citationStyle || "apa").toUpperCase()]
      ])
    ]));

    if (S.view === "manuscript") panel.appendChild(aiBlock(b));
    panel.appendChild(U.el("div", { class: "ctx-block" }, [
      U.el("h3", { text: "Selection" }),
      U.el("p", { class: "small muted", id: "ctxSelection", text: "Select text in the manuscript to see word count." })
    ]));
  }

  function list(rows) {
    var ul = U.el("ul", { class: "ctx-list" });
    rows.forEach(function (r) {
      ul.appendChild(U.el("li", {}, [U.el("span", { text: r[0] }), U.el("span", { text: r[1] })]));
    });
    return ul;
  }

  function progressBar(p) {
    var bar = U.el("div", { class: "bar" });
    bar.appendChild(U.el("i", { style: "width:" + Math.round(Math.max(0, Math.min(1, p)) * 100) + "%" }));
    return bar;
  }

  /* ------------------------------------------------------------- AI assistant */
  function aiEndpoint() {
    return (BF.globalSettings && BF.globalSettings.aiEndpoint) || "";
  }

  function aiBlock(book) {
    var block = U.el("div", { class: "ctx-block ai-panel" });
    block.appendChild(U.el("h3", { text: "AI assistant" }));
    if (!aiEndpoint()) {
      block.appendChild(U.el("div", {
        class: "ai-status",
        text: "Not configured. BookForge does not call any AI service until you connect your own server endpoint in Settings → AI. All writing features work without it."
      }));
      block.appendChild(U.el("button", {
        class: "btn ghost sm", text: "How to configure",
        onclick: function () {
          openDialog({
            title: "Connecting an AI assistant (optional)",
            body: "<p>BookForge never stores API keys in the browser. Provide a small server endpoint that accepts a JSON POST and returns JSON.</p>" +
              "<p><b>Request</b><br><code>{ \"action\": \"correct\", \"text\": \"…\", \"context\": { \"title\": \"…\", \"chapter\": \"…\" } }</code></p>" +
              "<p><b>Response</b><br><code>{ \"suggestion\": \"…\", \"notes\": \"optional\" }</code></p>" +
              "<p>Your server calls the AI provider with its own secret key. Then paste the endpoint URL in Settings → AI. Suggestions are always shown separately and are never written into the manuscript without your action.</p>",
            actions: [{ label: "Open settings", primary: true, onClick: function (close) { close(); openSettings(); } }]
          });
        }
      }));
      return block;
    }
    var select = U.el("select", { id: "aiAction" });
    [["correct", "Correct grammar & punctuation"], ["improve", "Improve clarity"], ["tone", "Adjust tone"], ["simplify", "Simplify language"],
      ["repetition", "Identify repetition"], ["transition", "Suggest transitions"],
      ["outline", "Suggest chapter structure"], ["brainstorm", "Brainstorm ideas"],
      ["summary", "Chapter summary"], ["questions", "Discussion questions"],
      ["exercises", "Draft exercises"], ["glossary", "Glossary entries"],
      ["consistency", "Review consistency"], ["feedback", "Editorial feedback"]].forEach(function (a) {
      select.appendChild(U.el("option", { value: a[0], text: a[1] }));
    });
    block.appendChild(select);
    block.appendChild(U.el("button", {
      class: "btn ghost sm", style: "margin-top:8px", text: "Generate suggestion",
      onclick: async function () {
        var ch = currentChapter();
        var sel = window.getSelection();
        var selected = sel && String(sel).trim();
        var text = selected || (ch ? U.stripHtml(ch.content) : "");
        if (!text.trim()) { toast("Write or select some text first.", "error"); return; }
        var out = block.querySelector("#aiOut") || U.el("div", { class: "ai-out", id: "aiOut" });
        out.textContent = "Working…";
        if (!out.parentNode) block.appendChild(out);
        try {
          var res = await fetch(aiEndpoint(), {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              action: select.value,
              text: text,
              context: { title: book.title, chapter: ch ? ch.title : "" }
            })
          });
          if (!res.ok) throw new Error("Endpoint responded with " + res.status);
          var data = await res.json();
          S.aiOutput = data.suggestion || data.text || "";
          out.textContent = S.aiOutput || "(empty response)";
          if (data.notes) out.textContent += "\n\nNotes: " + data.notes;
          var actions = U.el("div", { style: "margin-top:8px;display:flex;gap:6px;flex-wrap:wrap" }, [
            U.el("button", {
              class: "btn ghost sm", text: "Insert as suggestion",
              onclick: function () {
                if (!S.editor || !S.aiOutput) return;
                S.editor.insertHtml('<p class="editor-note" title="AI suggestion — review before keeping">AI suggestion (unverified): ' + U.escapeHtml(S.aiOutput) + "</p>");
                markDirty();
                toast("Inserted as a marked suggestion. The original text was not replaced.");
              }
            }),
            U.el("button", {
              class: "btn ghost sm", text: "Replace selection",
              onclick: function () {
                if (!S.editor || !S.aiOutput) return;
                var s2 = window.getSelection();
                if (!s2 || s2.isCollapsed) { toast("Select the passage you want to replace first.", "error"); return; }
                s2.deleteFromDocument();
                S.editor.insertText(S.aiOutput);
                markDirty();
                toast("Selection replaced. Use Undo (Ctrl+Z) to restore the original text.");
              }
            }),
            U.el("button", { class: "btn ghost sm", text: "Dismiss", onclick: function () { out.remove(); } })
          ]);
          if (!out.parentNode) block.appendChild(out);
          if (!block.querySelector(".ai-actions")) {
            actions.className = "ai-actions";
            block.appendChild(actions);
          }
        } catch (e) {
          out.textContent = "AI request failed: " + e.message + ". Check the endpoint configured in Settings → AI.";
        }
      }
    }));
    block.appendChild(U.el("p", {
      class: "small muted", style: "margin-top:8px",
      text: "AI output is never applied automatically. Citations and facts suggested by AI must be verified."
    }));
    return block;
  }

  /* ------------------------------------------------------------------ actions */
  function currentChapter() {
    if (!S.book) return null;
    return (S.book.chapters || []).filter(function (c) { return c.id === S.chapterId; })[0] || null;
  }

  function openChapter(id) {
    S.chapterId = id;
    S.pageView = false;
    if (S.view !== "manuscript") setView("manuscript");
    else render();
  }

  function setPageView(on) {
    S.pageView = !!on;
    if (S.view !== "manuscript") setView("manuscript");
    else render();
  }

  function cleanupScopeChapters(scope) {
    var b = S.book;
    if (!b) return [];
    if (scope === "all") return (b.chapters || []).slice();
    var ch = currentChapter();
    return ch ? [ch] : [];
  }

  function openCleanupDialog() {
    if (!S.book) { toast("Open a book first.", "error"); return; }
    if (!BF.textTools) { toast("The clean-up tools did not load. Reload the page.", "error"); return; }
    var b = S.book;
    var ch = currentChapter();
    if (!ch && !b.chapters.length) { toast("Write a chapter first.", "error"); return; }

    var fields = [
      { key: "spaces", label: "Collapse repeated spaces", help: "Two or more spaces or tabs become one space." },
      { key: "punctuation", label: "Fix punctuation spacing", help: "Remove spaces before punctuation and add missing spaces after commas and sentence marks." },
      { key: "quotes", label: "Typographic quotes", help: "Convert straight quotes and apostrophes to curly quotation marks." },
      { key: "capitalize", label: "Capitalize sentence starts", help: "Conservative: skips common abbreviations and initials." },
      { key: "ellipses", label: "Normalize ellipses", help: "Three or spaced periods become one ellipsis character." },
      { key: "dashes", label: "Normalize double hyphens", help: "A double hyphen becomes an em dash with clear spacing." },
      { key: "trim", label: "Trim paragraph edges", help: "Remove spaces and tabs at the start and end of each paragraph." },
      { key: "empty", label: "Remove empty paragraphs", help: "Delete paragraphs that contain no text, image, table or rule." }
    ];
    var boxes = {};
    var scope = ch ? "chapter" : "all";
    var chapterWordTotal = b.chapters.reduce(function (sum, c) { return sum + BF.model.chapterWords(c); }, 0);

    var scopeSelect = U.el("select", { id: "cleanupScope", "aria-label": "Clean-up scope" });
    var currentOpt = U.el("option", { value: "chapter", text: "Current chapter" + (ch ? " — " + ch.title + " (" + BF.model.chapterWords(ch).toLocaleString() + " words)" : "") });
    if (!ch) currentOpt.disabled = true;
    scopeSelect.appendChild(currentOpt);
    scopeSelect.appendChild(U.el("option", { value: "all", text: "All chapters — " + b.chapters.length + " chapter" + (b.chapters.length === 1 ? "" : "s") + ", " + chapterWordTotal.toLocaleString() + " words" }));
    scopeSelect.value = scope;

    var optionsBox = U.el("div", { class: "cleanup-options" });
    fields.forEach(function (f) {
      var input = U.el("input", { type: "checkbox", id: "cleanup_" + f.key });
      input.checked = !!BF.textTools.DEFAULTS[f.key];
      boxes[f.key] = input;
      input.addEventListener("change", function () { refresh(); });
      optionsBox.appendChild(U.el("div", { class: "cleanup-option" }, [
        U.el("label", { class: "check", for: "cleanup_" + f.key }, [
          input,
          U.el("div", {}, [U.el("b", { text: f.label }), U.el("small", { text: f.help })])
        ])
      ]));
    });

    var previewSummary = U.el("p", { class: "cleanup-summary", text: "Analyze a chapter to see what will change." });
    var previewList = U.el("div", { class: "cleanup-samples" });
    var previewBox = U.el("div", { class: "cleanup-preview" }, [
      U.el("div", { class: "cleanup-preview-head" }, [
        U.el("h3", { text: "Preview" }),
        U.el("span", { class: "small muted", text: "Local, on-device" })
      ]),
      previewSummary,
      previewList,
      U.el("p", { class: "small muted cleanup-safety", text: "A named safety version is saved in Version history before any change is applied." }),
      U.el("p", { class: "small muted cleanup-ai", text: aiEndpoint() ? "For a deeper rewrite, select a passage and use AI assistant → Correct grammar & punctuation. AI output is never applied automatically." : "AI is not configured. This clean-up runs entirely in your browser; no text leaves this device." })
    ]);

    var dlg = null;
    var body = U.el("div", { class: "cleanup-layout" }, [
      U.el("div", { class: "cleanup-col" }, [
        U.el("div", { class: "field" }, [
          U.el("label", { for: "cleanupScope", text: "Apply to" }),
          scopeSelect
        ]),
        U.el("div", { class: "field" }, [
          U.el("label", { text: "Corrections" }),
          optionsBox
        ]),
        U.el("div", { class: "cleanup-layout-note" }, [
          U.el("p", { class: "small muted", text: "Paragraph spacing, first-line indent and justification are controlled in Design studio." }),
          U.el("button", {
            class: "btn ghost sm", text: "Open Design studio",
            onclick: function () { if (dlg) dlg.close(); setView("design"); }
          })
        ])
      ]),
      previewBox
    ]);

    var applyBtn = null;
    var applying = false;
    var timer = null;
    var lastResult = null;

    function selectedOptions() {
      var out = {};
      fields.forEach(function (f) { out[f.key] = !!boxes[f.key].checked; });
      return out;
    }

    function collect() {
      var opts = selectedOptions();
      var chapters = cleanupScopeChapters(scope);
      var totals = { spaces: 0, punctuation: 0, quotes: 0, capitalized: 0, ellipses: 0, dashes: 0, trimmed: 0, empty: 0, blocks: 0 };
      var items = [];
      var samples = [];
      chapters.forEach(function (c) {
        var result = BF.textTools.clean(c.content || "", opts);
        Object.keys(totals).forEach(function (k) { totals[k] += Number(result.stats[k]) || 0; });
        items.push({ chapter: c, result: result });
        result.samples.forEach(function (s) {
          if (samples.length < 3) samples.push({ chapter: c.title, before: s.before, after: s.after });
        });
      });
      return {
        chapters: chapters,
        items: items,
        totals: totals,
        samples: samples,
        changed: totals.blocks > 0 || totals.empty > 0
      };
    }

    function updatePreview() {
      lastResult = collect();
      previewList.innerHTML = "";
      if (!lastResult.changed) {
        previewSummary.textContent = "No changes with these options.";
        if (applyBtn) {
          applyBtn.disabled = true;
          applyBtn.textContent = "Nothing to apply";
        }
        return;
      }
      previewSummary.textContent = BF.textTools.summary(lastResult.totals);
      if (applyBtn) {
        applyBtn.disabled = false;
        applyBtn.textContent = scope === "all" ? "Apply to all chapters" : "Apply to chapter";
      }
      lastResult.samples.forEach(function (s) {
        previewList.appendChild(U.el("div", { class: "cleanup-sample" }, [
          U.el("b", { text: s.chapter }),
          U.el("div", { class: "diff", html: U.diffHtml(s.before, s.after) })
        ]));
      });
      if (!lastResult.samples.length && lastResult.totals.empty) {
        previewList.appendChild(U.el("p", { class: "small muted", text: "Only empty paragraphs would be removed." }));
      }
    }

    function refresh() {
      clearTimeout(timer);
      timer = setTimeout(updatePreview, 120);
    }

    function apply(close) {
      if (applying) return;
      var result = collect();
      if (!result.changed) return;
      applying = true;
      if (applyBtn) {
        applyBtn.disabled = true;
        applyBtn.textContent = "Applying…";
      }
      var versionName = "Before clean-up — " + (scope === "all" ? "all chapters" : "current chapter");
      BF.storage.addVersion(b, { name: versionName, auto: false }).then(function () {
        result.items.forEach(function (item) {
          if (!item.result.changed) return;
          item.chapter.content = item.result.html;
          item.chapter.updatedAt = Date.now();
        });
        markDirty();
        close();
        render();
        saveNow("cleanup");
        toast("Clean-up applied. A safety version was saved in Version history.");
      }).catch(function (e) {
        applying = false;
        if (applyBtn) {
          applyBtn.disabled = false;
          applyBtn.textContent = scope === "all" ? "Apply to all chapters" : "Apply to chapter";
        }
        toast("Could not create a safety version: " + e.message, "error");
      });
    }

    scopeSelect.addEventListener("change", function () { scope = scopeSelect.value; refresh(); });
    dlg = openDialog({
      title: "Clean up & format",
      wide: true,
      body: body,
      actions: [
        { label: "Cancel", onClick: function (close) { close(); } },
        { label: "Apply", primary: true, onClick: function (close) { apply(close); } }
      ]
    });
    applyBtn = dlg.foot ? dlg.foot.querySelector("button.primary") : null;
    updatePreview();
  }

  async function duplicateBook(book) {
    var copy = U.clone(book);
    copy.id = U.uid("book");
    copy.title = book.title + " (copy)";
    copy.createdAt = Date.now();
    copy.updatedAt = Date.now();
    S.books.push(copy);
    await BF.storage.saveBook(copy);
    render();
    toast("Book duplicated");
  }

  async function deleteBook(book, permanent) {
    var ok = await confirmDialog({
      title: permanent ? "Delete permanently" : "Move to trash",
      message: permanent
        ? 'Permanently delete "' + book.title + '"? This cannot be undone. Its version history will also be removed.'
        : 'Move "' + book.title + '" to the trash? You can restore it from the Trash view.',
      confirmLabel: permanent ? "Delete permanently" : "Move to trash",
      danger: true
    });
    if (!ok) return;
    if (permanent) {
      S.books = S.books.filter(function (b) { return b.id !== book.id; });
      await BF.storage.deleteBook(book.id);
      if (S.book && S.book.id === book.id) { S.book = null; S.chapterId = null; }
    } else {
      book.trashed = true;
      await BF.storage.saveBook(book);
      if (S.book && S.book.id === book.id) { S.book = null; S.chapterId = null; }
    }
    render();
    toast(permanent ? "Book deleted" : "Book moved to trash");
  }

  async function openBook(book) {
    S.book = book;
    S.chapterId = book.chapters.length ? book.chapters[0].id : null;
    S.pageView = false;
    S.lastSnapshot = Date.now();
    await BF.storage.saveMeta({ lastBookId: book.id });
    if (book.settings && book.settings.theme) applyTheme(book.settings.theme);
    setView("manuscript");
    toast('Opened "' + book.title + '"');
  }

  /* -------------------------------------------------------------- new book */
  function newBookWizard() {
    var state = {
      step: 1,
      template: "blank",
      values: {
        title: "", subtitle: "", author: "", coAuthors: "", category: "Nonfiction",
        language: "English", audience: "", purpose: "", publisher: "", edition: "1st",
        copyrightYear: String(new Date().getFullYear()), isbn: "", targetWords: 60000,
        manuscriptFormat: "Prose", trim: "a4"
      }
    };
    var dialog = openDialog({
      title: "Create a new book",
      wide: true,
      body: buildStep(),
      actions: [
        { label: "Cancel", onClick: function (close) { close(); } },
        {
          label: "Back", onClick: function (close, body) {
            if (state.step > 1) { state.step--; body.innerHTML = ""; body.appendChild(buildStep()); refreshFoot(); }
          }
        },
        {
          label: "Create book", primary: true, onClick: function (close, body) {
            capture();
            if (state.step < 3) { state.step++; body.innerHTML = ""; body.appendChild(buildStep()); refreshFoot(); return; }
            if (!state.values.title.trim()) { toast("A book title is required.", "error"); state.step = 2; body.innerHTML = ""; body.appendChild(buildStep()); return; }
            var book = BF.model.createBook(Object.assign({}, state.values, { template: state.template }));
            book.design.trim = state.values.trim;
            book.design.customWidth = state.values.trim === "custom" ? Number(state.values.customWidth || 152.4) : book.design.customWidth;
            book.design.customHeight = state.values.trim === "custom" ? Number(state.values.customHeight || 228.6) : book.design.customHeight;
            S.books.push(book);
            BF.storage.saveBook(book).then(function () { toast("Book created and saved"); });
            close();
            openBook(book);
          }
        }
      ]
    });

    function refreshFoot() {
      var buttons = dialog.foot ? U.qsa("button", dialog.foot) : [];
      buttons.forEach(function (b) {
        if (b.textContent === "Back") b.disabled = state.step === 1;
      });
    }

    function capture() {
      U.qsa("[data-field]", dialog.body).forEach(function (input) {
        var name = input.dataset.field;
        state.values[name] = input.type === "checkbox" ? input.checked : input.value;
      });
      var selected = dialog.body.querySelector("[data-template][aria-pressed='true']");
      if (selected) state.template = selected.dataset.template;
    }

    function buildStep() {
      var wrap = U.el("div");
      var steps = U.el("div", { class: "wizard-steps" });
      ["Template", "Book details", "Production"].forEach(function (label, i) {
        steps.appendChild(U.el("span", { text: (i + 1) + ". " + label, "data-active": state.step === i + 1 ? "true" : "false" }));
      });
      wrap.appendChild(steps);

      if (state.step === 1) {
        var grid = U.el("div", { class: "template-grid" });
        BF.model.TEMPLATES.forEach(function (t) {
          var card = U.el("button", {
            type: "button", class: "template-card", "data-template": t.id,
            "aria-pressed": state.template === t.id ? "true" : "false",
            onclick: function () {
              state.template = t.id;
              U.qsa(".template-card", grid).forEach(function (c) { c.setAttribute("aria-pressed", c === card ? "true" : "false"); });
            }
          }, [U.el("b", { text: t.name }), U.el("small", { text: t.blurb + " · ~" + t.targetWords.toLocaleString() + " words" })]);
          grid.appendChild(card);
        });
        wrap.appendChild(grid);
        wrap.appendChild(U.el("p", { class: "help", text: "Templates create a starting outline of chapter titles and front/back matter. No placeholder prose is generated." }));
      } else if (state.step === 2) {
        wrap.appendChild(field("Book title", "title", state.values.title, "text", true));
        wrap.appendChild(field("Subtitle", "subtitle", state.values.subtitle));
        wrap.appendChild(row([
          field("Author name", "author", state.values.author, "text", true),
          field("Co-authors", "coAuthors", state.values.coAuthors, "text", false, "Separate with commas")
        ]));
        wrap.appendChild(row([
          select("Category", "category", BF.model.CATEGORIES, state.values.category),
          select("Language", "language", BF.model.LANGUAGES, state.values.language)
        ]));
        wrap.appendChild(row([
          field("Target audience", "audience", state.values.audience),
          field("Intended purpose", "purpose", state.values.purpose)
        ]));
      } else {
        wrap.appendChild(row([
          field("Publisher / imprint", "publisher", state.values.publisher),
          field("Edition", "edition", state.values.edition)
        ]));
        wrap.appendChild(row([
          field("Copyright year", "copyrightYear", state.values.copyrightYear, "number"),
          field("ISBN (optional, author-supplied)", "isbn", state.values.isbn, "text", false, "BookForge never generates or registers an ISBN.")
        ]));
        wrap.appendChild(row([
          field("Target word count", "targetWords", state.values.targetWords, "number"),
          select("Manuscript format", "manuscriptFormat", BF.model.MANUSCRIPT_FORMATS, state.values.manuscriptFormat)
        ]));
        wrap.appendChild(row([
          select("Trim size", "trim", BF.model.TRIM_SIZES.map(function (t) { return { value: t.id, label: t.name }; }), state.values.trim),
          field("Target words per chapter (guide)", "chapterGuide", Math.round((state.values.targetWords || 60000) / 12), "number", false, "Used for planning only.")
        ]));
        if (state.values.trim === "custom") {
          wrap.appendChild(row([
            field("Custom width (mm)", "customWidth", state.values.customWidth || 152.4, "number"),
            field("Custom height (mm)", "customHeight", state.values.customHeight || 228.6, "number")
          ]));
        }
      }
      return wrap;
    }

    function field(label, name, value, type, required, help) {
      var f = U.el("div", { class: "field" }, [
        U.el("label", { for: "wz_" + name, text: label + (required ? " *" : "") })
      ]);
      var input = U.el("input", { id: "wz_" + name, type: type || "text", "data-field": name });
      input.value = value == null ? "" : value;
      f.appendChild(input);
      if (help) f.appendChild(U.el("div", { class: "help", text: help }));
      return f;
    }
    function select(label, name, options, value) {
      var f = U.el("div", { class: "field" }, [U.el("label", { for: "wz_" + name, text: label })]);
      var s = U.el("select", { id: "wz_" + name, "data-field": name });
      options.forEach(function (o) {
        var opt = U.el("option", { value: o.value == null ? o : o.value, text: o.label == null ? o : o.label });
        if (String(opt.value) === String(value)) opt.selected = true;
        s.appendChild(opt);
      });
      f.appendChild(s);
      return f;
    }
    function row(children) {
      return U.el("div", { class: "field-row" }, children);
    }
    refreshFoot();
  }

  /* --------------------------------------------------------------- settings */
  async function openSettings() {
    var b = S.book;
    var g = BF.globalSettings || {};
    formDialog({
      title: "Settings",
      wide: true,
      fields: [
        { name: "theme", label: "Interface theme", type: "select", value: b ? (b.settings.theme || "dark") : (g.theme || "dark"), options: [{ value: "dark", label: "Luxury dark" }, { value: "light", label: "Light" }] },
        { name: "canvas", label: "Canvas colour", type: "select", value: g.canvas || "cream", options: [{ value: "cream", label: "Cream" }, { value: "white", label: "Warm white" }, { value: "sepia", label: "Sepia" }] },
        { name: "fontFamily", label: "Manuscript font", type: "select", value: g.fontFamily || "Georgia", options: [{ value: "Georgia", label: "Georgia" }, { value: "Cambria", label: "Cambria" }, { value: "Palatino Linotype", label: "Palatino" }, { value: "Times New Roman", label: "Times New Roman" }, { value: "Segoe UI", label: "Segoe UI (sans)" }] },
        { name: "fontSize", label: "Manuscript size (px)", type: "number", value: g.fontSize || 17 },
        { name: "lineHeight", label: "Line spacing", type: "number", value: g.lineHeight || 1.75, help: "For example 1.75" },
        { name: "paragraphSpacing", label: "Paragraph spacing (em)", type: "number", value: g.paragraphSpacing || 0.9 },
        { name: "columnWidth", label: "Writing column width (px)", type: "number", value: g.columnWidth || 760 },
        { name: "citationStyle", label: "Citation style", type: "select", value: b ? (b.settings.citationStyle || "apa") : "apa", options: BF.model.CITATION_STYLES.map(function (s) { return { value: s.id, label: s.name }; }) },
        { name: "autosaveMs", label: "Autosave delay (ms)", type: "number", value: g.autosaveMs || 900, help: "Saves are written to IndexedDB; Google Drive–style cloud sync is not part of this local edition." },
        { name: "aiEndpoint", label: "AI endpoint URL (optional)", type: "text", value: g.aiEndpoint || "", help: "Your own server URL that proxies the AI provider. API keys stay on the server." }
      ],
      submitLabel: "Save settings",
      onSubmit: function (values) {
        BF.globalSettings = Object.assign({}, g, values, {
          fontSize: Number(values.fontSize) || 17,
          lineHeight: Number(values.lineHeight) || 1.75,
          paragraphSpacing: Number(values.paragraphSpacing),
          columnWidth: Number(values.columnWidth) || 760,
          autosaveMs: Number(values.autosaveMs) || 900
        });
        BF.storage.saveMeta({ globalSettings: BF.globalSettings });
        if (b) {
          b.settings.citationStyle = values.citationStyle;
          b.settings.theme = values.theme;
          markDirty();
        }
        applyTheme(values.theme);
        applyTypography();
        toast("Settings saved");
      }
    });
  }

  function applyTypography() {
    var g = BF.globalSettings || {};
    var root = document.documentElement;
    root.style.setProperty("--manuscript-font", '"' + (g.fontFamily || "Georgia") + '", Georgia, serif');
    root.style.setProperty("--manuscript-size", (g.fontSize || 17) + "px");
    root.style.setProperty("--manuscript-leading", String(g.lineHeight || 1.75));
    root.style.setProperty("--para-space", (g.paragraphSpacing == null ? 0.9 : g.paragraphSpacing) + "em");
    root.style.setProperty("--column-width", (g.columnWidth || 760) + "px");
    var map = { cream: "#f8f3e8", white: "#fffdf8", sepia: "#f4ecdc" };
    root.style.setProperty("--canvas", map[g.canvas || "cream"] || "#f8f3e8");
  }

  /* -------------------------------------------------------------- import/export */
  function importProject() {
    var input = document.createElement("input");
    input.type = "file";
    input.accept = ".json,application/json";
    input.onchange = function () {
      var file = input.files[0];
      if (!file) return;
      U.readFileText(file).then(function (text) {
        var parsed = BF.storage.parseProjectBackup(text);
        var book = parsed.book;
        book.id = U.uid("book");
        S.books.push(book);
        return BF.storage.saveBook(book).then(function () {
          render();
          toast("Project imported" + (parsed.warnings.length ? " — " + parsed.warnings.join(" ") : ""));
        });
      }).catch(function (e) {
        toast("Import failed: " + e.message, "error");
      });
    };
    input.click();
  }

  async function runExport(format) {
    var b = S.book;
    if (!b) { toast("Open a book first.", "error"); return; }
    if (format === "preflight") { showPreflight(b); return; }
    if (format === "pdf") {
      await saveNow("export");
      BF.layout.print(b);
      return;
    }
    var filenameBase = U.safeFilename(b.title, "book");
    var progress = openDialog({
      title: "Exporting " + format.toUpperCase(),
      narrow: true,
      body: U.el("div", {}, [
        U.el("p", { id: "expStage", text: "Preparing…" }),
        (function () { var bar = U.el("div", { class: "bar" }); bar.appendChild(U.el("i", { id: "expBar", style: "width:5%" })); return bar; })()
      ]),
      actions: [{ label: "Close", onClick: function (close) { close(); } }]
    });
    var stage = document.getElementById("expStage");
    var bar = document.getElementById("expBar");
    function onProgress(msg, pct) {
      if (stage) stage.textContent = msg;
      if (bar && pct) bar.style.width = Math.max(5, Math.min(100, pct)) + "%";
    }
    try {
      var blob, name;
      if (format === "docx") { blob = await BF.exporters.buildDocx(b, { onProgress: onProgress }); name = filenameBase + ".docx"; }
      else if (format === "epub") { blob = await BF.exporters.buildEpub(b, { onProgress: onProgress }); name = filenameBase + ".epub"; }
      else if (format === "html") { blob = new Blob([BF.exporters.buildHtml(b)], { type: "text/html;charset=utf-8" }); name = filenameBase + ".html"; }
      else if (format === "md") { blob = new Blob([BF.exporters.buildMarkdown(b)], { type: "text/markdown;charset=utf-8" }); name = filenameBase + ".md"; }
      else if (format === "txt") { blob = new Blob([BF.exporters.buildTxt(b)], { type: "text/plain;charset=utf-8" }); name = filenameBase + ".txt"; }
      else if (format === "json") { blob = new Blob([BF.exporters.buildJson(b)], { type: "application/json" }); name = filenameBase + ".bookforge.json"; }
      else throw new Error("Unknown export format: " + format);
      if (!blob || !blob.size) throw new Error("The generated file was empty. Export aborted.");
      U.download(blob, name);
      onProgress("Done — " + name + " (" + U.formatBytes(blob.size) + ")", 100);
      toast("Exported " + name);
    } catch (e) {
      onProgress("Export failed: " + e.message);
      toast("Export failed: " + e.message, "error");
    }
  }

  function showPreflight(book) {
    var report = BF.exporters.preflight(book);
    function listFor(items) {
      if (!items.length) return U.el("p", { class: "small muted", text: "No issues found." });
      var ul = U.el("div");
      items.forEach(function (i) {
        var badgeClass = i.level === "error" ? "bad" : i.level === "warn" ? "warn" : "gold";
        ul.appendChild(U.el("p", { class: "small" }, [
          U.el("span", { class: "badge " + badgeClass, text: i.level.toUpperCase() }),
          document.createTextNode("  " + i.message)
        ]));
      });
      return ul;
    }
    openDialog({
      title: "Preflight report",
      wide: true,
      body: U.el("div", {}, [
        U.el("p", { class: "small muted", text: "Automated technical checks are listed separately from editorial, factual and legal review. Passing these checks does not verify academic accuracy." }),
        U.el("h3", { text: "Technical checks" }),
        listFor(report.technical),
        U.el("h3", { text: "Editorial / content notes", style: "margin-top:14px" }),
        listFor(report.editorial),
        U.el("h3", { text: "Statistics", style: "margin-top:14px" }),
        U.el("p", { class: "small", text: report.stats.words.toLocaleString() + " words · " + report.stats.chapters + " chapters · " + report.stats.written + " chapters with content · " + report.stats.readingMinutes + " min read" })
      ]),
      actions: [{ label: "Close", primary: true, onClick: function (close) { close(); } }]
    });
  }

  /* ------------------------------------------------------------ find/replace */
  function openFind() {
    if (S.view === "manuscript" && S.pageView) { toast("Switch to Draft to search the manuscript.", "error"); return; }
    if (S.view !== "manuscript" || !S.editor) { toast("Open the manuscript to search.", "error"); return; }
    var dlg = openDialog({
      title: "Find & replace",
      body: U.el("div", {}, [
        U.el("div", { class: "field" }, [U.el("label", { for: "findTerm", text: "Find" }), (function () { var i = U.el("input", { id: "findTerm", type: "search" }); return i; })()]),
        U.el("div", { class: "field" }, [U.el("label", { for: "replaceTerm", text: "Replace with" }), (function () { var i = U.el("input", { id: "replaceTerm" }); return i; })()]),
        U.el("p", { class: "help", text: "Find uses the browser's in-page search on the current chapter. Replace all is limited to the current chapter." })
      ]),
      actions: [
        { label: "Find next", onClick: function () { S.editor.findNext($("#findTerm").value) || toast("No more matches in this chapter", "error"); } },
        { label: "Replace", onClick: function () { S.editor.replaceCurrent($("#findTerm").value, $("#replaceTerm").value); markDirty(); } },
        {
          label: "Replace all", primary: true, onClick: function () {
            var n = S.editor.replaceAll($("#findTerm").value, $("#replaceTerm").value);
            markDirty();
            toast(n + " replacement" + (n === 1 ? "" : "s") + " made");
          }
        }
      ]
    });
    setTimeout(function () { var f = $("#findTerm"); if (f) f.focus(); }, 50);
    return dlg;
  }

  /* -------------------------------------------------------------- insert menu */
  function openInsertMenu(x, y) {
    var e = S.editor;
    contextMenu([
      { label: "Link…", onClick: function () { insertLink(); } },
      { label: "Image from file…", onClick: function () { insertImageFile(); } },
      { label: "Image from URL…", onClick: function () { insertImageUrl(); } },
      { label: "Table…", onClick: function () { insertTable(); } },
      {
        label: "Caption", onClick: function () {
          formDialog({
            title: "Insert caption",
            narrow: true,
            fields: [{ name: "caption", label: "Caption text", required: true }],
            submitLabel: "Insert caption",
            onSubmit: function (v) { S.editor.insertCaption(v.caption); markDirty(); }
          });
        }
      },
      { label: "Footnote", onClick: function () { insertFootnote(); } },
      { label: "Citation from references…", onClick: function () { insertCitation(); } },
      { label: "Page break", onClick: function () { e.insertPageBreak(); markDirty(); } },
      { label: "Section break", onClick: function () { e.insertSectionBreak(); markDirty(); } },
      { label: "Horizontal rule", onClick: function () { e.insertHorizontalRule(); markDirty(); } },
      { label: "Special character…", onClick: function () { insertSpecialChar(); } },
      { label: "Editorial comment", onClick: function () { addComment(); } }
    ], x, y);
  }

  function insertLink() {
    formDialog({
      title: "Insert link",
      fields: [
        { name: "href", label: "URL", required: true, placeholder: "https://" },
        { name: "label", label: "Link text (used when nothing is selected)" }
      ],
      submitLabel: "Insert",
      onSubmit: function (v) {
        S.editor.insertLink(v.href, v.label);
        markDirty();
      }
    });
  }

  function insertImageFile() {
    var input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    input.onchange = function () {
      var f = input.files[0];
      if (!f) return;
      U.fileToDataUrl(f).then(function (url) {
        addAsset(f.name, url, f.type, f.size, "", true);
        S.editor.insertImage(url, f.name);
        markDirty();
      }).catch(function (e) { toast(e.message, "error"); });
    };
    input.click();
  }

  function insertImageUrl() {
    formDialog({
      title: "Insert image from URL",
      fields: [
        { name: "src", label: "Image URL", required: true, placeholder: "https://" },
        { name: "alt", label: "Alternative text (required for accessibility)", required: true }
      ],
      submitLabel: "Insert",
      onSubmit: function (v) {
        S.editor.insertImage(v.src, v.alt);
        markDirty();
      }
    });
  }

  function insertTable() {
    formDialog({
      title: "Insert table",
      fields: [
        { name: "rows", label: "Rows (including header)", type: "number", value: 3, required: true },
        { name: "cols", label: "Columns", type: "number", value: 3, required: true }
      ],
      submitLabel: "Insert",
      onSubmit: function (v) {
        S.editor.insertTable(Math.max(2, Math.min(30, Number(v.rows))), Math.max(1, Math.min(12, Number(v.cols))));
        markDirty();
      }
    });
  }

  function insertFootnote() {
    formDialog({
      title: "Insert footnote",
      fields: [{ name: "note", label: "Footnote text", type: "textarea", required: true, rows: 3 }],
      submitLabel: "Insert footnote",
      onSubmit: function (v) {
        S.editor.insertFootnote(v.note);
        markDirty();
      }
    });
  }

  function insertCitation() {
    var b = S.book;
    if (!b.sources.length) {
      toast("Add a source in the References view first.", "error");
      setView("references");
      return;
    }
    formDialog({
      title: "Insert citation",
      fields: [
        {
          name: "sourceId", label: "Source", type: "select", required: true,
          options: b.sources.map(function (s) { return { value: s.id, label: (s.authors ? s.authors + " — " : "") + (s.title || "Untitled source") + (s.year ? " (" + s.year + ")" : "") }; })
        },
        { name: "locator", label: "Page or locator (optional)", placeholder: "e.g. 42" },
        { name: "mode", label: "Insert as", type: "select", value: "intext", options: [{ value: "intext", label: "In-text citation" }, { value: "full", label: "Full reference" }] }
      ],
      submitLabel: "Insert citation",
      onSubmit: function (v) {
        var idx = b.sources.findIndex(function (s) { return s.id === v.sourceId; });
        var src = b.sources[idx];
        if (!src) return false;
        var style = b.settings.citationStyle || "apa";
        var text = v.mode === "full"
          ? BF.model.formatCitation(src, style, idx + 1)
          : BF.model.formatInText(src, style, idx + 1, v.locator);
        S.editor.insertCitation(text, src.id, src.title);
        markDirty();
      }
    });
  }

  var SPECIAL_CHARS = ["—", "–", "…", "“", "”", "‘", "’", "«", "»", "†", "‡", "§", "¶", "•", "·", "°", "©", "®", "™", "€", "£", "¥", "±", "×", "÷", "≠", "≤", "≥", "∞", "α", "β", "γ", "π", "Σ", "Ω", "❖"];

  function insertSpecialChar() {
    openDialog({
      title: "Special characters",
      body: U.el("div", { style: "display:flex;flex-wrap:wrap;gap:6px" }, SPECIAL_CHARS.map(function (c) {
        return U.el("button", {
          class: "btn ghost", text: c, title: "Insert " + c,
          onclick: function () { S.editor.insertText(c); markDirty(); }
        });
      })),
      actions: [{ label: "Close", primary: true, onClick: function (close) { close(); } }]
    });
  }

  function addComment() {
    var b = S.book;
    var ch = currentChapter();
    if (!ch) { toast("Open a chapter first.", "error"); return; }
    var sel = window.getSelection();
    var quote = sel && String(sel).trim() ? String(sel).trim().slice(0, 280) : "";
    formDialog({
      title: "Add editorial comment",
      fields: [
        { name: "quote", label: "Selected text (optional)", type: "textarea", rows: 2, value: quote },
        { name: "body", label: "Comment", type: "textarea", required: true, rows: 3 }
      ],
      submitLabel: "Add comment",
      onSubmit: function (v) {
        b.comments.push({
          id: U.uid("cm"), chapterId: ch.id, quote: v.quote, body: v.body,
          author: b.author || "Local author", status: "open", createdAt: Date.now()
        });
        markDirty();
        renderContext();
        toast("Comment added");
      }
    });
  }

  function addAsset(name, dataUrl, mime, size, alt, silent) {
    if (!S.book) return null;
    var asset = { id: U.uid("as"), name: name, dataUrl: dataUrl, mime: mime, size: size || 0, alt: alt || "", createdAt: Date.now() };
    S.book.assets.push(asset);
    if (/^image\//.test(mime || "") && /^data:image\//i.test(dataUrl || "")) {
      var probe = new Image();
      probe.onload = function () {
        asset.width = probe.naturalWidth;
        asset.height = probe.naturalHeight;
        if (S.view === "assets") render();
      };
      probe.src = dataUrl;
    }
    if (!silent) markDirty();
    return asset;
  }

  function editedCopyName(name, mime) {
    var base = String(name || "image").replace(/\.[^.]+$/, "");
    return base + "-edited." + U.mimeToExt(mime);
  }

  function inlineImageWidth(img, book) {
    var dataWidth = parseFloat(img.getAttribute("data-bf-width") || "");
    if (dataWidth) return Math.max(10, Math.min(100, dataWidth));
    var style = (img.getAttribute("style") || "").match(/(?:^|;)\s*width\s*:\s*([\d.]+)\s*%/i);
    if (style) return Math.max(10, Math.min(100, parseFloat(style[1])));
    var attr = (img.getAttribute("width") || "").match(/^([\d.]+)%$/);
    if (attr) return Math.max(10, Math.min(100, parseFloat(attr[1])));
    var px = parseFloat(img.getAttribute("width") || "");
    var contentPx = book ? BF.layout.geometry(book).contentW * 96 / 25.4 : 0;
    if (px && contentPx) return Math.max(10, Math.min(100, Math.round(px / contentPx * 100)));
    return 100;
  }

  function replaceInlineImage(oldSrc, newSrc) {
    if (!S.book || !oldSrc || !newSrc || oldSrc === newSrc) return 0;
    var count = 0;
    function repl(html) {
      if (!html || String(html).indexOf(oldSrc) < 0) return html;
      count++;
      return String(html).split(oldSrc).join(newSrc);
    }
    (S.book.chapters || []).forEach(function (ch) { ch.content = repl(ch.content || ""); });
    ["front", "back"].forEach(function (side) {
      var sections = S.book.matter && S.book.matter[side];
      if (!sections) return;
      Object.keys(sections).forEach(function (key) {
        if (sections[key]) sections[key].content = repl(sections[key].content || "");
      });
    });
    if (S.view === "manuscript" && S.editor) {
      U.qsa("img", S.editor.root).forEach(function (im) {
        if (im.getAttribute("src") === oldSrc) im.setAttribute("src", newSrc);
      });
    }
    return count;
  }

  function editAsset(asset) {
    if (!S.book || !asset) return;
    if (!/^image\//.test(asset.mime || "") || !/^data:image\//i.test(asset.dataUrl || "")) {
      toast("Only images stored inside the project can be edited.", "error");
      return;
    }
    if (!BF.imageEditor) { toast("The image editor did not load. Hard-refresh the page.", "error"); return; }
    BF.imageEditor.open({
      src: asset.dataUrl,
      name: asset.name,
      mime: asset.mime,
      size: asset.size,
      mode: "asset"
    }).then(function (res) {
      if (!res) return;
      var oldSrc = asset.dataUrl;
      if (res.action === "copy") {
        var copy = addAsset(editedCopyName(asset.name, res.mime), res.dataUrl, res.mime, res.size, asset.alt, false);
        if (copy) { copy.width = res.width; copy.height = res.height; }
        if (S.view === "assets") render();
        toast("Saved an edited copy as " + (copy ? copy.name : "a new asset") + ".");
        return;
      }
      if (res.dataUrl === oldSrc && res.mime === asset.mime) return;
      asset.dataUrl = res.dataUrl;
      asset.mime = res.mime;
      asset.size = res.size;
      asset.width = res.width;
      asset.height = res.height;
      var updated = replaceInlineImage(oldSrc, res.dataUrl);
      markDirty();
      if (S.view === "assets") render();
      else renderContext();
      toast("Image replaced" + (updated ? " in " + updated + " manuscript section" + (updated === 1 ? "" : "s") : "") + ".");
    });
  }

  function editInlineImage(img) {
    if (!S.book || !S.editor || !img) return;
    var ch = currentChapter();
    if (!ch) { toast("Open a chapter first.", "error"); return; }
    var src = img.getAttribute("src") || "";
    if (!src) return;
    if (!BF.imageEditor) { toast("The image editor did not load. Hard-refresh the page.", "error"); return; }
    var contentPx = BF.layout.geometry(S.book).contentW * 96 / 25.4;
    BF.imageEditor.open({
      src: src,
      name: img.getAttribute("alt") || "Manuscript image",
      mode: "inline",
      allowDisplayWidth: true,
      displayWidth: inlineImageWidth(img, S.book),
      contentWidthPx: contentPx
    }).then(function (res) {
      if (!res) return;
      if (res.dataUrl && res.dataUrl !== src) img.setAttribute("src", res.dataUrl);
      if (res.displayWidth >= 100) {
        img.style.removeProperty("width");
        img.removeAttribute("data-bf-width");
      } else {
        img.style.width = res.displayWidth + "%";
        img.setAttribute("data-bf-width", String(res.displayWidth));
      }
      ch.content = S.editor.getHtml();
      ch.updatedAt = Date.now();
      markDirty();
      toast(res.dataUrl !== src ? "Image replaced and resized in this chapter." : "Display width updated.");
    });
  }

  /* ------------------------------------------------------------------ wiring */
  function bindTopbar() {
    refs.btnSidebar.addEventListener("click", function () {
      S.sidebarCollapsed = !S.sidebarCollapsed;
      refs.workspace.classList.toggle("sidebar-collapsed", S.sidebarCollapsed);
      refs.btnSidebar.setAttribute("aria-expanded", String(!S.sidebarCollapsed));
      BF.storage.saveMeta({ sidebarCollapsed: S.sidebarCollapsed });
    });

    refs.btnUndo.addEventListener("click", function () { if (S.editor) S.editor.exec("undo"); });
    refs.btnRedo.addEventListener("click", function () { if (S.editor) S.editor.exec("redo"); });
    refs.btnSearch.addEventListener("click", openFind);
    refs.btnPrint.addEventListener("click", function () {
      if (!S.book) return;
      saveNow("export").then(function () { BF.layout.print(S.book); });
    });
    refs.btnSettings.addEventListener("click", openSettings);
    refs.btnProfile.addEventListener("click", function () {
      var b = S.book;
      if (!b) { toast("Open a book to edit the author profile."); return; }
      formDialog({
        title: "Author profile",
        fields: [
          { name: "author", label: "Primary author", value: b.author },
          { name: "coAuthors", label: "Co-authors", value: b.coAuthors },
          { name: "publisher", label: "Publisher / imprint", value: b.publisher },
          { name: "copyrightYear", label: "Copyright year", value: b.copyrightYear },
          { name: "isbn", label: "ISBN (author-supplied)", value: b.isbn, help: "Stored exactly as you type it. BookForge never invents ISBNs." }
        ],
        submitLabel: "Save profile",
        onSubmit: function (v) {
          Object.assign(b, v);
          markDirty();
          syncTopbar();
          toast("Author profile updated");
        }
      });
    });

    refs.modeSelect.addEventListener("change", function () {
      S.mode = refs.modeSelect.value;
      document.body.dataset.mode = S.mode;
      if (S.view !== "manuscript") setView("manuscript");
      toast("Mode: " + S.mode.charAt(0).toUpperCase() + S.mode.slice(1));
    });

    refs.saveStatus.addEventListener("click", function () {
      if (S.saveState === "error") retrySave();
    });

    refs.btnExportMenu.addEventListener("click", function (e) {
      e.stopPropagation();
      var menu = refs.exportMenu;
      menu.hidden = !menu.hidden;
      refs.btnExportMenu.setAttribute("aria-expanded", String(!menu.hidden));
    });
    refs.exportMenu.addEventListener("click", function (e) {
      var btn = e.target.closest("button[data-export]");
      if (!btn) return;
      refs.exportMenu.hidden = true;
      runExport(btn.dataset.export);
    });
    document.addEventListener("click", function () {
      refs.exportMenu.hidden = true;
      refs.btnExportMenu.setAttribute("aria-expanded", "false");
    });
    document.addEventListener("keydown", function (e) {
      var mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === "s") { e.preventDefault(); saveNow("manual").then(function (ok) { if (ok) toast("Saved"); }); }
      if (mod && e.key.toLowerCase() === "f") { e.preventDefault(); openFind(); }
      if (mod && e.key.toLowerCase() === "n") { e.preventDefault(); newBookWizard(); }
      if (mod && e.key === "\\") { e.preventDefault(); S.contextVisible = !S.contextVisible; renderContext(); }
      if (e.key === "F11" && e.altKey) { e.preventDefault(); S.mode = S.mode === "focus" ? "studio" : "focus"; document.body.dataset.mode = S.mode; refs.modeSelect.value = S.mode; }
    });
  }

  function bindStatusbar() {
    var zoom = refs.zoomRange;
    zoom.addEventListener("input", function () {
      S.zoom = Number(zoom.value);
      refs.stZoom.textContent = S.zoom + "%";
      var sheet = document.querySelector(".page-sheet");
      if (sheet) sheet.style.zoom = (S.zoom / 100).toString();
    });
    var sc = U.el("button", {
      class: "icon-btn", title: "Keyboard shortcuts", "aria-label": "Keyboard shortcuts",
      onclick: showShortcuts
    }, ["⌘"]);
    refs.statusRight.insertBefore(sc, refs.statusRight.firstChild);
  }

  function showShortcuts() {
    var rows = [
      ["Ctrl + B / I / U", "Bold, italic, underline"],
      ["Ctrl + S", "Save now"],
      ["Ctrl + F / Ctrl + H", "Find and replace"],
      ["Ctrl + N", "New book"],
      ["Ctrl + Z / Ctrl + Y", "Undo / redo"],
      ["Ctrl + Shift + 1…3", "Heading 1–3"],
      ["Ctrl + Shift + 0", "Body paragraph"],
      ["Ctrl + Shift + 7 / 8", "Numbered / bulleted list"],
      ["Ctrl + Shift + 9", "Block quote"],
      ["Ctrl + \\", "Toggle context panel"],
      ["Alt + F11", "Toggle focus mode"],
      ["Tab / Shift + Tab", "Indent list item"]
    ];
    openDialog({
      title: "Keyboard shortcuts",
      body: U.el("table", { class: "table" }, [U.el("tbody", {}, rows.map(function (r) {
        return U.el("tr", {}, [U.el("td", {}, [U.el("kbd", { text: r[0] })]), U.el("td", { text: r[1] })]);
      }))]),
      actions: [{ label: "Close", primary: true, onClick: function (close) { close(); } }]
    });
  }

  /* -------------------------------------------------------------------- boot */
  async function loadData() {
    try {
      S.storageMode = await BF.storage.init();
      if (S.storageMode !== "indexeddb") {
        toast("IndexedDB is unavailable — using " + S.storageMode + " storage. Data may be limited in size.", "error");
      }
      BF.storage.onStatus = function (status, error) {
        if (status === "saving") setSaveState("saving");
        else if (status === "saved") setSaveState("saved");
        else if (status === "error") setSaveState("error", error);
      };
      var meta = await BF.storage.loadMeta();
      BF.globalSettings = meta.globalSettings || {};
      S.books = await BF.storage.loadAllBooks();
      S.sidebarCollapsed = !!meta.sidebarCollapsed;
      refs.workspace.classList.toggle("sidebar-collapsed", S.sidebarCollapsed);
      refs.btnSidebar.setAttribute("aria-expanded", String(!S.sidebarCollapsed));
      applyTheme(BF.globalSettings.theme || "dark");
      applyTypography();
      if (meta.lastBookId) {
        var last = S.books.filter(function (b) { return b.id === meta.lastBookId && !b.trashed; })[0];
        if (last) {
          S.book = last;
          S.chapterId = last.chapters.length ? last.chapters[0].id : null;
        }
      }
    } catch (e) {
      toast("Could not load saved projects: " + e.message, "error");
    }
  }

  async function boot() {
    refs = {
      workspace: $("#workspace"),
      nav: $("#nav"),
      view: $("#view"),
      main: $("#main"),
      context: $("#context"),
      overlay: $("#overlay"),
      topBookTitle: $("#topBookTitle"),
      topBookSub: $("#topBookSub"),
      saveStatus: $("#saveStatus"),
      saveText: $("#saveText"),
      btnSidebar: $("#btnSidebar"),
      btnUndo: $("#btnUndo"),
      btnRedo: $("#btnRedo"),
      btnSearch: $("#btnSearch"),
      btnPrint: $("#btnPrint"),
      btnSettings: $("#btnSettings"),
      btnProfile: $("#btnProfile"),
      btnExportMenu: $("#btnExportMenu"),
      exportMenu: $("#exportMenu"),
      modeSelect: $("#modeSelect"),
      statusRight: $(".status-right"),
      stChapter: $("#stChapter"),
      stWords: $("#stWords"),
      stChars: $("#stChars"),
      stRead: $("#stRead"),
      stTarget: $("#stTarget"),
      stPage: $("#stPage"),
      stZoom: $("#stZoom"),
      zoomRange: $("#zoomRange")
    };
    renderNav();
    await loadData();
    bindTopbar();
    bindStatusbar();
    document.getElementById("btnNewBookSide").addEventListener("click", newBookWizard);
    window.addEventListener("beforeunload", function (e) {
      if (S.dirty || S.saveState === "saving") {
        e.preventDefault();
        e.returnValue = "";
      }
    });
    setSaveState(S.dirty ? "dirty" : "saved");
    setView(S.book ? (window.location.hash === "#dashboard" ? "dashboard" : "manuscript") : "dashboard");
  }

  /* ------------------------------------------------------------- public API */
  BF.app = {
    S: S, icon: icon, toast: toast,
    openDialog: openDialog, confirmDialog: confirmDialog, formDialog: formDialog, promptDialog: promptDialog,
    contextMenu: contextMenu,
    setView: setView, render: render, renderContext: renderContext, renderStatus: renderStatus,
    saveNow: saveNow, saveBook: saveBookNow, markDirty: markDirty, setSaveState: setSaveState,
    currentChapter: currentChapter, openChapter: openChapter, openBook: openBook,
    setPageView: setPageView, openCleanupDialog: openCleanupDialog,
    newBookWizard: newBookWizard, duplicateBook: duplicateBook, deleteBook: deleteBook,
    importProject: importProject, runExport: runExport, showPreflight: showPreflight,
    openFind: openFind, openInsertMenu: openInsertMenu, openSettings: openSettings,
    insertCitation: insertCitation, insertFootnote: insertFootnote, addComment: addComment,
    insertLink: insertLink, insertTable: insertTable,
    insertImageFile: insertImageFile, insertImageUrl: insertImageUrl, insertSpecialChar: insertSpecialChar,
    addAsset: addAsset, editAsset: editAsset, editInlineImage: editInlineImage, replaceInlineImage: replaceInlineImage,
    showShortcuts: showShortcuts,
    applyTheme: applyTheme, applyTypography: applyTypography
  };

  document.addEventListener("DOMContentLoaded", boot);
  BF.bootReady = boot;
})();
