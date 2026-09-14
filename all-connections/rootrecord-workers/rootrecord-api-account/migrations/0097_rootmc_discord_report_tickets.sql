-- RootMC Discord: in-game /report tickets (private channel, thread, or forum post).

CREATE TABLE IF NOT EXISTS rootmc_discord_report_tickets (
  server_id TEXT NOT NULL,
  report_id TEXT NOT NULL,
  guild_id TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  ticket_kind TEXT NOT NULL DEFAULT 'text_channel',
  reporter_uuid TEXT NOT NULL,
  target_uuid TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  closed_at TEXT,
  PRIMARY KEY (server_id, report_id)
);

CREATE INDEX IF NOT EXISTS idx_rootmc_discord_report_tickets_status
  ON rootmc_discord_report_tickets (server_id, status, created_at DESC);
