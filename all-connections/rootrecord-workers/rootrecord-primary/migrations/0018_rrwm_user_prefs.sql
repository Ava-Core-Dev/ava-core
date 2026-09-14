-- Per-user preferences for Weather Manager Mobile.
CREATE TABLE IF NOT EXISTS rrwm_user_prefs (
  user_id TEXT PRIMARY KEY,
  noaa_alerts_enabled INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL
);

