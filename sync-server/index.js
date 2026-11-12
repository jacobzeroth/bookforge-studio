/**
 * BookForge sync service — Cloudflare Worker + D1 index + KV bodies.
 *
 * Auth: every request carries `Authorization: Bearer <sync-code>`.
 * The code is never stored: the storage key is its SHA-256 hash, so a dump of
 * KV or D1 does not reveal a usable sync code.
 *
 *   D1  `books` table  -> small, strongly consistent index used for listing
 *   KV  `b:<uid>:<id>` -> the book body itself (up to ~25 MB per book)
 */

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type",
  "Access-Control-Max-Age": "86400"
};

const MAX_BODY = 20 * 1024 * 1024; // KV allows 25 MiB; stay well inside it

function json(data, status) {
  return new Response(JSON.stringify(data), {
    status: status || 200,
    headers: Object.assign({ "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }, CORS)
  });
}

async function sha256Hex(text) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function bearer(req) {
  const raw = req.headers.get("Authorization") || "";
  const m = raw.match(/^Bearer\s+(.+)$/i);
  return m ? m[1].trim() : "";
}

export default {
  async fetch(req, env) {
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });

    const url = new URL(req.url);
    const path = url.pathname.replace(/\/+$/, "") || "/";

    if (path === "/" || path === "/health") {
      return json({ service: "bookforge-sync", ok: true, time: Date.now() });
    }

    if (!env.BOOKS || !env.DB) return json({ error: "Sync storage is not configured on this server." }, 503);

    const code = bearer(req);
    if (code.length < 16) return json({ error: "Missing or invalid sync code." }, 401);
    const uid = await sha256Hex("bookforge:v1:" + code);

    // GET /v1/books -> strongly consistent index of { id, updatedAt, deleted }
    if (path === "/v1/books" && req.method === "GET") {
      const { results } = await env.DB
        .prepare("SELECT book_id, updated_at, deleted FROM books WHERE user_id = ?")
        .bind(uid)
        .all();
      return json({
        books: (results || []).map((r) => ({
          id: r.book_id,
          updatedAt: Number(r.updated_at) || 0,
          deleted: !!r.deleted
        })),
        serverTime: Date.now()
      });
    }

    // /v1/books/:id
    const m = path.match(/^\/v1\/books\/([A-Za-z0-9._~-]{1,120})$/);
    if (m) {
      const id = m[1];
      const key = "b:" + uid + ":" + id;

      if (req.method === "GET") {
        const row = await env.BOOKS.getWithMetadata(key, "json");
        if (!row || !row.value) return json({ error: "Not found." }, 404);
        return json(row.value);
      }

      if (req.method === "PUT") {
        const text = await req.text();
        if (text.length > MAX_BODY) {
          return json({ error: "This book is too large to sync (over 20 MB). Export a project backup instead." }, 413);
        }
        let body;
        try { body = JSON.parse(text); } catch { return json({ error: "Invalid JSON body." }, 400); }
        if (!body || typeof body !== "object" || !body.data || typeof body.data !== "object") {
          return json({ error: "Body must be { data, updatedAt }." }, 400);
        }
        const incoming = Number(body.updatedAt) || Date.now();

        const current = await env.DB
          .prepare("SELECT updated_at FROM books WHERE user_id = ? AND book_id = ?")
          .bind(uid, id)
          .first();
        const currentAt = current ? Number(current.updated_at) || 0 : 0;

        // Last-write-wins: an older edit never overwrites a newer one.
        if (currentAt > incoming) {
          return json({ ok: true, stored: false, updatedAt: currentAt, reason: "newer version already stored" });
        }

        const record = { id, updatedAt: incoming, deleted: false, data: body.data };
        await env.BOOKS.put(key, JSON.stringify(record), { metadata: { updatedAt: incoming, deleted: false } });
        await env.DB
          .prepare(
            "INSERT INTO books (user_id, book_id, updated_at, deleted) VALUES (?, ?, ?, 0) " +
            "ON CONFLICT(user_id, book_id) DO UPDATE SET updated_at = excluded.updated_at, deleted = 0"
          )
          .bind(uid, id, incoming)
          .run();
        return json({ ok: true, stored: true, updatedAt: incoming });
      }

      if (req.method === "DELETE") {
        const at = Number(url.searchParams.get("updatedAt")) || Date.now();
        const current = await env.DB
          .prepare("SELECT updated_at FROM books WHERE user_id = ? AND book_id = ?")
          .bind(uid, id)
          .first();
        const currentAt = current ? Number(current.updated_at) || 0 : 0;
        if (currentAt > at) return json({ ok: true, stored: false, updatedAt: currentAt });

        const record = { id, updatedAt: at, deleted: true, data: null };
        await env.BOOKS.put(key, JSON.stringify(record), { metadata: { updatedAt: at, deleted: true } });
        await env.DB
          .prepare(
            "INSERT INTO books (user_id, book_id, updated_at, deleted) VALUES (?, ?, ?, 1) " +
            "ON CONFLICT(user_id, book_id) DO UPDATE SET updated_at = excluded.updated_at, deleted = 1"
          )
          .bind(uid, id, at)
          .run();
        return json({ ok: true, stored: true, updatedAt: at });
      }
    }

    return json({ error: "Unknown endpoint." }, 404);
  }
};
