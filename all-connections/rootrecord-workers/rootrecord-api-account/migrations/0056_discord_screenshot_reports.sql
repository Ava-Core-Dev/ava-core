CREATE TABLE IF NOT EXISTS discord_screenshot_reports (
  id TEXT PRIMARY KEY,
  interaction_id TEXT,
  channel_id TEXT,
  guild_id TEXT,
  requested_by_discord_id TEXT NOT NULL,
  prompt_json TEXT NOT NULL,
  response_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_discord_screenshot_reports_created
  ON discord_screenshot_reports(created_at DESC);
