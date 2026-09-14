-- Live player count from RootMC heartbeat (realm snapshot Discord posts).
CREATE TABLE IF NOT EXISTS rootmc_server_live_stats (
  server_id TEXT PRIMARY KEY NOT NULL,
  online_players INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL
);
