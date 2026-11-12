#!/usr/bin/env node
/*
 * BookForge Studio static server.
 * Zero dependencies. Serves this folder at http://localhost:4173 (override with PORT).
 * The app also works when index.html is opened directly from disk (file://).
 *
 *   node server.mjs
 *   node server.mjs 8080
 */
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(new URL(".", import.meta.url)));
const PORT = Number(process.argv[2] || process.env.PORT || 4173);

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
  ".md": "text/markdown; charset=utf-8"
};

function safePath(urlPath) {
  const decoded = decodeURIComponent(urlPath.split("?")[0].split("#")[0]);
  const rel = normalize(decoded).replace(/^([/\\])+/, "");
  const abs = join(ROOT, rel);
  if (abs !== ROOT && !abs.startsWith(ROOT + sep)) return null;
  return abs;
}

function send(res, status, headers, body) {
  res.writeHead(status, Object.assign({ "Cache-Control": "no-store" }, headers));
  if (body && body.pipe) body.pipe(res); else res.end(body);
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url || "/", "http://localhost");
    let target = safePath(url.pathname);
    if (!target) return send(res, 403, { "Content-Type": "text/plain" }, "Forbidden");

    let info = await stat(target).catch(() => null);
    if (info && info.isDirectory()) {
      target = join(target, "index.html");
      info = await stat(target).catch(() => null);
    }
    if (!info || !info.isFile()) {
      return send(res, 404, { "Content-Type": "text/plain; charset=utf-8" }, "404 Not Found — " + url.pathname);
    }

    const type = MIME[extname(target).toLowerCase()] || "application/octet-stream";
    const body = await readFile(target);
    send(res, 200, { "Content-Type": type, "Content-Length": body.length }, body);
  } catch (err) {
    send(res, 500, { "Content-Type": "text/plain; charset=utf-8" }, "500 Server error: " + err.message);
  }
});

server.listen(PORT, "127.0.0.1", () => {
  console.log("BookForge Studio served at http://localhost:" + PORT + "/");
  console.log("Root: " + ROOT);
  console.log("Press Ctrl+C to stop.");
});

server.on("error", (err) => {
  if (err.code === "EADDRINUSE") {
    console.error("Port " + PORT + " is already in use. Try: node server.mjs 8080");
  } else {
    console.error(err);
  }
  process.exit(1);
});
