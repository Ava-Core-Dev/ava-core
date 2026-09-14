-- Optional starter table; safe no-op if you drop it later.
CREATE TABLE IF NOT EXISTS rr_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
