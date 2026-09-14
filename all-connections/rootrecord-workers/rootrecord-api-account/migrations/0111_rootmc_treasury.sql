-- Treasury ledger sync, monthly playtime, activity dividend payouts, town tax leaderboard.

CREATE TABLE IF NOT EXISTS rootmc_treasury_ledger (
  server_id TEXT NOT NULL,
  mysql_id INTEGER NOT NULL,
  entry_type TEXT NOT NULL,
  amount REAL NOT NULL,
  from_uuid TEXT,
  to_uuid TEXT,
  details TEXT,
  created_at TEXT NOT NULL,
  synced_at TEXT NOT NULL,
  PRIMARY KEY (server_id, mysql_id)
);

CREATE INDEX IF NOT EXISTS idx_rootmc_treasury_ledger_month
  ON rootmc_treasury_ledger (server_id, created_at);

CREATE TABLE IF NOT EXISTS rootmc_playtime_monthly (
  server_id TEXT NOT NULL,
  minecraft_uuid TEXT NOT NULL,
  month_key TEXT NOT NULL,
  playtime_seconds INTEGER NOT NULL DEFAULT 0,
  synced_at TEXT NOT NULL,
  PRIMARY KEY (server_id, minecraft_uuid, month_key)
);

CREATE INDEX IF NOT EXISTS idx_rootmc_playtime_monthly_month
  ON rootmc_playtime_monthly (server_id, month_key, playtime_seconds);

CREATE TABLE IF NOT EXISTS rootmc_treasury_dividend_runs (
  server_id TEXT NOT NULL,
  month_key TEXT NOT NULL,
  pool_amount REAL NOT NULL,
  eligible_players INTEGER NOT NULL,
  total_eligible_seconds INTEGER NOT NULL,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (server_id, month_key)
);

CREATE TABLE IF NOT EXISTS rootmc_treasury_dividend_payouts (
  id TEXT PRIMARY KEY,
  server_id TEXT NOT NULL,
  month_key TEXT NOT NULL,
  minecraft_uuid TEXT NOT NULL,
  minecraft_username TEXT,
  amount REAL NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT NOT NULL,
  applied_at TEXT,
  error_message TEXT
);

CREATE INDEX IF NOT EXISTS idx_rootmc_dividend_payouts_pending
  ON rootmc_treasury_dividend_payouts (server_id, status);

CREATE TABLE IF NOT EXISTS rootmc_town_tax_rates (
  server_id TEXT NOT NULL,
  town_name TEXT NOT NULL,
  mayor_name TEXT,
  tax_percent REAL,
  synced_at TEXT NOT NULL,
  PRIMARY KEY (server_id, town_name)
);

CREATE TABLE IF NOT EXISTS rootmc_treasury_sync_state (
  server_id TEXT PRIMARY KEY,
  last_ledger_mysql_id INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL
);
