-- Record Units: tester engagement, future treasury bridge (in-app only).
CREATE TABLE IF NOT EXISTS rr_earn_balance (
  user_id TEXT NOT NULL PRIMARY KEY,
  balance INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL
);

-- UTC calendar day (YYYY-MM-DD) totals and daily check-in flag.
CREATE TABLE IF NOT EXISTS rr_earn_day (
  user_id TEXT NOT NULL,
  ymd TEXT NOT NULL,
  units_earned INTEGER NOT NULL DEFAULT 0,
  checkin_claimed INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (user_id, ymd)
);

-- Current focus per (user, app) for per-page time caps; resets on navigation.
CREATE TABLE IF NOT EXISTS rr_earn_state (
  user_id TEXT NOT NULL,
  app_id TEXT NOT NULL,
  page_path TEXT NOT NULL,
  t_enter_ms INTEGER NOT NULL,
  sec_on_page INTEGER NOT NULL DEFAULT 0,
  last_heartbeat_ms INTEGER NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (user_id, app_id)
);

CREATE TABLE IF NOT EXISTS rr_earn_app_day (
  user_id TEXT NOT NULL,
  app_id TEXT NOT NULL,
  ymd TEXT NOT NULL,
  units_earned INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (user_id, app_id, ymd)
);

CREATE TABLE IF NOT EXISTS rr_earn_app_total (
  user_id TEXT NOT NULL,
  app_id TEXT NOT NULL,
  total_units INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (user_id, app_id)
);

CREATE INDEX IF NOT EXISTS idx_rr_earn_app_day_ymd ON rr_earn_app_day(ymd);
CREATE INDEX IF NOT EXISTS idx_rr_earn_state_user ON rr_earn_state(user_id);
