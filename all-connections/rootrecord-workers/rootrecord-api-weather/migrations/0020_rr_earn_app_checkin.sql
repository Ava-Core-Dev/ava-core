-- Per-app daily check-in (independent of other apps the same day).
ALTER TABLE rr_earn_app_day ADD COLUMN checkin_claimed INTEGER NOT NULL DEFAULT 0;
