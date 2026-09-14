-- Self-custody Solana wallet linked to a RootRecord portal account (signed proof).
-- Used by Solana Tools for OTC / mint-action correlation; distinct from internal_solana_wallets (custodial).

CREATE TABLE IF NOT EXISTS solana_linked_wallets (
  account_id TEXT PRIMARY KEY,
  pubkey TEXT NOT NULL UNIQUE,
  verified_at TEXT NOT NULL,
  message_preview TEXT NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_solana_linked_wallets_pubkey ON solana_linked_wallets (pubkey);
