-- Block Notes economy: shop prices, balances, item totals, net worth

CREATE TABLE IF NOT EXISTS rootstat_shop_prices (
  server_id TEXT NOT NULL,
  item_key TEXT NOT NULL,
  avg_price REAL NOT NULL DEFAULT 0,
  sample_count INTEGER NOT NULL DEFAULT 0,
  source TEXT NOT NULL DEFAULT 'sign_scan',
  synced_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (server_id, item_key)
);

CREATE TABLE IF NOT EXISTS rootstat_player_balances (
  server_id TEXT NOT NULL,
  minecraft_uuid TEXT NOT NULL,
  minecraft_username TEXT,
  balance REAL NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'default',
  synced_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (server_id, minecraft_uuid)
);

CREATE TABLE IF NOT EXISTS rootstat_player_item_totals (
  server_id TEXT NOT NULL,
  minecraft_uuid TEXT NOT NULL,
  item_key TEXT NOT NULL,
  quantity INTEGER NOT NULL DEFAULT 0,
  source TEXT NOT NULL DEFAULT 'inventory',
  synced_at TEXT NOT NULL,
  PRIMARY KEY (server_id, minecraft_uuid, item_key)
);

CREATE TABLE IF NOT EXISTS rootstat_server_item_totals (
  server_id TEXT NOT NULL,
  item_key TEXT NOT NULL,
  total_quantity INTEGER NOT NULL DEFAULT 0,
  synced_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (server_id, item_key)
);

CREATE TABLE IF NOT EXISTS rootstat_player_net_worth (
  server_id TEXT NOT NULL,
  minecraft_uuid TEXT NOT NULL,
  minecraft_username TEXT,
  balance_value REAL NOT NULL DEFAULT 0,
  inventory_value REAL NOT NULL DEFAULT 0,
  chest_value REAL NOT NULL DEFAULT 0,
  shop_stock_value REAL NOT NULL DEFAULT 0,
  total_value REAL NOT NULL DEFAULT 0,
  ranked_at TEXT NOT NULL,
  synced_at TEXT NOT NULL,
  PRIMARY KEY (server_id, minecraft_uuid)
);

CREATE INDEX IF NOT EXISTS idx_rootstat_net_worth_server_rank
  ON rootstat_player_net_worth(server_id, total_value DESC);

CREATE INDEX IF NOT EXISTS idx_rootstat_server_items_server
  ON rootstat_server_item_totals(server_id);
