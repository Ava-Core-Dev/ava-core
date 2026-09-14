-- Server Reserve balance snapshots (from economy heartbeat) + column on sync state.

ALTER TABLE rootmc_treasury_sync_state ADD COLUMN treasury_balance REAL;

CREATE TABLE IF NOT EXISTS rootmc_treasury_balance_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  server_id TEXT NOT NULL,
  balance REAL NOT NULL,
  recorded_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_rootmc_treasury_balance_snapshots_server
  ON rootmc_treasury_balance_snapshots (server_id, recorded_at DESC);
