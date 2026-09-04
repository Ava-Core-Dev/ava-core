-- RootMC live cache on D1 (edge copy of host MySQL)
-- Host cron d1_sync upserts these rows
-- Workers read them when Ava is offline
-- Hyperdrive is the live SQL path for workers

CREATE TABLE IF NOT EXISTS sync_meta (
  name       TEXT PRIMARY KEY,
  updated_at TEXT NOT NULL,
  row_count  INTEGER NOT NULL DEFAULT 0,
  ok         INTEGER NOT NULL DEFAULT 1,
  detail     TEXT
);

CREATE TABLE IF NOT EXISTS player_balances (
  uuid       TEXT PRIMARY KEY,
  name       TEXT,
  balance    REAL NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS player_playtime (
  uuid       TEXT PRIMARY KEY,
  name       TEXT,
  seconds    INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS server_status (
  id         TEXT PRIMARY KEY,
  online     INTEGER NOT NULL DEFAULT 0,
  players    INTEGER,
  max_players INTEGER,
  motd       TEXT,
  updated_at TEXT NOT NULL,
  detail     TEXT
);

CREATE TABLE IF NOT EXISTS economy_snapshot (
  id         TEXT PRIMARY KEY,
  circulating REAL,
  treasury    REAL,
  updated_at  TEXT NOT NULL,
  json        TEXT
);
