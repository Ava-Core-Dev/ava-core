-- Mirror of license-backed accounts in this D1 (single DB with locations, etc.).
-- Passwords stay on the license Worker; this table stores ids + flags + optional JSON snapshot.
CREATE TABLE IF NOT EXISTS user_accounts (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  account_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  pro_unlocked INTEGER NOT NULL DEFAULT 0,
  extra_json TEXT
);
CREATE INDEX IF NOT EXISTS idx_user_accounts_account_id ON user_accounts(account_id);
