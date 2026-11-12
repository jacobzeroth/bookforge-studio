/* BookForge Studio — print layout: measurement-based pagination.
   Blocks are measured in the real page geometry and flowed into pages. Oversized
   paragraphs are split at word level; tables and figures move whole to the next page. */
(function () {
  "use strict";
  var BF = (window.BF = window.BF || {});
  var U = BF.util;

  var MM = 96 / 25.4;        // px per mm at CSS 96 dpi
  var PT = 96 / 72;          // px per pt

  function mm(px) { return px / MM; }
  function toPx(v) { return v * MM; }

  function romanish(n) {
    var map = [[1000, "m"], [900, "cm"], [500, "d"], [400, "cd"], [100, "c"], [90, "xc"],
      [50, "l"], [40, "xl"], [10, "x"], [9, "ix"], [5, "v"], [4, "iv"], [1, "i"]];
    var out = "";
    map.forEach(function (pair) { while (n >= pair[0]) { out += pair[1]; n -= pair[0]; } });
    return out || "i";
  }

  /* --------------------------------------------------------------- helpers */
  function elementFromHtml(html) {
    var tpl = document.createElement("template");
    tpl.innerHTML = html || "";
    return Array.prototype.slice.call(tpl.content.childNodes).map(function (n) {
      if (n.nodeType === 3) {
        var p = document.createElement("p");
        p.textContent = n.nodeValue;
        return p;
      }
      return n;
    });
  }

  function wordCountOf(el) {
    return U.countWords(el.textContent || "");
  }

  /* Truncate element text to the first n words, preserving inline structure. */
  function limitWords(el, n) {
    var w = 0;
    var walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, null);
    var node, remove = [];
    while ((node = walker.nextNode())) {
      var text = node.nodeValue || "";
      var tokens = text.split(/(\s+)/);
      var out = "";
      for (var i = 0; i < tokens.length; i++) {
        if (/^\s+$/.test(tokens[i])) { out += tokens[i]; continue; }
        if (w >= n) { if (!/^\s*$/.test(out)) remove.push({ node: node, cut: out }); else remove.push({ node: node, cut: "" }); break; }
        out += tokens[i];
        w++;
      }
      if (w >= n) {
        node.nodeValue = out;
        break;
      }
    }
    return el;
  }

  /* Remove the first n words from an element, preserving structure. */
  function skipWords(el, n) {
    var w = 0;
    var walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, null);
    var node;
    while ((node = walker.nextNode())) {
      var tokens = (node.nodeValue || "").split(/(\s+)/);
      var out = "";
      var started = false;
      for (var i = 0; i < tokens.length; i++) {
        if (/^\s+$/.test(tokens[i])) { if (started) out += tokens[i]; continue; }
        if (w < n) { w++; started = true; continue; }
        out += tokens[i];
      }
      node.nodeValue = out.replace(/^\s+/, "");
      if (w >= n) break;
    }
    el.normalize();
    return el;
  }

  function isLikelySplit(el) {
    return /^(P|BLOCKQUOTE|H1|H2|H3|H4)$/i.test(el.tagName);
  }

  function isAtomic(el) {
    return /^(TABLE|FIGURE|IMG|HR|UL|OL|PRE)$/i.test(el.tagName);
  }

  /* --------------------------------------------------------------- flow */
  function matterBlocks(key, state, book) {
    var label = null;
    BF.model.FRONT_MATTER.concat(BF.model.BACK_MATTER).forEach(function (m) { if (m.id === key) label = m.name; });
    var blocks = [];
    if (key === "titlePage") {
      blocks.push(elText("h1", book.title || "Untitled book", "matter-title"));
      if (book.subtitle) blocks.push(elText("p", book.subtitle, "matter-subtitle"));
      if (book.author) blocks.push(elText("p", book.author, "matter-author"));
      blocks.push(elText("p", book.publisher || "", "matter-publisher"));
    } else if (key === "halfTitle") {
      blocks.push(elText("h1", book.title || "Untitled book", "matter-halftitle"));
    } else if (key === "copyright") {
      var lines = state.content ? elementFromHtml(state.content) : elementFromHtml(
        "<p>" + U.escapeHtml(book.title || "Untitled book") + "</p>" +
        (book.author ? "<p>Copyright © " + U.escapeHtml(book.copyrightYear || "") + " " + U.escapeHtml(book.author) + "</p>" : "") +
        (book.publisher ? "<p>Published by " + U.escapeHtml(book.publisher) + (book.edition ? " · " + U.escapeHtml(book.edition) + " edition" : "") + "</p>" : "") +
        (book.isbn ? "<p>ISBN (as supplied by the author): " + U.escapeHtml(book.isbn) + "</p>" : "") +
        "<p>All rights reserved. This copyright page is a template and does not by itself establish or guarantee legal protection.</p>"
      );
      blocks = lines;
    } else if (key === "toc") {
      blocks.push(elText("h1", "Contents", "matter-heading"));
      BF.model.buildToc(book).forEach(function (e) {
        var cls = "toc-" + e.kind + " toc-level-" + Math.min(e.level, 3);
        blocks.push(elText("p", e.label, cls));
      });
    } else if (key === "listFigures" || key === "listTables") {
      var want = key === "listFigures" ? "FIGURE" : "TABLE";
      blocks.push(elText("h1", want === "FIGURE" ? "List of figures" : "List of tables", "matter-heading"));
      var any = false;
      (book.chapters || []).forEach(function (ch) {
        var tpl = document.createElement("template");
        tpl.innerHTML = ch.content || "";
        var nodes = tpl.content.querySelectorAll(want);
        Array.prototype.forEach.call(nodes, function (n) {
          var cap = n.querySelector ? n.querySelector("figcaption") : null;
          var text = (cap && cap.textContent) || (n.textContent || "").trim() || (want === "FIGURE" ? "Figure" : "Table");
          blocks.push(elText("p", text, "toc-entry"));
          any = true;
        });
      });
      if (!any) blocks.push(elText("p", "No " + (want === "FIGURE" ? "figures" : "tables") + " have been added to the manuscript yet.", "muted-line"));
    } else if (state.content) {
      if (key !== "dedication" && key !== "epigraph") blocks.push(elText("h1", label, "matter-heading"));
      elementFromHtml(U.stripHtml(state.content) ? state.content : "").forEach(function (b) { blocks.push(b); });
      if (!state.content && label) blocks.push(elText("h1", label, "matter-heading"));
    }
    if (!blocks.length && label) blocks.push(elText("h1", label, "matter-heading"));
    return blocks;
  }

  function elText(tag, text, cls) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    n.textContent = text;
    return n;
  }

  function buildFlow(book) {
    var flow = [];
    var frontKeys = BF.model.FRONT_MATTER.map(function (m) { return m.id; });
    var backKeys = BF.model.BACK_MATTER.map(function (m) { return m.id; });

    frontKeys.forEach(function (k) {
      var st = book.matter.front[k];
      var auto = ["titlePage", "copyright", "toc"].indexOf(k) >= 0;
      if (!st || (!st.enabled && !auto)) return;
      if (!st.enabled && auto) return;
      flow.push({
        role: "front", key: k, title: labelOf(k, "front"), blocks: matterBlocks(k, st, book),
        newPage: true, chapterOpen: k === "titlePage" || k === "halfTitle"
      });
    });

    (book.parts || []).forEach(function (part) {
      var chapters = (book.chapters || []).filter(function (c) { return c.partId === part.id; });
      if (!chapters.length) return;
      flow.push({
        role: "part", key: part.id, title: part.title, newPage: true, chapterOpen: true,
        blocks: [elText("h1", part.title, "part-title")]
      });
      chapters.forEach(function (ch) { flow.push(chapterFlow(ch, book)); });
    });
    (book.chapters || []).filter(function (c) { return !c.partId; }).forEach(function (ch) {
      flow.push(chapterFlow(ch, book));
    });

    backKeys.forEach(function (k) {
      var st = book.matter.back[k];
      var auto = ["bibliography", "references"].indexOf(k) >= 0;
      if (!st || (!st.enabled && !auto)) return;
      flow.push({
        role: "back", key: k, title: labelOf(k, "back"), blocks: backBlocks(k, st, book),
        newPage: true, chapterOpen: true
      });
    });
    return flow;
  }

  function labelOf(key, side) {
    var list = side === "front" ? BF.model.FRONT_MATTER : BF.model.BACK_MATTER;
    var m = list.filter(function (x) { return x.id === key; })[0];
    return m ? m.name : key;
  }

  function chapterFlow(ch, book) {
    var blocks = [];
    if (ch.matterKey) {
      blocks.push(elText("h1", labelOf(ch.matterKey, ch.matter || "front"), "matter-heading"));
    } else {
      blocks.push(elText("h1", ch.title || "Untitled chapter", "chapter-title"));
    }
    elementFromHtml(ch.content || "").forEach(function (b) {
      if (b.nodeType !== 1) { blocks.push(elText("p", b.textContent || "")); return; }
      blocks.push(b);
    });
    return { role: "chapter", key: ch.id, title: ch.title, chapter: ch, blocks: blocks, newPage: true, chapterOpen: true };
  }

  function backBlocks(key, st, book) {
    var blocks = [elText("h1", labelOf(key, "back"), "matter-heading")];
    if ((key === "bibliography" || key === "references")) {
      var style = book.settings.citationStyle || "apa";
      var items = BF.model.bibliography(book, style);
      if (!items.length) blocks.push(elText("p", "No sources have been entered in the reference library yet.", "muted-line"));
      items.forEach(function (it) {
        var p = elText("p", (key === "references" && style === "ieee" ? "" : "") + it.text, "bibliography-entry");
        blocks.push(p);
      });
    } else if (key === "endnotes") {
      var any = false;
      (book.chapters || []).forEach(function (ch) {
        var tpl = document.createElement("template");
        tpl.innerHTML = ch.content || "";
        var notes = tpl.content.querySelectorAll(".endnote-block li, sup.fn");
        if (ch.content && ch.content.indexOf("endnote-block") >= 0) {
          var block = tpl.content.querySelector(".endnote-block");
          if (block) {
            blocks.push(elText("h2", ch.title, "endnotes-chapter"));
            blocks.push(block);
            any = true;
          }
        }
      });
      if (!any) blocks.push(elText("p", "No endnotes have been created. Add notes from the editor toolbar.", "muted-line"));
    } else if (key === "glossary") {
      if (st.content) elementFromHtml(st.content).forEach(function (b) { blocks.push(b); });
      else blocks.push(elText("p", "The glossary is empty. Add entries from the Back matter builder.", "muted-line"));
    } else if (key === "index") {
      var terms = {};
      (book.chapters || []).forEach(function (ch) {
        BF.model.headingsFromHtml(ch.content).forEach(function (h) {
          if (h.text) terms[h.text] = (terms[h.text] || 0) + 1;
        });
      });
      var keys = Object.keys(terms).sort();
      if (!keys.length) blocks.push(elText("p", "No index terms found. Headings in the manuscript become index entries.", "muted-line"));
      keys.forEach(function (k) { blocks.push(elText("p", k + " — " + terms[k], "index-entry")); });
    } else if (st.content) {
      elementFromHtml(st.content).forEach(function (b) { blocks.push(b); });
    } else {
      blocks.push(elText("p", "This section is enabled but has no content yet.", "muted-line"));
    }
    return blocks;
  }

  /* ---------------------------------------------------------- pagination */
  function geometry(book) {
    var d = book.design || BF.model.defaultDesign("minimal-academic");
    var trim = BF.model.trimOf(d);
    var inside = Number(d.margins.inside) + Number(d.gutter || 0);
    var outside = Number(d.margins.outside);
    var top = Number(d.margins.top);
    var bottom = Number(d.margins.bottom);
    var contentW = trim.w - inside - outside;
    var contentH = trim.h - top - bottom;
    return {
      trimW: trim.w, trimH: trim.h,
      inside: inside, outside: outside, top: top, bottom: bottom,
      contentW: contentW, contentH: contentH
    };
  }

  function typography(el, d) {
    var bodyFont = d.bodyFont || "Georgia";
    el.style.fontFamily = '"' + bodyFont + '", Georgia, "Times New Roman", serif';
    el.style.fontSize = (Number(d.bodySize) || 11) * PT + "px";
    el.style.lineHeight = String(d.lineHeight || 1.5);
    el.style.textAlign = d.justify ? "justify" : "left";
    el.style.hyphens = d.hyphens ? "auto" : "manual";
    el.style.webkitHyphens = d.hyphens ? "auto" : "manual";
    el.style.color = "#111";
    el.style.background = "#fff";
    el.style.margin = "0";
    el.style.padding = "0";
    el.style.overflow = "visible";
  }

  var PAGINATION_CSS = [
    ".bfm * { box-sizing: border-box; }",
    ".bfm p { margin: 0 0 0.55em; }",
    ".bfm h1, .bfm h2, .bfm h3, .bfm h4 { margin: 0.9em 0 0.5em; line-height: 1.25; }",
    ".bfm h1 { font-size: 1.7em; } .bfm h2 { font-size: 1.35em; } .bfm h3 { font-size: 1.15em; }",
    ".bfm h1:first-child, .bfm h2:first-child, .bfm h3:first-child { margin-top: 0; }",
    ".bfm blockquote { margin: 0.8em 1.4em; border-left: 2px solid #999; padding-left: 0.8em; font-style: italic; }",
    ".bfm ul, .bfm ol { margin: 0 0 0.8em 1.3em; padding: 0; }",
    ".bfm li { margin-bottom: 0.25em; }",
    ".bfm table { border-collapse: collapse; width: 100%; margin: 0.8em 0; font-size: 0.92em; }",
    ".bfm th, .bfm td { border: 1px solid #999; padding: 4px 6px; text-align: left; }",
    ".bfm th { background: #f0f0f0; }",
    ".bfm figure { margin: 0.9em 0; text-align: center; }",
    ".bfm figcaption, .bfm .caption { font-size: 0.85em; color: #555; margin-top: 4px; font-family: " + '"Segoe UI", Arial, sans-serif' + "; }",
    ".bfm img { max-width: 100%; height: auto; }",
    ".bfm hr { border: 0; border-top: 1px solid #bbb; margin: 1.2em 0; }",
    ".bfm hr.page-break { border-top: 1px dashed #ccc; visibility: hidden; }",
    ".bfm .section-break { text-align: center; color: #999; }",
    ".bfm .section-break::after { content: '\\2766'; }",
    ".bfm sup.fn { font-size: 0.7em; color: #444; }",
    ".bfm .citation { color: #333; }",
    ".bfm .endnote-block { display: none; }",
    ".bfm .matter-title { text-align: center; font-size: 2.1em; margin-top: 0; }",
    ".bfm .matter-subtitle { text-align: center; font-style: italic; }",
    ".bfm .matter-author { text-align: center; margin-top: 2em; letter-spacing: 0.08em; text-transform: uppercase; font-size: 0.95em; }",
    ".bfm .matter-publisher { text-align: center; font-size: 0.85em; color: #555; }",
    ".bfm .matter-halftitle { text-align: center; font-size: 1.5em; margin-top: 0; }",
    ".bfm .matter-heading { text-align: center; }",
    ".bfm .toc-entry, .bfm .toc-level-1 { margin-bottom: 0.3em; }",
    ".bfm .toc-chapter { font-weight: 600; }",
    ".bfm .toc-heading { margin-left: 1.2em; font-size: 0.92em; color: #444; }",
    ".bfm .toc-part { font-weight: 700; text-transform: uppercase; letter-spacing: 0.08em; margin-top: 0.8em; }",
    ".bfm .chapter-title { margin-top: 0; }",
    ".bfm .part-title { text-align: center; font-size: 2em; text-transform: uppercase; letter-spacing: 0.12em; }",
    ".bfm .bibliography-entry { margin-left: 1.4em; text-indent: -1.4em; margin-bottom: 0.45em; }",
    ".bfm .muted-line { color: #777; font-style: italic; }",
    ".bfm .editor-note { display: none; }",
    ".bfm .index-entry { margin-bottom: 0.2em; font-size: 0.95em; }"
  ].join("\n");

  var styleInjected = false;
  function injectPaginationCss() {
    if (styleInjected) return;
    var s = document.createElement("style");
    s.id = "bf-pagination-css";
    s.textContent = PAGINATION_CSS;
    document.head.appendChild(s);
    styleInjected = true;
  }

  function measureHost(book) {
    var host = document.getElementById("measure");
    injectPaginationCss();
    var geo = geometry(book);
    host.className = "measure bfm";
    host.style.width = toPx(geo.contentW) + "px";
    typography(host, book.design || {});
    return { host: host, geo: geo };
  }

  function blockHeight(host, block) {
    host.innerHTML = "";
    host.appendChild(block);
    var h = host.getBoundingClientRect().height;
    var style = window.getComputedStyle(block);
    var marginBottom = parseFloat(style.marginBottom) || 0;
    if (block.nodeType === 1 && block.tagName === "P") {
      var spacing = parseFloat(style.marginBottom) || 0;
      marginBottom = Math.max(marginBottom, spacing);
    }
    return h + marginBottom;
  }

  function paginate(book) {
    injectPaginationCss();
    var m = measureHost(book);
    var host = m.host;
    var geo = m.geo;
    var contentHpx = toPx(geo.contentH);
    var d = book.design || {};
    var flow = buildFlow(book);
    var warnings = [];
    var pages = [];

    var current = newPage(pages.length + 1, null);
    pages.push(current);
    var used = 0;

    function currentPage() { return pages[pages.length - 1]; }
    function pushPage(flowItem) {
      var p = newPage(pages.length + 1, flowItem);
      pages.push(p);
      used = 0;
      return p;
    }

    flow.forEach(function (item) {
      var first = true;
      item.blocks.forEach(function (block) {
        var isHeading = /^(H1|H2|H3)$/.test(block.tagName || "");
        if (first && item.newPage) {
          if (pages.length > 1 || used > 0) pushPage(item);
          currentPage().chapterOpen = !!item.chapterOpen;
          currentPage().title = item.title;
          currentPage().role = item.role;
          currentPage().chapterId = item.chapter ? item.chapter.id : null;
          first = false;
        }
        if (!currentPage().title && item.title) {
          currentPage().title = item.title;
          currentPage().role = item.role;
          if (!currentPage().chapterId) currentPage().chapterId = item.chapter ? item.chapter.id : null;
        }
        var clone = block.cloneNode(true);
        if (clone.nodeType !== 1) { clone = elText("p", clone.textContent || ""); }
        var h = blockHeight(host, clone);
        var remaining = contentHpx - used;

        if (h <= remaining) {
          currentPage().blocks.push(clone);
          used += h;
          return;
        }

        // Does not fit. Try splitting text-like blocks.
        if (isLikelySplit(clone) && !isAtomic(clone)) {
          var totalWords = wordCountOf(clone);
          if (totalWords > 4) {
            var lo = 1, hi = totalWords, best = 0;
            while (lo <= hi) {
              var mid = (lo + hi) >> 1;
              var trial = clone.cloneNode(true);
              limitWords(trial, mid);
              var th = blockHeight(host, trial);
              if (th <= Math.max(remaining, 0)) { best = mid; lo = mid + 1; }
              else hi = mid - 1;
            }
            if (best >= 3) {
              var part1 = clone.cloneNode(true);
              limitWords(part1, best);
              currentPage().blocks.push(part1);
              used += blockHeight(host, part1);

              var rest = clone.cloneNode(true);
              skipWords(rest, best);
              // Continue flowing the remainder on a fresh page.
              var carry = rest;
              while (wordCountOf(carry) > 0) {
                pushPage(item);
                var ch = blockHeight(host, carry);
                if (ch <= contentHpx) { currentPage().blocks.push(carry); used += ch; break; }
                var tw = wordCountOf(carry);
                var l2 = 1, h2 = tw, b2 = 0;
                while (l2 <= h2) {
                  var m2 = (l2 + h2) >> 1;
                  var t2 = carry.cloneNode(true);
                  limitWords(t2, m2);
                  if (blockHeight(host, t2) <= contentHpx) { b2 = m2; l2 = m2 + 1; } else h2 = m2 - 1;
                }
                if (b2 < 1) { warnings.push("A block could not be split to fit the page size."); currentPage().blocks.push(carry); used = contentHpx; break; }
                var p2 = carry.cloneNode(true);
                limitWords(p2, b2);
                currentPage().blocks.push(p2);
                used += blockHeight(host, p2);
                var r2 = carry.cloneNode(true);
                skipWords(r2, b2);
                carry = r2;
              }
              return;
            }
          }
        }

        // Atomic block: move to the next page.
        if (used > 0) {
          pushPage(item);
          currentPage().title = currentPage().title || item.title;
          currentPage().role = currentPage().role || item.role;
          var rem2 = contentHpx - used;
          var h2b = blockHeight(host, clone);
          if (h2b > contentHpx) {
            if (clone.tagName === "IMG") warnings.push("An image is taller than the printable area and may be clipped.");
            else if (clone.tagName === "TABLE") warnings.push("A table is taller than the printable area and may be clipped.");
          }
          currentPage().blocks.push(clone);
          used += h2b;
          return;
        }
        currentPage().blocks.push(clone);
        used += h;
        if (h > contentHpx && !isAtomic(clone)) warnings.push("A long heading could not fit the printable area.");
      });
      // chapter opening: keep at least two lines with the heading (basic widow control)
    });

    /* Strip empty trailing page */
    if (pages.length > 1 && pages[pages.length - 1].blocks.length === 0) pages.pop();

    /* number the pages */
    var frontCount = 0;
    var arabic = 0;
    var arabicStarted = false;
    pages.forEach(function (p) {
      if (p.role === "front") { frontCount++; p.pageLabel = romanish(frontCount); p.isFront = true; }
      else {
        if (!arabicStarted) { arabicStarted = true; arabic = 0; }
        arabic++;
        p.pageLabel = String(arabic);
        p.isFront = false;
      }
      p.pageNumber = p.pageLabel;
    });

    return { pages: pages, warnings: warnings, geo: geo };
  }

  function newPage(index, flowItem) {
    return {
      blocks: [],
      chapterOpen: false,
      title: flowItem && flowItem.title ? flowItem.title : null,
      role: flowItem ? flowItem.role : null,
      chapterId: flowItem && flowItem.chapter ? flowItem.chapter.id : null,
      pageNumber: index
    };
  }

  function renderTemplate(tpl, ctx) {
    return String(tpl || "")
      .replace(/\{title\}/g, ctx.title || "")
      .replace(/\{chapter\}/g, ctx.chapter || "")
      .replace(/\{page\}/g, ctx.page || "");
  }

  function pageElement(page, book, geo) {
    var d = book.design || {};
    var isEven = Number(page.pageLabel) % 2 === 0 && !page.isFront;
    var left = isEven ? geo.outside : geo.inside;
    var lPx = page.isFront ? geo.inside : left;
    var root = document.createElement("div");
    root.className = "print-page" + (page.chapterOpen && d.chapterOpeners ? " chapter-open" : "");
    root.style.width = geo.trimW + "mm";
    root.style.height = geo.trimH + "mm";

    var body = document.createElement("div");
    body.className = "pg-body bfm";
    body.style.left = lPx + "mm";
    body.style.top = geo.top + "mm";
    body.style.width = geo.contentW + "mm";
    body.style.height = geo.contentH + "mm";
    typography(body, d);
    body.style.fontFamily = '"' + (d.bodyFont || "Georgia") + '", Georgia, "Times New Roman", serif';

    page.blocks.forEach(function (b) { body.appendChild(b); });
    root.appendChild(body);

    if (d.header && d.header.enabled && !page.chapterOpen) {
      var header = document.createElement("div");
      header.className = "pg-header";
      var hLeft = renderTemplate(d.header.left, { title: book.title, chapter: page.title || "", page: page.pageLabel });
      var hRight = renderTemplate(d.header.right, { title: book.title, chapter: page.title || "", page: page.pageLabel });
      var inner = document.createElement("div");
      inner.className = "inner";
      if (!page.isFront) {
        var a = document.createElement("span"); a.textContent = isEven ? hLeft : hRight;
        var bEl = document.createElement("span"); bEl.textContent = isEven ? hRight : hLeft;
        inner.appendChild(a); inner.appendChild(bEl);
      }
      header.appendChild(inner);
      header.style.left = lPx + "mm";
      header.style.width = geo.contentW + "mm";
      root.appendChild(header);
    }

    if (d.footer && d.footer.enabled) {
      var footer = document.createElement("div");
      footer.className = "pg-footer";
      footer.style.left = lPx + "mm";
      footer.style.width = geo.contentW + "mm";
      var fin = document.createElement("div");
      fin.className = "inner";
      var fl = document.createElement("span"); fl.textContent = renderTemplate(d.footer.left, { title: book.title, chapter: page.title || "", page: page.pageLabel });
      var fc = document.createElement("span"); fc.className = "pg-num"; fc.textContent = renderTemplate(d.footer.center, { title: book.title, chapter: page.title || "", page: page.pageLabel });
      var fr = document.createElement("span"); fr.textContent = renderTemplate(d.footer.right, { title: book.title, chapter: page.title || "", page: page.pageLabel });
      fin.appendChild(fl); fin.appendChild(fc); fin.appendChild(fr);
      footer.appendChild(fin);
      root.appendChild(footer);
    }
    return root;
  }

  function renderPreview(container, book, scale) {
    container.innerHTML = "";
    var res = paginate(book);
    res.pages.forEach(function (page) {
      var node = pageElement(page, book, res.geo);
      if (scale && scale !== 1) {
        node.style.transform = "scale(" + scale + ")";
        node.style.transformOrigin = "top center";
        node.style.marginBottom = (res.geo.trimH * scale - res.geo.trimH) + "mm";
      }
      container.appendChild(node);
    });
    return res;
  }

  function renderPages(container, book, opts) {
    opts = opts || {};
    container.innerHTML = "";
    var res = paginate(book);
    var scale = Number(opts.scale) > 0 ? Number(opts.scale) : 1;
    var trimWpx = res.geo.trimW * MM;
    var trimHpx = res.geo.trimH * MM;
    var stageW = Math.max(80, Math.round(trimWpx * scale));
    var stageH = Math.max(80, Math.round(trimHpx * scale));

    res.pages.forEach(function (page) {
      var card = document.createElement("article");
      card.className = "page-card" + (page.chapterId && page.chapterId === opts.chapterId ? " is-current" : "");
      card.dataset.page = page.pageLabel;
      card.dataset.chapter = page.chapterId || "";
      card.setAttribute("aria-label", "Page " + page.pageLabel);

      var head = document.createElement("div");
      head.className = "page-card-head";
      head.style.width = stageW + "px";
      var meta = document.createElement("div");
      meta.className = "page-card-meta";
      var num = document.createElement("span");
      num.className = "page-card-num";
      num.textContent = "Page " + page.pageLabel;
      meta.appendChild(num);
      var title = document.createElement("span");
      title.className = "page-card-title";
      title.textContent = page.title || (page.role === "front" ? "Front matter" : page.role === "back" ? "Back matter" : "Manuscript");
      meta.appendChild(title);
      if (page.chapterOpen && page.chapterId && page.chapterId === opts.chapterId) {
        var badge = document.createElement("span");
        badge.className = "page-card-badge";
        badge.textContent = "Current chapter";
        meta.appendChild(badge);
      }
      head.appendChild(meta);

      var actions = document.createElement("div");
      actions.className = "page-card-actions";
      var words = page.blocks.reduce(function (sum, b) { return sum + U.countWords(b.textContent || ""); }, 0);
      var count = document.createElement("span");
      count.className = "page-card-words";
      count.textContent = words.toLocaleString() + " words";
      actions.appendChild(count);
      if (page.chapterId && typeof opts.onEditChapter === "function") {
        var edit = document.createElement("button");
        edit.type = "button";
        edit.className = "btn ghost sm";
        edit.textContent = "Edit chapter";
        edit.addEventListener("click", function () { opts.onEditChapter(page.chapterId); });
        actions.appendChild(edit);
      } else if ((page.role === "front" || page.role === "back") && typeof opts.onOpenMatter === "function") {
        var matter = document.createElement("button");
        matter.type = "button";
        matter.className = "btn ghost sm";
        matter.textContent = "Open matter";
        matter.addEventListener("click", function () { opts.onOpenMatter(page.role); });
        actions.appendChild(matter);
      }
      head.appendChild(actions);
      card.appendChild(head);

      var stage = document.createElement("div");
      stage.className = "page-stage";
      stage.style.width = stageW + "px";
      stage.style.height = stageH + "px";
      var sheet = pageElement(page, book, res.geo);
      if (scale !== 1) {
        sheet.style.transform = "scale(" + scale + ")";
        sheet.style.transformOrigin = "top left";
      }
      stage.appendChild(sheet);
      card.appendChild(stage);
      container.appendChild(card);
    });

    return res;
  }

  function chapterPageMap(book, chapter) {
    if (!book || !chapter) return null;
    var temp = {};
    Object.keys(book).forEach(function (key) { temp[key] = book[key]; });
    temp.chapters = [Object.assign({}, chapter, { partId: null })];
    temp.parts = [];
    temp.matter = { front: {}, back: {} };
    var res = paginate(temp);
    var ranges = [];
    var words = 0;
    res.pages.forEach(function (page, index) {
      var count = 0;
      page.blocks.forEach(function (block) {
        if (block.nodeType !== 1) return;
        if (block.classList.contains("chapter-title") || block.classList.contains("matter-heading")) return;
        count += U.countWords(block.textContent || "");
      });
      ranges.push({ start: words, end: words + count, page: index + 1 });
      words += count;
    });
    return { total: res.pages.length, words: words, pages: ranges, geo: res.geo };
  }

  function print(book) {
    var printRoot = document.getElementById("print-root");
    printRoot.innerHTML = "";
    var res = paginate(book);
    res.pages.forEach(function (page) {
      printRoot.appendChild(pageElement(page, book, res.geo));
    });
    var geo = res.geo;
    var old = document.getElementById("bf-page-style");
    if (old) old.remove();
    var style = document.createElement("style");
    style.id = "bf-page-style";
    style.textContent = "@page { size: " + geo.trimW + "mm " + geo.trimH + "mm; margin: 0; }";
    document.head.appendChild(style);
    window.print();
    return res;
  }

  BF.layout = {
    paginate: paginate,
    renderPreview: renderPreview,
    renderPages: renderPages,
    chapterPageMap: chapterPageMap,
    print: print,
    geometry: geometry,
    romanish: romanish
  };
})();
