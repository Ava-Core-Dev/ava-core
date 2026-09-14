CREATE TABLE IF NOT EXISTS discord_ai_reports (
  id TEXT PRIMARY KEY,
  command_name TEXT NOT NULL,
  interaction_id TEXT,
  channel_id TEXT,
  guild_id TEXT,
  requested_by_discord_id TEXT NOT NULL,
  prompt_json TEXT NOT NULL,
  response_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_discord_ai_reports_command_created
  ON discord_ai_reports(command_name, created_at DESC);
