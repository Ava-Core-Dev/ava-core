-- Daily player wallet Notes + physical gold in storage (economy chart comparison).
CREATE TABLE IF NOT EXISTS rootmc_holder_supply_daily (
  server_id TEXT NOT NULL,
  day TEXT NOT NULL,
  player_notes_g REAL NOT NULL DEFAULT 0,
  physical_gold_g REAL NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (server_id, day)
);

CREATE INDEX IF NOT EXISTS idx_rootmc_holder_supply_daily_server_day
  ON rootmc_holder_supply_daily (server_id, day DESC);
