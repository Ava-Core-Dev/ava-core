-- RootMC webstat snapshots (dedicated D1: rootmc-webstat)
-- One snapshot per (server_id, mc_day_id); each published metric as its own row.

CREATE TABLE IF NOT EXISTS webstat_snapshots (
  server_id TEXT NOT NULL,
  mc_day_id INTEGER NOT NULL,
  completed_mc_day_id INTEGER,
  full_time INTEGER,
  ticks_per_day INTEGER NOT NULL DEFAULT 24000,
  server_name TEXT,
  computed_at TEXT,
  schema_version TEXT NOT NULL DEFAULT 'root-webstat/v1',
  source TEXT,
  ingest_via TEXT NOT NULL DEFAULT 'push',
  ingested_at TEXT NOT NULL,
  PRIMARY KEY (server_id, mc_day_id)
);

CREATE INDEX IF NOT EXISTS idx_webstat_snapshots_ingested
  ON webstat_snapshots (ingested_at DESC);

CREATE TABLE IF NOT EXISTS webstat_series_values (
  server_id TEXT NOT NULL,
  mc_day_id INTEGER NOT NULL,
  series_id TEXT NOT NULL,
  metric TEXT NOT NULL,
  value_real REAL NOT NULL DEFAULT 0,
  unit TEXT,
  holder TEXT,
  ingested_at TEXT NOT NULL,
  PRIMARY KEY (server_id, mc_day_id, series_id, metric)
);

CREATE INDEX IF NOT EXISTS idx_webstat_series_day
  ON webstat_series_values (mc_day_id, series_id);
