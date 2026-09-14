CREATE TABLE IF NOT EXISTS rr_roots_sol_swaps (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  custodial_wallet TEXT NOT NULL,
  input_lamports TEXT NOT NULL,
  quoted_roots_raw TEXT,
  quoted_roots_atomic INTEGER NOT NULL DEFAULT 0,
  slippage_bps INTEGER NOT NULL DEFAULT 100,
  status TEXT NOT NULL DEFAULT 'pending',
  swap_signature TEXT,
  deposit_credited INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  error TEXT
);

CREATE INDEX IF NOT EXISTS idx_rr_roots_sol_swaps_account_created
  ON rr_roots_sol_swaps(account_id, created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS idx_rr_roots_sol_swaps_signature
  ON rr_roots_sol_swaps(swap_signature)
  WHERE swap_signature IS NOT NULL;
