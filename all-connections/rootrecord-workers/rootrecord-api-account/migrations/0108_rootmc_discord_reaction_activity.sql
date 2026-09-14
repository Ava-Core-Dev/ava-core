-- Discord emoji reactions for weekly Top Participator scoring.

CREATE TABLE IF NOT EXISTS discord_reaction_activity (
  discord_message_id TEXT NOT NULL,
  discord_user_id TEXT NOT NULL,
  emoji_key TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  guild_id TEXT NOT NULL,
  username TEXT,
  global_name TEXT,
  created_at TEXT NOT NULL,
  PRIMARY KEY (discord_message_id, discord_user_id, emoji_key)
);

CREATE INDEX IF NOT EXISTS idx_discord_reaction_activity_created
  ON discord_reaction_activity (created_at);

CREATE INDEX IF NOT EXISTS idx_discord_reaction_activity_user_created
  ON discord_reaction_activity (discord_user_id, created_at);

ALTER TABLE rootmc_active_participant_awards ADD COLUMN vote_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE rootmc_active_participant_awards ADD COLUMN reaction_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE rootmc_active_participant_awards ADD COLUMN activity_score INTEGER NOT NULL DEFAULT 0;
