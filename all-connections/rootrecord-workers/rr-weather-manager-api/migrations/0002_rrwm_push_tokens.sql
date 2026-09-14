-- FCM registration tokens (parity with Mongo collection `push_tokens` on FastAPI).
CREATE TABLE IF NOT EXISTS rrwm_push_tokens (
  token TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  platform TEXT NOT NULL DEFAULT 'android',
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_rrwm_push_tokens_user ON rrwm_push_tokens(user_id);
