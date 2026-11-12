# BookForge Studio

A local-first, professional book writing, editing and production workspace. Plan the
book, write in a real rich-text manuscript editor, keep research and references,
produce paginated print proofs, run editorial checks and export genuine DOCX, EPUB 3,
HTML, Markdown, TXT and JSON files.

Nothing is stored in the cloud. Books live in your browser's IndexedDB (with a
localStorage or in-memory fallback), and exports are generated on your machine.

---

## Quick start

No dependencies, no build step, no CDN.

**Recommended — local server**

```powershell
node server.mjs
# open http://localhost:4173/
```

Change the port with an argument or environment variable:

```powershell
node server.mjs 8080
$env:PORT = "8080"; node server.mjs
```

**Directly from disk** — opening `index.html` in a modern browser also works
(`file://`). IndexedDB, exports and downloads are fully client-side.

**Requirements**

- Node.js 18+ (only for `server.mjs` and the tests)
- A current Chromium, Firefox or Edge browser for the app itself

### Environment

The app has no server-side configuration and no secrets. Optional variables:

| Variable | Used by | Default | Purpose |
|---|---|---|---|
| `PORT` | `server.mjs` | `4173` | Static server port |
| `BF_TEST_PORT` | `tests/e2e.mjs` | `4189` | Port for the test static server |
| `BF_DEBUG_PORT` | `tests/e2e.mjs` | `9229` | CDP debugging port for the test browser |
| `BOOKFORGE_BROWSER` | `tests/e2e.mjs` | auto-detect | Full path to `msedge.exe`/`chrome.exe` |

No API keys are read from the environment. AI assistance is opt-in and only talks to
an endpoint **you** configure in Settings; there is no bundled key or model.

---

## What is implemented

### Writing workspace

- **Dashboard / All books / Recent projects** with honest word counts and storage mode.
- **New book wizard** (3 steps): 11 templates (blank manuscript, academic textbook,
  educational handbook, business book, self-development, fiction/novel, general
  nonfiction, research publication, workbook, training manual, memoir), plus title,
  author, category, language, audience, purpose, publisher, edition, copyright year,
  target words and trim size.
- **Manuscript editor** built on a real contenteditable surface:
  - headings, bold/italic/underline/strikethrough, lists, block quotes, alignment,
    links, images, tables, horizontal rules, page/section breaks
  - footnotes (collected into an endnotes block), captions, citations
  - find & next, replace current, replace all
  - paste sanitising and file-drop images (stored as data URLs)
  - double-click any manuscript image to resize, compress, rotate, convert JPEG/WebP/PNG
    and set its display width on the page
  - keyboard shortcuts, typewriter/focus/reading modes
  - autosave with an honest save indicator (`Saved`, `Saving…`, `Unsaved changes`,
    `Save failed — click to retry`).
- **Draft / Pages manuscript views**: the Draft bar shows the page at the cursor within the
  current chapter, the current page size, and the chapter word count; the sidebar hosts a
  vertical page-progress track that follows the cursor page in Draft and the page scrolled
  into view in Pages; Pages
  renders a read-only proof of the whole book at the real trim size, fits complete pages
  on screen, highlights the current chapter,
  shows page numbers, chapter titles and page word counts, and hands any page back to
  its chapter in Draft. The proof uses the same measurement engine as print and Design
  studio; it is a paginated preview, not a second editable copy of the manuscript.
- **Clean up & format** (local, on-device): collapse repeated spaces, fix punctuation
  spacing, convert straight quotes and apostrophes, capitalize sentence starts
  conservatively, normalize ellipses and double hyphens, trim paragraph edges and remove
  empty paragraphs. A live diff shows exactly what will change; applying to the current
  chapter or all chapters always saves a named **Before clean-up** version first. Code,
  page breaks and section breaks are left intact. Paragraph spacing, first-line indent
  and justification stay in Design studio.
- **Outline** with parts and chapters, drag-and-drop reordering (keyboard-accessible
  move buttons), and headings derived from the actual chapter HTML.
