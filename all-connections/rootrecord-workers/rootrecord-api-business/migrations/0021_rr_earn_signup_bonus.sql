-- One-time account signup bonus (same user id as earn: `user:email`); not per app.
CREATE TABLE IF NOT EXISTS rr_earn_signup_bonus (
  user_id TEXT NOT NULL PRIMARY KEY,
  units INTEGER NOT NULL,
  granted_at TEXT NOT NULL
);
