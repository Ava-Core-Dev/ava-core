-- Weekly legislature: citizen items → compiled bill → amendments → Council vote.

CREATE TABLE IF NOT EXISTS rootmc_legislation_items (
  id TEXT NOT NULL PRIMARY KEY,
  week_key TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'governance',
  status TEXT NOT NULL DEFAULT 'pending',
  created_by_discord_id TEXT NOT NULL,
  minecraft_uuid TEXT,
  minecraft_username TEXT,
  submit_weight REAL NOT NULL DEFAULT 0,
  channel_id TEXT,
  message_id TEXT,
  bill_id TEXT,
  created_at TEXT NOT NULL,
  retracted_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_rootmc_legislation_items_week_status
  ON rootmc_legislation_items (week_key, status);

CREATE TABLE IF NOT EXISTS rootmc_weekly_bills (
  id TEXT NOT NULL PRIMARY KEY,
  week_key TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  item_count INTEGER NOT NULL DEFAULT 0,
  amendment_period_ends_at TEXT NOT NULL,
  vote_closes_at TEXT,
  proposal_id TEXT,
  channel_id TEXT,
  message_id TEXT,
  created_at TEXT NOT NULL,
  closed_at TEXT,
  result_summary TEXT
);

CREATE TABLE IF NOT EXISTS rootmc_bill_amendments (
  id TEXT NOT NULL PRIMARY KEY,
  bill_id TEXT NOT NULL,
  item_id TEXT,
  amendment_text TEXT NOT NULL,
  created_by_discord_id TEXT NOT NULL,
  minecraft_username TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (bill_id) REFERENCES rootmc_weekly_bills(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_rootmc_bill_amendments_bill
  ON rootmc_bill_amendments (bill_id, created_at);
