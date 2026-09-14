-- Root Record Global Updater: per-guild channel + category subscriptions (public multi-server bot).
CREATE TABLE IF NOT EXISTS root_updates_discord_guild_config (
  guild_id TEXT PRIMARY KEY,
  channel_id TEXT NOT NULL,
  categories_json TEXT NOT NULL DEFAULT '[]',
  configured_by_discord_id TEXT,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_root_updates_discord_guild_config_updated
  ON root_updates_discord_guild_config(updated_at DESC);
