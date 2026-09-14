-- Peer transfers of earn balance (Root Units) initiated from Discord slash commands.
CREATE TABLE IF NOT EXISTS rr_earn_discord_peer_transfer (
  id TEXT PRIMARY KEY NOT NULL,
  interaction_id TEXT NOT NULL UNIQUE,
  from_user_id TEXT NOT NULL,
  to_user_id TEXT NOT NULL,
  units INTEGER NOT NULL,
  from_discord_user_id TEXT NOT NULL,
  to_discord_user_id TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_rr_earn_discord_peer_transfer_created_at
  ON rr_earn_discord_peer_transfer (created_at);
