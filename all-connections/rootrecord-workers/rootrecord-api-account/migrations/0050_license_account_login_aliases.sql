-- Extra login emails merged onto the canonical account (one Discord user -> one portal account).
CREATE TABLE IF NOT EXISTS license_account_login_aliases (
  email TEXT PRIMARY KEY NOT NULL COLLATE NOCASE,
  account_id TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  salt TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_license_account_login_aliases_account_id
  ON license_account_login_aliases (account_id);
