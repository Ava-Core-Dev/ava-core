-- RootMC treasury grant proposals — community vote with 24h sustained majority.

ALTER TABLE rootmc_community_proposals ADD COLUMN grant_amount REAL;
ALTER TABLE rootmc_community_proposals ADD COLUMN grant_recipient_uuid TEXT;
ALTER TABLE rootmc_community_proposals ADD COLUMN grant_recipient_username TEXT;
ALTER TABLE rootmc_community_proposals ADD COLUMN majority_since TEXT;
ALTER TABLE rootmc_community_proposals ADD COLUMN majority_direction TEXT;
ALTER TABLE rootmc_community_proposals ADD COLUMN grant_transfer_id TEXT;

CREATE INDEX IF NOT EXISTS idx_rootmc_proposals_kind_status
  ON rootmc_community_proposals (kind, status);
