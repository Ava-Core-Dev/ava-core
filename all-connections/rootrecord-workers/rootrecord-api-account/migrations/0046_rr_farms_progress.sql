-- Root Farms progression (see Web/main/root-farms/README.md)
CREATE TABLE IF NOT EXISTS rr_farms_progress (
  user_id TEXT NOT NULL PRIMARY KEY,
  progress_version INTEGER NOT NULL DEFAULT 1,
  last_settled_ms INTEGER NOT NULL,
  lifetime_farms_earned INTEGER NOT NULL DEFAULT 0,
  plots_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_rr_farms_progress_updated ON rr_farms_progress(updated_at);
