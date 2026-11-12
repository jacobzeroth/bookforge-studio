/* BookForge Studio — local text clean-up and paragraph formatting.
   Works on a detached DOM copy so the manuscript is never touched until the
   caller applies the returned HTML. No network, no AI, no invented content. */
(function () {
  "use strict";
  var BF = (window.BF = window.BF || {});
  var U = BF.util;

  var DEFAULTS = {
    spaces: true,
    punctuation: true,
    quotes: true,
    capitalize: true,
    ellipses: true,
    dashes: true,
    trim: true,
    empty: true
  };

  var BLOCK_TAGS = {
    P: 1, DIV: 1, H1: 1, H2: 1, H3: 1, H4: 1, H5: 1, H6: 1,
    LI: 1, BLOCKQUOTE: 1, FIGCAPTION: 1, TD: 1, TH: 1, CAPTION: 1
  };
  var NESTED_TAGS = { UL: 1, OL: 1, TABLE: 1, FIGURE: 1, THEAD: 1, TBODY: 1, TFOOT: 1, TR: 1 };
  var SKIP_TAGS = { CODE: 1, PRE: 1, KBD: 1, SAMP: 1, SCRIPT: 1, STYLE: 1, TEXTAREA: 1, MATH: 1 };
  var EMBED_TAGS = { IMG: 1, HR: 1, SVG: 1, VIDEO: 1, AUDIO: 1, IFRAME: 1, OBJECT: 1, EMBED: 1, CANVAS: 1 };
  var MEDIA_SELECTOR = "img,svg,video,audio,iframe,object,embed,canvas,table,figure,hr";
  var ABBREVIATIONS = /^(mr|mrs|ms|dr|prof|rev|sr|jr|st|vs|etc|fig|figs|no|nos|vol|vols|ch|chs|pp|p|ed|eds|al|approx|dept|est|min|max)$/i;

  function inSkippedArea(el, root) {
    var node = el;
    while (node && node !== root) {
      if (node.nodeType === 1 && SKIP_TAGS[node.tagName]) return true;
      node = node.parentNode;
    }
    return false;
  }

  function textNodesOf(block) {
    var out = [];
    (function walk(node) {
      for (var child = node.firstChild; child; child = child.nextSibling) {
        if (child.nodeType === 3) {
          out.push(child);
        } else if (child.nodeType === 1) {
          if (SKIP_TAGS[child.tagName] || EMBED_TAGS[child.tagName] || NESTED_TAGS[child.tagName]) continue;
          if (child !== block && BLOCK_TAGS[child.tagName]) continue;
          if (inSkippedArea(child, block)) continue;
          walk(child);
        }
      }
    })(block);
    return out;
  }

  function joined(nodes) {
    return nodes.map(function (n) { return n.nodeValue || ""; }).join("");
  }

  function writeJoined(nodes, text) {
    var offset = 0;
    nodes.forEach(function (node) {
      var len = (node.nodeValue || "").length;
      node.nodeValue = text.slice(offset, offset + len);
      offset += len;
    });
  }

  function nonSpaceBefore(text, index) {
    for (var i = index - 1; i >= 0; i--) if (!/\s/.test(text.charAt(i))) return text.charAt(i);
    return "";
  }

  function nonSpaceAfter(text, index) {
    for (var i = index + 1; i < text.length; i++) if (!/\s/.test(text.charAt(i))) return text.charAt(i);
    return "";
  }

  function isWordChar(ch) { return /[A-Za-zÀ-ÖØ-öø-ÿ0-9]/.test(ch); }

  function smartQuotes(nodes, stats) {
    var text = joined(nodes);
    if (text.indexOf('"') < 0 && text.indexOf("'") < 0) return;
    var out = text.split("");
    for (var i = 0; i < out.length; i++) {
      var ch = out[i];
      var immediateBefore = i > 0 ? text.charAt(i - 1) : "";
      var before = nonSpaceBefore(text, i);
      var after = nonSpaceAfter(text, i);
      var atBoundary = !immediateBefore || /\s/.test(immediateBefore);
      if (ch === '"') {
        out[i] = atBoundary || /[([{—–-]/.test(immediateBefore) ? "“" : "”";
        stats.quotes++;
      } else if (ch === "'") {
        if (atBoundary) {
          if (/^(?:tis|twas|em|cause|round|bout|til|n)\b/i.test(text.slice(i + 1))) out[i] = "’";
          else if (/\d/.test(after)) out[i] = "’";
          else out[i] = "‘";
        } else if (isWordChar(before) && isWordChar(after)) out[i] = "’";
        else if (isWordChar(before) || /[.,!?;:”’)\]]/.test(before)) out[i] = "’";
        else out[i] = "‘";
        stats.quotes++;
      }
    }
    writeJoined(nodes, out.join(""));
  }

  function firstLetterIndex(text) {
    var leading = text.replace(/^\s+/, "");
    if (/^(?:…|\.\.\.)/.test(leading)) return -1;
    var m = /[A-Za-zÀ-ÖØ-öø-ÿ]/.exec(leading);
    if (!m) return -1;
    return text.indexOf(leading) + m.index;
  }

  function capitalizeSentences(nodes, stats) {
    var text = joined(nodes);
    if (!text.trim()) return;
    var indices = [];
    var first = firstLetterIndex(text);
    if (first >= 0) indices.push(first);
    var re = /([.!?])["'”’)\]]*\s+([a-zà-öø-ÿ])/g;
    var m;
    while ((m = re.exec(text))) {
      var end = m.index;
      var before = text.slice(0, end);
      var token = /([A-Za-z][A-Za-z.]*)$/.exec(before);
      if (token) {
        var word = token[1];
        if (word.indexOf(".") >= 0 || ABBREVIATIONS.test(word)) continue;
      }
      var startIndex = m.index + m[0].length - 1;
      if (/^[a-zà-öø-ÿ](?:\.[a-zà-öø-ÿ]){1,3}\./i.test(text.slice(startIndex))) continue;
      indices.push(startIndex);
    }
    if (!indices.length) return;
    var offset = 0;
    var starts = nodes.map(function (node) {
      var s = offset;
      offset += (node.nodeValue || "").length;
      return s;
    });
    indices.forEach(function (index) {
      var upper = text.charAt(index).toUpperCase();
      if (upper === text.charAt(index)) return;
      for (var i = 0; i < nodes.length; i++) {
        var len = (nodes[i].nodeValue || "").length;
        if (index >= starts[i] && index < starts[i] + len) {
          var local = index - starts[i];
          var value = nodes[i].nodeValue;
          nodes[i].nodeValue = value.slice(0, local) + upper + value.slice(local + 1);
          text = text.slice(0, index) + upper + text.slice(index + 1);
          stats.capitalized++;
          return;
        }
      }
    });
  }

  function cleanTextValue(value, stats) {
    var t = value;
    if (stats.options.ellipses) {
      t = t.replace(/\.\s*\.\s*\./g, function () { stats.ellipses++; return "…"; });
    }
    if (stats.options.dashes) {
      t = t.replace(/\s*--\s*/g, function () { stats.dashes++; return " — "; });
      t = t.replace(/^ — /, "— ").replace(/ —$/, " —");
    }
    if (stats.options.spaces) {
      t = t.replace(/[ \t]{2,}/g, function () { stats.spaces++; return " "; });
    }
    if (stats.options.punctuation) {
      t = t.replace(/[ \t]+([,.;:!?])/g, function (m, p) { stats.punctuation++; return p; });
      t = t.replace(/(^|[^A-Za-z0-9])([A-Za-zÀ-ÖØ-öø-ÿ]{2,})([.!?])(?=[A-ZÀ-ÖØ-Þ])/g, function (m, lead, word, p) {
        if (ABBREVIATIONS.test(word)) return m;
        stats.punctuation++;
        return lead + word + p + " ";
      });
      t = t.replace(/([,;!?])(?=[A-Za-zÀ-ÖØ-öø-ÿ])/g, function (m, p) { stats.punctuation++; return p + " "; });
      t = t.replace(/(:)(?=[A-ZÀ-ÖØ-Þ])/g, function (m, p) { stats.punctuation++; return p + " "; });
      t = t.replace(/([.!?])(?=[“'‘])/g, function (m, p) { stats.punctuation++; return p + " "; });
      t = t.replace(/(”)(?=[A-Za-zÀ-ÖØ-öø-ÿ])/g, function (m, p) { stats.punctuation++; return p + " "; });
    }
    return t;
  }

  function trimBlock(nodes, stats) {
    for (var i = 0; i < nodes.length; i++) {
      var value = nodes[i].nodeValue || "";
      if (!value) continue;
      var next = value.replace(/^[ \t]+/, "");
      if (next !== value) {
        nodes[i].nodeValue = next;
        stats.trimmed++;
      }
      break;
    }
    for (var j = nodes.length - 1; j >= 0; j--) {
      var v = nodes[j].nodeValue || "";
      if (!v) continue;
      var nv = v.replace(/[ \t]+$/, "");
      if (nv !== v) {
        nodes[j].nodeValue = nv;
        stats.trimmed++;
      }
      break;
    }
  }

  function emptyBlocks(root) {
    var removed = 0;
    (function walk(container) {
      Array.prototype.slice.call(container.children).forEach(function (el) {
        if (el.children.length) walk(el);
        if (!el.parentNode) return;
        if (el.tagName !== "P" && el.tagName !== "DIV") return;
        if (inSkippedArea(el, root)) return;
        if (el.id || el.className || el.getAttribute("style")) return;
        if (el.getAttribute("contenteditable") === "false") return;
        var prev = el.previousElementSibling;
        if (prev && (prev.tagName === "HR" || (prev.classList && prev.classList.contains("section-break")))) return;
        if (el.querySelector(MEDIA_SELECTOR)) return;
        var text = (el.textContent || "").replace(/[\s\u00a0]+/g, "");
        if (text) return;
        el.parentNode.removeChild(el);
        removed++;
      });
    })(root);
    return removed;
  }

  function clean(html, options) {
    var opts = {};
    Object.keys(DEFAULTS).forEach(function (k) { opts[k] = options && options[k] != null ? !!options[k] : DEFAULTS[k]; });
    var tpl = document.createElement("template");
    tpl.innerHTML = html || "";
    var root = tpl.content;
    var stats = {
      options: opts,
      spaces: 0, punctuation: 0, quotes: 0, capitalized: 0,
      ellipses: 0, dashes: 0, trimmed: 0, empty: 0, blocks: 0
    };
    var samples = [];

    var blocks = Array.prototype.slice.call(root.querySelectorAll("p,div,h1,h2,h3,h4,h5,h6,li,blockquote,figcaption,td,th,caption"));
    blocks.forEach(function (block) {
      if (inSkippedArea(block, root)) return;
      var nodes = textNodesOf(block);
      if (!nodes.length) return;
      var beforeText = joined(nodes);
      var beforeHtml = block.outerHTML;
      if (opts.quotes) smartQuotes(nodes, stats);
      if (opts.ellipses || opts.dashes || opts.spaces || opts.punctuation) {
        nodes.forEach(function (node) {
          var value = node.nodeValue || "";
          if (!value) return;
          node.nodeValue = cleanTextValue(value, stats);
        });
      }
      if (opts.capitalize) capitalizeSentences(nodes, stats);
      if (opts.trim) trimBlock(nodes, stats);
      var afterText = joined(nodes);
      if (block.outerHTML !== beforeHtml) {
        stats.blocks++;
        if (samples.length < 3 && beforeText !== afterText && beforeText.trim()) {
          samples.push({
            before: beforeText.length > 700 ? beforeText.slice(0, 700) + "…" : beforeText,
            after: afterText.length > 700 ? afterText.slice(0, 700) + "…" : afterText
          });
        }
      }
    });

    if (opts.empty) stats.empty = emptyBlocks(root);

    var total = stats.spaces + stats.punctuation + stats.quotes + stats.capitalized +
      stats.ellipses + stats.dashes + stats.trimmed + stats.empty;
    return {
      html: tpl.innerHTML,
      changed: total > 0,
      stats: stats,
      samples: samples
    };
  }

  function summary(stats) {
    var bits = [];
    if (stats.blocks) bits.push(stats.blocks + " paragraph" + (stats.blocks === 1 ? "" : "s") + " changed");
    if (stats.quotes) bits.push(stats.quotes + " quote mark" + (stats.quotes === 1 ? "" : "s") + " converted");
    if (stats.spaces) bits.push(stats.spaces + " spacing run" + (stats.spaces === 1 ? "" : "s") + " collapsed");
    if (stats.punctuation) bits.push(stats.punctuation + " punctuation gap" + (stats.punctuation === 1 ? "" : "s") + " fixed");
    if (stats.ellipses) bits.push(stats.ellipses + " ellipsis" + (stats.ellipses === 1 ? "" : "es") + " normalized");
    if (stats.dashes) bits.push(stats.dashes + " dash" + (stats.dashes === 1 ? "" : "es") + " normalized");
    if (stats.capitalized) bits.push(stats.capitalized + " sentence start" + (stats.capitalized === 1 ? "" : "s") + " capitalized");
    if (stats.trimmed) bits.push(stats.trimmed + " paragraph edge" + (stats.trimmed === 1 ? "" : "s") + " trimmed");
    if (stats.empty) bits.push(stats.empty + " empty paragraph" + (stats.empty === 1 ? "" : "s") + " removed");
    return bits.join(" · ");
  }

  BF.textTools = { clean: clean, summary: summary, DEFAULTS: DEFAULTS };
})();
