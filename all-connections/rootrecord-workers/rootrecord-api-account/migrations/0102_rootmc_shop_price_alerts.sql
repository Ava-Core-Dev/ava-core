-- RootMC shop price alerts + FCM tokens (RootMC D1; app_id filters RootMC Android).

CREATE TABLE IF NOT EXISTS rrwm_push_tokens (
  token TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  platform TEXT NOT NULL DEFAULT 'android',
  updated_at TEXT NOT NULL,
  app_id TEXT
);

CREATE INDEX IF NOT EXISTS idx_rrwm_push_tokens_user ON rrwm_push_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_rrwm_push_tokens_app
  ON rrwm_push_tokens(app_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS rootmc_shop_price_alerts (
  id TEXT NOT NULL PRIMARY KEY,
  account_id TEXT NOT NULL,
  server_id TEXT NOT NULL,
  item_key TEXT NOT NULL,
  alert_type TEXT NOT NULL DEFAULT 'below',
  threshold_value REAL NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  last_seen_price REAL,
  last_notified_at TEXT,
  last_notified_price REAL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_rootmc_shop_alerts_account
  ON rootmc_shop_price_alerts (account_id, server_id, enabled);

CREATE UNIQUE INDEX IF NOT EXISTS idx_rootmc_shop_alerts_unique
  ON rootmc_shop_price_alerts (account_id, server_id, item_key, alert_type);
