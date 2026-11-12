/* BookForge Studio — shared utilities (no dependencies) */
(function () {
  "use strict";

  var BF = (window.BF = window.BF || {});

  function uid(prefix) {
    var rnd = Math.random().toString(36).slice(2, 8);
    return (prefix || "id") + "_" + Date.now().toString(36) + "_" + rnd;
  }

  function el(tag, attrs, children) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        var v = attrs[k];
        if (v === null || v === undefined || v === false) return;
        if (k === "class") node.className = v;
        else if (k === "text") node.textContent = v;
        else if (k === "html") node.innerHTML = v;
        else if (k === "dataset") Object.keys(v).forEach(function (d) { node.dataset[d] = v[d]; });
        else if (k.indexOf("on") === 0 && typeof v === "function") node.addEventListener(k.slice(2), v);
        else if (v === true) node.setAttribute(k, "");
        else node.setAttribute(k, v);
      });
    }
    (children || []).forEach(function (c) {
      if (c === null || c === undefined) return;
      node.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
    });
    return node;
  }

  function qs(sel, root) { return (root || document).querySelector(sel); }
  function qsa(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }

  function escapeHtml(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function escapeXml(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" }[c];
    });
  }

  function stripHtml(html) {
    var d = document.createElement("div");
    d.innerHTML = html || "";
    return (d.textContent || "").replace(/\s+\n/g, "\n");
  }

  function countWords(text) {
    if (!text) return 0;
    var t = String(text).trim();
    if (!t) return 0;
    return t.split(/\s+/).filter(Boolean).length;
  }

  function countChars(text) { return text ? String(text).length : 0; }

  function readingMinutes(words) { return Math.max(0, Math.round(words / 220)); }

  function debounce(fn, wait) {
    var t = null;
    function wrapped() {
      var args = arguments, self = this;
      clearTimeout(t);
      t = setTimeout(function () { fn.apply(self, args); }, wait);
    }
    wrapped.cancel = function () { clearTimeout(t); };
    wrapped.flush = function () { clearTimeout(t); fn(); };
    return wrapped;
  }

  function formatDate(ts) {
    if (!ts) return "—";
    var d = new Date(ts);
    if (isNaN(d.getTime())) return "—";
    return d.toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" });
  }

  function formatDateTime(ts) {
    if (!ts) return "—";
    var d = new Date(ts);
    if (isNaN(d.getTime())) return "—";
    return d.toLocaleString(undefined, { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
  }

  function relativeTime(ts) {
    if (!ts) return "—";
    var diff = Date.now() - ts;
    var mins = Math.round(diff / 60000);
    if (mins < 1) return "just now";
    if (mins < 60) return mins + " min ago";
    var hrs = Math.round(mins / 60);
    if (hrs < 24) return hrs + (hrs === 1 ? " hour ago" : " hours ago");
    var days = Math.round(hrs / 24);
    if (days < 30) return days + (days === 1 ? " day ago" : " days ago");
    return formatDate(ts);
  }

  function download(blob, filename) {
    var a = document.createElement("a");
    var url = URL.createObjectURL(blob);
    a.href = url;
    a.download = filename;
    a.style.display = "none";
    document.body.appendChild(a);
    a.click();
    setTimeout(function () {
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }, 400);
  }

  function safeFilename(s, fallback) {
    var out = String(s || "").trim().replace(/[\\/:*?"<>|]+/g, "").replace(/\s+/g, "-").replace(/-+/g, "-");
    out = out.replace(/^-|-$/g, "");
    return out || fallback || "book";
  }

  function slugify(s) {
    return String(s || "").toLowerCase().trim()
      .replace(/[^a-z0-9\s-]/g, "")
      .replace(/\s+/g, "-")
      .replace(/-+/g, "-").replace(/^-|-$/g, "") || "section";
  }

  function dataUrlToBytes(dataUrl) {
    var parts = String(dataUrl).split(",");
    var meta = parts[0] || "";
    var mimeMatch = meta.match(/data:([^;]+)/);
    var mime = mimeMatch ? mimeMatch[1] : "application/octet-stream";
    var isBase64 = /;base64/i.test(meta);
    var payload = parts.slice(1).join(",");
    var binary;
    if (isBase64) binary = atob(payload);
    else binary = decodeURIComponent(payload);
    var bytes = new Uint8Array(binary.length);
    for (var i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return { mime: mime, bytes: bytes, ext: mimeToExt(mime) };
  }

  function mimeToExt(mime) {
    var map = {
      "image/png": "png", "image/jpeg": "jpg", "image/jpg": "jpg", "image/gif": "gif",
      "image/webp": "webp", "image/svg+xml": "svg", "image/bmp": "bmp"
    };
    return map[mime] || "bin";
  }

  function bytesToBase64(bytes) {
    var chunk = 0x8000, out = "";
    for (var i = 0; i < bytes.length; i += chunk) {
      out += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
    }
    return btoa(out);
  }

  function fileToDataUrl(file) {
    return new Promise(function (resolve, reject) {
      var r = new FileReader();
      r.onload = function () { resolve(r.result); };
      r.onerror = function () { reject(new Error("Could not read file: " + (file && file.name))); };
      r.readAsDataURL(file);
    });
  }

  function readFileText(file) {
    return new Promise(function (resolve, reject) {
      var r = new FileReader();
      r.onload = function () { resolve(String(r.result || "")); };
      r.onerror = function () { reject(new Error("Could not read file: " + (file && file.name))); };
      r.readAsText(file);
    });
  }

  /* Minimal word-level diff (LCS). Returns array of {type:'same'|'add'|'del', text} */
  function diffWords(a, b) {
    var A = String(a || "").split(/(\s+)/);
    var B = String(b || "").split(/(\s+)/);
    var n = A.length, m = B.length;
    var max = 2200;
    if (n > max || m > max) {
      return [{ type: "del", text: String(a || "") }, { type: "add", text: String(b || "") }];
    }
    var dp = [];
    for (var i = 0; i <= n; i++) dp.push(new Int32Array(m + 1));
    for (i = n - 1; i >= 0; i--) {
      for (var j = m - 1; j >= 0; j--) {
        dp[i][j] = A[i] === B[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
      }
    }
    var out = [], x = 0, y = 0;
    while (x < n && y < m) {
      if (A[x] === B[y]) { push(out, "same", A[x]); x++; y++; }
      else if (dp[x + 1][y] >= dp[x][y + 1]) { push(out, "del", A[x]); x++; }
      else { push(out, "add", B[y]); y++; }
    }
    while (x < n) { push(out, "del", A[x]); x++; }
    while (y < m) { push(out, "add", B[y]); y++; }
    return out;
  }

  function push(arr, type, text) {
    var last = arr[arr.length - 1];
    if (last && last.type === type) last.text += text;
    else arr.push({ type: type, text: text });
  }

  function diffHtml(a, b) {
    return diffWords(a, b).map(function (p) {
      if (p.type === "add") return '<ins>' + escapeHtml(p.text) + "</ins>";
      if (p.type === "del") return '<del>' + escapeHtml(p.text) + "</del>";
      return escapeHtml(p.text);
    }).join("");
  }

  /* Sanitise pasted / imported HTML: strip scripts, event handlers, remote style. */
  function sanitizeHtml(html) {
    var tpl = document.createElement("template");
    tpl.innerHTML = html || "";
    var allowed = {
      P: 1, BR: 1, DIV: 1, SPAN: 1, H1: 1, H2: 1, H3: 1, H4: 1, H5: 1, H6: 1,
      B: 1, STRONG: 1, I: 1, EM: 1, U: 1, S: 1, STRIKE: 1, DEL: 1, SUB: 1, SUP: 1,
      UL: 1, OL: 1, LI: 1, BLOCKQUOTE: 1, HR: 1, A: 1, IMG: 1, FIGURE: 1, FIGCAPTION: 1,
      TABLE: 1, THEAD: 1, TBODY: 1, TFOOT: 1, TR: 1, TH: 1, TD: 1, CAPTION: 1, MARK: 1, CODE: 1, PRE: 1
    };
    function walk(node) {
      var children = Array.prototype.slice.call(node.childNodes);
      children.forEach(function (child) {
        if (child.nodeType === 1) {
          if (!allowed[child.tagName]) {
            // unwrap unknown element but keep its text
            var frag = document.createDocumentFragment();
            while (child.firstChild) frag.appendChild(child.firstChild);
            node.replaceChild(frag, child);
            return;
          }
          Array.prototype.slice.call(child.attributes).forEach(function (attr) {
            var name = attr.name.toLowerCase();
            if (name.indexOf("on") === 0) child.removeAttribute(attr.name);
            else if (name === "style") child.removeAttribute("style");
            else if ((name === "href" || name === "src") && /^\s*javascript:/i.test(attr.value)) child.removeAttribute(attr.name);
          });
          walk(child);
        } else if (child.nodeType === 8) {
          node.removeChild(child);
        }
      });
    }
    walk(tpl.content);
    return tpl.innerHTML;
  }

  function formatBytes(n) {
    if (!n && n !== 0) return "—";
    if (n < 1024) return n + " B";
    if (n < 1024 * 1024) return (n / 1024).toFixed(1) + " KB";
    return (n / (1024 * 1024)).toFixed(1) + " MB";
  }

  function clone(v) { return JSON.parse(JSON.stringify(v)); }

  function groupBy(arr, keyFn) {
    return (arr || []).reduce(function (acc, item) {
      var k = keyFn(item);
      (acc[k] = acc[k] || []).push(item);
      return acc;
    }, {});
  }

  BF.util = {
    uid: uid, el: el, qs: qs, qsa: qsa,
    escapeHtml: escapeHtml, escapeXml: escapeXml, stripHtml: stripHtml,
    countWords: countWords, countChars: countChars, readingMinutes: readingMinutes,
    debounce: debounce, formatDate: formatDate, formatDateTime: formatDateTime, relativeTime: relativeTime,
    download: download, safeFilename: safeFilename, slugify: slugify,
    dataUrlToBytes: dataUrlToBytes, mimeToExt: mimeToExt, bytesToBase64: bytesToBase64,
    fileToDataUrl: fileToDataUrl, readFileText: readFileText,
    diffWords: diffWords, diffHtml: diffHtml, sanitizeHtml: sanitizeHtml,
    formatBytes: formatBytes, clone: clone, groupBy: groupBy
  };
})();