- **Chapters** table: rename, duplicate, status, move to trash, open.
- **Notes** with types and pinning; **Research library** with filters and links to
  chapters; **References** with source types, APA/MLA/Chicago/IEEE formatting,
  in-text citations, bibliography generation and citation insertion into the text.
- **Assets** library with a real image editor: resize with an aspect lock, presets,
  rotate, convert between JPEG/WebP/PNG, adjust quality, compare original/new file
  size before applying, replace the asset (updating every manuscript copy) or save
  an edited copy. **Comments** provide a local review workflow.
- **Front & back matter** builder: title page, copyright, dedication, epigraph,
  preface, acknowledgements, foreword, introduction, contents, list of figures/tables,
  conclusion, afterword, appendix, glossary, bibliography/references, index, endnotes,
  about the author, permissions and colophon. Generated sections are derived from the
  real manuscript; the rest are authored by you.

### Production

- **Design studio** with live paginated preview at real trim size: 7 layout templates,
  A4/A5/Letter/6×9/5.5×8.5/custom trims, margins and gutter, mirrored pages, running
  headers/footers with `{title}`, `{chapter}`, `{page}`, fonts, body size, leading,
  justification, hyphenation, first-line indent, drop caps and chapter openers.
- **Measurement-based pagination** (`BF.layout.paginate`) that flows real HTML blocks
  into pages, splits paragraphs at word boundaries, labels front matter with roman
  numerals, and warns about oversized images/tables.
- **Print / Print to PDF** from the paginated proof (the browser's print dialog is the
  PDF generator — this is labelled honestly in the UI).
- **Read-only page proof** in the manuscript view, backed by the same block measurement
  and page labels used for print, with chapter-level hand-off back to editing.
- **Version history**: named and automatic snapshots (autosave every 5 minutes, last
  25 automatic snapshots retained), word-level diff comparison and restore with a
  safety snapshot taken first.
- **Editorial review**: 13 heuristic categories (structure, headings, empty chapters,
  repeated spaces, long paragraphs, unresolved comments, etc.). The UI states clearly
  that passing checks does not verify facts or scholarship.
- **Preflight report** separating technical export checks from editorial reminders.
- **Trash** for books and chapters, with restore and explicit permanent deletion.

### Real exports

| Format | Implementation |
|---|---|
| `.docx` | Genuine OOXML zip: `[Content_Types].xml`, `document.xml`, styles, numbering, TOC field, hyperlinks, core properties, embedded `word/media/*` images (honouring display width and clamped to the text block), section/page settings from the Design Studio |
| `.epub` | EPUB 3 zip with stored `mimetype` first, `META-INF/container.xml`, `content.opf`, `nav.xhtml`, XHTML chapters, generated UUID (never a fabricated ISBN), embedded images |
| `.html` | Self-contained web book with light/dark styling and print CSS |
| `.md` | Markdown with headings, emphasis, lists, tables, links, images and block quotes |
| `.txt` | Plain text with chapter separators |
| `.json` | Full project backup (`bookforge-project` v1) that can be imported again |
| PDF | Browser print dialog over the real paginated proof |

### Persistence

- IndexedDB database `bookforge-studio` (stores: `projects`, `versions`, `meta`).
- Automatic fallback to localStorage, then memory, if IndexedDB is unavailable; the
  current mode is shown on the dashboard.
- Writes are serialised through a queue so rapid edits cannot reorder saves.
- The save state reflects actual completion of the storage write.
- Export/import round-trips through `.bookforge.json`; imported books are normalised
  and validated (no manuscript → explicit error, never silent data loss).

---

## Honest limitations

- **PDF** is produced by the browser's print-to-PDF. Exact page breaks can vary
  slightly with browser and installed fonts; the Design Studio preview uses the same
  measurement engine but is an approximation of print.
- **DOCX** uses paragraph styles and a TOC *field*. Word must update fields (or you
  can print/update the TOC) to populate page numbers — the document itself is real
  OOXML, not a renamed HTML file.
- **EPUB** is a valid EPUB 3 package by construction, but it is not run through
  `epubcheck` in the browser. Validate with epubcheck before commercial distribution.
- **No collaboration, accounts or cloud sync.** All books stay in this browser's
  storage. Clearing site data removes them unless you exported a backup.
