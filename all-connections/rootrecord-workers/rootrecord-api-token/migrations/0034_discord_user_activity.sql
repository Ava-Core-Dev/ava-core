-- Aggregated Discord author stats from the announcements channel poll (see discord-developer-sync.ts).
-- PII: Discord user id + display fields; internal ops only.
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
