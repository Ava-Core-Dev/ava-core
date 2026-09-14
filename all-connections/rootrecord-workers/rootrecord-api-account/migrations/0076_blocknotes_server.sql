-- BlockNotes companion plugin + featured dedicated server metadata

ALTER TABLE rootstat_servers ADD COLUMN server_address TEXT;
ALTER TABLE rootstat_servers ADD COLUMN default_world_name TEXT;
ALTER TABLE rootstat_servers ADD COLUMN map_url TEXT;
ALTER TABLE rootstat_servers ADD COLUMN game_version TEXT;
ALTER TABLE rootstat_servers ADD COLUMN featured INTEGER NOT NULL DEFAULT 0;
ALTER TABLE rootstat_servers ADD COLUMN blocknotes_plugin_version TEXT;
ALTER TABLE rootstat_servers ADD COLUMN blocknotes_last_seen_at TEXT;

CREATE INDEX IF NOT EXISTS idx_rootstat_servers_featured
  ON rootstat_servers(featured);

CREATE INDEX IF NOT EXISTS idx_rootstat_servers_address
  ON rootstat_servers(server_address);
