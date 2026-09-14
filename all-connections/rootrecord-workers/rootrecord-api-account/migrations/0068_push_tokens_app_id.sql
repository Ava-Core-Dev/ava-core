ALTER TABLE rrwm_push_tokens ADD COLUMN app_id TEXT;

CREATE INDEX IF NOT EXISTS idx_rrwm_push_tokens_app
  ON rrwm_push_tokens(app_id, updated_at DESC);
