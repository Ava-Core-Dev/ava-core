-- Remote emergency / major-event page for Kīlauea Android (no app rebuild required).
-- Public read:  GET  /api/mobile/kilauea-situation
-- Ops toggle:  POST /api/internal/kilauea-situation  { enabled, name?, body? }
--   Header: X-RR-Push-Admin-Key (same as push-broadcast)
CREATE TABLE IF NOT EXISTS kilauea_situation (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  enabled INTEGER NOT NULL DEFAULT 0,
  body TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL
);

INSERT OR IGNORE INTO kilauea_situation (id, name, enabled, body, updated_at)
VALUES ('current', '', 0, '', '1970-01-01T00:00:00.000Z');
