-- RootMC daily status report (posted to Discord at midnight HST).

CREATE TABLE IF NOT EXISTS rootmc_daily_reports (
  server_id TEXT NOT NULL,
  day_key TEXT NOT NULL,
  posted_at TEXT NOT NULL,
  channel_id TEXT,
  message_id TEXT,
  summary TEXT,
  PRIMARY KEY (server_id, day_key)
);
