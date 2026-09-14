ALTER TABLE rr_farms_progress ADD COLUMN store_json TEXT NOT NULL DEFAULT '{}';

CREATE TABLE IF NOT EXISTS rr_farms_varmint_events (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL,
  event_kind TEXT NOT NULL,
  plot_id INTEGER,
  payload_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  acked_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_rr_farms_varmint_user_pending ON rr_farms_varmint_events (user_id, acked_at);
