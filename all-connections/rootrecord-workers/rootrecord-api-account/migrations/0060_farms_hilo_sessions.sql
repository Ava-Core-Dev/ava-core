CREATE TABLE IF NOT EXISTS rr_farms_hilo_sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  stake INTEGER NOT NULL,
  bank INTEGER NOT NULL,
  current_card INTEGER NOT NULL,
  drawn_cards_json TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'active',
  rounds INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  resolved_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_rr_farms_hilo_sessions_user_status
  ON rr_farms_hilo_sessions(user_id, status, created_at);
