-- RootMC season arcs — community-voted rotating announcer themes.

ALTER TABLE rootmc_community_proposals ADD COLUMN kind TEXT NOT NULL DEFAULT 'general';
ALTER TABLE rootmc_community_proposals ADD COLUMN season_theme TEXT;
ALTER TABLE rootmc_community_proposals ADD COLUMN season_lines_json TEXT;

CREATE TABLE IF NOT EXISTS rootmc_season_arcs (
  id TEXT NOT NULL PRIMARY KEY,
  server_id TEXT NOT NULL DEFAULT 'rootmc',
  title TEXT NOT NULL,
  theme TEXT NOT NULL,
  announcer_lines_json TEXT NOT NULL,
  proposal_id TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  activated_at TEXT NOT NULL,
  ends_at TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (proposal_id) REFERENCES rootmc_community_proposals(id)
);

CREATE INDEX IF NOT EXISTS idx_rootmc_season_server_status
  ON rootmc_season_arcs (server_id, status);
