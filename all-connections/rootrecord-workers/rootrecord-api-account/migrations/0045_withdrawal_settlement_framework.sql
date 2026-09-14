-- Target pipeline: ledger-capped withdrawal intents → custodial→treasury settlement → ATA reclaim → treasury-funded payout.
-- Intents are product/DB authority for "how much"; settlement legs record on-chain steps (tx signatures filled later).

CREATE TABLE IF NOT EXISTS rr_withdrawal_intent (
  id TEXT PRIMARY KEY NOT NULL,
  account_id TEXT NOT NULL,
  mint_base58 TEXT NOT NULL,
  amount_ledger_whole INTEGER NOT NULL,
  destination_pubkey TEXT NOT NULL,
  status TEXT NOT NULL,
  status_detail TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  settled_at TEXT,
  CHECK (length(trim(id)) > 0),
  CHECK (length(trim(account_id)) > 0),
  CHECK (length(trim(mint_base58)) > 0),
  CHECK (length(trim(destination_pubkey)) > 0),
  CHECK (amount_ledger_whole >= 1)
);

CREATE INDEX IF NOT EXISTS idx_rr_withdrawal_intent_account_created
  ON rr_withdrawal_intent (account_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_rr_withdrawal_intent_status_created
  ON rr_withdrawal_intent (status, created_at);

CREATE TABLE IF NOT EXISTS rr_settlement_leg (
  id TEXT PRIMARY KEY NOT NULL,
  intent_id TEXT NOT NULL,
  step_index INTEGER NOT NULL,
  leg_type TEXT NOT NULL,
  status TEXT NOT NULL,
  tx_signature TEXT,
  amount_raw TEXT,
  error_detail TEXT,
  metadata_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (intent_id, step_index)
);

CREATE INDEX IF NOT EXISTS idx_rr_settlement_leg_intent ON rr_settlement_leg (intent_id);
