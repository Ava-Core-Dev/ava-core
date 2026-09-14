-- Block Notes signed-in account backup (notes, worlds/servers, waypoints, build plans, etc.)

CREATE TABLE IF NOT EXISTS blocknotes_account_snapshot (
  account_id TEXT PRIMARY KEY,
  doc TEXT NOT NULL,
  schema_version INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL,
  device_id TEXT
);

CREATE INDEX IF NOT EXISTS idx_blocknotes_account_snapshot_updated
  ON blocknotes_account_snapshot (updated_at);
