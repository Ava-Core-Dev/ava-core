-- Per-player physical gold in storage (mint peg), from periodic server scan.
CREATE TABLE IF NOT EXISTS rootstat_player_physical_gold (
  server_id TEXT NOT NULL,
  minecraft_uuid TEXT NOT NULL,
  minecraft_username TEXT,
  inventory_g REAL NOT NULL DEFAULT 0,
  ender_g REAL NOT NULL DEFAULT 0,
  shop_g REAL NOT NULL DEFAULT 0,
  chest_g REAL NOT NULL DEFAULT 0,
  total_g REAL NOT NULL DEFAULT 0,
  scanned_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (server_id, minecraft_uuid)
);

CREATE TABLE IF NOT EXISTS rootstat_physical_gold_summary (
  server_id TEXT PRIMARY KEY,
  total_storage_g REAL NOT NULL DEFAULT 0,
  unattributed_g REAL NOT NULL DEFAULT 0,
  player_count INTEGER NOT NULL DEFAULT 0,
  shops_scanned INTEGER NOT NULL DEFAULT 0,
  chunks_scanned INTEGER NOT NULL DEFAULT 0,
  scanned_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_rootstat_physical_gold_server_total
  ON rootstat_player_physical_gold (server_id, total_g DESC);
