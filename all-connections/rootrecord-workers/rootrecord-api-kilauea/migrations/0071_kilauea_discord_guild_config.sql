-- Per-guild Kīlauea Alerts Discord bot settings (public bot / multi-server).
CREATE TABLE IF NOT EXISTS kilauea_discord_guild_config (
  guild_id TEXT PRIMARY KEY,
  alerts_channel_id TEXT NOT NULL,
  reports_channel_id TEXT,
  configured_by_discord_id TEXT,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_kilauea_discord_guild_config_updated
  ON kilauea_discord_guild_config(updated_at DESC);

-- USGS quake dedupe per guild (same event may post to many servers).
CREATE TABLE IF NOT EXISTS kilauea_discord_guild_quake_post (
  guild_id TEXT NOT NULL,
  event_id TEXT NOT NULL,
  posted_at TEXT NOT NULL,
  PRIMARY KEY (guild_id, event_id)
);

CREATE INDEX IF NOT EXISTS idx_kilauea_discord_guild_quake_post_at
  ON kilauea_discord_guild_quake_post(posted_at DESC);
