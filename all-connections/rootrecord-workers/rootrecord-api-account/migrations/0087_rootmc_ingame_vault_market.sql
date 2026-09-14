-- RootMC: in-game capture, offline vault, stock market price history

CREATE TABLE IF NOT EXISTS rootmc_ingame_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  server_id TEXT NOT NULL,
  minecraft_uuid TEXT NOT NULL,
  minecraft_username TEXT,
  account_id TEXT,
  event_type TEXT NOT NULL,
  world_name TEXT NOT NULL,
  dimension TEXT NOT NULL DEFAULT 'overworld',
  x REAL NOT NULL,
  y REAL NOT NULL,
  z REAL NOT NULL,
  label TEXT,
  body TEXT,
  created_at TEXT NOT NULL,
  synced_to_account_at TEXT,
  consumed_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_rootmc_ingame_uuid
  ON rootmc_ingame_events(server_id, minecraft_uuid, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_rootmc_ingame_account
  ON rootmc_ingame_events(account_id, consumed_at, created_at DESC);

CREATE TABLE IF NOT EXISTS rootmc_vault_orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  server_id TEXT NOT NULL,
  account_id TEXT NOT NULL,
  minecraft_uuid TEXT,
  item_key TEXT NOT NULL,
  quantity INTEGER NOT NULL,
  price_paid REAL NOT NULL DEFAULT 0,
  shop_id TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT NOT NULL,
  claimed_at TEXT,
  expires_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_rootmc_vault_account
  ON rootmc_vault_orders(account_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_rootmc_vault_uuid
  ON rootmc_vault_orders(minecraft_uuid, status);

CREATE TABLE IF NOT EXISTS rootmc_shop_price_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  server_id TEXT NOT NULL,
  item_key TEXT NOT NULL,
  avg_price REAL NOT NULL,
  sample_count INTEGER NOT NULL DEFAULT 0,
  recorded_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_rootmc_price_history
  ON rootmc_shop_price_history(server_id, item_key, recorded_at DESC);

-- Canonical RootMC server row (legacy rootrecord-smp rows remain valid via server_id lookup)
INSERT OR IGNORE INTO rootstat_servers (server_id, server_name, server_secret_hash, created_at, updated_at)
SELECT 'rootmc', 'RootMC', server_secret_hash, datetime('now'), datetime('now')
FROM rootstat_servers WHERE server_id = 'rootrecord-smp' LIMIT 1;

UPDATE rootstat_servers
SET server_name = 'RootMC',
    server_address = COALESCE(server_address, '15.204.13.9:25565'),
    default_world_name = 'RootMC',
    map_url = COALESCE(map_url, 'http://15.204.13.9:22784/'),
    featured = 1,
    updated_at = datetime('now')
WHERE server_id IN ('rootmc', 'rootrecord-smp');
