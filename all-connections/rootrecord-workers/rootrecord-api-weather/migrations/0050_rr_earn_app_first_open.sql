-- One-time Root Units grant per signed-in user per app (first open). Token Manager excluded in app code.
CREATE TABLE IF NOT EXISTS rr_earn_app_first_open (
  user_id TEXT NOT NULL,
  app_id TEXT NOT NULL,
  units INTEGER NOT NULL,
  granted_at TEXT NOT NULL,
  PRIMARY KEY (user_id, app_id)
);

CREATE INDEX IF NOT EXISTS idx_rr_earn_app_first_open_app ON rr_earn_app_first_open(app_id);
