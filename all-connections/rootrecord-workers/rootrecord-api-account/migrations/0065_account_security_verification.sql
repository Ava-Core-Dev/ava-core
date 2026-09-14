-- Account verification, password recovery, and recent security proof challenges.
CREATE TABLE IF NOT EXISTS license_account_security (
  account_id TEXT PRIMARY KEY NOT NULL,
  email_verified_at TEXT,
  last_challenge_verified_at TEXT,
  last_challenge_method TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS license_account_challenges (
  id TEXT PRIMARY KEY NOT NULL,
  account_id TEXT NOT NULL,
  email TEXT NOT NULL COLLATE NOCASE,
  purpose TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  code_hash TEXT,
  new_email TEXT COLLATE NOCASE,
  device_id TEXT,
  user_agent TEXT,
  ip TEXT,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  consumed_at TEXT,
  failed_attempts INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_license_account_challenges_account
  ON license_account_challenges (account_id, purpose, consumed_at, expires_at);

CREATE INDEX IF NOT EXISTS idx_license_account_challenges_email
  ON license_account_challenges (email, purpose, consumed_at, expires_at);

CREATE INDEX IF NOT EXISTS idx_license_account_challenges_expires_at
  ON license_account_challenges (expires_at);
