-- Public governance web + terms acceptance + Discord thread ids.

ALTER TABLE rootmc_legislation_items ADD COLUMN discord_thread_id TEXT;

ALTER TABLE rootmc_weekly_bills ADD COLUMN discord_thread_id TEXT;

CREATE TABLE IF NOT EXISTS rootmc_governance_terms_acceptance (
  account_id TEXT NOT NULL PRIMARY KEY,
  terms_version TEXT NOT NULL,
  accepted_at TEXT NOT NULL,
  discord_user_id TEXT,
  minecraft_uuid TEXT
);

CREATE INDEX IF NOT EXISTS idx_rootmc_governance_terms_version
  ON rootmc_governance_terms_acceptance (terms_version);
