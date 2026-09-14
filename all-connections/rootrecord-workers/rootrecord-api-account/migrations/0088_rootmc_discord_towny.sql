-- RootMC Discord: Towny town/nation snapshots + per-guild channel mapping.

CREATE TABLE IF NOT EXISTS rootmc_towny_towns (
  server_id TEXT NOT NULL,
  town_uuid TEXT NOT NULL,
  town_name TEXT NOT NULL,
  mayor_uuid TEXT,
  mayor_name TEXT,
  resident_count INTEGER NOT NULL DEFAULT 0,
  nation_uuid TEXT,
  nation_name TEXT,
  is_capital INTEGER NOT NULL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 1,
  synced_at TEXT NOT NULL,
  PRIMARY KEY (server_id, town_uuid)
);

CREATE INDEX IF NOT EXISTS idx_rootmc_towny_towns_active
  ON rootmc_towny_towns (server_id, is_active, resident_count DESC);

CREATE TABLE IF NOT EXISTS rootmc_towny_nations (
  server_id TEXT NOT NULL,
  nation_uuid TEXT NOT NULL,
  nation_name TEXT NOT NULL,
  leader_uuid TEXT,
  leader_name TEXT,
  town_count INTEGER NOT NULL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 1,
  synced_at TEXT NOT NULL,
  PRIMARY KEY (server_id, nation_uuid)
);

CREATE INDEX IF NOT EXISTS idx_rootmc_towny_nations_active
  ON rootmc_towny_nations (server_id, is_active, town_count DESC);

CREATE TABLE IF NOT EXISTS rootmc_discord_town_channels (
  server_id TEXT NOT NULL,
  town_uuid TEXT NOT NULL,
  guild_id TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  invite_url TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (server_id, town_uuid)
);

CREATE TABLE IF NOT EXISTS rootmc_discord_nation_channels (
  server_id TEXT NOT NULL,
  nation_uuid TEXT NOT NULL,
  guild_id TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  invite_url TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (server_id, nation_uuid)
);
