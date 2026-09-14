-- Per-category RootMC daily Grok reports (playerbase, economy, mcmmo, etc.).

CREATE TABLE IF NOT EXISTS rootmc_daily_category_reports (
  server_id TEXT NOT NULL,
  day_key TEXT NOT NULL,
  category TEXT NOT NULL,
  posted_at TEXT NOT NULL,
  channel_id TEXT,
  message_id TEXT,
  summary TEXT,
  report_text TEXT,
  grok_model TEXT,
  grok_ok INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (server_id, day_key, category)
);
