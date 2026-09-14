CREATE TABLE IF NOT EXISTS rr_farms_dice_requests (
  id TEXT PRIMARY KEY,
  creator_user_id TEXT NOT NULL,
  joiner_user_id TEXT,
  stake INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  creator_roll INTEGER,
  joiner_roll INTEGER,
  winner_user_id TEXT,
  created_at TEXT NOT NULL,
  joined_at TEXT,
  resolved_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_rr_farms_dice_requests_status_created
  ON rr_farms_dice_requests(status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_rr_farms_dice_requests_creator_created
  ON rr_farms_dice_requests(creator_user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_rr_farms_dice_requests_joiner_created
  ON rr_farms_dice_requests(joiner_user_id, created_at DESC);
