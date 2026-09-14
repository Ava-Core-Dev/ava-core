-- Tracks recent signed-in app opens for Root Farms orchard app-bonus trees.
CREATE TABLE IF NOT EXISTS rr_app_session_last_open (
  user_id TEXT NOT NULL,
  app_id TEXT NOT NULL,
  last_open_at TEXT NOT NULL,
  PRIMARY KEY (user_id, app_id)
);

CREATE INDEX IF NOT EXISTS idx_rr_app_session_last_open_user_time
  ON rr_app_session_last_open(user_id, last_open_at DESC);
