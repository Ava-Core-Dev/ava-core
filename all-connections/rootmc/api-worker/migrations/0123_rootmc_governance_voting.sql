-- Governance weighted votes + official poll metadata + listing vote sync cache.

ALTER TABLE rootmc_community_proposal_votes ADD COLUMN vote_weight REAL NOT NULL DEFAULT 1.0;

ALTER TABLE rootmc_community_proposals ADD COLUMN bill_summary TEXT;
ALTER TABLE rootmc_community_proposals ADD COLUMN bill_url TEXT;
ALTER TABLE rootmc_community_proposals ADD COLUMN poll_channel TEXT NOT NULL DEFAULT 'forum';

CREATE TABLE IF NOT EXISTS rootmc_listing_votes (
  minecraft_uuid TEXT NOT NULL,
  service TEXT NOT NULL,
  voted_at TEXT NOT NULL,
  synced_at TEXT NOT NULL,
  PRIMARY KEY (minecraft_uuid, service, voted_at)
);

CREATE INDEX IF NOT EXISTS idx_rootmc_listing_votes_uuid_time
  ON rootmc_listing_votes (minecraft_uuid, voted_at);
