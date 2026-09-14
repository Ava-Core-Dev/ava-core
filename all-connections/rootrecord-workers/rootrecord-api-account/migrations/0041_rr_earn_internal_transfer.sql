-- Root Units (rr_earn_balance) peer transfers initiated from the signed-in API (not Discord).
CREATE TABLE IF NOT EXISTS rr_earn_internal_transfer (
  id TEXT PRIMARY KEY NOT NULL,
  from_user_id TEXT NOT NULL,
  to_user_id TEXT NOT NULL,
  units INTEGER NOT NULL,
  from_account_id TEXT NOT NULL,
  to_account_id TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_rr_earn_internal_transfer_from_account
  ON rr_earn_internal_transfer (from_account_id);
CREATE INDEX IF NOT EXISTS idx_rr_earn_internal_transfer_to_account
  ON rr_earn_internal_transfer (to_account_id);
CREATE INDEX IF NOT EXISTS idx_rr_earn_internal_transfer_created_at
  ON rr_earn_internal_transfer (created_at);
