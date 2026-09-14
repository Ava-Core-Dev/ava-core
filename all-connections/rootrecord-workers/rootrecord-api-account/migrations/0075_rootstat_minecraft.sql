-- RootStat: Minecraft UUID ↔ Root Record account linking (global D1)

CREATE TABLE IF NOT EXISTS rootstat_servers (
  server_id TEXT PRIMARY KEY NOT NULL,
  server_name TEXT,
  server_secret_hash TEXT NOT NULL,
  owner_account_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS rootstat_minecraft_links (
  minecraft_uuid TEXT PRIMARY KEY NOT NULL,
  minecraft_username TEXT NOT NULL,
  account_id TEXT NOT NULL,
  email TEXT,
  verified_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_rootstat_links_account
  ON rootstat_minecraft_links(account_id);

CREATE INDEX IF NOT EXISTS idx_rootstat_links_username
  ON rootstat_minecraft_links(minecraft_username COLLATE NOCASE);

CREATE TABLE IF NOT EXISTS rootstat_link_codes (
  code TEXT PRIMARY KEY NOT NULL,
  minecraft_uuid TEXT NOT NULL,
  minecraft_username TEXT NOT NULL,
  server_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  consumed_at TEXT,
  account_id TEXT
);

CREATE INDEX IF NOT EXISTS idx_rootstat_codes_uuid
  ON rootstat_link_codes(minecraft_uuid);

CREATE INDEX IF NOT EXISTS idx_rootstat_codes_expires
  ON rootstat_link_codes(expires_at);
