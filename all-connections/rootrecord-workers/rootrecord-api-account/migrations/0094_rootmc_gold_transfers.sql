-- Discord /pay gold transfers — D1 ledger + pending Vault apply on game server sync.

CREATE TABLE IF NOT EXISTS rootmc_gold_transfers (
  id TEXT NOT NULL PRIMARY KEY,
  server_id TEXT NOT NULL,
  from_uuid TEXT NOT NULL,
  from_username TEXT,
  to_uuid TEXT NOT NULL,
  to_username TEXT,
  amount REAL NOT NULL,
  source TEXT NOT NULL DEFAULT 'discord',
  discord_from_user_id TEXT,
  discord_to_user_id TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT NOT NULL,
  applied_at TEXT,
  error_message TEXT
);

CREATE INDEX IF NOT EXISTS idx_rootmc_gold_transfers_pending
  ON rootmc_gold_transfers (server_id, status, created_at);
