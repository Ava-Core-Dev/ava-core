-- Paid Vote Shards: $1 = 100. Vote value only (not perks, not weekly awards, not P&L).
-- Pro 500/mo · Lifetime 3000 one-time · Lifetime listing-site ×2.
CREATE TABLE IF NOT EXISTS rootmc_paid_vote_shards (
  minecraft_uuid TEXT NOT NULL PRIMARY KEY,
  shards INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS rootmc_paid_vote_shard_ledger (
  id TEXT NOT NULL PRIMARY KEY,
  minecraft_uuid TEXT NOT NULL,
  kind TEXT NOT NULL,
  usd REAL,
  shards INTEGER NOT NULL,
  note TEXT,
  include_in_pnl INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_rootmc_paid_vote_shard_ledger_uuid
  ON rootmc_paid_vote_shard_ledger (minecraft_uuid);
