-- RootMC Discord per-user message ingest + weekly awards / weekly report idempotency.

CREATE TABLE IF NOT EXISTS discord_user_activity (
  discord_user_id TEXT PRIMARY KEY NOT NULL,
  username TEXT,
  global_name TEXT,
  last_message_at TEXT NOT NULL,
  last_message_id TEXT,
  message_count INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_discord_user_activity_last_message_at
  ON discord_user_activity (last_message_at);

CREATE TABLE IF NOT EXISTS discord_message_activity (
  discord_message_id TEXT PRIMARY KEY NOT NULL,
  channel_id TEXT NOT NULL,
  guild_id TEXT NOT NULL,
  discord_user_id TEXT NOT NULL,
  username TEXT,
  global_name TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_discord_message_activity_created
  ON discord_message_activity (created_at);

CREATE INDEX IF NOT EXISTS idx_discord_message_activity_user_created
  ON discord_message_activity (discord_user_id, created_at);

CREATE TABLE IF NOT EXISTS discord_channel_sync_state (
  channel_id TEXT PRIMARY KEY NOT NULL,
  last_message_id TEXT,
  last_sync_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS rootmc_weekly_reports (
  server_id TEXT NOT NULL,
  week_key TEXT NOT NULL,
  posted_at TEXT NOT NULL,
  channel_id TEXT,
  message_id TEXT,
  summary TEXT,
  report_text TEXT,
  metrics_fingerprint TEXT,
  grok_model TEXT,
  grok_ok INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (server_id, week_key)
);

CREATE TABLE IF NOT EXISTS rootmc_weekly_category_reports (
  server_id TEXT NOT NULL,
  week_key TEXT NOT NULL,
  category TEXT NOT NULL,
  posted_at TEXT NOT NULL,
  channel_id TEXT,
  message_id TEXT,
  summary TEXT,
  report_text TEXT,
  metrics_fingerprint TEXT,
  grok_ok INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (server_id, week_key, category)
);

CREATE TABLE IF NOT EXISTS rootmc_active_participant_awards (
  week_key TEXT NOT NULL,
  discord_user_id TEXT NOT NULL,
  rank INTEGER NOT NULL,
  message_count INTEGER NOT NULL,
  username TEXT,
  role_granted INTEGER NOT NULL DEFAULT 1,
  posted_at TEXT NOT NULL,
  message_id TEXT,
  PRIMARY KEY (week_key, discord_user_id)
);

CREATE INDEX IF NOT EXISTS idx_rootmc_active_participant_awards_week
  ON rootmc_active_participant_awards (week_key, rank);
