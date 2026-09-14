-- Ava Shards ledger (vote power + tips). SPL mint address is optional until launch.
CREATE TABLE IF NOT EXISTS rg_ava_shard_balances (
  account_id TEXT PRIMARY KEY NOT NULL,
  shards INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS rg_ava_shard_ledger (
  id TEXT PRIMARY KEY NOT NULL,
  account_id TEXT NOT NULL,
  delta INTEGER NOT NULL,
  kind TEXT NOT NULL,
  ref TEXT NOT NULL,
  memo TEXT,
  created_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_rg_ava_shard_ledger_ref ON rg_ava_shard_ledger(ref);
CREATE INDEX IF NOT EXISTS idx_rg_ava_shard_ledger_account ON rg_ava_shard_ledger(account_id, created_at);

CREATE TABLE IF NOT EXISTS rg_ava_shard_meta (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  mint_base58 TEXT,
  updated_at TEXT NOT NULL
);

INSERT OR IGNORE INTO rg_ava_shard_meta (id, mint_base58, updated_at) VALUES (1, NULL, strftime('%Y-%m-%dT%H:%M:%fZ','now'));

ALTER TABLE rg_goal_donations ADD COLUMN fee_cents INTEGER;
ALTER TABLE rg_goal_donations ADD COLUMN fee_atomic TEXT;
ALTER TABLE rg_goal_donations ADD COLUMN net_cents INTEGER;
