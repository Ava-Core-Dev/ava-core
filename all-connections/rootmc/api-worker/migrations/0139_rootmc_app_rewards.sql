-- RootMC Terminal PWA: check-in streak state + vote claim ledger.

CREATE TABLE IF NOT EXISTS rootmc_app_checkin_state (
  minecraft_uuid TEXT NOT NULL,
  server_id TEXT NOT NULL,
  streak_count INTEGER NOT NULL DEFAULT 0,
  last_claim_at TEXT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (minecraft_uuid, server_id)
);

CREATE TABLE IF NOT EXISTS rootmc_app_vote_claims (
  id TEXT NOT NULL PRIMARY KEY,
  server_id TEXT NOT NULL,
  minecraft_uuid TEXT NOT NULL,
  site_id TEXT NOT NULL,
  transfer_id TEXT,
  reward_gold REAL NOT NULL,
  claimed_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_rootmc_app_vote_claims_player
  ON rootmc_app_vote_claims (server_id, minecraft_uuid, claimed_at DESC);

CREATE INDEX IF NOT EXISTS idx_rootmc_app_vote_claims_site
  ON rootmc_app_vote_claims (server_id, minecraft_uuid, site_id, claimed_at DESC);
