(function () {
  "use strict";
  var BF = (window.BF = window.BF || {});
  var U = BF.util;
  var MAX_SIDE = 12000;

  function isDataUrl(src) { return /^data:image\//i.test(src || ""); }

  function mimeFromDataUrl(src) {
    var m = /^data:([^;,]+)/i.exec(src || "");
    return m ? m[1].toLowerCase() : "";
  }

  function normalizeMime(mime) {
    return mime === "image/jpg" ? "image/jpeg" : mime;
  }

  function mimeSupported(mime) {
    try {
      var canvas = document.createElement("canvas");
      canvas.width = 1;
      canvas.height = 1;
      return canvas.toDataURL(mime).indexOf("data:" + mime) === 0;
    } catch (e) {
      return false;
    }
  }

  function loadImage(src) {
    return new Promise(function (resolve, reject) {
      var img = new Image();
      img.onload = function () { resolve(img); };
      img.onerror = function () { reject(new Error("The image could not be decoded.")); };
      img.src = src;
    });
  }

  function blobToDataUrl(blob) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function () { resolve(String(reader.result || "")); };
      reader.onerror = function () { reject(new Error("The encoded image could not be read.")); };
      reader.readAsDataURL(blob);
    });
  }

  function clamp(value, min, max) { return Math.max(min, Math.min(max, value)); }

  function formatLabel(mime) {
    if (mime === "image/jpeg") return "JPEG";
    if (mime === "image/png") return "PNG";
    if (mime === "image/webp") return "WebP";
    return String(mime || "image").replace(/^image\//, "").toUpperCase();
  }

  function open(opts) {
    opts = opts || {};
    var src = opts.src || "";
    if (!src) return Promise.reject(new Error("No image to edit."));
    return loadImage(src).then(build, function () { return build(null); });

    function build(img) {
      return new Promise(function (resolve) {
        var settled = false;
        var busy = false;
        var timer = null;
        var token = 0;
        var dlg = null;

        var srcW = img && img.naturalWidth ? img.naturalWidth : 0;
        var srcH = img && img.naturalHeight ? img.naturalHeight : 0;
        var canEdit = isDataUrl(src) && !!img && srcW > 1 && srcH > 1;
        var originalMime = normalizeMime(mimeFromDataUrl(src) || opts.mime || "image/png");
        var originalBytes = 0;
        if (typeof opts.size === "number" && opts.size > 0) originalBytes = opts.size;
        else if (isDataUrl(src)) {
          try { originalBytes = U.dataUrlToBytes(src).bytes.length; } catch (e) { originalBytes = 0; }
        }

        var formats = ["image/jpeg", "image/webp", "image/png"].filter(mimeSupported);
        if (!formats.length) formats = ["image/png", "image/jpeg"];
        var startMime = formats.indexOf(originalMime) >= 0 ? originalMime
          : (formats.indexOf("image/png") >= 0 ? "image/png" : formats[0]);

        var state = {
          rotation: 0,
          width: srcW || 0,
          height: srcH || 0,
          mime: startMime,
          quality: 82,
          displayWidth: clamp(Number(opts.displayWidth) || 100, 10, 100)
        };
        if (state.width > MAX_SIDE) {
          state.height = Math.round(state.height * MAX_SIDE / state.width);
          state.width = MAX_SIDE;
        }
        if (state.height > MAX_SIDE) {
          state.width = Math.round(state.width * MAX_SIDE / state.height);
          state.height = MAX_SIDE;
        }
        var initial = { width: state.width, height: state.height, rotation: 0, mime: state.mime, quality: state.quality };
        var initialDisplay = state.displayWidth;
        var allowWidth = opts.mode !== "asset" && opts.allowDisplayWidth !== false;

        function baseDims() {
          return state.rotation % 180 === 0 ? { w: srcW, h: srcH } : { w: srcH, h: srcW };
        }

        function changed() {
          if (!canEdit) return false;
          return state.rotation !== initial.rotation ||
            state.width !== initial.width ||
            state.height !== initial.height ||
            state.mime !== initial.mime ||
            state.quality !== initial.quality;
        }

        function paint(target, maxSide) {
          var scale = maxSide ? Math.min(1, maxSide / Math.max(state.width, state.height)) : 1;
          var w = Math.max(1, Math.round(state.width * scale));
          var h = Math.max(1, Math.round(state.height * scale));
          target.width = w;
          target.height = h;
          var ctx = target.getContext("2d");
          ctx.clearRect(0, 0, w, h);
          if (state.mime === "image/jpeg") {
            ctx.fillStyle = "#ffffff";
            ctx.fillRect(0, 0, w, h);
          }
          ctx.save();
          ctx.translate(w / 2, h / 2);
          ctx.rotate(state.rotation * Math.PI / 180);
          var drawW = state.rotation % 180 === 0 ? w : h;
          var drawH = state.rotation % 180 === 0 ? h : w;
          ctx.imageSmoothingEnabled = true;
          ctx.imageSmoothingQuality = "high";
          ctx.drawImage(img, -drawW / 2, -drawH / 2, drawW, drawH);
          ctx.restore();
        }

        function encode() {
          return new Promise(function (resolveEncoded, rejectEncoded) {
            var out = document.createElement("canvas");
            try { paint(out, 0); } catch (e) {
              rejectEncoded(new Error("The image could not be prepared for encoding."));
              return;
            }
            function done(blob) {
              if (!blob) {
                rejectEncoded(new Error("This browser could not encode the image."));
                return;
              }
              blobToDataUrl(blob).then(function (dataUrl) {
                var mime = "";
                try { mime = U.dataUrlToBytes(dataUrl).mime; } catch (e) { mime = state.mime; }
                resolveEncoded({
                  dataUrl: dataUrl,
                  mime: mime || state.mime,
                  size: blob.size,
                  width: out.width,
                  height: out.height
                });
              }, rejectEncoded);
            }
            try {
              if (state.mime === "image/png") out.toBlob(done, "image/png");
              else out.toBlob(done, state.mime, state.quality / 100);
            } catch (e) {
              rejectEncoded(new Error("The browser blocked reading this image (cross-origin content)."));
            }
          });
        }

        var preview = U.el("div", { class: "img-editor-preview" + (canEdit ? " is-checker" : "") });
        var canvas = null;
        if (canEdit) {
          canvas = U.el("canvas", { class: "img-editor-canvas", "aria-label": "Image preview" });
          preview.appendChild(canvas);
        } else if (img) {
          img.className = "img-editor-canvas";
          img.alt = opts.name || "Image preview";
          preview.appendChild(img);
        } else {
          preview.appendChild(U.el("div", { class: "img-editor-missing", text: "Preview unavailable. The image could not be loaded." }));
        }

        function originalText() {
          var bits = [];
          if (srcW && srcH) bits.push(srcW + " × " + srcH + " px");
          if (originalBytes) bits.push(U.formatBytes(originalBytes));
          bits.push(formatLabel(originalMime));
          return bits.join(" · ");
        }

        var newValue = U.el("b", { class: "img-editor-new", "aria-live": "polite", text: canEdit ? "Unchanged — original file" : "Linked image" });
        var stats = U.el("div", { class: "img-editor-stats" }, [
          U.el("div", { class: "img-editor-stat" }, [
            U.el("span", { class: "img-editor-stat-label", text: "Original" }),
            U.el("b", { text: originalText() })
          ]),
          U.el("div", { class: "img-editor-stat" }, [
            U.el("span", { class: "img-editor-stat-label", text: "New" }),
            newValue
          ])
        ]);
        preview.appendChild(stats);

        function setNew(text, cls) {
          newValue.textContent = text;
          newValue.className = "img-editor-new" + (cls ? " " + cls : "");
        }

        var controls = U.el("div", { class: "img-editor-controls" });
        var widthInput = null;
        var heightInput = null;
        var lockInput = null;
        var formatSelect = null;
        var qualityInput = null;
        var qualityOut = null;
        var qualityField = null;
        var formatHelp = null;
        var displayInput = null;
        var displayOut = null;
        var presetButtons = [];

        function displayText() {
          var text = state.displayWidth + "% of text width";
          if (opts.contentWidthPx) text += " · about " + Math.round(opts.contentWidthPx * state.displayWidth / 100) + " px on the page";
          return text;
        }

        function formatHelpText() {
          if (state.mime === "image/jpeg") return "Best compatibility in Word and most e-readers. Transparency becomes white.";
          if (state.mime === "image/webp") return "Smallest files, but older versions of Word and some e-readers cannot display WebP.";
          return "Lossless and keeps transparency. Photographs usually stay large.";
        }

        function setWidth(value, lock) {
          var base = baseDims();
          var maxW = Math.min(base.w, MAX_SIDE);
          var w = clamp(Math.round(Number(value) || 1), 1, maxW);
          state.width = w;
          if (lock) {
            var h = Math.round(w * base.h / base.w);
            if (h > MAX_SIDE) {
              h = MAX_SIDE;
              state.width = clamp(Math.round(h * base.w / base.h), 1, maxW);
            }
            state.height = clamp(h, 1, Math.min(base.h, MAX_SIDE));
          } else {
            state.height = clamp(state.height, 1, Math.min(base.h, MAX_SIDE));
          }
          syncUI();
        }

        function setHeight(value, lock) {
          var base = baseDims();
          var maxH = Math.min(base.h, MAX_SIDE);
          var h = clamp(Math.round(Number(value) || 1), 1, maxH);
          state.height = h;
          if (lock) {
            var w = Math.round(h * base.w / base.h);
            if (w > MAX_SIDE) {
              w = MAX_SIDE;
              state.height = clamp(Math.round(w * base.h / base.w), 1, maxH);
            }
            state.width = clamp(w, 1, Math.min(base.w, MAX_SIDE));
          } else {
            state.width = clamp(state.width, 1, Math.min(base.w, MAX_SIDE));
          }
          syncUI();
        }

        function applyPreset(value) {
          var base = baseDims();
          var w = value ? Math.min(value, base.w) : Math.min(base.w, MAX_SIDE);
          state.width = clamp(Math.round(w), 16, MAX_SIDE);
          state.height = clamp(Math.round(state.width * base.h / base.w), 16, MAX_SIDE);
          syncUI();
        }

        function rotate() {
          var prevW = state.width;
          var prevH = state.height;
          state.rotation = (state.rotation + 90) % 360;
          var base = baseDims();
          state.width = clamp(prevH, 16, Math.min(base.w, MAX_SIDE));
          state.height = clamp(prevW, 16, Math.min(base.h, MAX_SIDE));
          syncUI();
        }

        function reset() {
          state.rotation = initial.rotation;
          state.width = initial.width;
          state.height = initial.height;
          state.mime = initial.mime;
          state.quality = initial.quality;
          syncUI();
        }

        function scheduleEstimate() {
          clearTimeout(timer);
          var my = ++token;
          if (!canEdit) {
            setNew(img ? "Linked image — display width only" : "No editable image data");
            return;
          }
          if (!changed()) {
            setNew(originalBytes ? "Unchanged — original file" : "Unchanged");
            return;
          }
          setNew("Estimating…");
          timer = setTimeout(function () {
            encode().then(function (res) {
              if (my !== token || settled) return;
              var text = state.width + " × " + state.height + " px · " + U.formatBytes(res.size) + " · " + formatLabel(res.mime);
              var cls = "";
              if (originalBytes) {
                var saved = Math.round((1 - res.size / originalBytes) * 100);
                if (saved > 0) { cls = "img-gain"; text += " · " + saved + "% smaller"; }
                else if (saved < 0) { cls = "img-loss"; text += " · " + Math.abs(saved) + "% larger"; }
                else text += " · same size";
              }
              setNew(text, cls);
            }).catch(function (err) {
              if (my !== token || settled) return;
              setNew(err.message, "img-loss");
            });
          }, 240);
        }

        function refreshPrimary() {
          if (!dlg) return;
          var dirty = changed() || (allowWidth && state.displayWidth !== initialDisplay);
          if (primaryBtn) primaryBtn.disabled = busy || !dirty;
          if (copyBtn) copyBtn.disabled = busy || !changed();
        }

        function syncUI() {
          if (canEdit) {
            if (document.activeElement !== widthInput) widthInput.value = String(state.width);
            if (document.activeElement !== heightInput) heightInput.value = String(state.height);
            formatSelect.value = state.mime;
            qualityInput.value = String(state.quality);
            qualityOut.textContent = state.quality + "%";
            qualityField.hidden = state.mime === "image/png";
            formatHelp.textContent = formatHelpText();
            presetButtons.forEach(function (item) {
              item.button.setAttribute("aria-pressed", String(item.value === 0
                ? state.width === Math.min(baseDims().w, MAX_SIDE) && state.height === Math.min(baseDims().h, MAX_SIDE)
                : state.width === item.value));
            });
            if (canvas) paint(canvas, 1000);
          }
          if (displayInput) displayOut.textContent = displayText();
          scheduleEstimate();
          refreshPrimary();
        }

        if (canEdit) {
          var base = baseDims();
          var presetRow = U.el("div", { class: "img-editor-presets" });
          var sizes = [];
          [2000, 1600, 1200, 800, 640].forEach(function (value) {
            if (value < Math.min(base.w, MAX_SIDE) && sizes.indexOf(value) < 0) sizes.push(value);
          });
          [{ value: 0, label: "Original" }].concat(sizes.map(function (value) {
            return { value: value, label: value + " px" };
          })).forEach(function (item) {
            var button = U.el("button", {
              class: "btn ghost sm",
              type: "button",
              text: item.label,
              "aria-pressed": "false",
              onclick: function () { applyPreset(item.value); }
            });
            presetButtons.push({ button: button, value: item.value });
            presetRow.appendChild(button);
          });

          widthInput = U.el("input", { id: "bfImgWidth", type: "number", min: "16", max: String(MAX_SIDE), step: "1", value: String(state.width) });
          heightInput = U.el("input", { id: "bfImgHeight", type: "number", min: "16", max: String(MAX_SIDE), step: "1", value: String(state.height) });
          widthInput.addEventListener("input", function () { setWidth(widthInput.value, lockInput.checked); });
          heightInput.addEventListener("input", function () { setHeight(heightInput.value, lockInput.checked); });
          widthInput.addEventListener("change", function () {
            setWidth(Math.max(16, Number(widthInput.value) || 16), lockInput.checked);
            widthInput.value = String(state.width);
            heightInput.value = String(state.height);
          });
          heightInput.addEventListener("change", function () {
            setHeight(Math.max(16, Number(heightInput.value) || 16), lockInput.checked);
            widthInput.value = String(state.width);
            heightInput.value = String(state.height);
          });
          lockInput = U.el("input", { id: "bfImgLock", type: "checkbox" });
          lockInput.checked = true;

          controls.appendChild(U.el("div", { class: "field" }, [
            U.el("label", { text: "Output size" }),
            presetRow
          ]));
          controls.appendChild(U.el("div", { class: "field" }, [
            U.el("div", { class: "img-editor-dims" }, [
              U.el("div", {}, [U.el("label", { for: "bfImgWidth", text: "Width (px)" }), widthInput]),
              U.el("div", {}, [U.el("label", { for: "bfImgHeight", text: "Height (px)" }), heightInput])
            ])
          ]));
          controls.appendChild(U.el("label", { class: "check img-editor-lock", for: "bfImgLock" }, [
            lockInput,
            U.el("span", { text: "Keep aspect ratio" })
          ]));

          controls.appendChild(U.el("div", { class: "field" }, [
            U.el("label", { text: "Orientation" }),
            U.el("div", { class: "img-editor-inline-actions" }, [
              U.el("button", { class: "btn ghost sm", type: "button", text: "Rotate 90°", onclick: rotate }),
              U.el("button", { class: "btn ghost sm", type: "button", text: "Reset", onclick: reset })
            ])
          ]));

          formatSelect = U.el("select", { id: "bfImgFormat" });
          [["image/jpeg", "JPEG — photographs, widest support"],
            ["image/webp", "WebP — smallest files"],
            ["image/png", "PNG — lossless graphics"]].forEach(function (item) {
            if (formats.indexOf(item[0]) < 0) return;
            formatSelect.appendChild(U.el("option", { value: item[0], text: item[1] }));
          });
          formatSelect.value = state.mime;
          formatSelect.addEventListener("change", function () {
            state.mime = formatSelect.value;
            syncUI();
          });
          formatHelp = U.el("div", { class: "help", text: formatHelpText() });
          controls.appendChild(U.el("div", { class: "field" }, [
            U.el("label", { for: "bfImgFormat", text: "Format" }),
            formatSelect,
            formatHelp
          ]));

          qualityInput = U.el("input", { id: "bfImgQuality", type: "range", min: "30", max: "95", step: "1", value: String(state.quality) });
          qualityOut = U.el("output", { id: "bfImgQualityOut", class: "img-editor-out", text: state.quality + "%" });
          qualityInput.addEventListener("input", function () {
            state.quality = Number(qualityInput.value) || 82;
            qualityOut.textContent = state.quality + "%";
            scheduleEstimate();
            refreshPrimary();
          });
          qualityField = U.el("div", { class: "field" }, [
            U.el("label", { for: "bfImgQuality", text: "Quality" }),
            U.el("div", { class: "img-editor-range" }, [qualityInput, qualityOut])
          ]);
          qualityField.hidden = state.mime === "image/png";
          controls.appendChild(qualityField);

          controls.appendChild(U.el("p", { class: "img-editor-note", text: "Resizing, format and quality change the stored file. Images are never enlarged beyond their original pixels." + (opts.mode === "asset" ? "" : " The edit applies to this manuscript image; the original asset stays in Assets.") }));
        } else if (!img) {
          controls.appendChild(U.el("p", { class: "img-editor-note", text: "This image could not be loaded, so its pixels cannot be edited. You can still set its display width in the manuscript." }));
        } else {
          controls.appendChild(U.el("p", { class: "img-editor-note", text: isDataUrl(src)
            ? "This image could not be measured for pixel editing. You can still set its display width in the manuscript."
            : "This image is linked from the web. Browsers block recompressing images from another site, so only its display width can be changed here. Upload the file to Assets to resize and compress it." }));
        }

        if (allowWidth) {
          displayInput = U.el("input", { id: "bfImgDisplay", type: "range", min: "10", max: "100", step: "1", value: String(state.displayWidth) });
          displayOut = U.el("output", { id: "bfImgDisplayOut", class: "img-editor-out", text: displayText() });
          displayInput.addEventListener("input", function () {
            state.displayWidth = clamp(Number(displayInput.value) || 100, 10, 100);
            displayOut.textContent = displayText();
            refreshPrimary();
          });
          controls.appendChild(U.el("div", { class: "field" }, [
            U.el("label", { for: "bfImgDisplay", text: "Display width in manuscript" }),
            U.el("div", { class: "img-editor-range" }, [displayInput, displayOut]),
            U.el("div", { class: "help", text: "Changes how large the image appears on the page and in exports. It does not recompress the file." })
          ]));
        }

        var body = U.el("div", { class: "img-editor" }, [preview, controls]);
        var primaryLabel = opts.mode === "asset" ? "Replace image" : "Apply to manuscript";
        var primaryAction = opts.mode === "asset" ? "replace" : "apply";
        var actions = [];
        if (canEdit && opts.mode === "asset") {
          actions.push({ label: "Save as copy", onClick: function (close) { apply("copy", close); } });
        }
        actions.push({ label: "Cancel", onClick: function (close) { close(); } });
        if (canEdit || allowWidth) {
          actions.push({ label: primaryLabel, primary: true, onClick: function (close) { apply(primaryAction, close); } });
        }

        var primaryBtn = null;
        var copyBtn = null;

        dlg = BF.app.openDialog({
          title: "Edit image" + (opts.name ? " — " + opts.name : ""),
          wide: true,
          body: body,
          actions: actions,
          onClose: function () {
            if (settled) return;
            settled = true;
            resolve(null);
          }
        });

        var footButtons = dlg.foot ? Array.prototype.slice.call(dlg.foot.querySelectorAll("button")) : [];
        primaryBtn = footButtons.filter(function (b) { return b.classList.contains("primary"); })[0] || null;
        copyBtn = footButtons.filter(function (b) { return b.textContent.trim() === "Save as copy"; })[0] || null;

        function setBusy(on) {
          busy = on;
          footButtons.forEach(function (b) { b.disabled = on; });
          if (!on) refreshPrimary();
        }

        function finish(result) {
          if (settled) return;
          settled = true;
          resolve(result);
        }

        function apply(action, close) {
          if (busy) return;
          if (!canEdit || !changed()) {
            finish({
              action: action,
              dataUrl: src,
              mime: originalMime,
              size: originalBytes,
              width: srcW,
              height: srcH,
              displayWidth: state.displayWidth
            });
            close();
            return;
          }
          setBusy(true);
          setNew("Encoding…");
          encode().then(function (res) {
            finish({
              action: action,
              dataUrl: res.dataUrl,
              mime: res.mime,
              size: res.size,
              width: res.width,
              height: res.height,
              displayWidth: state.displayWidth
            });
            close();
          }).catch(function (err) {
            setBusy(false);
            setNew(err.message, "img-loss");
            if (BF.app && BF.app.toast) BF.app.toast(err.message, "error");
          });
        }

        syncUI();
      });
    }
  }

  BF.imageEditor = { open: open };
})();
