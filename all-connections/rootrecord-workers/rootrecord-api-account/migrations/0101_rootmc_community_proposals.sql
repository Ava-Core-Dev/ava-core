-- RootMC community proposals — linked Discord voters (guild governance).

CREATE TABLE IF NOT EXISTS rootmc_community_proposals (
  id TEXT NOT NULL PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  created_by_discord_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  closes_at TEXT NOT NULL,
  closed_at TEXT,
  channel_id TEXT,
  message_id TEXT,
  result_summary TEXT
);

CREATE TABLE IF NOT EXISTS rootmc_community_proposal_votes (
  proposal_id TEXT NOT NULL,
  discord_user_id TEXT NOT NULL,
  vote TEXT NOT NULL,
  minecraft_uuid TEXT,
  minecraft_username TEXT,
  voted_at TEXT NOT NULL,
  PRIMARY KEY (proposal_id, discord_user_id),
  FOREIGN KEY (proposal_id) REFERENCES rootmc_community_proposals(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_rootmc_proposals_status_closes
  ON rootmc_community_proposals (status, closes_at);
