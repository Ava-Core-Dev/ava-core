-- Internal (custodial) Solana wallets per RootRecord account.
-- Private keys are stored encrypted at rest (ciphertext + iv) and never returned to clients.

CREATE TABLE IF NOT EXISTS internal_solana_wallets (
  account_id TEXT PRIMARY KEY,
  pubkey TEXT NOT NULL UNIQUE,
  privkey_pkcs8_enc BLOB NOT NULL,
  privkey_iv BLOB NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

