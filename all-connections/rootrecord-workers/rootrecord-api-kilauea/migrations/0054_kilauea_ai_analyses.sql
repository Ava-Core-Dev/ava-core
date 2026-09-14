CREATE TABLE IF NOT EXISTS kilauea_ai_analyses (
  id TEXT PRIMARY KEY,
  source_type TEXT NOT NULL,
  source_id TEXT NOT NULL,
  source_time TEXT,
  severity TEXT,
  event TEXT,
  magnitude REAL,
  headline TEXT,
  url TEXT,
  free_text TEXT NOT NULL,
  pro_text TEXT NOT NULL,
  model TEXT,
  prompt_json TEXT NOT NULL,
  response_json TEXT NOT NULL,
  prior_report_id TEXT,
  discord_posted_at TEXT,
  created_at TEXT NOT NULL,
  UNIQUE(source_type, source_id)
);

CREATE INDEX IF NOT EXISTS idx_kilauea_ai_analyses_created
  ON kilauea_ai_analyses(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_kilauea_ai_analyses_source
  ON kilauea_ai_analyses(source_type, source_time DESC);
