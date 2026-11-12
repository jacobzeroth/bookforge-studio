/* BookForge Studio — domain model: books, templates, outline, citations, stats. */
(function () {
  "use strict";
  var BF = (window.BF = window.BF || {});
  var U = BF.util;

  /* ------------------------------------------------------------ templates */
  var TEMPLATES = [
    {
      id: "blank", name: "Blank manuscript", kind: "Nonfiction",
      blurb: "A clean start: front matter, one part and a first chapter.",
      chapters: ["Chapter 1"], targetWords: 60000, design: "minimal-academic",
      front: { titlePage: true, copyright: true, toc: true }, back: { aboutAuthor: true }
    },
    {
      id: "academic-textbook", name: "Academic textbook", kind: "Textbook",
      blurb: "Units with learning objectives, discussion questions and further reading.",
      chapters: ["Foundations and Orientation", "Core Concepts", "Methods and Practice", "Applications and Case Studies", "Review, Assessment and Discussion"],
      targetWords: 90000, design: "minimal-academic",
      front: { halfTitle: true, titlePage: true, copyright: true, preface: true, toc: true, listFigures: true, listTables: true },
      back: { conclusion: true, appendices: true, glossary: true, bibliography: true, references: true, index: true }
    },
    {
      id: "educational-handbook", name: "Educational handbook", kind: "Handbook",
      blurb: "Practical handbook for educators with activities and summaries.",
      chapters: ["Introduction and How to Use This Handbook", "Planning and Preparation", "Classroom Practice", "Assessment and Feedback", "Reflection and Next Steps"],
      targetWords: 45000, design: "educational-textbook",
      front: { titlePage: true, copyright: true, preface: true, toc: true },
      back: { appendices: true, glossary: true, furtherReading: true, aboutAuthor: true }
    },
    {
      id: "business-book", name: "Business book", kind: "Business",
      blurb: "Frameworks, case examples and action steps for professional readers.",
      chapters: ["The Case for Change", "Diagnosing the Situation", "The Framework", "Implementation Playbook", "Measuring Results", "Leading Beyond the Launch"],
      targetWords: 50000, design: "modern-business",
      front: { halfTitle: true, titlePage: true, copyright: true, toc: true },
      back: { conclusion: true, appendices: true, aboutAuthor: true }
    },
    {
      id: "self-development", name: "Self-development book", kind: "Self-help",
      blurb: "Principles, exercises and reflection prompts in a warm voice.",
      chapters: ["Where You Are Now", "The Mindset Shift", "Daily Practice", "Obstacles and Setbacks", "Sustaining Change"],
      targetWords: 40000, design: "luxury-nonfiction",
      front: { titlePage: true, copyright: true, dedication: true, toc: true },
      back: { conclusion: true, furtherReading: true, aboutAuthor: true }
    },
    {
      id: "fiction", name: "Fiction / novel", kind: "Fiction",
      blurb: "Parts and chapters for narrative writing, with scene-oriented structure.",
      chapters: ["Part One", "Chapter 1", "Chapter 2", "Chapter 3", "Part Two", "Chapter 4", "Chapter 5"],
      targetWords: 80000, design: "classic-literary",
      front: { halfTitle: true, titlePage: true, copyright: true, dedication: true, epigraph: true, toc: true },
      back: { aboutAuthor: true }
    },
    {
      id: "nonfiction", name: "General nonfiction", kind: "Nonfiction",
      blurb: "Idea-driven chapters with introduction and conclusion.",
      chapters: ["Introduction", "Chapter 1", "Chapter 2", "Chapter 3", "Chapter 4", "Conclusion"],
      targetWords: 60000, design: "luxury-nonfiction",
      front: { titlePage: true, copyright: true, toc: true },
      back: { aboutAuthor: true, furtherReading: true }
    },
    {
      id: "research-publication", name: "Research publication", kind: "Research",
      blurb: "Abstract-led structure with methodology, findings and references.",
      chapters: ["Abstract", "Introduction", "Literature Review", "Methodology", "Findings", "Discussion", "Conclusion"],
      targetWords: 35000, design: "minimal-academic",
      front: { titlePage: true, copyright: true, toc: true, listTables: true, listFigures: true },
      back: { references: true, appendices: true, index: true }
    },
    {
      id: "workbook", name: "Workbook", kind: "Workbook",
      blurb: "Modules with exercises, worksheets and space for learner notes.",
      chapters: ["Getting Started", "Module 1: Foundations", "Module 2: Practice", "Module 3: Application", "Module 4: Review", "Final Reflection"],
      targetWords: 25000, design: "workbook",
      front: { titlePage: true, copyright: true, toc: true },
      back: { glossary: true, appendices: true, aboutAuthor: true }
    },
    {
      id: "training-manual", name: "Training manual", kind: "Manual",
      blurb: "Procedures, checklists and competency assessments for teams.",
      chapters: ["Purpose and Scope", "Roles and Responsibilities", "Procedure: Step by Step", "Safety and Compliance", "Assessment and Certification"],
      targetWords: 30000, design: "training-manual",
      front: { titlePage: true, copyright: true, toc: true },
      back: { appendices: true, glossary: true, index: true }
    },
    {
      id: "memoir", name: "Memoir", kind: "Memoir",
      blurb: "Reflective narrative structure with a prologue and epilogue.",
      chapters: ["Prologue", "Chapter 1", "Chapter 2", "Chapter 3", "Chapter 4", "Epilogue"],
      targetWords: 65000, design: "classic-literary",
      front: { halfTitle: true, titlePage: true, copyright: true, dedication: true, epigraph: true, toc: true },
      back: { aboutAuthor: true }
    }
  ];

  var TRIM_SIZES = [
    { id: "a4", name: "A4 (210 × 297 mm)", w: 210, h: 297, unit: "mm" },
    { id: "a5", name: "A5 (148 × 210 mm)", w: 148, h: 210, unit: "mm" },
    { id: "letter", name: "US Letter (8.5 × 11 in)", w: 215.9, h: 279.4, unit: "mm" },
    { id: "6x9", name: "Trade 6 × 9 in", w: 152.4, h: 228.6, unit: "mm" },
    { id: "5.5x8.5", name: "Digest 5.5 × 8.5 in", w: 139.7, h: 215.9, unit: "mm" },
    { id: "custom", name: "Custom size", w: 210, h: 297, unit: "mm" }
  ];

  var DESIGN_TEMPLATES = [
    { id: "minimal-academic", name: "Minimal academic", bodyFont: "Georgia", headingFont: "Georgia", indent: true, lineHeight: 1.5, chapterOpeners: false, runningHead: true, tableStyle: "rules" },
    { id: "classic-literary", name: "Classic literary", bodyFont: "Georgia", headingFont: "Georgia", indent: true, lineHeight: 1.6, chapterOpeners: true, runningHead: true, tableStyle: "rules", dropCap: true },
    { id: "luxury-nonfiction", name: "Luxury nonfiction", bodyFont: "Georgia", headingFont: "Georgia", indent: false, lineHeight: 1.7, chapterOpeners: true, runningHead: true, tableStyle: "zebra" },
    { id: "modern-business", name: "Modern business", bodyFont: "Segoe UI", headingFont: "Segoe UI", indent: false, lineHeight: 1.55, chapterOpeners: false, runningHead: false, tableStyle: "zebra" },
    { id: "educational-textbook", name: "Educational textbook", bodyFont: "Georgia", headingFont: "Segoe UI", indent: false, lineHeight: 1.6, chapterOpeners: true, runningHead: true, tableStyle: "rules" },
    { id: "workbook", name: "Workbook", bodyFont: "Segoe UI", headingFont: "Segoe UI", indent: false, lineHeight: 1.8, chapterOpeners: true, runningHead: false, tableStyle: "boxed" },
    { id: "training-manual", name: "Professional training manual", bodyFont: "Segoe UI", headingFont: "Segoe UI", indent: false, lineHeight: 1.65, chapterOpeners: true, runningHead: true, tableStyle: "boxed" }
  ];

  var CITATION_STYLES = [
    { id: "apa", name: "APA (7th)" },
    { id: "mla", name: "MLA (9th)" },
    { id: "chicago", name: "Chicago (17th)" },
    { id: "ieee", name: "IEEE" }
  ];

  var SOURCE_TYPES = ["Book", "Journal article", "Chapter in edited book", "Conference paper", "Thesis", "Report", "Web page", "News article", "Dataset", "Other"];

  var FRONT_MATTER = [
    { id: "halfTitle", name: "Half title" },
    { id: "titlePage", name: "Title page" },
    { id: "copyright", name: "Copyright page" },
    { id: "dedication", name: "Dedication" },
    { id: "epigraph", name: "Epigraph" },
    { id: "preface", name: "Preface" },
    { id: "foreword", name: "Foreword" },
    { id: "acknowledgements", name: "Acknowledgements" },
    { id: "toc", name: "Table of contents" },
    { id: "listFigures", name: "List of figures" },
    { id: "listTables", name: "List of tables" }
  ];

  var BACK_MATTER = [
    { id: "conclusion", name: "Conclusion" },
    { id: "appendices", name: "Appendices" },
    { id: "glossary", name: "Glossary" },
    { id: "bibliography", name: "Bibliography" },
    { id: "references", name: "References" },
    { id: "endnotes", name: "Endnotes" },
    { id: "index", name: "Index" },
    { id: "authorBio", name: "About the author" },
    { id: "furtherReading", name: "Further reading" }
  ];

  var NOTE_TYPES = ["Research note", "Character profile", "Topic note", "Chapter idea", "Quotation", "Research question", "To-do", "Reminder"];

  var MANUSCRIPT_FORMATS = ["Prose", "Academic", "Workbook", "Manual", "Mixed"];
  var CATEGORIES = ["Fiction", "Nonfiction", "Academic", "Business", "Self-help", "Education", "Research", "Memoir", "Other"];
  var LANGUAGES = ["English", "Hindi", "Malayalam", "Tamil", "Telugu", "Kannada", "Bengali", "Marathi", "Spanish", "French", "German", "Other"];

  /* --------------------------------------------------------------- factory */
  function defaultDesign(templateId) {
    var t = DESIGN_TEMPLATES.filter(function (d) { return d.id === templateId; })[0] || DESIGN_TEMPLATES[0];
    return {
      template: t.id,
      trim: "a4",
      customWidth: 210,
      customHeight: 297,
      margins: { top: 20, bottom: 20, inside: 22, outside: 16 },
      gutter: 0,
      header: { enabled: true, left: "{title}", right: "{chapter}" },
      footer: { enabled: true, left: "", center: "{page}", right: "" },
      runningHead: t.runningHead,
      chapterOpeners: t.chapterOpeners,
      dropCap: !!t.dropCap,
      bodyFont: t.bodyFont,
      headingFont: t.headingFont,
      bodySize: 11,
      lineHeight: t.lineHeight,
      firstLineIndent: t.indent,
      paragraphSpacing: 0,
      justify: true,
      widowOrphans: true,
      tableStyle: t.tableStyle,
      hyphens: true
    };
  }

  function defaultMatter(template) {
    var front = {}, back = {};
    FRONT_MATTER.forEach(function (m) {
      var on = template && template.front ? !!template.front[m.id] : false;
      front[m.id] = { enabled: on, content: "" };
    });
    BACK_MATTER.forEach(function (m) {
      var on = template && template.back ? !!template.back[m.id] : false;
      back[m.id] = { enabled: on, content: "" };
    });
    return { front: front, back: back };
  }

  function createChapter(title, opts) {
    opts = opts || {};
    var now = Date.now();
    return {
      id: U.uid("ch"),
      title: title || "Untitled chapter",
      content: "",
      partId: opts.partId || null,
      matter: opts.matter || null, // 'front' | 'back' | null
      matterKey: opts.matterKey || null,
      status: "draft",
      order: opts.order == null ? 0 : opts.order,
      createdAt: now,
      updatedAt: now
    };
  }

  function createBook(input) {
    input = input || {};
    var template = TEMPLATES.filter(function (t) { return t.id === input.template; })[0] || TEMPLATES[0];
    var now = Date.now();
    var book = {
      id: U.uid("book"),
      schema: 1,
      title: input.title || "Untitled book",
      subtitle: input.subtitle || "",
      author: input.author || "",
      coAuthors: input.coAuthors || "",
      category: input.category || template.kind || "",
      language: input.language || "English",
      audience: input.audience || "",
      purpose: input.purpose || "",
      publisher: input.publisher || "",
      edition: input.edition || "",
      copyrightYear: input.copyrightYear || String(new Date().getFullYear()),
      isbn: input.isbn || "",
      targetWords: Number(input.targetWords || template.targetWords || 0),
      manuscriptFormat: input.manuscriptFormat || (template.kind === "Textbook" ? "Academic" : "Prose"),
      template: template.id,
      createdAt: now,
      updatedAt: now,
      archived: false,
      trashed: false,
      settings: {
        theme: input.theme || "dark",
        citationStyle: input.citationStyle || "apa"
      },
      design: defaultDesign(template.design),
      parts: [],
      chapters: [],
      matter: defaultMatter(template),
      notes: [],
      sources: [],
      assets: [],
      comments: [],
      trashChapters: [],
      goals: { dailyTarget: 500, deadline: "" }
    };
    (template.chapters || ["Chapter 1"]).forEach(function (t, i) {
      book.chapters.push(createChapter(t, { order: i + 1 }));
    });
    return book;
  }

  /* ------------------------------------------------------------- geometry */
  function trimOf(design) {
    var t = TRIM_SIZES.filter(function (x) { return x.id === design.trim; })[0];
    if (!t) t = TRIM_SIZES[0];
    if (t.id === "custom") return { w: Number(design.customWidth) || 152.4, h: Number(design.customHeight) || 228.6, unit: "mm" };
    return { w: t.w, h: t.h, unit: t.unit };
  }

  function designTemplate(id) {
    return DESIGN_TEMPLATES.filter(function (t) { return t.id === id; })[0] || DESIGN_TEMPLATES[0];
  }

  /* ---------------------------------------------------------------- stats */
  function chapterWords(ch) { return U.countWords(U.stripHtml(ch.content || "")); }

  function stats(book) {
    if (!book) return { words: 0, chars: 0, chapters: 0, written: 0, readingMinutes: 0, progress: 0 };
    var words = 0, chars = 0, written = 0;
    (book.chapters || []).forEach(function (ch) {
      var text = U.stripHtml(ch.content || "");
      var w = U.countWords(text);
      words += w;
      chars += text.length;
      if (w > 0) written++;
    });
    (Object.keys(book.matter.front || {})).forEach(function (k) {
      var m = book.matter.front[k];
      if (m && m.enabled && m.content) { words += U.countWords(U.stripHtml(m.content)); chars += U.stripHtml(m.content).length; }
    });
    (Object.keys(book.matter.back || {})).forEach(function (k) {
      var m = book.matter.back[k];
      if (m && m.enabled && m.content) { words += U.countWords(U.stripHtml(m.content)); chars += U.stripHtml(m.content).length; }
    });
    return {
      words: words,
      chars: chars,
      chapters: (book.chapters || []).length,
      written: written,
      readingMinutes: U.readingMinutes(words),
      progress: book.targetWords ? Math.min(1, words / book.targetWords) : 0
    };
  }

  /* -------------------------------------------------------------- headings */
  function headingsFromHtml(html) {
    var out = [];
    if (!html) return out;
    var tpl = document.createElement("template");
    tpl.innerHTML = html;
    var nodes = tpl.content.querySelectorAll("h1,h2,h3,h4");
    Array.prototype.forEach.call(nodes, function (n) {
      out.push({ level: Number(n.tagName.slice(1)), text: (n.textContent || "").trim() });
    });
    return out;
  }

  function buildToc(book) {
    var entries = [];
    FRONT_MATTER.forEach(function (m) {
      var st = book.matter.front[m.id];
      if (st && st.enabled && (st.content || m.id === "titlePage" || m.id === "copyright" || m.id === "toc")) {
        entries.push({ label: m.name, kind: "front", key: m.id, level: 1, chapterId: null });
      }
    });
    var byPart = U.groupBy(book.chapters || [], function (c) { return c.partId || ""; });
    (book.parts || []).forEach(function (p) {
      entries.push({ label: p.title, kind: "part", key: p.id, level: 1, chapterId: null });
      (byPart[p.id] || []).forEach(function (ch) { pushChapter(entries, ch, 2); });
    });
    (byPart[""] || []).forEach(function (ch) { pushChapter(entries, ch, 1); });
    BACK_MATTER.forEach(function (m) {
      var st = book.matter.back[m.id];
      if (st && st.enabled && (st.content || m.id === "bibliography" || m.id === "references")) {
        entries.push({ label: m.name, kind: "back", key: m.id, level: 1, chapterId: null });
      }
    });
    return entries;
  }

  function pushChapter(entries, ch, level) {
    entries.push({ label: ch.title, kind: "chapter", key: ch.id, level: level, chapterId: ch.id });
    headingsFromHtml(ch.content).filter(function (h) { return h.level <= 3; }).forEach(function (h) {
      entries.push({ label: h.text, kind: "heading", key: ch.id, level: level + h.level, chapterId: ch.id, heading: h.text });
    });
  }

  /* ------------------------------------------------------------ citations */
  function authorString(source) {
    return (source && source.authors ? String(source.authors).trim() : "") || "";
  }

  function clean(text) {
    return String(text == null ? "" : text).replace(/\s+/g, " ").trim();
  }

  function ensurePeriod(s) {
    s = clean(s);
    if (!s) return "";
    return /[.!?]$/.test(s) ? s : s + ".";
  }

  function formatCitation(source, style, index) {
    var a = authorString(source);
    var title = clean(source.title || "");
    var year = clean(source.year || "");
    var publisher = clean(source.publisher || "");
    var doi = clean(source.doi || "");
    var url = clean(source.url || "");
    var pages = clean(source.pages || "");
    var accessed = clean(source.accessed || "");
    var parts = [];

    if (style === "apa") {
      if (a) parts.push(ensurePeriod(a));
      var yt = year ? "(" + year + ")." : "";
      if (yt) parts.push(yt);
      if (title) parts.push(ensurePeriod(source.type === "Book" || !source.type ? title : title));
      if (publisher) parts.push(ensurePeriod(publisher));
      if (pages) parts.push("pp. " + pages + ".");
      if (doi) parts.push("https://doi.org/" + doi.replace(/^https?:\/\/doi\.org\//, ""));
      else if (url) parts.push(url);
    } else if (style === "mla") {
      if (a) parts.push(ensurePeriod(a));
      if (title) parts.push(ensurePeriod('"' + title + '"'));
      if (publisher) parts.push(publisher + (year ? ", " + year : "") + ".");
      else if (year) parts.push(year + ".");
      if (pages) parts.push("pp. " + pages + ".");
      if (doi) parts.push("doi:" + doi.replace(/^https?:\/\/doi\.org\//, "") + ".");
      else if (url) parts.push("Web. " + (accessed ? accessed + ". " : "") + url + ".");
    } else if (style === "chicago") {
      if (a) parts.push(ensurePeriod(a));
      if (title) parts.push(ensurePeriod('"' + title + '"'));
      if (publisher) parts.push(publisher + (year ? ", " + year : "") + ".");
      else if (year) parts.push(year + ".");
      if (pages) parts.push(pages + ".");
      if (doi) parts.push("https://doi.org/" + doi.replace(/^https?:\/\/doi\.org\//, "") + ".");
      else if (url) parts.push(url + ".");
    } else { /* ieee */
      var n = index == null ? "" : "[" + index + "] ";
      var head = n + (a ? a + ", " : "");
      if (title) head += '"' + title + '," ';
      if (publisher) head += publisher + ", ";
      if (year) head += year + ".";
      parts.push(head.replace(/,\s*$/, "."));
      if (pages) parts.push("pp. " + pages + ".");
      if (doi) parts.push("doi: " + doi.replace(/^https?:\/\/doi\.org\//, "") + ".");
      else if (url) parts.push("Available: " + url + ".");
    }
    return clean(parts.join(" ")).replace(/\s+([.,])/g, "$1").replace(/\.\./g, ".").replace(/\s+\./g, ".");
  }

  function formatInText(source, style, index, locator) {
    var a = authorString(source);
    var surname = a ? a.split(/[,;]/)[0].trim().split(/\s+/).slice(-1)[0] : "";
    var year = clean(source.year || "");
    var loc = locator ? clean(locator) : "";
    if (style === "mla") return "(" + (surname || "Unknown") + (loc ? " " + loc : "") + ")";
    if (style === "ieee") return "[" + (index || "?") + "]";
    if (style === "chicago") return "(" + (surname || "Unknown") + (year ? " " + year : "") + (loc ? ", " + loc : "") + ")";
    return "(" + (surname || "Unknown") + (year ? ", " + year : "") + (loc ? ", p. " + loc : "") + ")";
  }

  function bibliography(book, style) {
    var sources = (book.sources || []).slice();
    return sources.map(function (s, i) {
      return { source: s, text: formatCitation(s, style || "apa", i + 1) };
    });
  }

  function citedIds(book) {
    var ids = {};
    (book.chapters || []).forEach(function (ch) {
      var m = String(ch.content || "").match(/data-source-id="([^"]+)"/g);
      if (m) m.forEach(function (x) { ids[x.replace(/.*data-source-id="|"/g, "")] = true; });
    });
    return Object.keys(ids);
  }

  /* -------------------------------------------------------------- module */
  BF.model = {
    TEMPLATES: TEMPLATES, TRIM_SIZES: TRIM_SIZES, DESIGN_TEMPLATES: DESIGN_TEMPLATES,
    CITATION_STYLES: CITATION_STYLES, SOURCE_TYPES: SOURCE_TYPES,
    FRONT_MATTER: FRONT_MATTER, BACK_MATTER: BACK_MATTER, NOTE_TYPES: NOTE_TYPES,
    MANUSCRIPT_FORMATS: MANUSCRIPT_FORMATS, CATEGORIES: CATEGORIES, LANGUAGES: LANGUAGES,
    createBook: createBook, createChapter: createChapter, defaultDesign: defaultDesign,
    defaultMatter: defaultMatter, trimOf: trimOf, designTemplate: designTemplate,
    chapterWords: chapterWords, stats: stats,
    headingsFromHtml: headingsFromHtml, buildToc: buildToc,
    formatCitation: formatCitation, formatInText: formatInText, bibliography: bibliography,
    citedIds: citedIds
  };
})();
