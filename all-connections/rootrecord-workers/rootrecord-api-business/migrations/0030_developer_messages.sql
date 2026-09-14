-- In-app "developer messages" feed (Settings → recent notes). Public read via GET /api/mobile/developer-messages.
CREATE TABLE IF NOT EXISTS developer_messages (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  app_scope TEXT NOT NULL DEFAULT 'all',
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_developer_messages_created ON developer_messages (created_at);
