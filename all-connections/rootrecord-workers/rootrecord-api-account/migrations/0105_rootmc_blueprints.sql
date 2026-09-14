-- RootMC plot blueprints (member/lifetime) — R2 object keys + metadata.

CREATE TABLE IF NOT EXISTS rootmc_blueprints (
  id TEXT NOT NULL PRIMARY KEY,
  server_id TEXT NOT NULL,
  account_id TEXT NOT NULL,
  minecraft_uuid TEXT NOT NULL,
  minecraft_username TEXT,
  town_name TEXT NOT NULL,
  plot_x INTEGER NOT NULL,
  plot_z INTEGER NOT NULL,
  world_name TEXT NOT NULL,
  chunk_x INTEGER NOT NULL,
  chunk_z INTEGER NOT NULL,
  anchor_x INTEGER NOT NULL,
  anchor_y INTEGER NOT NULL,
  anchor_z INTEGER NOT NULL,
  r2_key TEXT NOT NULL,
  file_name TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  download_token TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_rootmc_blueprints_account ON rootmc_blueprints (account_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_rootmc_blueprints_plot ON rootmc_blueprints (server_id, town_name, plot_x, plot_z);
