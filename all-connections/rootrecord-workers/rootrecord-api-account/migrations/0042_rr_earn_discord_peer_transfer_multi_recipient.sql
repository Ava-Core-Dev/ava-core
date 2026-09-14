-- Allow one interaction_id to fan out to many recipients (/send everyone).
-- Replaces UNIQUE(interaction_id) with UNIQUE(interaction_id, to_discord_user_id).

CREATE TABLE rr_earn_discord_peer_transfer_new (
  id TEXT PRIMARY KEY NOT NULL,
  interaction_id TEXT NOT NULL,
  from_user_id TEXT NOT NULL,
  to_user_id TEXT NOT NULL,
  units INTEGER NOT NULL,
  from_discord_user_id TEXT NOT NULL,
  to_discord_user_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(interaction_id, to_discord_user_id)
);

INSERT INTO rr_earn_discord_peer_transfer_new (
  id, interaction_id, from_user_id, to_user_id, units, from_discord_user_id, to_discord_user_id, created_at
)
SELECT id, interaction_id, from_user_id, to_user_id, units, from_discord_user_id, to_discord_user_id, created_at
FROM rr_earn_discord_peer_transfer;

DROP TABLE rr_earn_discord_peer_transfer;

ALTER TABLE rr_earn_discord_peer_transfer_new RENAME TO rr_earn_discord_peer_transfer;

CREATE INDEX IF NOT EXISTS idx_rr_earn_discord_peer_transfer_created_at
  ON rr_earn_discord_peer_transfer (created_at);

CREATE INDEX IF NOT EXISTS idx_rr_earn_discord_peer_transfer_interaction_id
  ON rr_earn_discord_peer_transfer (interaction_id);
