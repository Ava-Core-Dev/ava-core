-- Server-side sessions (JWT may include `sid`); revoked rows invalidate bearer tokens.
CREATE TABLE IF NOT EXISTS license_sessions (
  id TEXT PRIMARY KEY NOT NULL,
  account_id TEXT NOT NULL,
  device_id TEXT,
  user_agent TEXT,
  ip TEXT,
  created_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  revoked_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_license_sessions_account ON license_sessions (account_id);
CREATE INDEX IF NOT EXISTS idx_license_sessions_account_active ON license_sessions (account_id, revoked_at);

-- Pending email change: id = hex(SHA-256(verification_token)).
CREATE TABLE IF NOT EXISTS license_email_change (
  id TEXT PRIMARY KEY NOT NULL,
  account_id TEXT NOT NULL,
  new_email TEXT NOT NULL COLLATE NOCASE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_license_email_change_account ON license_email_change (account_id);

-- Rate limit failed password-change attempts (5 / 10 min / account).
CREATE TABLE IF NOT EXISTS me_password_attempt (
  id TEXT PRIMARY KEY NOT NULL,
  account_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  ok INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_me_password_attempt_acct ON me_password_attempt (account_id, created_at);
