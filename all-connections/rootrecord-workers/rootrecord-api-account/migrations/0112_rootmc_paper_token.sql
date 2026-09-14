-- Paper ROOTMC sim: USD price feed (Helius/Jupiter via Worker) + history for charts.

CREATE TABLE IF NOT EXISTS rootmc_paper_token_price (
  server_id TEXT NOT NULL DEFAULT 'default',
  mint TEXT NOT NULL,
  price_usd REAL NOT NULL,
  g_per_unit REAL NOT NULL,
  source TEXT NOT NULL,
  fetched_at TEXT NOT NULL,
  PRIMARY KEY (server_id, mint)
);

CREATE TABLE IF NOT EXISTS rootmc_paper_token_price_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  server_id TEXT NOT NULL,
  mint TEXT NOT NULL,
  price_usd REAL NOT NULL,
  g_per_unit REAL NOT NULL,
  source TEXT NOT NULL,
  recorded_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_rootmc_paper_token_history_time
  ON rootmc_paper_token_price_history (server_id, mint, recorded_at DESC);
