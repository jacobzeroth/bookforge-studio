-- BookForge sync index. Book bodies live in KV; this table only holds the
-- small, strongly-consistent index the clients list.
CREATE TABLE IF NOT EXISTS books (
  user_id    TEXT    NOT NULL,
  book_id    TEXT    NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted    INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, book_id)
);

CREATE INDEX IF NOT EXISTS idx_books_user ON books (user_id, updated_at);
