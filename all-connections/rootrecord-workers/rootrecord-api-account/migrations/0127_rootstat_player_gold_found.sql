-- Per-player cumulative physical gold found (mine + loot), synced from Root Essentials MySQL.
CREATE TABLE IF NOT EXISTS rootstat_player_gold_found (
  server_id TEXT NOT NULL,
  minecraft_uuid TEXT NOT NULL,
  minecraft_username TEXT,
  total_gold_g REAL NOT NULL DEFAULT 0,
  mined_ore_g REAL NOT NULL DEFAULT 0,
  mined_block_g REAL NOT NULL DEFAULT 0,
  loot_chest_g REAL NOT NULL DEFAULT 0,
  loot_mob_g REAL NOT NULL DEFAULT 0,
  pickup_g REAL NOT NULL DEFAULT 0,
  find_events INTEGER NOT NULL DEFAULT 0,
  synced_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (server_id, minecraft_uuid)
);

CREATE INDEX IF NOT EXISTS idx_rootstat_gold_found_server_total
  ON rootstat_player_gold_found (server_id, total_gold_g DESC);
