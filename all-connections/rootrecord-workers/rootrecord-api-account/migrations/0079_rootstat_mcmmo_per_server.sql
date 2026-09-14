-- McMMO stats scoped per RootStat server (not merged across SMPs)

ALTER TABLE rootstat_servers ADD COLUMN rootstat_last_seen_at TEXT;

CREATE TABLE IF NOT EXISTS rootstat_mcmmo_stats_new (
  server_id TEXT NOT NULL,
  minecraft_uuid TEXT NOT NULL,
  minecraft_username TEXT,
  power_level INTEGER NOT NULL DEFAULT 0,
  skills_json TEXT NOT NULL DEFAULT '{}',
  synced_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (server_id, minecraft_uuid)
);

INSERT INTO rootstat_mcmmo_stats_new (
  server_id, minecraft_uuid, minecraft_username, power_level, skills_json, synced_at, updated_at
)
SELECT
  COALESCE(
    (SELECT server_id FROM rootstat_servers WHERE featured = 1 ORDER BY updated_at DESC LIMIT 1),
    (SELECT server_id FROM rootstat_servers ORDER BY updated_at DESC LIMIT 1),
    'rootrecord-smp'
  ),
  minecraft_uuid,
  minecraft_username,
  power_level,
  skills_json,
  synced_at,
  updated_at
FROM rootstat_mcmmo_stats;

DROP TABLE rootstat_mcmmo_stats;
ALTER TABLE rootstat_mcmmo_stats_new RENAME TO rootstat_mcmmo_stats;

CREATE INDEX IF NOT EXISTS idx_rootstat_mcmmo_username
  ON rootstat_mcmmo_stats(minecraft_username COLLATE NOCASE);

CREATE INDEX IF NOT EXISTS idx_rootstat_mcmmo_server
  ON rootstat_mcmmo_stats(server_id);
