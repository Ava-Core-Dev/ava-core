-- Per-item gold provenance events (mine, loot, mint), synced from Root Essentials MySQL.
CREATE TABLE IF NOT EXISTS rootstat_gold_item_events (
  server_id TEXT NOT NULL,
  event_id INTEGER NOT NULL,
  minecraft_uuid TEXT NOT NULL,
  minecraft_username TEXT,
  event_type TEXT NOT NULL,
  obtained_via TEXT NOT NULL,
  material TEXT NOT NULL,
  stack_amount INTEGER NOT NULL,
  gold_g REAL NOT NULL,
  world TEXT,
  block_x INTEGER,
  block_y INTEGER,
  block_z INTEGER,
  context_json TEXT,
  occurred_at TEXT NOT NULL,
  synced_at TEXT NOT NULL,
  PRIMARY KEY (server_id, event_id)
);

CREATE INDEX IF NOT EXISTS idx_rootstat_gold_item_events_player_time
  ON rootstat_gold_item_events (server_id, minecraft_uuid, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_rootstat_gold_item_events_server_time
  ON rootstat_gold_item_events (server_id, occurred_at DESC);
