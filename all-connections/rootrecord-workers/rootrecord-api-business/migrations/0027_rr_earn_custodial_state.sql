-- Ledger for RRTT pushed from treasury to custodial vs withdrawn; optional withdraw destination (no linked wallet).
-- Earn total stays in rr_earn_balance; pending = balance - units_sent_to_custodial; available ≈ sent - withdrawn (see on-chain cache).

CREATE TABLE IF NOT EXISTS rr_earn_custodial_state (
  account_id TEXT PRIMARY KEY,
  units_sent_to_custodial INTEGER NOT NULL DEFAULT 0,
  units_withdrawn_from_custodial INTEGER NOT NULL DEFAULT 0,
  withdraw_dest_pubkey TEXT,
  withdraw_dest_updated_at TEXT,
  custodial_rrtt_onchain INTEGER,
  sol_balance_lamports_cached INTEGER,
  cache_updated_at TEXT,
  last_treasury_transfer_at TEXT,
  last_treasury_transfer_sig TEXT
);

CREATE INDEX IF NOT EXISTS idx_rr_earn_custodial_sent ON rr_earn_custodial_state (account_id);
