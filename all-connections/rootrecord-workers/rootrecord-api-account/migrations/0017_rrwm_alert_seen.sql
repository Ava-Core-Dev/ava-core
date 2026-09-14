-- Remember which NOAA alert ids we've already pushed per user + saved location.
CREATE TABLE IF NOT EXISTS rrwm_alert_seen (
  user_id TEXT NOT NULL,
  location_id TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'noaa',
  alert_id TEXT NOT NULL,
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  PRIMARY KEY (user_id, location_id, source, alert_id)
);
CREATE INDEX IF NOT EXISTS idx_rrwm_alert_seen_user_loc ON rrwm_alert_seen(user_id, location_id);

