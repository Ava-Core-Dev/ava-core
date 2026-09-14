-- rootmc-live core schema (never apply to D1 rootmc).
-- Section 1: global connection registry
CREATE TABLE IF NOT EXISTS server_connections (
  server_id TEXT PRIMARY KEY NOT NULL,
  display_name TEXT NOT NULL DEFAULT '',
  role TEXT NOT NULL DEFAULT '',
  game_address TEXT NOT NULL DEFAULT '',
  webstat_url TEXT NOT NULL DEFAULT '',
  mysql_binding TEXT NOT NULL DEFAULT '',
  mysql_database TEXT NOT NULL DEFAULT '',
  table_prefixes TEXT NOT NULL DEFAULT 'root_,towny_,mcmmo_',
  updated_at TEXT NOT NULL DEFAULT ''
);

-- Section 2: parents named by server_id
CREATE TABLE IF NOT EXISTS servers (
  server_id TEXT PRIMARY KEY NOT NULL,
  display_name TEXT NOT NULL DEFAULT '',
  role TEXT NOT NULL DEFAULT '',
  last_sync_at TEXT NOT NULL DEFAULT '',
  last_sync_ok INTEGER NOT NULL DEFAULT 0,
  table_count INTEGER NOT NULL DEFAULT 0,
  row_count INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT ''
);

-- Sync metadata for section 3 mirrors
CREATE TABLE IF NOT EXISTS sync_table_state (
  server_id TEXT NOT NULL,
  table_name TEXT NOT NULL,
  last_ok_at TEXT NOT NULL DEFAULT '',
  row_count INTEGER NOT NULL DEFAULT 0,
  error TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (server_id, table_name)
);

-- Hub-facing Times projections (filled from MySQL root_times_status via sync)
CREATE TABLE IF NOT EXISTS rootmc_server_times_status (
  server_id TEXT PRIMARY KEY NOT NULL,
  day_id INTEGER NOT NULL DEFAULT 0,
  tod_ticks INTEGER NOT NULL DEFAULT 0,
  full_time INTEGER NOT NULL DEFAULT 0,
  phase TEXT NOT NULL DEFAULT '',
  length_minutes INTEGER NOT NULL DEFAULT 30,
  online INTEGER NOT NULL DEFAULT 0,
  afk INTEGER NOT NULL DEFAULT 0,
  players_json TEXT NOT NULL DEFAULT '[]',
  plugins_json TEXT NOT NULL DEFAULT '[]',
  timezone TEXT NOT NULL DEFAULT 'UTC',
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS rootmc_server_times_samples (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  server_id TEXT NOT NULL,
  ts TEXT NOT NULL,
  online INTEGER NOT NULL DEFAULT 0,
  afk INTEGER NOT NULL DEFAULT 0,
  tod_ticks INTEGER NOT NULL DEFAULT 0,
  phase TEXT NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_live_times_samples_server_ts
  ON rootmc_server_times_samples (server_id, ts);

-- Seed Claims + Towny (IDs match rootstat_servers / cloud.yml)
INSERT OR REPLACE INTO server_connections (
  server_id, display_name, role, game_address, webstat_url,
  mysql_binding, mysql_database, table_prefixes, updated_at
) VALUES
(
  '4963895e-0964-48b8-81b7-1f40a966e8be',
  'Claims',
  'claims',
  'claims.rootmc.net',
  'https://claims.rootmc.net',
  'ROOTMC_MYSQL_CLAIMS',
  '49cc9f4e50-gen3',
  'root_,towny_,mcmmo_',
  datetime('now')
),
(
  '15bbc057-4f8b-4761-abdb-7b7e4d9c7512',
  'Towny',
  'towny',
  'play.rootmc.net',
  'https://towny.rootmc.net',
  'ROOTMC_MYSQL',
  '75eedc3b19-rootmc',
  'root_,towny_,mcmmo_',
  datetime('now')
);

INSERT OR IGNORE INTO servers (server_id, display_name, role, updated_at)
VALUES
  ('4963895e-0964-48b8-81b7-1f40a966e8be', 'Claims', 'claims', datetime('now')),
  ('15bbc057-4f8b-4761-abdb-7b7e4d9c7512', 'Towny', 'towny', datetime('now'));
