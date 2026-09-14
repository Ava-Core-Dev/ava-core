CREATE TABLE IF NOT EXISTS rr_roots_mint_requests (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  amount_atomic TEXT NOT NULL,
  destination_owner TEXT NOT NULL,
  custodial_fee_payer TEXT NOT NULL,
  status TEXT NOT NULL,
  tx_signature TEXT,
  error_detail TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  confirmed_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_rr_roots_mint_requests_account_created
  ON rr_roots_mint_requests(account_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_rr_roots_mint_requests_status
  ON rr_roots_mint_requests(status, updated_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS idx_rr_roots_mint_requests_one_active
  ON rr_roots_mint_requests(account_id)
  WHERE status IN ('pending', 'reserved', 'submitted');
