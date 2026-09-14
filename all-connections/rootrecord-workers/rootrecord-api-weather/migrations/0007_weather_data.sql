-- Append-only dashboard snapshots (cache + history). Used by GET /api/dashboard.

CREATE TABLE IF NOT EXISTS weather_data (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  location_id TEXT,
  grid_key TEXT NOT NULL,
  lat REAL NOT NULL,
  lon REAL NOT NULL,
  fetched_at TEXT NOT NULL,
  bundle_json TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_weather_data_user_grid_time
  ON weather_data (user_id, grid_key, fetched_at DESC);

CREATE INDEX IF NOT EXISTS idx_weather_data_user_location_time
  ON weather_data (user_id, location_id, fetched_at DESC);
