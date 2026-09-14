-- Weekly in-game playtime snapshots (delta = end-of-week total minus prior week).

CREATE TABLE IF NOT EXISTS rootmc_playtime_week_snapshots (
  server_id TEXT NOT NULL,
  week_key TEXT NOT NULL,
  minecraft_uuid TEXT NOT NULL,
  minecraft_username TEXT,
  total_playtime_seconds INTEGER NOT NULL DEFAULT 0,
  snapshot_at TEXT NOT NULL,
  PRIMARY KEY (server_id, week_key, minecraft_uuid)
);

CREATE INDEX IF NOT EXISTS idx_rootmc_playtime_week_snapshots_week
  ON rootmc_playtime_week_snapshots (server_id, week_key);

CREATE TABLE IF NOT EXISTS rootmc_top_active_player_awards (
  week_key TEXT NOT NULL,
  minecraft_uuid TEXT NOT NULL,
  discord_user_id TEXT NOT NULL,
  weekly_playtime_seconds INTEGER NOT NULL,
  minecraft_username TEXT,
  discord_display_name TEXT,
  role_granted INTEGER NOT NULL DEFAULT 1,
  posted_at TEXT NOT NULL,
  PRIMARY KEY (week_key, minecraft_uuid)
);

CREATE TABLE IF NOT EXISTS rootmc_weekly_activity_awards (
  week_key TEXT PRIMARY KEY NOT NULL,
  posted_at TEXT NOT NULL,
  message_id TEXT
);
