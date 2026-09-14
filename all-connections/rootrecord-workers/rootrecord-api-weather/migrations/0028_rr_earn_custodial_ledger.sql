-- Full audit trail: treasury → custodial RRTT, withdrawals to personal wallets, etc.
-- app_snapshot_json: { "per_app_totals_at_transfer": [{app_id, total_units}], "attributed_to_this_transfer": [{app_id, units}] }

CREATE TABLE IF NOT EXISTS rr_earn_custodial_ledger (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  direction TEXT NOT NULL CHECK (direction IN ('in', 'out')),
  units INTEGER NOT NULL,
  tx_signature TEXT,
  recipient_pubkey TEXT,
  app_snapshot_json TEXT NOT NULL DEFAULT '{}',
  earn_balance_snapshot INTEGER,
  notes TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_rr_earn_custodial_ledger_account_time ON rr_earn_custodial_ledger (account_id, created_at DESC);
