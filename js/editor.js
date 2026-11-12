/* BookForge Studio — manuscript editor built on a contenteditable surface.
   Structured HTML per chapter; Word/Chapter data is persisted by the app layer. */
(function () {
  "use strict";
  var BF = (window.BF = window.BF || {});
  var U = BF.util;

  function Editor(root, opts) {
    this.root = root;
    this.opts = opts || {};
    this.savedRange = null;
    this._bind();
  }

  Editor.prototype._bind = function () {
    var self = this;
    try { document.execCommand("defaultParagraphSeparator", false, "p"); } catch (e) { /* older engines */ }

    this.root.addEventListener("input", function () { self._changed(); });
    this.root.addEventListener("blur", function () { self.saveSelection(); });
    this.root.addEventListener("keyup", function () { self._selectionChanged(); });
    this.root.addEventListener("mouseup", function () { self.saveSelection(); self._selectionChanged(); });
    this.root.addEventListener("keydown", function (e) { self._keydown(e); });
    this.root.addEventListener("paste", function (e) { self._paste(e); });
    this.root.addEventListener("drop", function (e) { self._drop(e); });
    this.root.addEventListener("dblclick", function (e) {
      var target = e.target;
      if (target && target.tagName === "IMG" && self.opts.onImageDblClick) {
        e.preventDefault();
        self.opts.onImageDblClick(target);
      }
    });
    document.addEventListener("selectionchange", function () {
      if (document.activeElement === self.root) { self._selectionChanged(); }
    });
  };

  Editor.prototype._changed = function () {
    if (this.opts.onChange) this.opts.onChange(this.getHtml());
    if (this.opts.onStats) {
      var text = this.root.textContent || "";
      this.opts.onStats({ words: U.countWords(text), chars: text.length });
    }
    if (this.opts.typewriter && this.opts.typewriter()) this.scrollCaretToLine();
  };

  Editor.prototype._selectionChanged = function () {
    if (this.opts.onSelectionState) {
      var state = {};
      ["bold", "italic", "underline", "strikeThrough", "insertUnorderedList", "insertOrderedList",
        "justifyLeft", "justifyCenter", "justifyRight", "justifyFull"].forEach(function (c) {
        try { state[c] = document.queryCommandState(c); } catch (e) { state[c] = false; }
      });
      state.block = this.currentBlockTag();
      this.opts.onSelectionState(state);
    }
  };

  Editor.prototype._keydown = function (e) {
    var mod = e.ctrlKey || e.metaKey;
    if (mod && !e.shiftKey && !e.altKey) {
      var k = e.key.toLowerCase();
      if (k === "b") { e.preventDefault(); this.exec("bold"); return; }
      if (k === "i") { e.preventDefault(); this.exec("italic"); return; }
      if (k === "u") { e.preventDefault(); this.exec("underline"); return; }
      if (k === "s") { e.preventDefault(); if (this.opts.onSave) this.opts.onSave(); return; }
      if (k === "f") { e.preventDefault(); if (this.opts.onFind) this.opts.onFind(); return; }
    }
    if (mod && e.shiftKey) {
      if (e.key === "1") { e.preventDefault(); this.formatBlock("h1"); return; }
      if (e.key === "2") { e.preventDefault(); this.formatBlock("h2"); return; }
      if (e.key === "3") { e.preventDefault(); this.formatBlock("h3"); return; }
      if (e.key === "0") { e.preventDefault(); this.formatBlock("p"); return; }
      if (e.key === "7") { e.preventDefault(); this.exec("insertOrderedList"); return; }
      if (e.key === "8") { e.preventDefault(); this.exec("insertUnorderedList"); return; }
      if (e.key === "9") { e.preventDefault(); this.formatBlock("blockquote"); return; }
    }
    if (e.key === "Tab") {
      var inList = false;
      try { inList = document.queryCommandState("insertUnorderedList") || document.queryCommandState("insertOrderedList"); } catch (err) { inList = false; }
      if (inList) { e.preventDefault(); this.exec(e.shiftKey ? "outdent" : "indent"); }
    }
  };

  Editor.prototype._paste = function (e) {
    var cd = e.clipboardData;
    if (!cd) return;
    var html = cd.getData("text/html");
    var text = cd.getData("text/plain");
    e.preventDefault();
    if (html && !e.shiftKey) {
      this.insertHtml(U.sanitizeHtml(html));
    } else {
      var safe = U.escapeHtml(text || "").replace(/\r?\n\r?\n/g, "</p><p>").replace(/\r?\n/g, "<br>");
      this.insertHtml("<p>" + safe + "</p>");
    }
    this._changed();
  };

  Editor.prototype._drop = function (e) {
    if (!e.dataTransfer || !e.dataTransfer.files || !e.dataTransfer.files.length) return;
    e.preventDefault();
    var file = e.dataTransfer.files[0];
    if (/^image\//.test(file.type) && this.opts.onImageFile) this.opts.onImageFile(file);
  };

  /* ------------------------------------------------------------- commands */
  Editor.prototype.focus = function () { this.root.focus(); };

  Editor.prototype.exec = function (cmd, value) {
    this.focus();
    this.restoreSelection();
    try { document.execCommand(cmd, false, value == null ? null : value); } catch (e) { /* ignored */ }
    this._changed();
    this._selectionChanged();
  };

  Editor.prototype.formatBlock = function (tag) {
    this.focus();
    this.restoreSelection();
    try { document.execCommand("formatBlock", false, "<" + tag + ">"); } catch (e) { /* ignored */ }
    this._changed();
    this._selectionChanged();
  };

  Editor.prototype.setColor = function (color) { this.exec("foreColor", color); };
  Editor.prototype.highlight = function (color) { this.exec("hiliteColor", color); };

  Editor.prototype.currentBlockTag = function () {
    var sel = window.getSelection();
    if (!sel || !sel.rangeCount) return "P";
    var node = sel.getRangeAt(0).commonAncestorContainer;
    if (node.nodeType !== 1) node = node.parentElement;
    while (node && node !== this.root) {
      if (/^(H1|H2|H3|P|BLOCKQUOTE|DIV|LI)$/.test(node.tagName)) return node.tagName;
      node = node.parentElement;
    }
    return "P";
  };

  Editor.prototype.saveSelection = function () {
    var sel = window.getSelection();
    if (sel && sel.rangeCount && this.root.contains(sel.anchorNode)) {
      this.savedRange = sel.getRangeAt(0).cloneRange();
    }
  };

  Editor.prototype.restoreSelection = function () {
    if (!this.savedRange) return;
    var sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(this.savedRange);
  };

  Editor.prototype.insertHtml = function (html) {
    this.focus();
    this.restoreSelection();
    var ok = false;
    try { ok = document.execCommand("insertHTML", false, html); } catch (e) { ok = false; }
    if (!ok) {
      var sel = window.getSelection();
      if (sel && sel.rangeCount) {
        var range = sel.getRangeAt(0);
        range.deleteContents();
        var tpl = document.createElement("template");
        tpl.innerHTML = html;
        var frag = tpl.content;
        var last = frag.lastChild;
        range.insertNode(frag);
        if (last) {
          range.setStartAfter(last);
          range.collapse(true);
          sel.removeAllRanges();
          sel.addRange(range);
        }
      }
    }
    this.saveSelection();
    this._changed();
  };

  Editor.prototype.insertText = function (text) { this.insertHtml(U.escapeHtml(text)); };

  Editor.prototype.insertLink = function (href, label) {
    var sel = window.getSelection();
    var hasSelection = sel && sel.rangeCount && !sel.getRangeAt(0).collapsed;
    if (hasSelection) { this.exec("createLink", href); }
    else this.insertHtml('<a href="' + U.escapeHtml(href) + '">' + U.escapeHtml(label || href) + "</a>");
  };

  Editor.prototype.insertImage = function (src, alt) {
    var fig = '<figure contenteditable="false"><img src="' + U.escapeHtml(src) + '" alt="' + U.escapeHtml(alt || "") + '" title="Double-click to edit image size and compression"><figcaption contenteditable="true">' + U.escapeHtml(alt || "Figure caption") + "</figcaption></figure><p><br></p>";
    this.insertHtml(fig);
  };

  Editor.prototype.insertTable = function (rows, cols) {
    var r, c, html = "<table><thead><tr>";
    for (c = 0; c < cols; c++) html += "<th>Column " + (c + 1) + "</th>";
    html += "</tr></thead><tbody>";
    for (r = 1; r < rows; r++) {
      html += "<tr>";
      for (c = 0; c < cols; c++) html += "<td>&nbsp;</td>";
      html += "</tr>";
    }
    html += "</tbody></table><p><br></p>";
    this.insertHtml(html);
  };

  Editor.prototype.insertPageBreak = function () {
    this.insertHtml('<hr class="page-break" contenteditable="false"><p><br></p>');
  };

  Editor.prototype.insertSectionBreak = function () {
    this.insertHtml('<p class="section-break" contenteditable="false"></p><p><br></p>');
  };

  Editor.prototype.insertHorizontalRule = function () { this.exec("insertHorizontalRule"); };

  Editor.prototype.insertFootnote = function (note) {
    var existing = this.root.querySelectorAll("sup.fn").length;
    var n = existing + 1;
    this.insertHtml('<sup class="fn" contenteditable="false" data-note="' + U.escapeHtml(note) + '" title="' + U.escapeHtml(note) + '">' + n + "</sup>");
    this.ensureEndnoteBlock();
    var ol = this.root.querySelector(".endnote-block ol");
    if (ol) {
      var li = document.createElement("li");
      li.innerHTML = U.escapeHtml(note);
      ol.appendChild(li);
    }
  };

  Editor.prototype.ensureEndnoteBlock = function () {
    var block = this.root.querySelector(".endnote-block");
    if (!block) {
      block = document.createElement("div");
      block.className = "endnote-block";
      block.innerHTML = "<h3>Notes</h3><ol></ol>";
      this.root.appendChild(block);
    }
    return block;
  };

  Editor.prototype.insertCitation = function (text, sourceId, title) {
    this.insertHtml('<span class="citation" contenteditable="false" data-source-id="' + U.escapeHtml(sourceId || "") + '" title="' + U.escapeHtml(title || "") + '">' + U.escapeHtml(text) + "</span>");
  };

  Editor.prototype.insertCaption = function (text) {
    this.insertHtml('<p class="caption">' + U.escapeHtml(text) + "</p>");
  };

  /* ---------------------------------------------------------- find & replace */
  Editor.prototype.findNext = function (term, backwards) {
    if (!term) return false;
    this.focus();
    var found = false;
    try {
      found = window.find(term, false, !!backwards, true, false, false, false);
    } catch (e) { found = false; }
    return found;
  };

  Editor.prototype.replaceCurrent = function (term, replacement) {
    var sel = window.getSelection();
    if (!sel || !sel.rangeCount) return false;
    var range = sel.getRangeAt(0);
    if (range.collapsed) return false;
    var selected = sel.toString();
    if (term && selected.toLowerCase() !== term.toLowerCase()) return false;
    range.deleteContents();
    var node = document.createTextNode(replacement);
    range.insertNode(node);
    sel.removeAllRanges();
    var after = document.createRange();
    after.setStartAfter(node);
    after.collapse(true);
    sel.addRange(after);
    this._changed();
    return true;
  };

  Editor.prototype.replaceAll = function (term, replacement) {
    if (!term) return 0;
    var count = 0;
    var walker = document.createTreeWalker(this.root, NodeFilter.SHOW_TEXT, null);
    var nodes = [];
    var n;
    while ((n = walker.nextNode())) { if (n.nodeValue && n.nodeValue.indexOf(term) >= 0) nodes.push(n); }
    nodes.forEach(function (node) {
      var parts = node.nodeValue.split(term);
      count += parts.length - 1;
      var parent = node.parentNode;
      if (!parent) return;
      var frag = document.createDocumentFragment();
      parts.forEach(function (p, i) {
        if (i > 0) frag.appendChild(document.createTextNode(replacement));
        frag.appendChild(document.createTextNode(p));
      });
      parent.replaceChild(frag, node);
    });
    if (count) this._changed();
    return count;
  };

  /* ------------------------------------------------------------ typewriter */
  Editor.prototype.scrollCaretToLine = function () {
    var sel = window.getSelection();
    if (!sel || !sel.rangeCount) return;
    var range = sel.getRangeAt(0).cloneRange();
    range.collapse(true);
    var rect = range.getClientRects()[0];
    if (!rect) return;
    var host = this.opts.scroller ? this.opts.scroller() : null;
    if (!host) return;
    var hostRect = host.getBoundingClientRect();
    var target = hostRect.top + hostRect.height * 0.42;
    var delta = rect.top - target;
    if (Math.abs(delta) > 8) host.scrollTop += delta;
  };

  /* -------------------------------------------------------------- content */
  Editor.prototype.getHtml = function () { return this.root.innerHTML; };
  Editor.prototype.getText = function () { return this.root.textContent || ""; };
  Editor.prototype.setHtml = function (html) {
    this.root.innerHTML = html || "";
    this.savedRange = null;
    this._changed();
  };
  Editor.prototype.getStats = function () {
    var text = this.root.textContent || "";
    return { words: U.countWords(text), chars: text.length };
  };

  BF.Editor = Editor;
})();
