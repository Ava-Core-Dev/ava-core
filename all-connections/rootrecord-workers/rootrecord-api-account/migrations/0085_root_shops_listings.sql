-- Root Shops: per-sign listings synced from SMP (BlockNotes economy scan).

CREATE TABLE IF NOT EXISTS rootstat_shop_listings (
  server_id TEXT NOT NULL,
  shop_id TEXT NOT NULL,
  owner_uuid TEXT,
  owner_username TEXT,
  world_name TEXT NOT NULL,
  x INTEGER NOT NULL,
  y INTEGER NOT NULL,
  z INTEGER NOT NULL,
  item_key TEXT NOT NULL,
  price REAL NOT NULL,
  listing_type TEXT NOT NULL DEFAULT 'sell',
  synced_at TEXT NOT NULL,
  PRIMARY KEY (server_id, shop_id)
);

CREATE INDEX IF NOT EXISTS idx_rootstat_shop_listings_owner
  ON rootstat_shop_listings (server_id, owner_uuid);

CREATE INDEX IF NOT EXISTS idx_rootstat_shop_listings_item
  ON rootstat_shop_listings (server_id, item_key);