- **AI assistance is opt-in and off by default.** There is no bundled model or key.
  The AI panel includes a **Correct grammar & punctuation** action for a configured
  endpoint; suggestions are always shown separately and are never auto-applied. Facts
  and citations suggested by any model must be verified by you.
- **Reviews and preflight are heuristics**, not plagiarism or fact checking.
- **Clean-up is rule-based, not a grammar checker.** Its corrections are deliberately
  conservative but can still be wrong for unusual prose. Review the diff before
  applying; the safety version can be compared or restored from Version history.
  Deeper grammar rewriting requires your own configured AI endpoint, and still needs
  human review.
- **No ISBNs are generated, guessed or registered.** Enter your real ISBN if you have
  one; otherwise exports omit it.
- **Image editing is canvas-based.** Images stored in the project can be resized,
  recompressed and rotated. Images linked from a remote URL can only have their
  display width changed, because browsers block reading pixels from other origins.
  WebP output is small and modern readers support it, but older Word versions may
  not display WebP — choose JPEG when maximum compatibility matters. EXIF metadata is
  not preserved in re-encoded files.
- Styles beyond the design controls (complex footnotes in DOCX, advanced EPUB
  typography, MathML, fonts embedded in EPUB) are out of scope.

---

## AI endpoint contract (optional)

In **Settings → AI**, enable assistance and enter an endpoint you control. BookForge
POSTs JSON to it:

```json
{
  "action": "correct|improve|tone|simplify|repetition|transition|outline|brainstorm|summary|questions|exercises|glossary|consistency|feedback",
  "text": "selected passage or chapter text",
  "context": { "title": "Book title", "chapter": "Chapter title" }
}
```

The endpoint must return JSON with either `suggestion` or `text`, plus optional
`notes`:

```json
{ "suggestion": "…proposed text…", "notes": "optional explanation" }
```

Keep provider keys on your proxy — never in this repository or in the browser.
If no endpoint is configured, the AI panel says so instead of pretending to work.

---

## Tests

End-to-end tests drive the real app in headless Edge/Chrome over the DevTools
Protocol, using only Node built-ins (global `WebSocket` + `fetch`):

```powershell
node tests/e2e.mjs
```

The suite starts `server.mjs`, creates and edits a book through the real editor,
reloads to verify IndexedDB persistence, snapshots/mutates/restores a version,
builds DOCX and EPUB (checks zip magic, OOXML/EPUB parts and embedded images),
drives the image editor through the real UI (resize/compress replaces the asset and
inline copies, double-click sets display width, DOCX honours and clamps it),
validates HTML/Markdown/TXT/JSON output, runs preflight and backup import,
paginates at A4, checks the page indicator (Draft cursor page, sidebar progress track,
Pages scroll position) against full-book pagination,
drives the Draft/Pages proof through the real UI (multi-page layout,
current-chapter highlight and Edit chapter hand-off), applies the local clean-up through
the real dialog (diff preview, safety version, persistence), prepares print pages,
renders the Design Studio preview, and exercises the library UI
rename/delete/trash/restore confirmation flow. It also fails if the page logged an
error or uncaught exception.

---

## Project layout

```
bookforge/
  index.html          app shell
  server.mjs          zero-dependency static server
  css/styles.css      themes, workspace, manuscript, dialogs, print styles
  js/util.js          DOM/format/diff/sanitise helpers
  js/zip.js           CRC-32 STORE zip writer (DOCX/EPUB)
  js/model.js         templates, book factory, stats, TOC, citations
  js/storage.js       IndexedDB/localStorage/memory persistence + versions
  js/editor.js        contenteditable manuscript engine
  js/image-editor.js  canvas image resize/compress/rotate dialog
  js/text-tools.js    local clean-up and text normalization tools
  js/layout.js        measurement pagination, preview, page proof, print
  js/export.js        DOCX/EPUB/HTML/MD/TXT/JSON + preflight
  js/views.js         all workspace views
  js/app.js           shell, dialogs, commands, keyboard shortcuts, boot
  tests/e2e.mjs       headless-browser acceptance tests
```
