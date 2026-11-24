/* BookForge Studio — workspace views. Rendered into #view by the app shell. */
(function () {
  "use strict";
  var BF = (window.BF = window.BF || {});
  var U = BF.util;
  var app, S;

  function A() { app = BF.app; S = app.S; return app; }
  function book() { A(); return S.book; }

  function viewHead(title, subtitle, actions) {
    return U.el("div", { class: "view-head" }, [
      U.el("div", {}, [U.el("h1", { text: title }), U.el("p", { text: subtitle || "" })]),
      U.el("div", { class: "view-actions" }, actions || [])
    ]);
  }

  function btn(label, onClick, kind) {
    return U.el("button", { class: "btn " + (kind || "ghost"), text: label, onclick: onClick });
  }

  function needBook() {
    return U.el("div", { class: "empty" }, [
      U.el("h3", { text: "No book is open" }),
      U.el("p", { text: "Create a new book or open one from your library to use this workspace." }),
      btn("Create a new book", function () { A().newBookWizard(); }, "primary"),
      btn("Go to library", function () { A().setView("books"); })
    ]);
  }

  function sortChapters(b) {
    b.chapters.sort(function (x, y) { return (x.order || 0) - (y.order || 0); });
    b.chapters.forEach(function (c, i) { c.order = i + 1; });
  }

  /* =============================================================== dashboard */
  var SVG_NS = "http://www.w3.org/2000/svg";

  function brandMark(cls) {
    var svg = document.createElementNS(SVG_NS, "svg");
    svg.setAttribute("class", cls || "brand-hero-mark");
    svg.setAttribute("aria-hidden", "true");
    svg.setAttribute("focusable", "false");
    var use = document.createElementNS(SVG_NS, "use");
    use.setAttribute("href", "#bf-mark");
    svg.appendChild(use);
    return svg;
  }

  function brandHero(actions) {
    return U.el("div", { class: "brand-hero" }, [
      brandMark("brand-hero-mark"),
      U.el("div", { class: "brand-hero-copy" }, [
        U.el("h1", { class: "brand-hero-word", text: "BookForge" }),
        U.el("div", { class: "brand-hero-studio", text: "Studio" }),
        U.el("p", { class: "brand-hero-tag", text: "Write • Edit • Publish • Inspire" })
      ]),
      U.el("div", { class: "brand-hero-actions" }, actions)
    ]);
  }

  function dashboard() {
    A();
    var wrap = U.el("div");
    var active = S.books.filter(function (b) { return !b.trashed; });
    var totalWords = active.reduce(function (sum, b) { return sum + BF.model.stats(b).words; }, 0);
    var totalChapters = active.reduce(function (sum, b) { return sum + b.chapters.length; }, 0);
    var openComments = active.reduce(function (sum, b) { return sum + (b.comments || []).filter(function (c) { return c.status !== "resolved"; }).length; }, 0);

    wrap.appendChild(brandHero([
      btn("Create book", function () { A().newBookWizard(); }, "primary"),
      btn("Import project backup", function () { A().importProject(); })
    ]));

    wrap.appendChild(U.el("div", { class: "grid cols-4", style: "margin-bottom:14px" }, [
      stat("Books", String(active.length), totalChapters + " chapters in total"),
      stat("Words written", totalWords.toLocaleString(), "across all open books"),
      stat("Open comments", String(openComments), "editorial notes to resolve"),
      stat("Storage", S.storageMode === "indexeddb" ? "IndexedDB" : S.storageMode === "localstorage" ? "localStorage" : "Memory", "local browser storage only")
    ]));

    if (!active.length) {
      wrap.appendChild(U.el("div", { class: "empty" }, [
        brandMark("empty-mark"),
        U.el("h3", { text: "Start your first book" }),
        U.el("p", { text: "BookForge keeps everything in this browser. Choose a template, enter your book details and begin writing — or import an existing .bookforge.json backup." }),
        btn("Create a new book", function () { A().newBookWizard(); }, "primary"),
        btn("Import project backup", function () { A().importProject(); })
      ]));
    } else {
      wrap.appendChild(U.el("div", { class: "panel-block" }, [
        U.el("h2", { class: "panel-title", text: "Recent books" }),
        bookTable(active.slice().sort(function (a, b) { return b.updatedAt - a.updatedAt; }).slice(0, 6))
      ]));
      wrap.appendChild(U.el("div", { class: "panel-block" }, [
        U.el("h2", { class: "panel-title", text: "Writing goals" }),
        U.el("div", { class: "grid cols-3" }, active.slice(0, 3).map(function (b) {
          var st = BF.model.stats(b);
          return U.el("div", {}, [
            U.el("p", { class: "small", text: b.title }),
            progressBar(st.progress),
            U.el("p", { class: "small muted", text: st.words.toLocaleString() + " / " + (b.targetWords || 0).toLocaleString() + " words" })
          ]);
        }))
      ]));
    }
    return wrap;
  }

  function stat(k, v, s) {
    return U.el("div", { class: "stat" }, [
      U.el("div", { class: "k", text: k }),
      U.el("div", { class: "v", text: v }),
      U.el("div", { class: "s", text: s || "" })
    ]);
  }

  function progressBar(p) {
    var bar = U.el("div", { class: "bar" });
    bar.appendChild(U.el("i", { style: "width:" + Math.round(Math.max(0, Math.min(1, p || 0)) * 100) + "%" }));
    return bar;
  }

  function bookTable(books) {
    var table = U.el("table", { class: "table" });
    table.appendChild(U.el("thead", {}, [U.el("tr", {}, [
      U.el("th", { text: "Book" }), U.el("th", { text: "Progress" }), U.el("th", { text: "Last edited" }), U.el("th", { text: "Status" }), U.el("th", { text: "Actions" })
    ])]));
    var tbody = U.el("tbody");
    books.forEach(function (b) {
      var st = BF.model.stats(b);
      tbody.appendChild(U.el("tr", {}, [
        U.el("td", {}, [
          U.el("b", { text: b.title }),
          U.el("div", { class: "small muted", text: (b.author || "No author") + (b.subtitle ? " · " + b.subtitle : "") })
        ]),
        U.el("td", { style: "min-width:140px" }, [
          progressBar(st.progress),
          U.el("div", { class: "small muted", text: st.words.toLocaleString() + " / " + (b.targetWords || 0).toLocaleString() + " words · " + st.chapters + " chapters" })
        ]),
        U.el("td", { text: U.relativeTime(b.updatedAt) }),
        U.el("td", {}, [badge(b.archived ? "Archived" : "Active", b.archived ? "" : "ok")]),
        U.el("td", {}, [U.el("div", { class: "actions" }, [
          btn("Open", function () { A().openBook(b); }, "primary"),
          btn("Rename", function () { renameBook(b); }),
          btn("Duplicate", function () { A().duplicateBook(b); }),
          btn(b.archived ? "Unarchive" : "Archive", function () { b.archived = !b.archived; A().saveBook(b); A().render(); }),
          btn("Delete", function () { A().deleteBook(b, false); }, "danger")
        ])])
      ]));
    });
    table.appendChild(tbody);
    return table;
  }

  function badge(text, kind) {
    return U.el("span", { class: "badge " + (kind || ""), text: text });
  }

  function renameBook(b) {
    A().formDialog({
      title: "Rename book",
      narrow: true,
      fields: [{ name: "title", label: "Book title", value: b.title, required: true }],
      submitLabel: "Rename",
      onSubmit: function (v) {
        b.title = v.title;
        b.updatedAt = Date.now();
        A().saveBook(b);
        A().render();
      }
    });
  }

  /* =============================================================== all books */
  function books() {
    A();
    var wrap = U.el("div");
    var items = S.books.filter(function (b) { return !b.trashed; });
    var showArchived = !!S.showArchived;
    if (!showArchived) items = items.filter(function (b) { return !b.archived; });
    wrap.appendChild(viewHead("All books", "Every project stored in this browser.", [
      btn("Create book", function () { A().newBookWizard(); }, "primary"),
      btn("Import backup", function () { A().importProject(); }),
      btn(showArchived ? "Hide archived" : "Show archived", function () { S.showArchived = !S.showArchived; A().render(); })
    ]));
    if (!items.length) {
      wrap.appendChild(U.el("div", { class: "empty" }, [U.el("h3", { text: "No books here yet" }), U.el("p", { text: "Create a book to see it listed." })]));
      return wrap;
    }
    wrap.appendChild(U.el("div", { class: "panel-block" }, [bookTable(items)]));
    return wrap;
  }

  function recent() {
    A();
    var wrap = U.el("div");
    var items = S.books.filter(function (b) { return !b.trashed; }).sort(function (a, b) { return b.updatedAt - a.updatedAt; }).slice(0, 12);
    wrap.appendChild(viewHead("Recent projects", "Ordered by last edit.", [btn("Create book", function () { A().newBookWizard(); }, "primary")]));
    if (!items.length) wrap.appendChild(U.el("div", { class: "empty" }, [U.el("h3", { text: "Nothing edited yet" })]));
    else wrap.appendChild(U.el("div", { class: "panel-block" }, [bookTable(items)]));
    return wrap;
  }

  /* =============================================================== manuscript */
  function trimLabel(geo) {
    function fmt(n) { return String(Math.round(n * 100) / 100).replace(/\.0+$/, ""); }
    return fmt(geo.trimW / 25.4) + " × " + fmt(geo.trimH / 25.4) + " in";
  }

  function pageViewReady() {
    var overlay = document.getElementById("overlay");
    return !!(S && S.pageView && S.view === "manuscript" && (!overlay || overlay.hidden));
  }

  var pageResizeTimer = null;
  window.addEventListener("resize", function () {
    if (!pageViewReady()) return;
    clearTimeout(pageResizeTimer);
    pageResizeTimer = setTimeout(function () {
      if (pageViewReady()) A().render();
    }, 250);
  });

  function scrollToPageCard(card, smooth) {
    if (!card) return;
    var main = document.getElementById("main");
    if (!main) return;
    var offset = card.getBoundingClientRect().top - main.getBoundingClientRect().top + main.scrollTop;
    var top = Math.max(0, offset - 52);
    if (smooth && typeof main.scrollTo === "function") main.scrollTo({ top: top, behavior: "smooth" });
    else main.scrollTop = top;
  }

  var draftPageState = null;
  var draftPageTimer = null;

  function wordOffsetAtCaret(surface) {
    var sel = window.getSelection();
    if (!sel || !sel.rangeCount || !surface.contains(sel.anchorNode)) return null;
    var range = document.createRange();
    range.selectNodeContents(surface);
    try { range.setEnd(sel.anchorNode, sel.anchorOffset); } catch (e) { return null; }
    var frag = range.cloneContents();
    var host = document.createElement("div");
    host.appendChild(frag);
    var blocks = Array.prototype.slice.call(host.children);
    if (!blocks.length) return U.countWords(host.textContent || "");
    return blocks.reduce(function (n, block) {
      return n + U.countWords(block.textContent || "");
    }, 0);
  }

  function ensureSidebarPageIndicator() {
    var host = document.getElementById("sidebar");
    if (!host) return null;
    var foot = host.querySelector(".sidebar-foot") || host;
    var el = document.getElementById("sidebarPageIndicator");
    if (!el) {
      el = U.el("div", {
        class: "sidebar-page-indicator", id: "sidebarPageIndicator",
        title: "Page position at the cursor in Draft, or the page scrolled into view in Pages."
      }, [
        U.el("div", { class: "sidebar-page-track", id: "sidebarPageTrack" }, [
          U.el("div", { class: "sidebar-page-fill", id: "sidebarPageFill" })
        ]),
        U.el("div", { class: "sidebar-page-label" }, [
          U.el("b", { id: "sidebarPageCurrent", text: "—" }),
          U.el("span", { text: "/" }),
          U.el("span", { id: "sidebarPageTotal", text: "—" })
        ])
      ]);
      foot.appendChild(el);
    }
    bindMainScroll();
    return el;
  }

  function setSidebarPage(page, total) {
    var fill = document.getElementById("sidebarPageFill");
    var cur = document.getElementById("sidebarPageCurrent");
    var tot = document.getElementById("sidebarPageTotal");
    if (cur) cur.textContent = String(page);
    if (tot) tot.textContent = String(total);
    if (fill && total > 0) {
      fill.style.height = Math.max(6, Math.min(100, Math.round(page / total * 100))) + "%";
    }
  }

  var mainScrollBound = false;

  function bindMainScroll() {
    if (mainScrollBound) return;
    var main = document.getElementById("main");
    if (!main) return;
    mainScrollBound = true;
    var ticking = false;
    main.addEventListener("scroll", function () {
      if (!document.body.classList.contains("pages-mode")) return;
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(function () {
        ticking = false;
        updateSidebarPagesScroll();
      });
    });
  }

  function updateSidebarPagesScroll() {
    if (!document.body.classList.contains("pages-mode")) return;
    var cards = U.qsa("#view .page-card");
    if (!cards.length) return;
    var main = document.getElementById("main");
    var line = (main ? main.getBoundingClientRect().top : 0) + 80;
    var current = cards[0];
    for (var i = 0; i < cards.length; i++) {
      if (cards[i].getBoundingClientRect().bottom > line) { current = cards[i]; break; }
    }
    setSidebarPage(cards.indexOf(current) + 1, cards.length);
  }

  function updateDraftPageIndicator(surface, ch) {
    var current = document.getElementById("draftPageCurrent");
    var total = document.getElementById("draftPageTotal");
    if (!current || !total || !draftPageState || draftPageState.chapterId !== ch.id) return;
    if (draftPageState.updatedAt !== ch.updatedAt || draftPageState.title !== ch.title) return;
    var offset = wordOffsetAtCaret(surface);
    if (offset == null) offset = 0;
    var page = 1;
    for (var i = 0; i < draftPageState.ranges.length; i++) {
      page = i + 1;
      if (offset < draftPageState.ranges[i].end) break;
    }
    current.textContent = String(page);
    total.textContent = String(draftPageState.total);
    setSidebarPage(page, draftPageState.total);
  }

  function scheduleDraftPageMap(b, ch, surface, delay) {
    if (!BF.layout || typeof BF.layout.chapterPageMap !== "function") return;
    clearTimeout(draftPageTimer);
    draftPageTimer = setTimeout(function () {
      if (!S || S.pageView || S.view !== "manuscript" || S.chapterId !== ch.id) return;
      var designKey = "";
      try { designKey = JSON.stringify(b.design || {}); } catch (e) { designKey = ""; }
      if (draftPageState &&
          draftPageState.chapterId === ch.id &&
          draftPageState.updatedAt === ch.updatedAt &&
          draftPageState.title === ch.title &&
          draftPageState.designKey === designKey) {
        updateDraftPageIndicator(surface, ch);
        return;
      }
      var map;
      try { map = BF.layout.chapterPageMap(b, ch); } catch (e) { return; }
      if (!map) return;
      draftPageState = {
        chapterId: ch.id, updatedAt: ch.updatedAt, title: ch.title, designKey: designKey,
        ranges: map.pages, total: map.total
      };
      updateDraftPageIndicator(surface, ch);
    }, delay || 400);
  }

  function manuscriptBar(b, ch) {
    var bar = U.el("div", { class: "manuscript-bar" + (S.pageView ? " is-pages" : "") });
    var seg = U.el("div", { class: "seg", role: "group", "aria-label": "Manuscript view" });
    var draft = U.el("button", {
      type: "button", text: "Draft", "aria-pressed": S.pageView ? "false" : "true",
      onclick: function () { if (S.pageView) A().setPageView(false); }
    });
    var pages = U.el("button", {
      type: "button", text: "Pages", "aria-pressed": S.pageView ? "true" : "false",
      onclick: function () { if (!S.pageView) A().setPageView(true); }
    });
    seg.appendChild(draft);
    seg.appendChild(pages);
    bar.appendChild(seg);

    var index = b.chapters.filter(function (c) { return c.order < ch.order; }).length + 1;
    var trim = trimLabel(BF.layout.geometry(b));
    bar.appendChild(U.el("span", {
      class: "bar-meta", id: "pageViewInfo",
      title: "Page size: " + trim + ". Change it in Design studio.",
      text: S.pageView ? "Laying out pages…" : "Chapter " + index + " of " + b.chapters.length + " · Page size " + trim + " · " + BF.model.chapterWords(ch).toLocaleString() + " words"
    }));

    if (!S.pageView) {
      bar.appendChild(U.el("span", {
        class: "draft-page-indicator", id: "draftPageIndicator",
        title: "Current chapter page at the cursor, measured with the print page layout."
      }, [
        U.el("span", { text: "Page " }),
        U.el("b", { id: "draftPageCurrent", text: "—" }),
        U.el("span", { text: " of " }),
        U.el("span", { id: "draftPageTotal", text: "—" })
      ]));
      ensureSidebarPageIndicator();
    }

    var actions = U.el("div", { class: "bar-actions" });
    actions.appendChild(U.el("button", {
      type: "button", class: "btn ghost sm", text: "Clean up & format",
      onclick: function () { A().openCleanupDialog(); }
    }));
    if (S.pageView) {
      actions.appendChild(U.el("button", {
        type: "button", class: "btn ghost sm", text: "Jump to my chapter",
        onclick: function () {
          var target = U.qsa(".page-card.is-current").filter(function (el) { return el.dataset.chapter === S.chapterId; })[0];
          scrollToPageCard(target, true);
        }
      }));
      actions.appendChild(U.el("button", {
        type: "button", class: "btn ghost sm", text: "Refresh pages",
        onclick: function () { A().render(); }
      }));
      actions.appendChild(U.el("button", {
        type: "button", class: "btn ghost sm", text: "Page setup",
        onclick: function () { A().setView("design"); }
      }));
    }
    bar.appendChild(actions);
    return bar;
  }

  function pagesCanvas(b, ch) {
    var canvas = U.el("div", { class: "canvas-wrap is-pages" });
    var host = U.el("div", { class: "page-view", role: "region", "aria-label": "Manuscript pages" });
    host.appendChild(U.el("div", { class: "page-loading", text: "Laying out pages…" }));
    canvas.appendChild(host);

    setTimeout(function () {
      if (!document.body.contains(host) || !S.pageView || S.view !== "manuscript") return;
      var cs = window.getComputedStyle(canvas);
      var main = document.getElementById("main");
      var availW = (canvas.clientWidth || 760) - parseFloat(cs.paddingLeft || 0) - parseFloat(cs.paddingRight || 0) - 2;
      var availH = (main ? main.clientHeight : window.innerHeight) - 145;
      var geo = BF.layout.geometry(b);
      var pageW = geo.trimW * 96 / 25.4;
      var pageH = geo.trimH * 96 / 25.4;
      var widthScale = Math.max(240, availW) / pageW;
      var heightScale = Math.max(220, availH) / pageH;
      var scale = Math.max(0.34, Math.min(1, widthScale, Math.max(0.62, heightScale)));
      scale = Math.floor(scale * 1000) / 1000;
      var res;
      try {
        res = BF.layout.renderPages(host, b, {
          scale: scale,
          chapterId: S.chapterId,
          onEditChapter: function (id) { A().openChapter(id); },
          onOpenMatter: function () { A().setView("matter"); }
        });
      } catch (e) {
        host.innerHTML = "";
        host.appendChild(U.el("div", { class: "empty" }, [
          U.el("h3", { text: "Pages could not be laid out" }),
          U.el("p", { text: e.message })
        ]));
        return;
      }
      var info = document.getElementById("pageViewInfo");
      if (info) info.textContent = res.pages.length + " pages · " + trimLabel(geo) + " · read-only proof";
      var stPage = document.getElementById("stPage");
      if (stPage) stPage.textContent = res.pages.length + " pages (exact)";
      ensureSidebarPageIndicator();
      scrollToPageCard(host.querySelector(".page-card.is-current"), false);
      updateSidebarPagesScroll();
    }, 30);

    return canvas;
  }

  function manuscript() {
    A();
    var b = book();
    if (!b) return needBook();
    if (!b.chapters.length) {
      b.chapters.push(BF.model.createChapter("Chapter 1", { order: 1 }));
      S.chapterId = b.chapters[0].id;
    }
    if (!S.chapterId || !b.chapters.some(function (c) { return c.id === S.chapterId; })) S.chapterId = b.chapters[0].id;
    var ch = A().currentChapter();

    var wrap = U.el("div");
    wrap.appendChild(manuscriptBar(b, ch));
    if (S.pageView) {
      S.editor = null;
      wrap.appendChild(pagesCanvas(b, ch));
      return wrap;
    }

    var toolbar = buildToolbar();
    var shell = U.el("div", { class: "editor-shell" });
    shell.appendChild(toolbar);

    var canvasWrap = U.el("div", { class: "canvas-wrap" });
    var sheet = U.el("div", { class: "page-sheet" });
    var chapterIndex = b.chapters.filter(function (c) { return c.order < ch.order; }).length + 1;
    sheet.appendChild(U.el("div", { class: "chapter-kicker", id: "chapterKicker", text: (b.parts.some(function (p) { return p.id === ch.partId; }) ? "Part " + partName(b, ch.partId) + " · " : "") + "Chapter " + chapterIndex + " · " + BF.model.chapterWords(ch).toLocaleString() + " words" }));
    var title = U.el("input", {
      class: "chapter-heading", value: ch.title, "aria-label": "Chapter title",
      style: "width:100%;border:0;background:transparent;color:inherit;font-size:1.6em;font-weight:600;padding:0 0 10px;margin-bottom:14px;border-bottom:1px solid var(--canvas-line)"
    });
    title.addEventListener("input", function () {
      ch.title = title.value || "Untitled chapter";
      A().markDirty();
      A().renderContext();
      updateChapterKicker();
      scheduleDraftPageMap(b, ch, surface, 350);
    });
    sheet.appendChild(title);

    var surface = U.el("div", { class: "manuscript", contenteditable: "true", spellcheck: "true", role: "textbox", "aria-multiline": "true", "aria-label": "Chapter manuscript" });
    surface.innerHTML = ch.content || "";
    sheet.appendChild(surface);
    canvasWrap.appendChild(sheet);
    shell.appendChild(canvasWrap);
    wrap.appendChild(shell);

    S.editor = new BF.Editor(surface, {
      onChange: function () {
        ch.content = S.editor.getHtml();
        ch.updatedAt = Date.now();
        A().markDirty();
        updateChapterKicker();
        scheduleDraftPageMap(b, ch, surface, 350);
      },
      onStats: function () {
        A().renderStatus();
      },
      onSelectionState: function (state) {
        paintToolbar(state);
        var sel = window.getSelection();
        var text = sel ? String(sel) : "";
        var box = document.getElementById("ctxSelection");
        if (box) box.textContent = text.trim() ? U.countWords(text) + " words, " + text.length + " characters selected" : "Select text in the manuscript to see word count.";
        updateDraftPageIndicator(surface, ch);
      },
      onSave: function () { A().saveNow("manual"); },
      onFind: function () { A().openFind(); },
      onImageFile: function (file) {
        U.fileToDataUrl(file).then(function (url) {
          A().addAsset(file.name, url, file.type, file.size, file.name, false);
          S.editor.insertImage(url, file.name);
          A().markDirty();
        });
      },
      onImageDblClick: function (img) { A().editInlineImage(img); },
      typewriter: function () { return S.mode === "typewriter"; },
      scroller: function () { return document.getElementById("main"); }
    });
    scheduleDraftPageMap(b, ch, surface, 80);
    updateDraftPageIndicator(surface, ch);

    return wrap;
  }

  function partName(b, partId) {
    var p = b.parts.filter(function (x) { return x.id === partId; })[0];
    return p ? p.title : "";
  }

  function updateChapterKicker() {
    var b = book();
    var ch = A().currentChapter();
    var el = document.getElementById("chapterKicker");
    if (!el || !b || !ch) return;
    var idx = b.chapters.filter(function (c) { return c.order < ch.order; }).length + 1;
    el.textContent = (ch.partId && partName(b, ch.partId) ? "Part " + partName(b, ch.partId) + " · " : "") + "Chapter " + idx + " · " + BF.model.chapterWords(ch).toLocaleString() + " words";
  }

  function buildToolbar() {
    var bar = U.el("div", { class: "editor-toolbar", role: "toolbar", "aria-label": "Formatting" });
    var e = function () { return S.editor; };
    function group(children) { return U.el("div", { class: "group" }, children); }
    function tb(label, title, onClick, id) {
      var b = U.el("button", { type: "button", title: title, "aria-label": title, "data-cmd": id || "", onclick: onClick }, [label]);
      return b;
    }

    var blockSelect = U.el("select", { title: "Paragraph style", "aria-label": "Paragraph style" });
    [["p", "Body text"], ["h1", "Heading 1"], ["h2", "Heading 2"], ["h3", "Heading 3"], ["blockquote", "Block quote"]].forEach(function (o) {
      blockSelect.appendChild(U.el("option", { value: o[0], text: o[1] }));
    });
    blockSelect.addEventListener("change", function () {
      e().formatBlock(blockSelect.value);
      A().markDirty();
    });
    bar.appendChild(blockSelect);

    bar.appendChild(group([
      tb("B", "Bold (Ctrl+B)", function () { e().exec("bold"); A().markDirty(); }, "bold"),
      tb("I", "Italic (Ctrl+I)", function () { e().exec("italic"); A().markDirty(); }, "italic"),
      tb("U", "Underline (Ctrl+U)", function () { e().exec("underline"); A().markDirty(); }, "underline"),
      tb("S", "Strikethrough", function () { e().exec("strikeThrough"); A().markDirty(); }, "strikeThrough")
    ]));
    bar.appendChild(group([
      tb("•", "Bulleted list", function () { e().exec("insertUnorderedList"); A().markDirty(); }, "insertUnorderedList"),
      tb("1.", "Numbered list", function () { e().exec("insertOrderedList"); A().markDirty(); }, "insertOrderedList"),
      tb("❝", "Block quote", function () { e().formatBlock("blockquote"); A().markDirty(); })
    ]));
    bar.appendChild(group([
      tb("⇤", "Align left", function () { e().exec("justifyLeft"); A().markDirty(); }, "justifyLeft"),
      tb("↔", "Align centre", function () { e().exec("justifyCenter"); A().markDirty(); }, "justifyCenter"),
      tb("⇥", "Align right", function () { e().exec("justifyRight"); A().markDirty(); }, "justifyRight"),
      tb("☰", "Justify", function () { e().exec("justifyFull"); A().markDirty(); }, "justifyFull")
    ]));
    bar.appendChild(group([
      tb("🔗", "Insert link", function () { A().insertLink(); }),
      tb("🖼", "Insert image", function () { A().openInsertMenu(360, 96); }),
      tb("▦", "Insert table", function () { A().insertTable ? A().insertTable() : A().openInsertMenu(360, 120); }),
      tb("†", "Footnote", function () { A().insertFootnote(); }),
      tb("“”", "Citation", function () { A().insertCitation(); }),
      tb("❖", "Special characters", function () { A().openInsertMenu(400, 200); })
    ]));
    bar.appendChild(group([
      tb("⌕", "Find & replace (Ctrl+F)", function () { A().openFind(); }),
      tb("≡", "Insert menu (page breaks, comments, captions)", function (ev) { A().openInsertMenu(ev.clientX, ev.clientY + 12); }),
      tb("Tx", "Clear formatting", function () { e().exec("removeFormat"); A().markDirty(); })
    ]));
    return bar;
  }

  function paintToolbar(state) {
    U.qsa(".editor-toolbar button[data-cmd]").forEach(function (b) {
      var key = b.dataset.cmd;
      if (!key) return;
      b.setAttribute("aria-pressed", state && state[key] ? "true" : "false");
    });
  }

  /* ================================================================== outline */
  function outline() {
    A();
    var b = book();
    if (!b) return needBook();
    sortChapters(b);
    var wrap = U.el("div");
    wrap.appendChild(viewHead("Book outline", "Parts, chapters and manuscript headings stay synchronised with the editor.", [
      btn("Add part", function () { addPart(); }),
      btn("Add chapter", function () { addChapter(); }, "primary"),
      btn("Generate table of contents", function () { showToc(); }),
      btn("Rebuild list", function () { A().render(); })
    ]));

    var tree = U.el("div", { class: "outline-tree" });
    var byPart = U.groupBy(b.chapters, function (c) { return c.partId || ""; });
    (byPart[""] || []).forEach(function (ch, i) { tree.appendChild(chapterRow(b, ch, 0, i)); });
    (b.parts || []).slice().sort(function (x, y) { return (x.order || 0) - (y.order || 0); }).forEach(function (part) {
      tree.appendChild(partRow(b, part));
      var list = U.el("div", { class: "outline-children" });
      (byPart[part.id] || []).forEach(function (ch, i) { list.appendChild(chapterRow(b, ch, 1, i)); });
      tree.appendChild(list);
    });

    wrap.appendChild(U.el("div", { class: "panel-block" }, [tree]));
    return wrap;
  }

  function partRow(b, part) {
    var row = U.el("div", { class: "outline-row", draggable: "true" });
    row.dataset.partId = part.id;
    row.appendChild(U.el("span", { class: "grip", text: "⠿" }));
    row.appendChild(U.el("span", { class: "otype", text: "Part" }));
    row.appendChild(U.el("span", { class: "otitle", text: part.title }));
    row.appendChild(U.el("span", { class: "ostats", text: (b.chapters.filter(function (c) { return c.partId === part.id; }).length) + " chapters" }));
    row.appendChild(U.el("div", { class: "actions" }, [
      btn("Rename", function () { renamePart(part); }), 
      btn("Delete", function () { deletePart(part); }, "danger")
    ]));
    row.addEventListener("dragstart", function (e) {
      e.dataTransfer.setData("text/bf-part", part.id);
    });
    row.addEventListener("dragover", function (e) { e.preventDefault(); row.classList.add("dragover"); });
    row.addEventListener("dragleave", function () { row.classList.remove("dragover"); });
    row.addEventListener("drop", function (e) {
      e.preventDefault();
      row.classList.remove("dragover");
      var chId = e.dataTransfer.getData("text/bf-chapter");
      if (chId) {
        var ch = b.chapters.filter(function (c) { return c.id === chId; })[0];
        if (ch) { ch.partId = part.id; A().markDirty(); A().render(); }
      }
    });
    return row;
  }

  function chapterRow(b, ch, depth, index) {
    var row = U.el("div", { class: "outline-row", draggable: "true" });
    if (ch.id === S.chapterId) row.classList.add("selected");
    row.dataset.chapterId = ch.id;
    row.appendChild(U.el("span", { class: "grip", text: "⠿" }));
    row.appendChild(U.el("span", { class: "otype", text: "Chapter" }));
    row.appendChild(U.el("span", { class: "otitle", text: ch.title }));
    row.appendChild(U.el("span", { class: "ostats", text: BF.model.chapterWords(ch).toLocaleString() + " words" }));
    row.appendChild(U.el("div", { class: "actions" }, [
      btn("Open", function () { A().openChapter(ch.id); }),
      btn("↑", function () { moveChapter(b, ch, -1); }),
      btn("↓", function () { moveChapter(b, ch, 1); }),
      btn("Indent", function () { cyclePart(b, ch); }, "ghost"),
      btn("Rename", function () { renameChapter(ch); }),
      btn("Duplicate", function () { duplicateChapter(b, ch); }),
      btn("Delete", function () { deleteChapter(b, ch); }, "danger")
    ]));
    row.addEventListener("click", function (e) {
      if (e.target.closest("button")) return;
      S.chapterId = ch.id;
      A().render();
    });
    row.addEventListener("dragstart", function (e) {
      row.classList.add("dragging");
      e.dataTransfer.setData("text/bf-chapter", ch.id);
    });
    row.addEventListener("dragend", function () { row.classList.remove("dragging"); });
    row.addEventListener("dragover", function (e) { e.preventDefault(); row.classList.add("dragover"); });
    row.addEventListener("dragleave", function () { row.classList.remove("dragover"); });
    row.addEventListener("drop", function (e) {
      e.preventDefault();
      row.classList.remove("dragover");
      var otherId = e.dataTransfer.getData("text/bf-chapter");
      var partId = e.dataTransfer.getData("text/bf-part");
      if (otherId && otherId !== ch.id) {
        var other = b.chapters.filter(function (c) { return c.id === otherId; })[0];
        if (!other) return;
        sortChapters(b);
        b.chapters = b.chapters.filter(function (c) { return c.id !== otherId; });
        var idx = b.chapters.indexOf(ch);
        other.partId = ch.partId;
        b.chapters.splice(idx, 0, other);
        sortChapters(b);
        A().markDirty();
        A().render();
      } else if (partId) {
        ch.partId = partId;
        A().markDirty();
        A().render();
      }
    });

    var box = U.el("div", {});
    box.appendChild(row);
    var headings = BF.model.headingsFromHtml(ch.content);
    if (depth === 0 || depth === 1) {
      var list = U.el("div", { class: "outline-children" });
      headings.forEach(function (h) {
        list.appendChild(U.el("div", { class: "outline-row" }, [
          U.el("span", { class: "otype", text: "H" + h.level }),
          U.el("span", { class: "otitle", text: h.text || "(untitled heading)" })
        ]));
      });
      if (!headings.length) list.appendChild(U.el("div", { class: "outline-row" }, [U.el("span", { class: "otype", text: "—" }), U.el("span", { class: "otitle muted", text: "No headings in this chapter yet" })]));
      box.appendChild(list);
    }
    return box;
  }

  function addPart() {
    A().promptDialog({ title: "Add part", label: "Part title", value: "Part " + (book().parts.length + 1) }).then(function (v) {
      if (!v) return;
      book().parts.push({ id: U.uid("part"), title: v, order: book().parts.length + 1 });
      A().markDirty();
      A().render();
    });
  }

  function addChapter() {
    var b = book();
    A().promptDialog({ title: "Add chapter", label: "Chapter title", value: "Chapter " + (b.chapters.length + 1) }).then(function (v) {
      if (!v) return;
      var ch = BF.model.createChapter(v, { order: b.chapters.length + 1 });
      b.chapters.push(ch);
      S.chapterId = ch.id;
      A().markDirty();
      A().render();
    });
  }

  function renameChapter(ch) {
    A().promptDialog({ title: "Rename chapter", label: "Chapter title", value: ch.title }).then(function (v) {
      if (!v) return;
      ch.title = v;
      A().markDirty();
      A().render();
    });
  }

  function renamePart(part) {
    A().promptDialog({ title: "Rename part", label: "Part title", value: part.title }).then(function (v) {
      if (!v) return;
      part.title = v;
      A().markDirty();
      A().render();
    });
  }

  function deletePart(part) {
    var b = book();
    A().confirmDialog({
      title: "Delete part",
      message: "Delete \"" + part.title + "\"? Its chapters will be kept and moved out of the part.",
      danger: true, confirmLabel: "Delete part"
    }).then(function (ok) {
      if (!ok) return;
      b.chapters.forEach(function (c) { if (c.partId === part.id) c.partId = null; });
      b.parts = b.parts.filter(function (p) { return p.id !== part.id; });
      A().markDirty();
      A().render();
    });
  }

  function moveChapter(b, ch, delta) {
    sortChapters(b);
    var idx = b.chapters.indexOf(ch);
    var target = idx + delta;
    if (target < 0 || target >= b.chapters.length) return;
    var other = b.chapters[target];
    var targetPart = other.partId;
    b.chapters.splice(idx, 1);
    b.chapters.splice(target, 0, ch);
    ch.partId = targetPart;
    sortChapters(b);
    A().markDirty();
    A().render();
  }

  function cyclePart(b, ch) {
    var parts = b.parts || [];
    if (!parts.length) {
      app.toast("No parts exist yet. Add a part first.");
      return;
    }
    var idx = ch.partId ? parts.findIndex(function (p) { return p.id === ch.partId; }) : -1;
    var next = idx + 1;
    ch.partId = next >= parts.length ? null : parts[next].id;
    A().markDirty();
    A().render();
  }

  function duplicateChapter(b, ch) {
    var copy = U.clone(ch);
    copy.id = U.uid("ch");
    copy.title = ch.title + " (copy)";
    copy.createdAt = Date.now();
    copy.updatedAt = Date.now();
    sortChapters(b);
    b.chapters.splice(b.chapters.indexOf(ch) + 1, 0, copy);
    sortChapters(b);
    A().markDirty();
    A().render();
    app.toast("Chapter duplicated");
  }

  function deleteChapter(b, ch) {
    A().confirmDialog({
      title: "Move chapter to trash",
      message: 'Move "' + ch.title + '" to the trash? You can restore it from the Trash view.',
      danger: true, confirmLabel: "Move to trash"
    }).then(function (ok) {
      if (!ok) return;
      b.chapters = b.chapters.filter(function (c) { return c.id !== ch.id; });
      b.trashChapters = b.trashChapters || [];
      b.trashChapters.push({ chapter: U.clone(ch), deletedAt: Date.now() });
      sortChapters(b);
      if (S.chapterId === ch.id) S.chapterId = b.chapters.length ? b.chapters[0].id : null;
      A().markDirty();
      A().render();
    });
  }

  function showToc() {
    var entries = BF.model.buildToc(book());
    var list = entries.length
      ? U.el("ol", {}, entries.map(function (e) {
        return U.el("li", { style: "margin-left:" + ((e.level - 1) * 16) + "px", text: e.label });
      }))
      : U.el("p", { class: "muted", text: "No entries yet." });
    A().openDialog({
      title: "Table of contents",
      wide: true,
      body: U.el("div", {}, [
        U.el("p", { class: "small muted", text: "Generated from your actual parts, chapters and headings. Nothing is invented." }),
        list
      ]),
      actions: [{ label: "Close", primary: true, onClick: function (close) { close(); } }]
    });
  }

  /* ================================================================= chapters */
  function chapters() {
    A();
    var b = book();
    if (!b) return needBook();
    sortChapters(b);
    var wrap = U.el("div");
    wrap.appendChild(viewHead("Chapters", b.chapters.length + " chapters · " + BF.model.stats(b).words.toLocaleString() + " words", [
      btn("Add chapter", function () { addChapter(); }, "primary"),
      btn("Move up / down with the arrows", function () { app.toast("Use ↑ / ↓ to reorder chapters"); })
    ]));
    var table = U.el("table", { class: "table" });
    table.appendChild(U.el("thead", {}, [U.el("tr", {}, [
      U.el("th", { text: "#" }), U.el("th", { text: "Chapter" }), U.el("th", { text: "Words" }),
      U.el("th", { text: "Status" }), U.el("th", { text: "Updated" }), U.el("th", { text: "Actions" })
    ])]));
    var tbody = U.el("tbody");
    b.chapters.forEach(function (ch, i) {
      tbody.appendChild(U.el("tr", {}, [
        U.el("td", { text: String(i + 1) }),
        U.el("td", {}, [
          U.el("b", { text: ch.title }),
          U.el("div", { class: "small muted", text: BF.model.headingsFromHtml(ch.content).slice(0, 3).map(function (h) { return "H" + h.level + " " + h.text; }).join(" · ") || "No headings" })
        ]),
        U.el("td", { text: BF.model.chapterWords(ch).toLocaleString() }),
        U.el("td", {}, [statusBadge(ch)]),
        U.el("td", { text: U.relativeTime(ch.updatedAt) }),
        U.el("td", {}, [U.el("div", { class: "actions" }, [
          btn("Open", function () { A().openChapter(ch.id); }, "primary"),
          btn("↑", function () { moveChapter(b, ch, -1); }),
          btn("↓", function () { moveChapter(b, ch, 1); }),
          btn("Rename", function () { renameChapter(ch); }),
          btn("Duplicate", function () { duplicateChapter(b, ch); }),
          btn("Delete", function () { deleteChapter(b, ch); }, "danger")
        ])])
      ]));
    });
    table.appendChild(tbody);
    wrap.appendChild(U.el("div", { class: "panel-block" }, [table]));
    return wrap;
  }

  function statusBadge(ch) {
    if (ch.status === "final") return badge("Final", "ok");
    if (ch.status === "revised") return badge("Revised", "gold");
    return badge("Draft");
  }

  /* ==================================================================== notes */
  var NOTE_TYPES = function () { return BF.model.NOTE_TYPES; };

  function noteFilters(defaultType) {
    S.noteFilter = S.noteFilter || { type: defaultType || "", q: "" };
    return S.noteFilter;
  }

  function notesView(headTitle, headSub, subset) {
    A();
    var b = book();
    if (!b) return needBook();
    var f = noteFilters(subset);
    var wrap = U.el("div");
    wrap.appendChild(viewHead(headTitle, headSub, [
      btn("New note", function () { noteDialog(null, subset); }, "primary")
    ]));

    var controls = U.el("div", { class: "toolbar" });
    var typeSel = U.el("select", { "aria-label": "Filter by note type" });
    typeSel.appendChild(U.el("option", { value: "", text: "All types" }));
    NOTE_TYPES().filter(function (t) { return !subset || subset.indexOf(t) >= 0; }).forEach(function (t) {
      var o = U.el("option", { value: t, text: t });
      if (f.type === t) o.selected = true;
      typeSel.appendChild(o);
    });
    typeSel.addEventListener("change", function () { f.type = typeSel.value; A().render(); });
    var search = U.el("input", { type: "search", placeholder: "Search notes…", "aria-label": "Search notes" });
    search.value = f.q || "";
    search.addEventListener("input", U.debounce(function () { f.q = search.value; A().render(); }, 250));
    controls.appendChild(typeSel);
    controls.appendChild(search);
    wrap.appendChild(controls);

    var items = b.notes.slice().sort(function (x, y) { return y.updatedAt - x.updatedAt; });
    if (f.type) items = items.filter(function (n) { return n.type === f.type; });
    if (f.q) {
      var q = f.q.toLowerCase();
      items = items.filter(function (n) {
        return (n.title + " " + n.body + " " + (n.tags || []).join(" ")).toLowerCase().indexOf(q) >= 0;
      });
    }
    if (!items.length) {
      wrap.appendChild(U.el("div", { class: "empty" }, [
        U.el("h3", { text: "No notes yet" }),
        U.el("p", { text: "Create research notes, character profiles, quotations, questions or to-dos. Notes can be linked to a chapter." })
      ]));
      return wrap;
    }
    var grid = U.el("div", { class: "grid cols-3" });
    items.forEach(function (n) {
      grid.appendChild(U.el("div", { class: "panel-block" }, [
        U.el("div", { style: "display:flex;justify-content:space-between;gap:8px;align-items:flex-start" }, [
          U.el("b", { text: n.title }),
          badge(n.type)
        ]),
        U.el("p", { class: "small", style: "margin:8px 0;white-space:pre-wrap", text: (n.body || "").slice(0, 320) }),
        (n.tags || []).length ? U.el("div", {}, n.tags.map(function (t) { return U.el("span", { class: "chip", text: "#" + t }); })) : null,
        U.el("div", { class: "small muted", text: (n.chapterId ? "Linked to: " + chapterTitle(b, n.chapterId) + " · " : "") + U.relativeTime(n.updatedAt) }),
        U.el("div", { class: "actions", style: "margin-top:8px" }, [
          btn("Edit", function () { noteDialog(n, subset); }),
          n.attachment ? btn("Attachment", function () { downloadAttachment(n); }) : null,
          btn("Delete", function () { deleteNote(n); }, "danger")
        ])
      ]));
    });
    wrap.appendChild(grid);
    return wrap;
  }

  function notes() { return notesView("Notes", "Research notes, character profiles, quotations and reminders.", null); }
  function research() {
    return notesView(
      "Research library",
      "Research notes, quotations and questions with optional file attachments.",
      ["Research note", "Quotation", "Research question", "Topic note"]
    );
  }

  function chapterTitle(b, id) {
    var ch = b.chapters.filter(function (c) { return c.id === id; })[0];
    return ch ? ch.title : "(deleted chapter)";
  }

  function noteDialog(note, subset) {
    var b = book();
    A().formDialog({
      title: note ? "Edit note" : "New note",
      wide: true,
      fields: [
        { name: "title", label: "Title", required: true, value: note ? note.title : "" },
        { name: "type", label: "Type", type: "select", value: note ? note.type : (subset ? subset[0] : "Research note"), options: NOTE_TYPES().map(function (t) { return { value: t, label: t }; }) },
        { name: "body", label: "Note", type: "textarea", rows: 7, value: note ? note.body : "" },
        { name: "tags", label: "Tags (comma separated)", value: note ? (note.tags || []).join(", ") : "" },
        {
          name: "chapterId", label: "Link to chapter", type: "select", value: note ? (note.chapterId || "") : "",
          options: [{ value: "", label: "Not linked" }].concat(b.chapters.map(function (c) { return { value: c.id, label: c.title }; }))
        },
        { name: "attach", label: "Attach a file (max ~2 MB)", type: "file" }
      ],
      submitLabel: note ? "Save note" : "Create note",
      onSubmit: async function (v) {
        var target = note || { id: U.uid("nt"), createdAt: Date.now() };
        target.title = v.title;
        target.type = v.type;
        target.body = v.body;
        target.tags = String(v.tags || "").split(",").map(function (s) { return s.trim(); }).filter(Boolean);
        target.chapterId = v.chapterId || null;
        target.updatedAt = Date.now();
        var file = v.attach && v.attach.files && v.attach.files[0];
        if (file) {
          if (file.size > 2 * 1024 * 1024) { app.toast("Attachment is larger than 2 MB.", "error"); return false; }
          var url = await U.fileToDataUrl(file);
          target.attachment = { name: file.name, mime: file.type, size: file.size, dataUrl: url };
        }
        if (!note) b.notes.push(target);
        A().markDirty();
        A().render();
      }
    });
  }

  function downloadAttachment(note) {
    var a = note.attachment;
    if (!a) return;
    if (a.dataUrl && a.dataUrl.indexOf("data:") === 0) {
      var parsed = U.dataUrlToBytes(a.dataUrl);
      U.download(new Blob([parsed.bytes], { type: a.mime }), a.name);
    } else {
      app.toast("The attachment data is not available.", "error");
    }
  }

  function deleteNote(note) {
    var b = book();
    A().confirmDialog({ title: "Delete note", message: 'Delete "' + note.title + '"?', danger: true, confirmLabel: "Delete" }).then(function (ok) {
      if (!ok) return;
      b.notes = b.notes.filter(function (n) { return n.id !== note.id; });
      A().markDirty();
      A().render();
    });
  }

  /* ============================================================== references */
  function references() {
    A();
    var b = book();
    if (!b) return needBook();
    var wrap = U.el("div");
    wrap.appendChild(viewHead("References", "Real source metadata only — BookForge never invents authors, DOIs or page numbers.", [
      btn("Add source", function () { sourceDialog(null); }, "primary"),
      btn("Export bibliography (.txt)", function () { exportBibliography(); }),
      btn("Open manuscript", function () { A().setView("manuscript"); })
    ]));

    var styleRow = U.el("div", { class: "toolbar" }, [
      (function () {
        var label = U.el("label", { class: "small", text: "Citation style", for: "citStyle" });
        return label;
      })(),
      (function () {
        var sel = U.el("select", { id: "citStyle" });
        BF.model.CITATION_STYLES.forEach(function (s) {
          var o = U.el("option", { value: s.id, text: s.name });
          if ((b.settings.citationStyle || "apa") === s.id) o.selected = true;
          sel.appendChild(o);
        });
        sel.addEventListener("change", function () {
          b.settings.citationStyle = sel.value;
          A().markDirty();
          A().render();
        });
        return sel;
      })()
    ]);
    wrap.appendChild(styleRow);

    if (!b.sources.length) {
      wrap.appendChild(U.el("div", { class: "empty" }, [
        U.el("h3", { text: "No sources yet" }),
        U.el("p", { text: "Add books, articles or web pages with their real details. Citations inserted into the manuscript link back to these records." })
      ]));
      return wrap;
    }

    var table = U.el("table", { class: "table" });
    table.appendChild(U.el("thead", {}, [U.el("tr", {}, [
      U.el("th", { text: "#" }), U.el("th", { text: "Source" }), U.el("th", { text: "Type" }),
      U.el("th", { text: "Identifier" }), U.el("th", { text: "Actions" })
    ])]));
    var tbody = U.el("tbody");
    b.sources.forEach(function (s, i) {
      tbody.appendChild(U.el("tr", {}, [
        U.el("td", { text: String(i + 1) }),
        U.el("td", {}, [
          U.el("b", { text: s.title || "(untitled)" }),
          U.el("div", { class: "small muted", text: (s.authors || "No author given") + (s.year ? " · " + s.year : "") + (s.publisher ? " · " + s.publisher : "") })
        ]),
        U.el("td", { text: s.type || "Other" }),
        U.el("td", { class: "small", text: s.doi ? "doi:" + s.doi : (s.isbn ? "ISBN " + s.isbn : (s.url || "—")) }),
        U.el("td", {}, [U.el("div", { class: "actions" }, [
          btn("Insert citation", function () { insertSourceCitation(s); }, "primary"),
          btn("Edit", function () { sourceDialog(s); }),
          btn("Delete", function () { deleteSource(s); }, "danger")
        ])])
      ]));
    });
    table.appendChild(tbody);
    wrap.appendChild(U.el("div", { class: "panel-block" }, [table]));

    var bib = U.el("div", { class: "panel-block" }, [
      U.el("h2", { class: "panel-title", text: "Formatted bibliography (" + (b.settings.citationStyle || "apa").toUpperCase() + ")" })
    ]);
    BF.model.bibliography(b, b.settings.citationStyle || "apa").forEach(function (item, i) {
      bib.appendChild(U.el("p", { class: "citation-preview", style: "margin-bottom:6px", text: (b.settings.citationStyle === "ieee" ? "[" + (i + 1) + "] " : "") + item.text }));
    });
    wrap.appendChild(bib);
    return wrap;
  }

  function sourceDialog(source) {
    var b = book();
    A().formDialog({
      title: source ? "Edit source" : "Add source",
      wide: true,
      fields: [
        { name: "title", label: "Title", required: true, value: source ? source.title : "" },
        { name: "authors", label: "Author(s)", value: source ? source.authors : "", help: "As printed on the source, e.g. “Sharma, R. and Iyer, M.”" },
        { name: "year", label: "Publication year", value: source ? source.year : "" },
        { name: "publisher", label: "Publisher / journal", value: source ? source.publisher : "" },
        { name: "type", label: "Source type", type: "select", value: source ? source.type : "Book", options: BF.model.SOURCE_TYPES.map(function (t) { return { value: t, label: t }; }) },
        { name: "doi", label: "DOI", value: source ? source.doi : "", help: "Enter only a DOI you have verified." },
        { name: "url", label: "URL", value: source ? source.url : "" },
        { name: "isbn", label: "ISBN", value: source ? source.isbn : "" },
        { name: "pages", label: "Pages (for chapters/articles)", value: source ? source.pages : "" },
        { name: "accessed", label: "Access date (web sources)", value: source ? source.accessed : "" },
        { name: "notes", label: "Notes", type: "textarea", rows: 3, value: source ? source.notes : "" }
      ],
      submitLabel: source ? "Save source" : "Add source",
      onSubmit: function (v) {
        var target = source || { id: U.uid("src"), createdAt: Date.now() };
        Object.assign(target, v);
        target.updatedAt = Date.now();
        if (!source) b.sources.push(target);
        A().markDirty();
        A().render();
      }
    });
  }

  function deleteSource(s) {
    var b = book();
    A().confirmDialog({
      title: "Delete source",
      message: 'Delete "' + (s.title || "this source") + '"? Citations already inserted in the manuscript will remain as plain text.',
      danger: true, confirmLabel: "Delete"
    }).then(function (ok) {
      if (!ok) return;
      b.sources = b.sources.filter(function (x) { return x.id !== s.id; });
      A().markDirty();
      A().render();
    });
  }

  function insertSourceCitation(s) {
    var b = book();
    if (S.view !== "manuscript") {
      A().openChapter(S.chapterId || (b.chapters[0] && b.chapters[0].id));
      app.toast("Opened the manuscript — place the cursor and insert the citation again.");
      return;
    }
    var idx = b.sources.indexOf(s) + 1;
    var style = b.settings.citationStyle || "apa";
    S.editor.insertCitation(BF.model.formatInText(s, style, idx), s.id, s.title);
    A().markDirty();
    app.toast("Citation inserted");
  }

  function exportBibliography() {
    var b = book();
    var lines = BF.model.bibliography(b, b.settings.citationStyle || "apa").map(function (i, n) {
      return (b.settings.citationStyle === "ieee" ? "[" + (n + 1) + "] " : "") + i.text;
    });
    if (!lines.length) { app.toast("No sources to export.", "error"); return; }
    U.download(new Blob([lines.join("\n\n")], { type: "text/plain;charset=utf-8" }), U.safeFilename(b.title, "book") + "-bibliography.txt");
  }

  /* =================================================================== assets */
  function assets() {
    A();
    var b = book();
    if (!b) return needBook();
    var wrap = U.el("div");
    wrap.appendChild(viewHead("Assets & images", "Images and files stored inside this project (local only). Resize and compress here, or double-click an image in the manuscript.", [
      (function () {
        var input = U.el("input", { type: "file", accept: "image/*", multiple: true, style: "display:none" });
        input.addEventListener("change", function () {
          Array.prototype.forEach.call(input.files, function (file) {
            U.fileToDataUrl(file).then(function (url) {
              app.addAsset(file.name, url, file.type, file.size, file.name, false);
              A().markDirty();
              A().render();
            });
          });
        });
        var wrapBtn = U.el("span", {});
        wrapBtn.appendChild(btn("Upload image", function () { input.click(); }, "primary"));
        wrapBtn.appendChild(input);
        return wrapBtn;
      })()
    ]));
    if (!b.assets.length) {
      wrap.appendChild(U.el("div", { class: "empty" }, [
        U.el("h3", { text: "No assets yet" }),
        U.el("p", { text: "Upload images to reference them in the manuscript. Assets are embedded in DOCX and EPUB exports." })
      ]));
      return wrap;
    }
    var total = b.assets.reduce(function (s, a) { return s + (a.size || 0); }, 0);
    wrap.appendChild(U.el("p", { class: "small muted", text: b.assets.length + " assets · " + U.formatBytes(total) + " total" }));
    var grid = U.el("div", { class: "grid cols-4" });
    b.assets.forEach(function (a) {
      var isImage = /^image\//.test(a.mime);
      var altInput = U.el("input", { type: "text", value: a.alt || "", "aria-label": "Alternative text for " + a.name, placeholder: "Alt text (accessibility)" });
      altInput.addEventListener("change", function () { a.alt = altInput.value; A().markDirty(); });
      grid.appendChild(U.el("div", { class: "panel-block" }, [
        isImage ? U.el("img", { class: "asset-thumb", src: a.dataUrl, alt: a.alt || a.name })
          : U.el("div", { class: "asset-thumb", style: "display:grid;place-items:center", text: "FILE" }),
        U.el("p", { class: "small", style: "margin:8px 0 4px", text: a.name }),
        U.el("p", { class: "small muted", text: U.formatBytes(a.size) + (a.width ? " · " + a.width + " × " + a.height + " px" : "") + " · " + U.relativeTime(a.createdAt) }),
        altInput,
        U.el("div", { class: "actions", style: "margin-top:8px" }, [
          isImage ? btn("Edit image", function () { app.editAsset(a); }) : null,
          btn("Insert", function () {
            if (S.view !== "manuscript") { app.toast("Open the manuscript first, then insert."); return; }
            S.editor.insertImage(a.dataUrl, a.alt || a.name);
            A().markDirty();
          }),
          btn("Download", function () {
            var parsed = U.dataUrlToBytes(a.dataUrl);
            U.download(new Blob([parsed.bytes], { type: a.mime }), a.name);
          }),
          btn("Delete", function () {
            A().confirmDialog({ title: "Delete asset", message: "Delete " + a.name + "? Images already inserted in the manuscript keep their own copy.", danger: true, confirmLabel: "Delete" })
              .then(function (ok) {
                if (!ok) return;
                b.assets = b.assets.filter(function (x) { return x.id !== a.id; });
                A().markDirty();
                A().render();
              });
          }, "danger")
        ])
      ]));
    });
    wrap.appendChild(grid);
    return wrap;
  }

  /* ================================================================= comments */
  function comments() {
    A();
    var b = book();
    if (!b) return needBook();
    var wrap = U.el("div");
    var open = b.comments.filter(function (c) { return c.status !== "resolved"; });
    var done = b.comments.filter(function (c) { return c.status === "resolved"; });
    wrap.appendChild(viewHead("Comments", open.length + " open · " + done.length + " resolved. Comments stay in this browser.", [
      btn("Add comment", function () { A().setView("manuscript"); app.addComment(); }, "primary")
    ]));
    if (!b.comments.length) {
      wrap.appendChild(U.el("div", { class: "empty" }, [
        U.el("h3", { text: "No comments yet" }),
        U.el("p", { text: "Select text in the manuscript and use Insert ▸ Editorial comment to leave notes for yourself or reviewers." })
      ]));
      return wrap;
    }
    open.concat(done).forEach(function (c) {
      wrap.appendChild(U.el("div", { class: "issue" }, [
        U.el("div", { class: "issue-head" }, [
          badge(c.status === "resolved" ? "Resolved" : "Open", c.status === "resolved" ? "ok" : "warn"),
          U.el("span", { class: "issue-where", text: chapterTitle(b, c.chapterId) + " · " + U.relativeTime(c.createdAt) })
        ]),
        c.quote ? U.el("p", { class: "small muted", text: "“" + c.quote + "”" }) : null,
        U.el("p", { text: c.body }),
        U.el("div", { class: "issue-actions" }, [
          btn("Go to chapter", function () { A().openChapter(c.chapterId); }),
          btn(c.status === "resolved" ? "Reopen" : "Mark resolved", function () {
            c.status = c.status === "resolved" ? "open" : "resolved";
            A().markDirty();
            A().render();
          }),
          btn("Delete", function () {
            A().confirmDialog({ title: "Delete comment", message: "Delete this comment?", danger: true, confirmLabel: "Delete" }).then(function (ok) {
              if (!ok) return;
              b.comments = b.comments.filter(function (x) { return x.id !== c.id; });
              A().markDirty();
              A().render();
            });
          }, "danger")
        ])
      ]));
    });
    return wrap;
  }

  /* ================================================================= versions */
  function versions() {
    A();
    var b = book();
    if (!b) return needBook();
    var wrap = U.el("div");
    wrap.appendChild(viewHead("Version history", "Automatic recovery snapshots every five minutes while editing, plus named versions you save yourself.", [
      btn("Save named version", function () {
        A().promptDialog({ title: "Save version", label: "Version name", value: "Draft " + new Date().toLocaleDateString() }).then(function (name) {
          if (!name) return;
          BF.storage.addVersion(b, { name: name, auto: false }).then(function () {
            app.toast("Version saved");
            A().render();
          });
        });
      }, "primary")
    ]));
    var listBox = U.el("div", { class: "panel-block" }, [U.el("p", { class: "muted small", text: "Loading versions…" })]);
    wrap.appendChild(listBox);
    BF.storage.listVersions(b.id).then(function (list) {
      listBox.innerHTML = "";
      if (!list.length) {
        listBox.appendChild(U.el("p", { class: "muted", text: "No versions yet. Snapshots are created automatically while you write." }));
        return;
      }
      list.forEach(function (v) {
        var row = U.el("div", { class: "version-row" });
        row.appendChild(U.el("div", { class: "meta" }, [
          U.el("b", { text: v.name }),
          U.el("span", { text: U.formatDateTime(v.createdAt) + " · " + (v.words || 0).toLocaleString() + " words" + (v.auto ? " · automatic" : "") })
        ]));
        row.appendChild(U.el("div", { class: "actions" }, [
          btn("Compare with current", function () { compareVersion(v); }),
          btn("Restore", function () { restoreVersion(v); }, "primary"),
          btn("Delete", function () {
            A().confirmDialog({ title: "Delete version", message: "Delete \"" + v.name + "\"?", danger: true, confirmLabel: "Delete" }).then(function (ok) {
              if (!ok) return;
              BF.storage.deleteVersion(v.id).then(function () { A().render(); });
            });
          }, "danger")
        ]));
        listBox.appendChild(row);
      });
    });
    return wrap;
  }

  function restoreVersion(v) {
    var b = book();
    A().confirmDialog({
      title: "Restore version",
      message: 'Restore "' + v.name + '" (' + U.formatDateTime(v.createdAt) + ')? Your current manuscript will be snapshotted first so nothing is lost.',
      confirmLabel: "Restore version", danger: true
    }).then(async function (ok) {
      if (!ok) return;
      await BF.storage.addVersion(b, { name: "Before restoring " + v.name, auto: true });
      var restored = v.data;
      restored.id = b.id;
      restored.updatedAt = Date.now();
      var idx = S.books.findIndex(function (x) { return x.id === b.id; });
      S.books[idx] = restored;
      S.book = restored;
      S.chapterId = restored.chapters.length ? restored.chapters[0].id : null;
      await BF.storage.saveBook(restored);
      A().setSaveState("saved");
      A().render();
      app.toast("Version restored");
    });
  }

  function compareVersion(v) {
    var b = book();
    var body = U.el("div");
    var changed = 0;
    b.chapters.forEach(function (ch) {
      var oldCh = (v.data.chapters || []).filter(function (c) { return c.id === ch.id; })[0];
      var oldText = oldCh ? U.stripHtml(oldCh.content || "") : "";
      var newText = U.stripHtml(ch.content || "");
      if (oldText !== newText) {
        changed++;
        body.appendChild(U.el("h3", { text: ch.title }));
        body.appendChild(U.el("div", { class: "diff", html: U.diffHtml(oldText, newText) }));
      }
    });
    if (!changed) body.appendChild(U.el("p", { text: "No textual differences found between this version and the current manuscript." }));
    A().openDialog({
      title: 'Compare: "' + v.name + '" vs current',
      wide: true,
      body: U.el("div", {}, [
        U.el("p", { class: "small muted", text: "Deletions are shown in red, additions in green. Word-level comparison of chapters present in both versions." }),
        body
      ]),
      actions: [
        { label: "Restore this version", primary: true, onClick: function (close) { close(); restoreVersion(v); } },
        { label: "Close", onClick: function (close) { close(); } }
      ]
    });
  }

  /* =================================================================== export */
  function exportView() {
    A();
    var b = book();
    if (!b) return needBook();
    var wrap = U.el("div");
    wrap.appendChild(viewHead("Export center", "Every format below is generated locally from the structured manuscript.", [
      btn("Preflight report", function () { A().showPreflight(b); }),
      btn("Print / PDF preview", function () { A().saveNow("export").then(function () { BF.layout.print(b); }); }, "primary")
    ]));
    var formats = [
      ["docx", "Word document (.docx)", "Real OOXML package with semantic heading styles, tables, lists and embedded images. Word rebuilds the table of contents field on open."],
      ["epub", "EPUB 3 (.epub)", "Valid container with navigation document, semantic chapters, embedded images and generated publisher identifier (never an ISBN)."],
      ["pdf", "PDF via print dialog", "Renders genuine paginated pages with your trim size, margins, running heads and page numbers, then uses your browser's Save as PDF."],
      ["html", "Web book (.html)", "Self-contained semantic HTML with a responsive reading layout and a print stylesheet."],
      ["md", "Markdown (.md)", "Clean headings, lists, links, tables and images (images use data URIs)."],
      ["txt", "Plain text (.txt)", "Manuscript text with chapter separators."],
      ["json", "Project backup (.json)", "Complete project: manuscript, metadata, outline, notes, sources, assets, comments and design settings."]
    ];
    var grid = U.el("div", { class: "grid cols-2" });
    formats.forEach(function (f) {
      grid.appendChild(U.el("div", { class: "panel-block" }, [
        U.el("b", { text: f[1] }),
        U.el("p", { class: "small muted", style: "margin:8px 0", text: f[2] }),
        btn("Export", function () { A().runExport(f[0]); }, "primary")
      ]));
    });
    wrap.appendChild(grid);
    wrap.appendChild(U.el("div", { class: "panel-block" }, [
      U.el("h2", { class: "panel-title", text: "Honest limitations" }),
      U.el("ul", { class: "small muted" }, [
        U.el("li", { text: "PDF is produced through your browser's print engine, so exact pagination can differ slightly from the on-screen preview in other viewers." }),
        U.el("li", { text: "DOCX does not include footnotes as Word footnote objects; chapter notes are exported in an endnote section." }),
        U.el("li", { text: "EPUB uses a generated UUID identifier. ISBNs are never invented or registered." }),
        U.el("li", { text: "Everything is stored in this browser only. Export a project backup regularly." })
      ])
    ]));
    wrap.appendChild(U.el("div", { class: "panel-block" }, [
      U.el("h2", { class: "panel-title", text: "Import" }),
      U.el("p", { class: "small muted", text: "Restore a project from a .bookforge.json backup. The imported book receives a new local id so it never overwrites your current projects." }),
      btn("Import project backup", function () { A().importProject(); })
    ]));
    return wrap;
  }

  /* ==================================================================== trash */
  function trash() {
    A();
    var wrap = U.el("div");
    var trashed = S.books.filter(function (b) { return b.trashed; });
    wrap.appendChild(viewHead("Trash", "Deleted books and chapters stay here until you remove them permanently.", []));
    if (!trashed.length) wrap.appendChild(U.el("p", { class: "small muted", text: "No trashed books." }));
    trashed.forEach(function (b) {
      wrap.appendChild(U.el("div", { class: "issue" }, [
        U.el("div", { class: "issue-head" }, [U.el("b", { text: b.title }), U.el("span", { class: "issue-where", text: U.relativeTime(b.updatedAt) })]),
        U.el("div", { class: "issue-actions" }, [
          btn("Restore", function () { b.trashed = false; A().saveBook(b); A().render(); app.toast("Book restored"); }, "primary"),
          btn("Delete permanently", function () { A().deleteBook(b, true); }, "danger")
        ])
      ]));
    });

    var b = S.book;
    if (b && (b.trashChapters || []).length) {
      wrap.appendChild(U.el("h2", { class: "panel-title", style: "margin-top:22px", text: "Deleted chapters in the open book" }));
      b.trashChapters.forEach(function (entry, i) {
        wrap.appendChild(U.el("div", { class: "issue" }, [
          U.el("div", { class: "issue-head" }, [U.el("b", { text: entry.chapter.title }), U.el("span", { class: "issue-where", text: "Deleted " + U.relativeTime(entry.deletedAt) })]),
          U.el("div", { class: "issue-actions" }, [
            btn("Restore chapter", function () {
              var ch = entry.chapter;
              ch.order = b.chapters.length + 1;
              b.chapters.push(ch);
              b.trashChapters.splice(i, 1);
              A().markDirty();
              A().render();
              app.toast("Chapter restored");
            }, "primary"),
            btn("Delete permanently", function () {
              A().confirmDialog({ title: "Delete chapter permanently", message: 'Permanently delete "' + entry.chapter.title + '"?', danger: true, confirmLabel: "Delete" }).then(function (ok) {
                if (!ok) return;
                b.trashChapters.splice(i, 1);
                A().markDirty();
                A().render();
              });
            }, "danger")
          ])
        ]));
      });
    }
    return wrap;
  }

  /* =================================================================== design */
  function design() {
    A();
    var b = book();
    if (!b) return needBook();
    var d = b.design;
    var wrap = U.el("div");
    wrap.appendChild(viewHead("Design studio", "Print layout for " + U.escapeHtml(b.title) + ". Pagination is measured block by block, not guessed from word count.", [
      btn("Reset to template", function () {
        var t = b.design.template;
        b.design = BF.model.defaultDesign(t);
        A().markDirty();
        A().render();
        app.toast("Design reset to template defaults");
      }),
      btn("Print / PDF", function () { A().saveNow("export").then(function () { BF.layout.print(b); }); }, "primary")
    ]));

    var studio = U.el("div", { class: "studio-grid" });
    var controls = U.el("div", { class: "panel-block" });
    var previewBox = U.el("div", { class: "page-preview", id: "designPreview" });
    var warnBox = U.el("div", { id: "designWarnings", class: "small muted", style: "margin-top:10px" });

    function row(label, control, help) {
      var f = U.el("div", { class: "field" }, [U.el("label", { text: label }), control]);
      if (help) f.appendChild(U.el("div", { class: "help", text: help }));
      return f;
    }
    function num(name, value, min, max, step) {
      var i = U.el("input", { type: "number", value: value, min: min == null ? 0 : min, max: max, step: step || 1, "data-design": name });
      i.addEventListener("change", function () { updateDesign(name, Number(i.value)); });
      return i;
    }
    function text(name, value) {
      var i = U.el("input", { type: "text", value: value || "", "data-design": name });
      i.addEventListener("change", function () { updateDesign(name, i.value); });
      return i;
    }
    function check(name, value, label) {
      var i = U.el("input", { type: "checkbox" });
      i.checked = !!value;
      i.addEventListener("change", function () { updateDesign(name, i.checked); });
      return U.el("label", { class: "check" }, [i, U.el("span", { text: label })]);
    }
    function selectField(name, value, options) {
      var s = U.el("select", { "data-design": name });
      options.forEach(function (o) {
        var opt = U.el("option", { value: o.value, text: o.label });
        if (String(o.value) === String(value)) opt.selected = true;
        s.appendChild(opt);
      });
      s.addEventListener("change", function () { updateDesign(name, s.value); });
      return s;
    }

    controls.appendChild(row("Layout template", selectField("template", d.template, BF.model.DESIGN_TEMPLATES.map(function (t) { return { value: t.id, label: t.name }; }))));
    controls.appendChild(row("Trim size", selectField("trim", d.trim, BF.model.TRIM_SIZES.map(function (t) { return { value: t.id, label: t.name }; })), "A4, A5, US Letter, 6 × 9 and custom sizes are supported."));
    if (d.trim === "custom") {
      controls.appendChild(row("Custom size (mm)", U.el("div", { class: "field-row" }, [num("customWidth", d.customWidth), num("customHeight", d.customHeight)])));
    }
    controls.appendChild(row("Margins (mm)", U.el("div", { class: "field-row" }, [
      num("margins.top", d.margins.top), num("margins.bottom", d.margins.bottom)
    ])));
    controls.appendChild(row("Inside / outside margins (mm)", U.el("div", { class: "field-row" }, [
      num("margins.inside", d.margins.inside), num("margins.outside", d.margins.outside)
    ])));
    controls.appendChild(row("Gutter (mm)", num("gutter", d.gutter)));
    controls.appendChild(row("Running head", U.el("div", {}, [
      check("header.enabled", d.header.enabled, "Show header"),
      U.el("div", { class: "field-row" }, [text("header.left", d.header.left), text("header.right", d.header.right)])
    ]), "Placeholders: {title}, {chapter}, {page}"));
    controls.appendChild(row("Footer", U.el("div", {}, [
      check("footer.enabled", d.footer.enabled, "Show footer"),
      U.el("div", { class: "field-row-3" }, [text("footer.left", d.footer.left), text("footer.center", d.footer.center), text("footer.right", d.footer.right)])
    ]), "Use {page} for page numbers. Front matter is numbered in lower-case roman."));
    controls.appendChild(row("Chapter openers", check("chapterOpeners", d.chapterOpeners, "Start chapters on a new page")));
    controls.appendChild(row("Body font", selectField("bodyFont", d.bodyFont, ["Georgia", "Cambria", "Palatino Linotype", "Times New Roman", "Segoe UI", "Arial"].map(function (f) { return { value: f, label: f }; }))));
    controls.appendChild(row("Heading font", selectField("headingFont", d.headingFont, ["Georgia", "Cambria", "Palatino Linotype", "Times New Roman", "Segoe UI", "Arial"].map(function (f) { return { value: f, label: f }; }))));
    controls.appendChild(row("Body size (pt) / line spacing", U.el("div", { class: "field-row" }, [num("bodySize", d.bodySize, 7, 18, 0.5), num("lineHeight", d.lineHeight, 1, 2.5, 0.05)])));
    controls.appendChild(row("Paragraph spacing (em)", num("paragraphSpacing", d.paragraphSpacing, 0, 3, 0.05)));
    controls.appendChild(row("Text", U.el("div", {}, [
      check("firstLineIndent", d.firstLineIndent, "First-line indent"),
      check("justify", d.justify, "Justified text"),
      check("hyphens", d.hyphens, "Hyphenation"),
      check("widowOrphans", d.widowOrphans, "Prevent widows and orphans")
    ])));
    controls.appendChild(row("Table styling", selectField("tableStyle", d.tableStyle, [{ value: "rules", label: "Rules" }, { value: "zebra", label: "Zebra" }, { value: "boxed", label: "Boxed" }])));

    studio.appendChild(controls);
    var right = U.el("div");
    right.appendChild(previewBox);
    right.appendChild(warnBox);
    studio.appendChild(right);
    wrap.appendChild(studio);

    setTimeout(refreshPreview, 40);

    function updateDesign(path, value) {
      var parts = path.split(".");
      if (parts.length === 1) b.design[path] = value;
      else b.design[parts[0]][parts[1]] = value;
      if (path === "template") {
        var preset = BF.model.designTemplate(value);
        b.design.bodyFont = preset.bodyFont;
        b.design.headingFont = preset.headingFont;
        b.design.firstLineIndent = preset.indent;
        b.design.lineHeight = preset.lineHeight;
        b.design.chapterOpeners = preset.chapterOpeners;
        b.design.runningHead = preset.runningHead;
        b.design.tableStyle = preset.tableStyle;
      }
      A().markDirty();
      A().render();
    }

    function refreshPreview() {
      var box = document.getElementById("designPreview");
      var warn = document.getElementById("designWarnings");
      if (!box) return;
      // clientWidth still counts padding/border, and a vertical scrollbar can
      // appear after this measurement, so leave room for both.
      var scale = Math.min(1, (box.clientWidth - 52) / (BF.model.trimOf(b.design).w * (96 / 25.4)));
      var res = BF.layout.renderPreview(box, b, scale);
      if (warn) warn.textContent = res.pages.length + " pages at " + BF.model.trimOf(b.design).w + " × " + BF.model.trimOf(b.design).h + " mm" + (res.warnings.length ? " · " + res.warnings.length + " layout warning(s): " + res.warnings.slice(0, 2).join(" ") : "");
    }
    return wrap;
  }

  /* =================================================================== review */
  var CHECK_CATEGORIES = ["Grammar & spelling", "Sentence clarity", "Repetition", "Terminology", "Heading consistency", "Chapter balance", "Missing transitions", "Unfinished sections", "Unsupported factual claims", "Missing citations", "Reference consistency", "Accessibility", "Formatting"];

  function runChecks(b) {
    var issues = [];
    var dismissed = (b.review && b.review.dismissed) || {};
    function add(o) {
      o.id = o.id || U.uid("iss");
      if (dismissed[o.id]) return;
      issues.push(o);
    }
    b.chapters.forEach(function (ch) {
      var text = U.stripHtml(ch.content || "");
      var where = ch.title;
      if (!text.trim()) add({ category: "Unfinished sections", severity: "high", chapterId: ch.id, where: where, explanation: "This chapter is empty.", suggestion: "Write the chapter or remove it from the outline." });
      var doubleSpace = (ch.content || "").match(/[^>]\s{2,}[^<]/g);
      if (doubleSpace && doubleSpace.length) {
        add({
          category: "Formatting", severity: "low", chapterId: ch.id, where: where,
          explanation: doubleSpace.length + " place(s) contain repeated spaces.",
          suggestion: "Collapse repeated spaces to a single space.", fix: "spaces"
        });
      }
      var repeated = text.match(/\b(\w+)\s+\1\b/gi);
      if (repeated) {
        add({ category: "Repetition", severity: "medium", chapterId: ch.id, where: where, explanation: "Repeated word detected: " + repeated.slice(0, 3).join(", "), suggestion: "Remove the accidental repetition." });
      }
      var sentences = text.split(/(?<=[.!?])\s+/).filter(function (s) { return s.trim(); });
      var longSentences = sentences.filter(function (s) { return U.countWords(s) > 40; });
      if (longSentences.length) {
        add({ category: "Sentence clarity", severity: "low", chapterId: ch.id, where: where, explanation: longSentences.length + " sentence(s) exceed 40 words.", suggestion: "Consider splitting the longest sentences: “" + longSentences[0].slice(0, 90) + "…”" });
      }
      var headings = BF.model.headingsFromHtml(ch.content);
      if (headings.some(function (h) { return h.level === 1; })) {
        add({ category: "Heading consistency", severity: "medium", chapterId: ch.id, where: where, explanation: "A level-1 heading appears inside a chapter; chapter titles are already level 1.", suggestion: "Use level 2 and 3 headings inside chapters." });
      }
      var straightQuotes = text.match(/"/g);
      if (straightQuotes && straightQuotes.length > 4) {
        add({ category: "Formatting", severity: "low", chapterId: ch.id, where: where, explanation: straightQuotes.length + " straight quotation marks found.", suggestion: "Use typographic quotation marks for print." });
      }
      var noAlt = 0;
      var tpl = document.createElement("template");
      tpl.innerHTML = ch.content || "";
      Array.prototype.forEach.call(tpl.content.querySelectorAll("img"), function (img) { if (!img.getAttribute("alt")) noAlt++; });
      if (noAlt) add({ category: "Accessibility", severity: "medium", chapterId: ch.id, where: where, explanation: noAlt + " image(s) without alternative text.", suggestion: "Add descriptive alt text to every image." });
      var claims = text.match(/\b(studies show|research proves|scientists say|it is proven|statistics show)\b/gi);
      if (claims) {
        add({ category: "Unsupported factual claims", severity: "high", chapterId: ch.id, where: where, explanation: "Potentially unsupported claim language: “" + claims[0] + "”.", suggestion: "Add a citation to a verified source or rephrase the claim." });
      }
    });
    var unresolved = (b.comments || []).filter(function (c) { return c.status !== "resolved"; });
    if (unresolved.length) add({ category: "Formatting", severity: "low", where: "Whole manuscript", explanation: unresolved.length + " unresolved editorial comments.", suggestion: "Resolve or delete comments before export." });
    (b.sources || []).forEach(function (s) {
      var miss = [];
      if (!s.title) miss.push("title");
      if (!s.authors) miss.push("author");
      if (!s.year) miss.push("year");
      if (miss.length) add({ category: "Reference consistency", severity: "medium", where: "References: " + (s.title || "(untitled)"), explanation: "Missing " + miss.join(", ") + ".", suggestion: "Complete the source metadata; BookForge will not invent missing fields." });
    });
    var cited = BF.model.citedIds(b);
    cited.forEach(function (id) {
      if (!(b.sources || []).some(function (s) { return s.id === id; })) {
        add({ category: "Missing citations", severity: "high", where: "Manuscript", explanation: "A citation references a source that no longer exists in the library.", suggestion: "Re-insert the citation from the References view." });
      }
    });
    var words = b.chapters.map(function (c) { return BF.model.chapterWords(c); });
    var avg = words.reduce(function (a, x) { return a + x; }, 0) / Math.max(1, words.length);
    words.forEach(function (w, i) {
      if (avg > 400 && w < avg * 0.25) {
        add({ category: "Chapter balance", severity: "low", chapterId: b.chapters[i].id, where: b.chapters[i].title, explanation: "This chapter is far shorter than the manuscript average (" + w + " vs " + Math.round(avg) + " words).", suggestion: "Consider developing or merging this chapter." });
      }
    });
    return issues;
  }

  function review() {
    A();
    var b = book();
    if (!b) return needBook();
    var wrap = U.el("div");
    b.review = b.review || { dismissed: [], accepted: [] };
    var issues = runChecks(b);
    b.review.open = issues;

    wrap.appendChild(viewHead("Editorial review", "Automated checks across 13 categories. These are heuristics — they do not replace human editing or verify facts.", [
      btn("Re-run checks", function () { A().render(); }, "primary"),
      btn("Reset dismissed", function () {
        b.review.dismissed = [];
        A().markDirty();
        A().render();
      })
    ]));
    wrap.appendChild(U.el("p", { class: "small muted", text: "Important: a clean report does not mean the manuscript is academically verified. Citations must come from real sources you have checked." }));

    if (!issues.length) {
      wrap.appendChild(U.el("div", { class: "empty" }, [U.el("h3", { text: "No issues detected" }), U.el("p", { text: "The automated checks found nothing to flag. Editorial and factual review remain your responsibility." })]));
      return wrap;
    }
    var byCat = U.groupBy(issues, function (i) { return i.category; });
    CHECK_CATEGORIES.forEach(function (cat) {
      var list = byCat[cat];
      if (!list) return;
      wrap.appendChild(U.el("h2", { class: "panel-title", style: "margin-top:18px", text: cat + " (" + list.length + ")" }));
      list.forEach(function (iss) {
        wrap.appendChild(U.el("div", { class: "issue" }, [
          U.el("div", { class: "issue-head" }, [
            badge(iss.severity, iss.severity === "high" ? "bad" : iss.severity === "medium" ? "warn" : ""),
            U.el("span", { class: "issue-where", text: iss.where })
          ]),
          U.el("p", { text: iss.explanation }),
          U.el("code", { class: "fix", text: "Suggested: " + iss.suggestion }),
          U.el("div", { class: "issue-actions" }, [
            iss.chapterId ? btn("Open location", function () { A().openChapter(iss.chapterId); }) : null,
            iss.fix === "spaces" ? btn("Apply fix", function () {
              var ch = b.chapters.filter(function (c) { return c.id === iss.chapterId; })[0];
              if (!ch) return;
              ch.content = String(ch.content || "").replace(/([^>])\s{2,}([^<])/g, "$1 $2");
              ch.updatedAt = Date.now();
              A().markDirty();
              A().render();
              app.toast("Repeated spaces collapsed");
            }, "primary") : null,
            btn("Dismiss", function () {
              b.review.dismissed.push(iss.id);
              A().markDirty();
              A().render();
            })
          ])
        ]));
      });
    });
    return wrap;
  }

  /* ==================================================================== matter */
  function matter() {
    A();
    var b = book();
    if (!b) return needBook();
    var wrap = U.el("div");
    wrap.appendChild(viewHead("Front & back matter", "Choose which sections are included. Generated sections (contents, bibliography, index) build themselves from your real manuscript and library.", [
      btn("Preview in design studio", function () { A().setView("design"); }),
      btn("Preflight", function () { A().showPreflight(b); })
    ]));

    wrap.appendChild(sectionList("Front matter", BF.model.FRONT_MATTER, b.matter.front, "front"));
    wrap.appendChild(sectionList("Back matter", BF.model.BACK_MATTER, b.matter.back, "back"));
    return wrap;
  }

  function sectionList(title, defs, state, side) {
    var block = U.el("div", { class: "panel-block" });
    block.appendChild(U.el("h2", { class: "panel-title", text: title }));
    defs.forEach(function (def) {
      var st = state[def.id];
      var field = U.el("div", { class: "field" });
      var box = U.el("input", { type: "checkbox" });
      box.checked = !!st.enabled;
      box.addEventListener("change", function () {
        st.enabled = box.checked;
        A().markDirty();
        A().render();
      });
      field.appendChild(U.el("label", { class: "check" }, [box, U.el("span", { text: def.name })]));
      var generated = ["toc", "listFigures", "listTables", "bibliography", "references", "index", "endnotes"].indexOf(def.id) >= 0;
      if (generated) {
        field.appendChild(U.el("div", { class: "help", text: "Generated automatically from your manuscript and reference library — no invented content." }));
      } else {
        var ta = U.el("textarea", { rows: 3, placeholder: "Write the " + def.name.toLowerCase() + " content (plain text; blank lines become paragraphs)." });
        ta.value = U.stripHtml(st.content || "");
        ta.addEventListener("change", function () {
          st.content = ta.value.split(/\n{2,}/).map(function (p) { return "<p>" + U.escapeHtml(p).replace(/\n/g, "<br>") + "</p>"; }).join("");
          A().markDirty();
        });
        field.appendChild(ta);
      }
      block.appendChild(field);
    });
    return block;
  }

  BF.views = {
    dashboard: dashboard,
    books: books,
    recent: recent,
    manuscript: manuscript,
    outline: outline,
    chapters: chapters,
    notes: notes,
    research: research,
    references: references,
    assets: assets,
    comments: comments,
    versions: versions,
    export: exportView,
    trash: trash,
    design: design,
    review: review,
    matter: matter
  };
})();
