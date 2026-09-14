-- Per-server playtime (join date, last login, total seconds in-game)

CREATE TABLE IF NOT EXISTS rootstat_player_playtime (
  server_id TEXT NOT NULL,
  minecraft_uuid TEXT NOT NULL,
  minecraft_username TEXT,
  total_playtime_seconds INTEGER NOT NULL DEFAULT 0,
  first_join_at TEXT,
  last_login_at TEXT,
  synced_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (server_id, minecraft_uuid)
);

CREATE INDEX IF NOT EXISTS idx_rootstat_playtime_server
  ON rootstat_player_playtime(server_id);
