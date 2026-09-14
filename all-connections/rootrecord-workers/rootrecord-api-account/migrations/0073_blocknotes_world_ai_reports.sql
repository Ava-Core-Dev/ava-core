CREATE TABLE IF NOT EXISTS blocknotes_world_ai_reports (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  world_key TEXT NOT NULL,
  world_name TEXT NOT NULL,
  day_utc TEXT NOT NULL,
  month_utc TEXT NOT NULL,
  summary_text TEXT NOT NULL,
  report_text TEXT NOT NULL,
  stats_json TEXT NOT NULL,
  source_data_json TEXT NOT NULL,
  model TEXT,
  prompt_json TEXT NOT NULL,
  response_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_blocknotes_world_ai_user_world_created
  ON blocknotes_world_ai_reports(user_id, world_key, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_blocknotes_world_ai_user_day
  ON blocknotes_world_ai_reports(user_id, day_utc);

CREATE INDEX IF NOT EXISTS idx_blocknotes_world_ai_user_month
  ON blocknotes_world_ai_reports(user_id, month_utc);
