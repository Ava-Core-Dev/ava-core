CREATE TABLE IF NOT EXISTS roots_onchain_scan_state (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS roots_onchain_buy_notifications (
  signature TEXT PRIMARY KEY,
  slot INTEGER NOT NULL DEFAULT 0,
  mint TEXT NOT NULL,
  buyer_owner TEXT,
  buyer_token_account TEXT,
  amount_raw TEXT NOT NULL,
  amount_ui TEXT NOT NULL,
  notified_channel_id TEXT NOT NULL,
  notified_at TEXT NOT NULL,
  details_json TEXT NOT NULL DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_roots_onchain_buy_notifications_notified_at
  ON roots_onchain_buy_notifications(notified_at);
