/* BookForge Studio — real document generation.
   DOCX (OOXML package), EPUB 3 (valid container), self-contained HTML,
   Markdown, plain text, and JSON project backup. */
(function () {
  "use strict";
  var BF = (window.BF = window.BF || {});
  var U = BF.util;
  var docxImageLimits = null;

  /* --------------------------------------------------------------- helpers */
  function bookText(book) {
    var lines = [];
    (book.chapters || []).forEach(function (ch) {
      lines.push(ch.title || "");
      lines.push("");
      lines.push(U.stripHtml(ch.content || ""));
      lines.push("");
    });
    return lines.join("\n");
  }

  function matterSections(book) {
    var out = [];
    BF.model.FRONT_MATTER.forEach(function (m) {
      var st = book.matter.front[m.id];
      if (st && st.enabled) out.push({ side: "front", id: m.id, name: m.name, content: st.content || "", state: st });
    });
    return out;
  }

  function backSections(book) {
    var out = [];
    BF.model.BACK_MATTER.forEach(function (m) {
      var st = book.matter.back[m.id];
      if (st && st.enabled) out.push({ side: "back", id: m.id, name: m.name, content: st.content || "", state: st });
    });
    return out;
  }

  /* ================================================================= DOCX */
  var W_NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"';

  function docxEscape(s) { return U.escapeXml(s); }

  function runProps(fmt) {
    var parts = [];
    if (fmt.bold) parts.push("<w:b/>");
    if (fmt.italic) parts.push("<w:i/>");
    if (fmt.underline) parts.push("<w:u w:val=\"single\"/>");
    if (fmt.strike) parts.push("<w:strike/>");
    if (fmt.sup) parts.push("<w:vertAlign w:val=\"superscript\"/>");
    if (fmt.sub) parts.push("<w:vertAlign w:val=\"subscript\"/>");
    if (fmt.href) parts.push('<w:rStyle w:val="Hyperlink"/>');
    return parts.length ? "<w:rPr>" + parts.join("") + "</w:rPr>" : "";
  }

  function run(text, fmt) {
    if (text === "") return "";
    return "<w:r>" + runProps(fmt) + '<w:t xml:space="preserve">' + docxEscape(text) + "</w:t></w:r>";
  }

  function convertInline(node, fmt, ctx) {
    var out = [];
    if (node.nodeType === 3) {
      out.push(run(node.nodeValue.replace(/\s+/g, " "), fmt));
      return out;
    }
    if (node.nodeType !== 1) return out;
    var tag = node.tagName;
    var f = Object.assign({}, fmt);
    if (tag === "B" || tag === "STRONG") f.bold = true;
    if (tag === "I" || tag === "EM") f.italic = true;
    if (tag === "U") f.underline = true;
    if (tag === "S" || tag === "STRIKE" || tag === "DEL") f.strike = true;
    if (tag === "SUP") f.sup = true;
    if (tag === "SUB") f.sub = true;
    if (tag === "BR") return ['<w:r><w:br/></w:r>'];
    if (tag === "IMG") return [docxImageRun(node)];
    if (tag === "A") {
      var href = node.getAttribute("href") || "";
      if (!href) {
        Array.prototype.forEach.call(node.childNodes, function (c) { out = out.concat(convertInline(c, f, ctx)); });
        return out;
      }
      var relId = ctx.addRel(href, "External");
      var inner = [];
      Array.prototype.forEach.call(node.childNodes, function (c) { inner = inner.concat(convertInline(c, Object.assign({}, f, { href: true }), ctx)); });
      if (!inner.length) inner = [run(node.textContent, Object.assign({}, f, { href: true }))];
      out.push('<w:hyperlink r:id="' + relId + '">' + inner.join("") + "</w:hyperlink>");
      return out;
    }
    Array.prototype.forEach.call(node.childNodes, function (c) { out = out.concat(convertInline(c, f, ctx)); });
    return out;
  }

  function pxToEmu(px) { return Math.round(px * 9525); }

  function docxImageSize(imgEl, info) {
    var naturalW = info.widthPx || 320;
    var naturalH = info.heightPx || 220;
    var maxW = docxImageLimits && docxImageLimits.maxWidthPx;
    var maxH = docxImageLimits && docxImageLimits.maxHeightPx;
    var percent = null;
    var explicit = null;

    var dataWidth = parseFloat(imgEl.getAttribute("data-bf-width") || "");
    if (isFinite(dataWidth) && dataWidth > 0) percent = dataWidth;

    var style = imgEl.style && imgEl.style.width ? imgEl.style.width.trim() : "";
    var stylePct = /^([\d.]+)%$/.exec(style);
    var stylePx = /^([\d.]+)px$/.exec(style);
    if (percent == null && stylePct) percent = parseFloat(stylePct[1]);
    if (percent == null && explicit == null && stylePx) explicit = parseFloat(stylePx[1]);

    if (percent == null && explicit == null) {
      var attr = (imgEl.getAttribute("width") || "").trim();
      var attrPct = /^([\d.]+)%$/.exec(attr);
      var attrPx = /^([\d.]+)(?:px)?$/.exec(attr);
      if (attrPct) percent = parseFloat(attrPct[1]);
      else if (attrPx) explicit = parseFloat(attrPx[1]);
    }

    var width = naturalW;
    var height = naturalH;
    if (percent != null && maxW) {
      width = maxW * percent / 100;
      height = width * naturalH / naturalW;
    } else if (explicit != null) {
      width = explicit;
      height = explicit * naturalH / naturalW;
    }
    if (maxW && width > maxW) {
      width = maxW;
      height = width * naturalH / naturalW;
    }
    if (maxH && height > maxH) {
      height = maxH;
      width = height * naturalW / naturalH;
    }
    if (!(width > 0) || !(height > 0)) {
      width = naturalW;
      height = naturalH;
    }
    return { widthPx: width, heightPx: height };
  }

  function docxImageRun(imgEl) {
    var src = imgEl.getAttribute("src") || "";
    var info = (window.__bfDocxImages && window.__bfDocxImages[src]);
    if (!info) return run("[image: " + (imgEl.getAttribute("alt") || "untitled") + "]", { italic: true });
    var size = docxImageSize(imgEl, info);
    return '<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0">' +
      '<wp:extent cx="' + pxToEmu(size.widthPx) + '" cy="' + pxToEmu(size.heightPx) + '"/>' +
      '<wp:effectExtent l="0" t="0" r="0" b="0"/>' +
      '<wp:docPr id="' + info.id + '" name="Picture ' + info.id + '" descr="' + docxEscape(imgEl.getAttribute("alt") || "") + '"/>' +
      '<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">' +
      '<pic:pic><pic:nvPicPr><pic:cNvPr id="' + info.id + '" name="image' + info.id + '"/><pic:cNvPicPr/></pic:nvPicPr>' +
      '<pic:blipFill><a:blip r:embed="' + info.relId + '"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>' +
      '<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="' + pxToEmu(size.widthPx) + '" cy="' + pxToEmu(size.heightPx) + '"/></a:xfrm>' +
      '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic>' +
      "</a:graphicData></a:graphic></wp:inline></w:drawing></w:r>";
  }

  function paragraph(runsXml, style, extraProps) {
    var pPr = "<w:pPr>";
    if (style) pPr += '<w:pStyle w:val="' + style + '"/>';
    if (extraProps) pPr += extraProps;
    pPr += "</w:pPr>";
    return "<w:p>" + pPr + (runsXml || "") + "</w:p>";
  }

  function paraFromElement(elm, ctx, style, extraProps) {
    var runs = [];
    Array.prototype.forEach.call(elm.childNodes, function (c) { runs = runs.concat(convertInline(c, {}, ctx)); });
    return paragraph(runs.join(""), style, extraProps);
  }

  function tableToOoxml(table, ctx) {
    var rows = table.querySelectorAll("tr");
    var xml = "<w:tbl><w:tblPr><w:tblStyle w:val=\"TableGrid\"/><w:tblW w:w=\"0\" w:type=\"auto\"/></w:tblPr><w:tblGrid>";
    var cols = rows.length ? rows[0].children.length : 1;
    for (var c = 0; c < cols; c++) xml += '<w:gridCol w:w="' + Math.round(9000 / cols) + '"/>';
    xml += "</w:tblGrid>";
    Array.prototype.forEach.call(rows, function (tr) {
      xml += "<w:tr>";
      Array.prototype.forEach.call(tr.children, function (cell) {
        var inner = "";
        Array.prototype.forEach.call(cell.childNodes, function (n) {
          if (n.nodeType === 1 && /^(P|DIV)$/.test(n.tagName)) inner += paraFromElement(n, ctx);
          else if (n.nodeType === 3 && n.nodeValue.trim()) inner += paragraph(run(n.nodeValue.trim(), {}));
        });
        if (!inner) inner = paragraph("");
        xml += "<w:tc><w:tcPr/>" + inner + "</w:tc>";
      });
      xml += "</w:tr>";
    });
    xml += "</w:tbl>" + paragraph("");
    return xml;
  }

  function listToOoxml(list, ctx, level) {
    var numId = list.tagName === "OL" ? 2 : 1;
    var xml = "";
    Array.prototype.forEach.call(list.children, function (li) {
      if (li.tagName !== "LI") return;
      var runs = [];
      var nested = "";
      Array.prototype.forEach.call(li.childNodes, function (n) {
        if (n.nodeType === 1 && /^(UL|OL)$/.test(n.tagName)) nested += listToOoxml(n, ctx, (level || 0) + 1);
        else runs = runs.concat(convertInline(n, {}, ctx));
      });
      var ilvl = Math.min(level || 0, 2);
      xml += paragraph(runs.join(""), "ListParagraph", '<w:numPr><w:ilvl w:val="' + ilvl + '"/><w:numId w:val="' + numId + '"/></w:numPr>');
      xml += nested;
    });
    return xml;
  }

  function htmlToOoxml(html, ctx, opts) {
    opts = opts || {};
    var tpl = document.createElement("template");
    tpl.innerHTML = U.sanitizeHtml(html || "");
    var xml = "";
    Array.prototype.forEach.call(tpl.content.childNodes, function (node) {
      if (node.nodeType === 3) {
        if (node.nodeValue.trim()) xml += paragraph(run(node.nodeValue.replace(/\s+/g, " ").trim(), {}));
        return;
      }
      if (node.nodeType !== 1) return;
      switch (node.tagName) {
        case "H1": xml += paraFromElement(node, ctx, "Heading1"); break;
        case "H2": xml += paraFromElement(node, ctx, "Heading2"); break;
        case "H3": xml += paraFromElement(node, ctx, "Heading3"); break;
        case "H4": xml += paraFromElement(node, ctx, "Heading4"); break;
        case "P":
          if (node.querySelector("img") && node.textContent.trim() === "" && node.children.length === 1) xml += paraFromElement(node, ctx);
          else xml += paraFromElement(node, ctx, opts.style || null);
          break;
        case "BLOCKQUOTE": xml += paraFromElement(node, ctx, "Quote"); break;
        case "UL": case "OL": xml += listToOoxml(node, ctx, 0); break;
        case "TABLE": xml += tableToOoxml(node, ctx); break;
        case "FIGURE": {
          var img = node.querySelector("img");
          var cap = node.querySelector("figcaption");
          if (img) xml += paragraph(docxImageRun(img), "Caption");
          if (cap) xml += paragraph(run(cap.textContent || "", { italic: true }), "Caption");
          break;
        }
        case "IMG": xml += paragraph(docxImageRun(node)); break;
        case "HR": xml += paragraph("", "HorizontalRule"); break;
        case "DIV":
          if (node.classList.contains("endnote-block")) {
            xml += paragraph(run("Notes", { bold: true }), "Heading4");
            Array.prototype.forEach.call(node.querySelectorAll("li"), function (li) {
              xml += paragraph(run(li.textContent || "", {}), "Endnote");
            });
          } else {
            xml += htmlToOoxml(node.innerHTML, ctx, opts);
          }
          break;
        default:
          xml += paraFromElement(node, ctx, opts.style || null);
      }
    });
    return xml;
  }

  var DOCX_STYLES = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
    '<w:styles ' + W_NS + '>' +
    '<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Georgia" w:hAnsi="Georgia" w:eastAsia="Georgia" w:cs="Georgia"/><w:sz w:val="22"/><w:szCs w:val="22"/></w:rPr></w:rPrDefault>' +
    "<w:pPrDefault><w:pPr><w:spacing w:after=\"120\" w:line=\"276\" w:lineRule=\"auto\"/></w:pPr></w:pPrDefault></w:docDefaults>" +
    '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>' +
    '<w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:pPr><w:jc w:val="center"/><w:spacing w:after="240"/></w:pPr><w:rPr><w:sz w:val="56"/><w:b/></w:rPr></w:style>' +
    '<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:pPr><w:keepNext/><w:spacing w:before="320" w:after="160"/><w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:sz w:val="36"/><w:b/></w:rPr></w:style>' +
    '<w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:pPr><w:keepNext/><w:spacing w:before="280" w:after="140"/><w:outlineLvl w:val="1"/></w:pPr><w:rPr><w:sz w:val="28"/><w:b/></w:rPr></w:style>' +
    '<w:style w:type="paragraph" w:styleId="Heading3"><w:name w:val="heading 3"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:pPr><w:keepNext/><w:spacing w:before="240" w:after="120"/><w:outlineLvl w:val="2"/></w:pPr><w:rPr><w:sz w:val="24"/><w:b/></w:rPr></w:style>' +
    '<w:style w:type="paragraph" w:styleId="Heading4"><w:name w:val="heading 4"/><w:basedOn w:val="Normal"/><w:pPr><w:keepNext/><w:spacing w:before="200" w:after="100"/><w:outlineLvl w:val="3"/></w:pPr><w:rPr><w:i/></w:rPr></w:style>' +
    '<w:style w:type="paragraph" w:styleId="Quote"><w:name w:val="Quote"/><w:basedOn w:val="Normal"/><w:pPr><w:ind w:left="720" w:right="720"/></w:pPr><w:rPr><w:i/></w:rPr></w:style>' +
    '<w:style w:type="paragraph" w:styleId="Caption"><w:name w:val="Caption"/><w:basedOn w:val="Normal"/><w:pPr><w:jc w:val="center"/><w:spacing w:after="240"/></w:pPr><w:rPr><w:sz w:val="18"/><w:color w:val="555555"/></w:rPr></w:style>' +
    '<w:style w:type="paragraph" w:styleId="ListParagraph"><w:name w:val="List Paragraph"/><w:basedOn w:val="Normal"/><w:pPr><w:contextualSpacing/></w:pPr></w:style>' +
    '<w:style w:type="paragraph" w:styleId="Endnote"><w:name w:val="Endnote Text"/><w:basedOn w:val="Normal"/><w:rPr><w:sz w:val="18"/></w:rPr></w:style>' +
    '<w:style w:type="paragraph" w:styleId="Bibliography"><w:name w:val="Bibliography"/><w:basedOn w:val="Normal"/><w:pPr><w:ind w:left="720" w:hanging="720"/></w:pPr></w:style>' +
    '<w:style w:type="character" w:styleId="Hyperlink"><w:name w:val="Hyperlink"/><w:rPr><w:color w:val="1F4E79"/><w:u w:val="single"/></w:rPr></w:style>' +
    '<w:style w:type="table" w:styleId="TableGrid"><w:name w:val="Table Grid"/><w:tblPr><w:tblBorders>' +
    '<w:top w:val="single" w:sz="4" w:color="999999"/><w:left w:val="single" w:sz="4" w:color="999999"/>' +
    '<w:bottom w:val="single" w:sz="4" w:color="999999"/><w:right w:val="single" w:sz="4" w:color="999999"/>' +
    '<w:insideH w:val="single" w:sz="4" w:color="999999"/><w:insideV w:val="single" w:sz="4" w:color="999999"/>' +
    "</w:tblBorders></w:tblPr></w:style>" +
    "</w:styles>";

  var DOCX_NUMBERING = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
    '<w:numbering ' + W_NS + '>' +
    '<w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="bullet"/><w:lvlText w:val="&#8226;"/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="720" w:hanging="360"/></w:pPr></w:lvl>' +
    '<w:lvl w:ilvl="1"><w:start w:val="1"/><w:numFmt w:val="bullet"/><w:lvlText w:val="&#9702;"/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="1440" w:hanging="360"/></w:pPr></w:lvl>' +
    '<w:lvl w:ilvl="2"><w:start w:val="1"/><w:numFmt w:val="bullet"/><w:lvlText w:val="&#9642;"/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="2160" w:hanging="360"/></w:pPr></w:lvl></w:abstractNum>' +
    '<w:abstractNum w:abstractNumId="1"><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="720" w:hanging="360"/></w:pPr></w:lvl>' +
    '<w:lvl w:ilvl="1"><w:start w:val="1"/><w:numFmt w:val="lowerLetter"/><w:lvlText w:val="%2."/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="1440" w:hanging="360"/></w:pPr></w:lvl>' +
    '<w:lvl w:ilvl="2"><w:start w:val="1"/><w:numFmt w:val="lowerRoman"/><w:lvlText w:val="%3."/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="2160" w:hanging="360"/></w:pPr></w:lvl></w:abstractNum>' +
    '<w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>' +
    '<w:num w:numId="2"><w:abstractNumId w:val="1"/></w:num>' +
    "</w:numbering>";

  function docxSectPr(book) {
    var geo = BF.layout.geometry(book);
    return '<w:sectPr><w:pgSz w:w="' + Math.round(geo.trimW * 56.6929) + '" w:h="' + Math.round(geo.trimH * 56.6929) + '"/>' +
      '<w:pgMar w:top="' + Math.round(geo.top * 56.6929) + '" w:right="' + Math.round(geo.outside * 56.6929) + '" w:bottom="' + Math.round(geo.bottom * 56.6929) + '" w:left="' + Math.round(geo.inside * 56.6929) + '" w:header="720" w:footer="720" w:gutter="0"/>' +
      "</w:sectPr>";
  }

  async function buildDocx(book, opts) {
    opts = opts || {};
    var ctx = { rels: [], relId: 1 };
    ctx.addRel = function (target, mode, type) {
      var id = "rId" + (ctx.relId++);
      ctx.rels.push({ id: id, target: target, mode: mode, type: type || (mode === "External" ? "http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" : "http://schemas.openxmlformats.org/officeDocument/2006/relationships/image") });
      return id;
    };

    var docxGeo = BF.layout.geometry(book);
    docxImageLimits = {
      maxWidthPx: docxGeo.contentW * 96 / 25.4,
      maxHeightPx: docxGeo.contentH * 96 / 25.4 * 0.85
    };

    /* Collect images (data URLs) so runs can reference them. */
    var media = {};
    window.__bfDocxImages = {};
    var allHtml = [];
    (book.chapters || []).forEach(function (ch) { allHtml.push(ch.content || ""); });
    matterSections(book).forEach(function (m) { allHtml.push(m.content || ""); });
    var imgSrcs = {};
    allHtml.forEach(function (html) {
      var m = String(html).match(/<img[^>]+src="(data:[^"]+)"/g) || [];
      m.forEach(function (tag) {
        var src = tag.replace(/.*src="/, "").replace(/"$/, "");
        imgSrcs[src] = true;
      });
    });
    var imgList = Object.keys(imgSrcs);
    for (var i = 0; i < imgList.length; i++) {
      var src = imgList[i];
      var parsed = U.dataUrlToBytes(src);
      var name = "image" + (i + 1) + "." + parsed.ext;
      var relId = ctx.addRel("media/" + name, "Internal", "http://schemas.openxmlformats.org/officeDocument/2006/relationships/image");
      media[name] = parsed.bytes;
      var dims = await measureImage(src);
      window.__bfDocxImages[src] = { relId: relId, name: name, widthPx: dims.width, heightPx: dims.height, id: i + 1 };
      if (opts.onProgress) opts.onProgress("Embedding images (" + (i + 1) + "/" + imgList.length + ")", 20 + Math.round((i / Math.max(1, imgList.length)) * 30));
    }

    var body = "";
    body += paraFromElement(textEl("p", book.title || "Untitled book"), ctx, "Title");
    if (book.subtitle) body += paraFromElement(textEl("p", book.subtitle), ctx, "Quote");
    if (book.author) body += paragraph(run(book.author, { italic: false }), "Caption");
    if (book.coAuthors) body += paragraph(run("With " + book.coAuthors, {}), "Caption");

    /* Table of contents field */
    body += paragraph('<w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText xml:space="preserve"> TOC \\o "1-3" \\h \\z \\u </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:t>Right-click here in Word and choose &quot;Update Field&quot; to build the table of contents.</w:t></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r>');

    matterSections(book).forEach(function (m) {
      if (m.id === "toc") return;
      body += paragraph(docxEscape(m.name), "Heading1");
      body += htmlToOoxml(m.content, ctx);
      body += paragraph("", null, '<w:pageBreakBefore w:val="false"/>');
    });

    (book.chapters || []).forEach(function (ch, idx) {
      body += paragraph("", null, '<w:pageBreakBefore w:val="true"/>');
      body += paragraph(docxEscape(ch.title || "Untitled chapter"), "Heading1");
      body += htmlToOoxml(ch.content || "", ctx);
      if (opts.onProgress) opts.onProgress("Converting chapter " + (idx + 1) + " of " + book.chapters.length, 50 + Math.round((idx / Math.max(1, book.chapters.length)) * 40));
    });

    backSections(book).forEach(function (m) {
      body += paragraph("", null, '<w:pageBreakBefore w:val="true"/>');
      body += paragraph(docxEscape(m.name), "Heading1");
      if (m.id === "bibliography" || m.id === "references") {
        var style = book.settings.citationStyle || "apa";
        BF.model.bibliography(book, style).forEach(function (it, i) {
          body += paragraph(run((style === "ieee" ? "[" + (i + 1) + "] " : "") + it.text, {}), "Bibliography");
        });
      } else {
        body += htmlToOoxml(m.content, ctx);
      }
    });

    body += docxSectPr(book);

    var relsXml = ctx.rels.map(function (r) {
      return '<Relationship Id="' + r.id + '" Type="' + r.type + '" Target="' + U.escapeXml(r.target) + '"' + (r.mode === "External" ? ' TargetMode="External"' : "") + "/>";
    }).join("");

    var now = new Date().toISOString();
    var entries = [
      {
        name: "[Content_Types].xml",
        data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
          '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
          '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
          '<Default Extension="xml" ContentType="application/xml"/>' +
          '<Default Extension="png" ContentType="image/png"/><Default Extension="jpg" ContentType="image/jpeg"/>' +
          '<Default Extension="jpeg" ContentType="image/jpeg"/><Default Extension="gif" ContentType="image/gif"/>' +
          '<Default Extension="webp" ContentType="image/webp"/><Default Extension="svg" ContentType="image/svg+xml"/>' +
          '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
          '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>' +
          '<Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/>' +
          '<Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/>' +
          '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>' +
          '<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>' +
          "</Types>"
      },
      {
        name: "_rels/.rels",
        data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
          '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
          '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
          '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>' +
          '<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>' +
          "</Relationships>"
      },
      {
        name: "word/document.xml",
        data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:document ' + W_NS + "><w:body>" + body + "</w:body></w:document>"
      },
      { name: "word/styles.xml", data: DOCX_STYLES },
      { name: "word/numbering.xml", data: DOCX_NUMBERING },
      { name: "word/settings.xml", data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:settings ' + W_NS + '><w:updateFields w:val="true"/></w:settings>' },
      {
        name: "word/_rels/document.xml.rels",
        data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
          '<Relationship Id="rIdStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
          '<Relationship Id="rIdNumbering" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/>' +
          '<Relationship Id="rIdSettings" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/settings" Target="settings.xml"/>' +
          relsXml + "</Relationships>"
      },
      {
        name: "docProps/core.xml",
        data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
          '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">' +
          "<dc:title>" + U.escapeXml(book.title || "") + "</dc:title>" +
          "<dc:creator>" + U.escapeXml(book.author || "") + "</dc:creator>" +
          "<dc:subject>" + U.escapeXml(book.category || "") + "</dc:subject>" +
          "<dc:description>" + U.escapeXml(book.subtitle || book.purpose || "") + "</dc:description>" +
          '<cp:lastModifiedBy>' + U.escapeXml(book.author || "BookForge Studio") + "</cp:lastModifiedBy>" +
          '<dcterms:created xsi:type="dcterms:W3CDTF">' + now + "</dcterms:created>" +
          '<dcterms:modified xsi:type="dcterms:W3CDTF">' + now + "</dcterms:modified>" +
          "</cp:coreProperties>"
      },
      {
        name: "docProps/app.xml",
        data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
          '<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">' +
          "<Application>BookForge Studio</Application>" +
          "<Words>" + BF.model.stats(book).words + "</Words>" +
          "</Properties>"
      }
    ];

    Object.keys(media).forEach(function (name) {
      entries.push({ name: "word/media/" + name, data: media[name] });
    });

    if (opts.onProgress) opts.onProgress("Packaging DOCX", 96);
    return BF.zip.create(entries, { mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" });
  }

  function textEl(tag, text) {
    var n = document.createElement(tag);
    n.textContent = text;
    return n;
  }

  function measureImage(src) {
    return new Promise(function (resolve) {
      var img = new Image();
      img.onload = function () {
        var maxW = 460;
        var w = img.naturalWidth || 400;
        var h = img.naturalHeight || 300;
        if (w > maxW) { h = Math.round(h * (maxW / w)); w = maxW; }
        resolve({ width: w, height: h });
      };
      img.onerror = function () { resolve({ width: 320, height: 220 }); };
      img.src = src;
    });
  }

  /* ================================================================= EPUB */
  function toXhtmlFragment(html) {
    var tpl = document.createElement("template");
    tpl.innerHTML = U.sanitizeHtml(html || "");
    /* remove editor-only helpers */
    Array.prototype.forEach.call(tpl.content.querySelectorAll(".endnote-block"), function (b) {
      var parent = b.parentNode;
      if (!parent) return;
      var h = document.createElement("h3");
      h.textContent = "Notes";
      parent.insertBefore(h, b);
    });
    var frag = tpl.content;
    var out = "";
    Array.prototype.forEach.call(frag.childNodes, function (n) {
      out += new XMLSerializer().serializeToString(n);
    });
    return out || "<p></p>";
  }

  function xhtmlPage(title, bodyHtml, cssHref) {
    return '<?xml version="1.0" encoding="UTF-8"?>\n' +
      '<!DOCTYPE html>\n' +
      '<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="en" lang="en">' +
      "<head><meta charset=\"utf-8\"/><title>" + U.escapeXml(title) + "</title>" +
      '<link rel="stylesheet" type="text/css" href="' + cssHref + '"/></head>' +
      "<body><section epub:type=\"chapter\">" + bodyHtml + "</section></body></html>";
  }

  async function buildEpub(book, opts) {
    opts = opts || {};
    var id = "urn:uuid:" + (window.crypto && crypto.randomUUID ? crypto.randomUUID() :
      "00000000-0000-4000-8000-" + String(Date.now()).slice(-12).padStart(12, "0"));
    var now = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
    var manifest = [], spine = [], navItems = [], entries = [];
    var imageMap = {};
    var imgCount = 0;

    function handleImages(html) {
      var tpl = document.createElement("template");
      tpl.innerHTML = U.sanitizeHtml(html || "");
      Array.prototype.forEach.call(tpl.content.querySelectorAll("img"), function (img) {
        var src = img.getAttribute("src") || "";
        if (src.indexOf("data:") !== 0) return;
        if (!imageMap[src]) {
          var parsed = U.dataUrlToBytes(src);
          imgCount++;
          var name = "image-" + imgCount + "." + parsed.ext;
          imageMap[src] = name;
          entries.push({ name: "OEBPS/images/" + name, data: parsed.bytes });
          manifest.push('<item id="img' + imgCount + '" href="images/' + name + '" media-type="' + parsed.mime + '"/>');
        }
        img.setAttribute("src", "../images/" + imageMap[src]);
      });
      var out = "";
      Array.prototype.forEach.call(tpl.content.childNodes, function (n) {
        out += new XMLSerializer().serializeToString(n);
      });
      return out || "<p></p>";
    }

    var used = {};
    function addDoc(name, title, html, navLevel) {
      var file = name + ".xhtml";
      var body = handleImages(html);
      entries.push({ name: "OEBPS/text/" + file, data: xhtmlPage(title, body, "../styles/style.css") });
      var docId = "doc-" + name;
      manifest.push('<item id="' + docId + '" href="text/' + file + '" media-type="application/xhtml+xml"/>');
      spine.push('<itemref idref="' + docId + '"/>');
      navItems.push({ href: "text/" + file, title: title, level: navLevel });
      return docId;
    }

    addDoc("title", "Title page", docTitlePage(book), 1);

    matterSections(book).forEach(function (m, i) {
      if (m.id === "titlePage") return;
      if (m.id === "toc" || m.id === "listFigures" || m.id === "listTables") return;
      addDoc("front-" + m.id, m.name, '<h1>' + U.escapeHtml(m.name) + "</h1>" + (m.content || ""), 1);
    });

    var n = 0;
    (book.parts || []).forEach(function (part) {
      var chapters = (book.chapters || []).filter(function (c) { return c.partId === part.id; });
      if (!chapters.length) return;
      addDoc("part-" + (++n), part.title, '<h1 class="part-title">' + U.escapeHtml(part.title) + "</h1>", 1);
      chapters.forEach(function (ch, i) {
        addDoc("ch-" + ch.id, ch.title, '<h1>' + U.escapeHtml(ch.title) + "</h1>" + (ch.content || ""), 2);
      });
    });
    (book.chapters || []).filter(function (c) { return !c.partId; }).forEach(function (ch) {
      addDoc("ch-" + ch.id, ch.title, '<h1>' + U.escapeHtml(ch.title) + "</h1>" + (ch.content || ""), 1);
    });

    backSections(book).forEach(function (m) {
      var extra = "";
      if (m.id === "bibliography" || m.id === "references") {
        var params = BF.model.bibliography(book, book.settings.citationStyle || "apa");
        extra = params.length
          ? "<ol>" + params.map(function (p) { return "<li>" + U.escapeHtml(p.text) + "</li>"; }).join("") + "</ol>"
          : "<p><em>No sources have been entered yet.</em></p>";
        m.content = extra;
      } else if (m.id === "index") {
        var terms = {};
        (book.chapters || []).forEach(function (ch) {
          BF.model.headingsFromHtml(ch.content).forEach(function (h) { if (h.text) terms[h.text] = (terms[h.text] || 0) + 1; });
        });
        var keys = Object.keys(terms).sort();
        extra = keys.length ? "<ul>" + keys.map(function (k) { return "<li>" + U.escapeHtml(k) + "</li>"; }).join("") + "</ul>" : "<p><em>No index terms found.</em></p>";
        m.content = extra;
      }
      addDoc("back-" + m.id, m.name, '<h1>' + U.escapeHtml(m.name) + "</h1>" + (m.content || ""), 1);
    });

    entries.push({ name: "OEBPS/styles/style.css", data: EPUB_CSS });
    manifest.push('<item id="css" href="styles/style.css" media-type="text/css"/>');
    manifest.push('<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>');

    var navHtml = '<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE html>\n' +
      '<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="en" lang="en">' +
      '<head><meta charset="utf-8"/><title>Contents</title><link rel="stylesheet" type="text/css" href="styles/style.css"/></head><body>' +
      '<nav epub:type="toc" id="toc"><h1>Contents</h1><ol>' +
      navItems.map(function (it) { return '<li><a href="' + it.href + '">' + U.escapeXml(it.title) + "</a></li>"; }).join("") +
      "</ol></nav></body></html>";
    entries.push({ name: "OEBPS/nav.xhtml", data: navHtml });

    var opf = '<?xml version="1.0" encoding="UTF-8"?>\n' +
      '<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid" xml:lang="en">' +
      '<metadata xmlns:dc="http://purl.org/dc/elements/1.1/">' +
      '<dc:identifier id="bookid">' + U.escapeXml(id) + "</dc:identifier>" +
      "<dc:title>" + U.escapeXml(book.title || "Untitled book") + "</dc:title>" +
      (book.subtitle ? "<dc:title id=\"subtitle\">" + U.escapeXml(book.subtitle) + "</dc:title>" : "") +
      "<dc:language>" + U.escapeXml((book.language || "English").slice(0, 2).toLowerCase() === "en" ? "en" : langCode(book.language)) + "</dc:language>" +
      (book.author ? "<dc:creator>" + U.escapeXml(book.author) + "</dc:creator>" : "<dc:creator>Unknown author</dc:creator>") +
      (book.coAuthors ? "<dc:contributor>" + U.escapeXml(book.coAuthors) + "</dc:contributor>" : "") +
      (book.publisher ? "<dc:publisher>" + U.escapeXml(book.publisher) + "</dc:publisher>" : "") +
      (book.category ? "<dc:subject>" + U.escapeXml(book.category) + "</dc:subject>" : "") +
      "<dc:date>" + now + "</dc:date>" +
      '<meta property="dcterms:modified">' + now + "</meta>" +
      "</metadata><manifest>" + manifest.join("") + "</manifest><spine>" + spine.join("") + "</spine></package>";
    entries.push({ name: "OEBPS/content.opf", data: opf });

    entries.push({
      name: "META-INF/container.xml",
      data: '<?xml version="1.0" encoding="UTF-8"?>\n<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>'
    });

    /* mimetype must be first and stored uncompressed */
    entries.unshift({ name: "mimetype", data: "application/epub+zip" });

    if (opts.onProgress) opts.onProgress("Packaging EPUB", 92);
    return BF.zip.create(entries, { mime: "application/epub+zip" });
  }

  function langCode(lang) {
    var map = { English: "en", Hindi: "hi", Malayalam: "ml", Tamil: "ta", Telugu: "te", Kannada: "kn", Bengali: "bn", Marathi: "mr", Spanish: "es", French: "fr", German: "de" };
    return map[lang] || "en";
  }

  function docTitlePage(book) {
    return '<div class="title-page"><h1 class="book-title">' + U.escapeHtml(book.title || "Untitled book") + "</h1>" +
      (book.subtitle ? '<p class="book-subtitle">' + U.escapeHtml(book.subtitle) + "</p>" : "") +
      (book.author ? '<p class="book-author">' + U.escapeHtml(book.author) + "</p>" : "") +
      (book.publisher ? '<p class="book-publisher">' + U.escapeHtml(book.publisher) + "</p>" : "") +
      "</div>";
  }

  var EPUB_CSS = [
    "body { font-family: Georgia, serif; line-height: 1.6; margin: 5%; color: #111; }",
    "h1, h2, h3 { font-family: Georgia, serif; line-height: 1.25; }",
    "h1 { font-size: 1.6em; margin: 1.2em 0 .6em; }",
    "p { margin: 0 0 .8em; text-align: justify; }",
    "blockquote { margin: 1em 1.6em; font-style: italic; }",
    "figure { margin: 1em 0; text-align: center; }",
    "figcaption, .caption { font-size: .85em; color: #555; }",
    "img { max-width: 100%; height: auto; }",
    "table { border-collapse: collapse; width: 100%; font-size: .92em; }",
    "th, td { border: 1px solid #999; padding: 4px 6px; text-align: left; }",
    ".title-page { text-align: center; margin-top: 25%; }",
    ".book-title { font-size: 2.2em; }",
    ".book-subtitle { font-style: italic; }",
    ".book-author { margin-top: 2em; text-transform: uppercase; letter-spacing: .08em; }",
    ".bibliography-entry { margin-left: 1.4em; text-indent: -1.4em; }"
  ].join("\n");

  /* ================================================================== HTML */
  function buildHtml(book) {
    var stats = BF.model.stats(book);
    var toc = BF.model.buildToc(book);
    var parts = [];
    parts.push("<!DOCTYPE html>\n<html lang=\"en\">\n<head>\n<meta charset=\"UTF-8\">\n<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">");
    parts.push("<title>" + U.escapeHtml(book.title || "Untitled book") + (book.subtitle ? " — " + U.escapeHtml(book.subtitle) : "") + "</title>");
    parts.push("<meta name=\"author\" content=\"" + U.escapeHtml(book.author || "") + "\">");
    parts.push("<style>" + HTML_BOOK_CSS + "</style>\n</head>\n<body>");
    parts.push("<header class=\"book-head\"><h1 class=\"book-title\">" + U.escapeHtml(book.title || "Untitled book") + "</h1>" +
      (book.subtitle ? '<p class="book-subtitle">' + U.escapeHtml(book.subtitle) + "</p>" : "") +
      (book.author ? '<p class="book-author">' + U.escapeHtml(book.author) + "</p>" : "") +
      (book.publisher ? '<p class="book-publisher">' + U.escapeHtml(book.publisher) + (book.edition ? " · " + U.escapeHtml(book.edition) + " edition" : "") + "</p>" : "") +
      "</header>");
    parts.push("<nav class=\"toc\" aria-label=\"Contents\"><h2>Contents</h2><ol>" +
      toc.filter(function (t) { return t.level <= 2; }).map(function (t) {
        return '<li class="toc-' + t.kind + '"><a href="#' + U.escapeHtml(String(t.key)) + '">' + U.escapeHtml(t.label) + "</a></li>";
      }).join("") + "</ol></nav>");
    matterSections(book).forEach(function (m) {
      if (m.id === "toc") return;
      parts.push('<section class="matter" id="' + U.escapeHtml(m.id) + '"><h2 class="matter-title">' + U.escapeHtml(m.name) + "</h2>" + (U.sanitizeHtml(m.content) || "") + "</section>");
    });
    (book.parts || []).forEach(function (part) {
      var chapters = (book.chapters || []).filter(function (c) { return c.partId === part.id; });
      if (!chapters.length) return;
      parts.push('<section class="part" id="' + U.escapeHtml(part.id) + '"><h1 class="part-title">' + U.escapeHtml(part.title) + "</h1>");
      chapters.forEach(function (ch) { parts.push(chapterSection(ch)); });
      parts.push("</section>");
    });
    (book.chapters || []).filter(function (c) { return !c.partId; }).forEach(function (ch) { parts.push(chapterSection(ch)); });
    backSections(book).forEach(function (m) {
      var extra = "";
      if (m.id === "bibliography" || m.id === "references") {
        var list = BF.model.bibliography(book, book.settings.citationStyle || "apa");
        extra = list.length ? "<ol class=\"bibliography\">" + list.map(function (p) { return "<li>" + U.escapeHtml(p.text) + "</li>"; }).join("") + "</ol>" : "<p><em>No sources entered yet.</em></p>";
      } else extra = U.sanitizeHtml(m.content || "");
      parts.push('<section class="matter" id="' + U.escapeHtml(m.id) + '"><h2 class="matter-title">' + U.escapeHtml(m.name) + "</h2>" + extra + "</section>");
    });
    parts.push("<footer class=\"book-foot\"><p>" + U.escapeHtml(book.author || "") + " · " + U.escapeHtml(book.copyrightYear || "") + " · " + stats.words + " words</p></footer>");
    parts.push("</body>\n</html>");
    return parts.join("\n");
  }

  function chapterSection(ch) {
    return '<section class="chapter" id="' + U.escapeHtml(ch.id) + '"><h2 class="chapter-title">' + U.escapeHtml(ch.title) + "</h2>" +
      U.sanitizeHtml(ch.content || "") + "</section>";
  }

  var HTML_BOOK_CSS = [
    ":root { color-scheme: light dark; }",
    "body { margin: 0 auto; max-width: 46rem; padding: 3rem 1.25rem 6rem; font: 18px/1.7 Georgia, 'Times New Roman', serif; color: #1c1c1c; background: #fffdf8; }",
    "h1, h2, h3 { font-family: Georgia, serif; line-height: 1.25; }",
    ".book-head { text-align: center; margin-bottom: 3rem; }",
    ".book-title { font-size: 2.4rem; margin-bottom: .3rem; }",
    ".book-subtitle { font-style: italic; color: #555; margin-top: 0; }",
    ".book-author { text-transform: uppercase; letter-spacing: .1em; margin-top: 1.4rem; }",
    ".book-publisher { color: #666; font-size: .9rem; }",
    ".toc { border: 1px solid #e2d9c5; padding: 1rem 1.4rem; background: #fbf7ec; }",
    ".toc ol { margin: 0; padding-left: 1.2rem; }",
    ".toc li { margin: .2rem 0; }",
    ".toc a { color: #6b5320; text-decoration: none; }",
    ".toc a:hover { text-decoration: underline; }",
    ".chapter, .matter, .part { margin-top: 3.2rem; }",
    ".chapter-title, .matter-title { border-bottom: 1px solid #e2d9c5; padding-bottom: .4rem; }",
    ".part-title { text-align: center; text-transform: uppercase; letter-spacing: .14em; }",
    "p { margin: 0 0 .9em; }",
    "blockquote { margin: 1.2em 2em; font-style: italic; border-left: 3px solid #ddd2b6; padding-left: 1em; }",
    "figure { margin: 1.4em 0; text-align: center; }",
    "figcaption { font-size: .85rem; color: #5c5c5c; }",
    "img { max-width: 100%; height: auto; }",
    "table { border-collapse: collapse; width: 100%; margin: 1.2em 0; font-size: .95rem; }",
    "th, td { border: 1px solid #c9c0aa; padding: 6px 9px; text-align: left; }",
    "th { background: #f4efe2; }",
    ".bibliography { padding-left: 1.4rem; }",
    ".bibliography li { margin-bottom: .5rem; }",
    ".endnote-block { display: none; }",
    ".book-foot { margin-top: 4rem; border-top: 1px solid #e2d9c5; padding-top: 1rem; font-size: .85rem; color: #666; text-align: center; }",
    "@media print { body { max-width: none; padding: 0; font-size: 11pt; } .toc { border: 0; background: none; } section { break-before: page; } .book-head { break-after: page; } }",
    "@media (prefers-color-scheme: dark) { body { background: #14130f; color: #ece6d9; } .toc { background: #1b1915; border-color: #33302a; } .chapter-title, .matter-title { border-color: #33302a; } th { background: #23211b; } th, td { border-color: #3c382f; } .book-foot { border-color: #33302a; } .toc a { color: #d9c48f; } }"
  ].join("\n");

  /* ============================================================== Markdown */
  function inlineMd(node) {
    var out = "";
    Array.prototype.forEach.call(node.childNodes, function (n) {
      if (n.nodeType === 3) { out += U.escapeHtmlMd ? U.escapeHtmlMd(n.nodeValue) : n.nodeValue; return; }
      if (n.nodeType !== 1) return;
      var t = n.tagName;
      if (t === "B" || t === "STRONG") out += "**" + inlineMd(n) + "**";
      else if (t === "I" || t === "EM") out += "_" + inlineMd(n) + "_";
      else if (t === "U") out += "<u>" + inlineMd(n) + "</u>";
      else if (t === "S" || t === "STRIKE" || t === "DEL") out += "~~" + inlineMd(n) + "~~";
      else if (t === "SUP") out += "^" + inlineMd(n) + "^";
      else if (t === "SUB") out += "~" + inlineMd(n) + "~";
      else if (t === "A") out += "[" + inlineMd(n) + "](" + (n.getAttribute("href") || "") + ")";
      else if (t === "IMG") out += "![" + (n.getAttribute("alt") || "") + "](" + (n.getAttribute("src") || "") + ")";
      else if (t === "BR") out += "  \n";
      else out += inlineMd(n);
    });
    return out;
  }

  function htmlToMarkdown(html, depth) {
    depth = depth || 0;
    var tpl = document.createElement("template");
    tpl.innerHTML = U.sanitizeHtml(html || "");
    var out = [];
    Array.prototype.forEach.call(tpl.content.childNodes, function (node) {
      if (node.nodeType === 3) {
        if (node.nodeValue.trim()) out.push(node.nodeValue.trim());
        return;
      }
      if (node.nodeType !== 1) return;
      switch (node.tagName) {
        case "H1": out.push("# " + inlineMd(node)); break;
        case "H2": out.push("## " + inlineMd(node)); break;
        case "H3": out.push("### " + inlineMd(node)); break;
        case "H4": out.push("#### " + inlineMd(node)); break;
        case "P": out.push(inlineMd(node)); break;
        case "BLOCKQUOTE": out.push("> " + inlineMd(node).replace(/\n/g, "\n> ")); break;
        case "UL": out.push(Array.prototype.map.call(node.querySelectorAll(":scope > li"), function (li) {
          return "- " + inlineMd(li);
        }).join("\n")); break;
        case "OL": out.push(Array.prototype.map.call(node.querySelectorAll(":scope > li"), function (li, i) {
          return (i + 1) + ". " + inlineMd(li);
        }).join("\n")); break;
        case "HR": out.push("---"); break;
        case "FIGURE": {
          var img = node.querySelector("img");
          var cap = node.querySelector("figcaption");
          if (img) out.push("![" + (img.getAttribute("alt") || (cap ? cap.textContent : "")) + "](" + (img.getAttribute("src") || "") + ")");
          if (cap) out.push("*" + cap.textContent + "*");
          break;
        }
        case "IMG": out.push("![" + (node.getAttribute("alt") || "") + "](" + (node.getAttribute("src") || "") + ")"); break;
        case "TABLE": {
          var rows = node.querySelectorAll("tr");
          if (rows.length) {
            var md = [];
            Array.prototype.forEach.call(rows, function (tr, ri) {
              var cells = Array.prototype.map.call(tr.children, function (td) { return inlineMd(td).replace(/\|/g, "\\|"); });
              md.push("| " + cells.join(" | ") + " |");
              if (ri === 0) md.push("| " + cells.map(function () { return "---"; }).join(" | ") + " |");
            });
            out.push(md.join("\n"));
          }
          break;
        }
        case "DIV":
          if (node.classList.contains("endnote-block")) {
            out.push("**Notes**");
            Array.prototype.forEach.call(node.querySelectorAll("li"), function (li, i) { out.push((i + 1) + ". " + inlineMd(li)); });
          } else out.push(htmlToMarkdown(node.innerHTML, depth));
          break;
        default: out.push(inlineMd(node));
      }
    });
    return out.filter(function (s) { return s !== ""; }).join("\n\n");
  }

  function buildMarkdown(book) {
    var out = [];
    out.push("# " + (book.title || "Untitled book"));
    if (book.subtitle) out.push("*" + book.subtitle + "*");
    if (book.author) out.push("**" + book.author + "**");
    var meta = [];
    if (book.coAuthors) meta.push("Co-authors: " + book.coAuthors);
    if (book.publisher) meta.push("Publisher: " + book.publisher);
    if (book.edition) meta.push("Edition: " + book.edition);
    if (book.copyrightYear) meta.push("Copyright: " + book.copyrightYear);
    if (book.isbn) meta.push("ISBN (author-supplied): " + book.isbn);
    if (meta.length) out.push(meta.join("  \n"));
    out.push("## Contents");
    out.push(BF.model.buildToc(book).filter(function (t) { return t.level <= 2; }).map(function (t) {
      return "- " + t.label;
    }).join("\n"));
    matterSections(book).forEach(function (m) {
      if (m.id === "titlePage" || m.id === "copyright") return;
      out.push("## " + m.name);
      if (m.content) out.push(htmlToMarkdown(m.content));
    });
    (book.chapters || []).forEach(function (ch) {
      out.push("## " + (ch.title || "Untitled chapter"));
      if (ch.content) out.push(htmlToMarkdown(ch.content));
    });
    backSections(book).forEach(function (m) {
      out.push("## " + m.name);
      if (m.id === "bibliography" || m.id === "references") {
        var list = BF.model.bibliography(book, book.settings.citationStyle || "apa");
        out.push(list.length ? list.map(function (p, i) {
          return (book.settings.citationStyle === "ieee" ? "[" + (i + 1) + "] " : "") + p.text;
        }).join("\n\n") : "_No sources have been entered yet._");
      } else if (m.content) out.push(htmlToMarkdown(m.content));
    });
    return out.join("\n\n") + "\n";
  }

  /* ============================================================ Plain text */
  function buildTxt(book) {
    var sep = "\n\n" + "=".repeat(60) + "\n\n";
    var out = [];
    out.push((book.title || "Untitled book").toUpperCase());
    if (book.subtitle) out.push(book.subtitle);
    if (book.author) out.push("by " + book.author);
    out.push("");
    matterSections(book).forEach(function (m) {
      out.push(sep);
      out.push(m.name.toUpperCase());
      out.push("");
      out.push(U.stripHtml(m.content || ""));
    });
    (book.parts || []).forEach(function (part) {
      var chapters = (book.chapters || []).filter(function (c) { return c.partId === part.id; });
      if (!chapters.length) return;
      out.push(sep);
      out.push(part.title.toUpperCase());
      chapters.forEach(function (ch) { pushChapterTxt(out, ch); });
    });
    (book.chapters || []).filter(function (c) { return !c.partId; }).forEach(function (ch) { pushChapterTxt(out, ch); });
    backSections(book).forEach(function (m) {
      out.push(sep);
      out.push(m.name.toUpperCase());
      out.push("");
      if (m.id === "bibliography" || m.id === "references") {
        out.push(BF.model.bibliography(book, book.settings.citationStyle || "apa").map(function (p) { return p.text; }).join("\n\n"));
      } else out.push(U.stripHtml(m.content || ""));
    });
    out.push("\n" + "-".repeat(40));
    out.push("Exported from BookForge Studio · " + new Date().toLocaleString());
    return out.join("\n");
  }

  function pushChapterTxt(out, ch) {
    out.push("\n\n" + ch.title.toUpperCase() + "\n" + "-".repeat(Math.max(8, ch.title.length)));
    out.push("");
    out.push(U.stripHtml(ch.content || "").replace(/\n{3,}/g, "\n\n").trim());
  }

  /* ============================================================= preflight */
  function preflight(book) {
    var technical = [];
    var editorial = [];
    var stats = BF.model.stats(book);
    var chapters = book.chapters || [];

    if (!book.title || !book.title.trim()) technical.push({ level: "error", message: "The book has no title. A title is required for every export format." });
    if (!book.author || !book.author.trim()) technical.push({ level: "warn", message: "No author name is set. Exports will show no author." });
    if (!book.language) technical.push({ level: "warn", message: "No language is set. EPUB will default to English." });
    if (!book.publisher) technical.push({ level: "info", message: "No publisher or imprint is set (optional)." });
    if (!book.isbn) technical.push({ level: "info", message: "No ISBN supplied. BookForge never generates or registers ISBNs for you." });
    if (!book.copyrightYear) technical.push({ level: "warn", message: "Copyright year is empty; the copyright page template will omit it." });

    var empty = chapters.filter(function (c) { return !U.stripHtml(c.content || "").trim(); });
    if (empty.length) technical.push({ level: "warn", message: empty.length + " chapter(s) are empty: " + empty.slice(0, 5).map(function (c) { return c.title; }).join(", ") + (empty.length > 5 ? "…" : "") });

    var missingImages = 0;
    var brokenLinks = 0;
    var noAlt = 0;
    chapters.forEach(function (ch) {
      var tpl = document.createElement("template");
      tpl.innerHTML = ch.content || "";
      Array.prototype.forEach.call(tpl.content.querySelectorAll("img"), function (img) {
        var src = img.getAttribute("src") || "";
        if (!src) missingImages++;
        if (!img.getAttribute("alt")) noAlt++;
      });
      Array.prototype.forEach.call(tpl.content.querySelectorAll("a[href]"), function (a) {
        var href = a.getAttribute("href") || "";
        if (!href || href === "#" || /^javascript:/i.test(href)) brokenLinks++;
      });
    });
    if (missingImages) technical.push({ level: "error", message: missingImages + " image(s) have no source and will not be exported." });
    if (noAlt) technical.push({ level: "warn", message: noAlt + " image(s) have no alternative text (accessibility)." });
    if (brokenLinks) technical.push({ level: "warn", message: brokenLinks + " link(s) are empty or broken." });

    var unresolved = (book.comments || []).filter(function (c) { return c.status !== "resolved"; });
    if (unresolved.length) editorial.push({ level: "warn", message: unresolved.length + " editorial comment(s) are still unresolved." });

    var uncited = (book.sources || []).filter(function (s) { return !s.title; });
    if (uncited.length) editorial.push({ level: "warn", message: uncited.length + " research source(s) have no title and cannot be cited correctly." });

    if (book.targetWords && stats.words < book.targetWords * 0.5) {
      editorial.push({ level: "info", message: "The manuscript is at " + Math.round(stats.progress * 100) + "% of the target word count." });
    }
    if (!(book.sources || []).length) editorial.push({ level: "info", message: "No research sources or references have been entered." });

    return {
      technical: technical,
      editorial: editorial,
      stats: stats,
      note: "Technical checks are automated. Editorial, factual and legal review remain the author's and publisher's responsibility — passing these checks does not verify scholarly accuracy."
    };
  }

  BF.exporters = {
    buildDocx: buildDocx,
    buildEpub: buildEpub,
    buildHtml: buildHtml,
    buildMarkdown: buildMarkdown,
    buildTxt: buildTxt,
    buildJson: function (book) { return JSON.stringify(BF.storage.exportProject(book), null, 2); },
    preflight: preflight,
    deepStats: BF.model.stats
  };
})();
