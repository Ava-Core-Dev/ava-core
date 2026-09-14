CREATE TABLE IF NOT EXISTS rootmc_ingame_ask_usage (
  server_id TEXT NOT NULL,
  minecraft_uuid TEXT NOT NULL,
  day_utc TEXT NOT NULL,
  ask_count INTEGER NOT NULL DEFAULT 0,
  last_ask_at TEXT,
  PRIMARY KEY (server_id, minecraft_uuid, day_utc)
);

CREATE INDEX IF NOT EXISTS idx_rootmc_ingame_ask_day
  ON rootmc_ingame_ask_usage(day_utc);
