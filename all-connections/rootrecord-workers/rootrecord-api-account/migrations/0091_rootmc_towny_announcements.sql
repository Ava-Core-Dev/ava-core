-- Dedupe Towny founded/fallen announcements to Discord general-info channels.

CREATE TABLE IF NOT EXISTS rootmc_towny_announcement_events (
  server_id TEXT NOT NULL,
  entity_kind TEXT NOT NULL,
  entity_uuid TEXT NOT NULL,
  event_kind TEXT NOT NULL,
  entity_name TEXT NOT NULL,
  announced_at TEXT NOT NULL,
  PRIMARY KEY (server_id, entity_kind, entity_uuid, event_kind)
);
