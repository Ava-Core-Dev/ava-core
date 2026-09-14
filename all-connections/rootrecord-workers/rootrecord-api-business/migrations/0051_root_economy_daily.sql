-- Public Root Economy chart: daily internal circulation + optional intraday snapshots.
CREATE TABLE IF NOT EXISTS root_economy_daily (
  day TEXT PRIMARY KEY NOT NULL,
  total_circulation INTEGER NOT NULL DEFAULT 0,
  account_count INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS root_economy_snapshot (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  recorded_at TEXT NOT NULL,
  total_circulation INTEGER NOT NULL DEFAULT 0,
  account_count INTEGER NOT NULL DEFAULT 0,
  trigger_kind TEXT
);

CREATE INDEX IF NOT EXISTS idx_root_economy_snapshot_at ON root_economy_snapshot (recorded_at DESC);
