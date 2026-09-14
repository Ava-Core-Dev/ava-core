-- McMMO skill snapshots pushed from RootStat (MySQL → D1)

CREATE TABLE IF NOT EXISTS rootstat_mcmmo_stats (
  minecraft_uuid TEXT PRIMARY KEY NOT NULL,
  minecraft_username TEXT,
  power_level INTEGER NOT NULL DEFAULT 0,
  skills_json TEXT NOT NULL DEFAULT '{}',
  synced_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_rootstat_mcmmo_username
  ON rootstat_mcmmo_stats(minecraft_username COLLATE NOCASE);
