CREATE TABLE IF NOT EXISTS weather_location_ai_reports (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  location_id TEXT NOT NULL,
  day_utc TEXT NOT NULL,
  location_name TEXT NOT NULL,
  latitude REAL NOT NULL,
  longitude REAL NOT NULL,
  weather_data_id INTEGER,
  weather_fetched_at TEXT,
  summary_text TEXT NOT NULL,
  report_text TEXT NOT NULL,
  source_data_json TEXT NOT NULL,
  model TEXT,
  prompt_json TEXT NOT NULL,
  response_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_weather_location_ai_user_loc_created
  ON weather_location_ai_reports(user_id, location_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_weather_location_ai_user_loc_day
  ON weather_location_ai_reports(user_id, location_id, day_utc);
