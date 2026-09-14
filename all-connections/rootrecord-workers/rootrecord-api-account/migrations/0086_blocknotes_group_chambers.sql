-- Shared trial-chamber / spawner cooldown state per Realm group.
CREATE TABLE IF NOT EXISTS blocknotes_group_chambers (
  group_id TEXT PRIMARY KEY,
  snapshot_json TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  updated_by_account_id TEXT
);

CREATE INDEX IF NOT EXISTS idx_blocknotes_group_chambers_updated
  ON blocknotes_group_chambers(updated_at DESC);
