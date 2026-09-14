CREATE TABLE IF NOT EXISTS rr_roots_custodial_deposits (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  email TEXT,
  custodial_wallet TEXT NOT NULL,
  token_account TEXT NOT NULL,
  mint_base58 TEXT NOT NULL,
  token_program_id TEXT NOT NULL,
  amount_raw TEXT NOT NULL,
  amount_atomic INTEGER NOT NULL DEFAULT 0,
  decimals INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'processing',
  sweep_signature TEXT,
  topup_signature TEXT,
  close_signature TEXT,
  credited_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  error TEXT
);

CREATE INDEX IF NOT EXISTS idx_rr_roots_custodial_deposits_account_created
  ON rr_roots_custodial_deposits(account_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_rr_roots_custodial_deposits_status
  ON rr_roots_custodial_deposits(status, created_at);

CREATE UNIQUE INDEX IF NOT EXISTS idx_rr_roots_custodial_deposits_sweep_signature
  ON rr_roots_custodial_deposits(sweep_signature)
  WHERE sweep_signature IS NOT NULL;
