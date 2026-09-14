-- On-chain holdings mirror for each custodial pubkey: native SOL + SPL (Token + Token-2022).
-- Rows are replaced whenever `syncCustodialTokenSlotsFromRpc` runs (e.g. /earn/summary refresh, GET /v1/me/custodial-wallet-tokens).
-- P2P ledger / treasury sweep of user deposits is out of scope for this migration.

CREATE TABLE IF NOT EXISTS custodial_wallet_token_slots (
  account_id TEXT NOT NULL,
  mint_base58 TEXT NOT NULL,
  token_program_id TEXT NOT NULL,
  ata_pubkey TEXT NOT NULL,
  decimals INTEGER NOT NULL,
  amount_raw TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (account_id, mint_base58, token_program_id)
);

CREATE INDEX IF NOT EXISTS idx_custodial_wallet_token_slots_account
  ON custodial_wallet_token_slots (account_id);
