CREATE TABLE IF NOT EXISTS rrwm_locations (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  latitude REAL NOT NULL,
  longitude REAL NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_rrwm_locations_user ON rrwm_locations(user_id);
CREATE INDEX IF NOT EXISTS idx_rrwm_locations_user_id ON rrwm_locations(user_id, id);
