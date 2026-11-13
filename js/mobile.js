/* BookForge Studio — phone layout helpers.
   The CSS does the visual work; this file only manages the off-canvas navigation
   drawer and the compact "more" menu that replaces the desktop top-bar controls. */
(function () {
  "use strict";
  var BF = (window.BF = window.BF || {});
  var MQ = window.matchMedia("(max-width: 900px)");
  var refs = { backdrop: null, btn: null, sidebar: null };

  function isMobile() { return MQ.matches; }

  function openNav() {
    document.body.classList.add("nav-open");
    if (refs.backdrop) refs.backdrop.hidden = false;
    var toggle = document.getElementById("btnSidebar");
    if (toggle) toggle.setAttribute("aria-expanded", "true");
    var first = refs.sidebar && refs.sidebar.querySelector("nav button");
    if (first) setTimeout(function () { first.focus({ preventScroll: true }); }, 80);
  }

  function closeNav() {
    document.body.classList.remove("nav-open");
    if (refs.backdrop) refs.backdrop.hidden = true;
    var toggle = document.getElementById("btnSidebar");
    if (toggle) toggle.setAttribute("aria-expanded", "false");
  }

  function toggleNav() {
    if (document.body.classList.contains("nav-open")) closeNav(); else openNav();
  }

  function moreMenu(btn) {
    var A = BF.app;
    if (!A) return;
    var hasBook = !!(A.S && A.S.book);
    var items = [
      { label: "New book", onClick: function () { A.newBookWizard(); } },
      { label: "Cloud sync…", onClick: function () { A.openSyncDialog(); } },
      { label: "Settings…", onClick: function () { A.openSettings(); } }
    ];
    if (hasBook) {
      items = items.concat([
        { label: "Print / save as PDF", onClick: function () { document.getElementById("btnPrint").click(); } },
        { label: "Export Word (.docx)", onClick: function () { A.runExport("docx"); } },
        { label: "Export EPUB", onClick: function () { A.runExport("epub"); } },
        { label: "Export HTML", onClick: function () { A.runExport("html"); } },
        { label: "Export Markdown", onClick: function () { A.runExport("md"); } },
        { label: "Export plain text", onClick: function () { A.runExport("txt"); } },
        { label: "Project backup (.json)", onClick: function () { A.runExport("json"); } },
        { label: "Preflight report", onClick: function () { A.runExport("preflight"); } },
        { label: "Author profile", onClick: function () { document.getElementById("btnProfile").click(); } }
      ]);
    }
    items.push({ label: "Keyboard shortcuts", onClick: function () { A.showShortcuts(); } });

    var r = btn.getBoundingClientRect();
    btn.setAttribute("aria-expanded", "true");
    A.contextMenu(items, Math.max(8, r.right - 268), r.bottom + 6);
    setTimeout(function () { btn.setAttribute("aria-expanded", "false"); }, 0);
  }

  function init() {
    refs.backdrop = document.getElementById("navBackdrop");
    refs.sidebar = document.getElementById("sidebar");
    refs.btn = document.getElementById("btnMobileMore");

    if (refs.backdrop) {
      refs.backdrop.addEventListener("click", closeNav);
      refs.backdrop.addEventListener("touchstart", function (e) { e.preventDefault(); closeNav(); }, { passive: false });
    }
    if (refs.btn) refs.btn.addEventListener("click", function () { moreMenu(refs.btn); });

    var nav = document.getElementById("nav");
    if (nav) {
      nav.addEventListener("click", function (e) {
        if (e.target.closest("button") && isMobile()) closeNav();
      });
    }

    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && document.body.classList.contains("nav-open")) closeNav();
    });

    // Leaving phone width must not leave the drawer state behind.
    var onChange = function (e) {
      closeNav();
      if (e && e.matches === false) {
        document.body.classList.remove("sidebar-collapsed");
        var ws = document.getElementById("workspace");
        if (ws) ws.classList.remove("sidebar-collapsed");
      }
    };
    if (MQ.addEventListener) MQ.addEventListener("change", onChange);
    else if (MQ.addListener) MQ.addListener(onChange);

    if (isMobile()) closeNav();
  }

  BF.mobile = {
    init: init,
    isMobile: isMobile,
    openNav: openNav,
    closeNav: closeNav,
    toggleNav: toggleNav
  };
})();
