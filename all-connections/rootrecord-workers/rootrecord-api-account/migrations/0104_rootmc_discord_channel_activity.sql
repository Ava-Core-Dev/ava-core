-- RootMC daily reports: Discord guild channel registry + activity aggregates.
-- (Subset of 0037 — no DROP; safe on fresh RootMC D1.)

CREATE TABLE IF NOT EXISTS discord_discovered_channels (
  channel_id TEXT PRIMARY KEY NOT NULL,
  guild_id TEXT NOT NULL,
  name TEXT,
  type INTEGER NOT NULL,
  position INTEGER NOT NULL DEFAULT 0,
  parent_id TEXT,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_discord_discovered_channels_guild
  ON discord_discovered_channels (guild_id);

CREATE TABLE IF NOT EXISTS discord_channel_message_stats (
  discord_message_id TEXT PRIMARY KEY NOT NULL,
  channel_id TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_discord_channel_message_stats_channel
  ON discord_channel_message_stats (channel_id);

CREATE TABLE IF NOT EXISTS discord_activity_daily_by_channel (
  day TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  message_count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, channel_id)
);
