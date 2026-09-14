-- Public feed of SPL mints created via Solana Tools (token_create action logs).
CREATE TABLE IF NOT EXISTS solana_site_token_create (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  wallet TEXT NOT NULL,
  mint TEXT NOT NULL,
  name TEXT,
  symbol TEXT,
  token2022 INTEGER NOT NULL DEFAULT 0,
  signature TEXT,
  network TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_solana_site_token_create_mint ON solana_site_token_create(mint);
CREATE INDEX IF NOT EXISTS idx_solana_site_token_create_created ON solana_site_token_create(created_at DESC);
