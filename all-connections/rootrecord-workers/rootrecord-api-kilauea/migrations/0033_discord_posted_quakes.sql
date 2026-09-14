-- Earthquakes (USGS) already posted to the Kilauea Alerts Discord channel. Dedupe key is the
-- USGS event id (e.g. `hv73834702`), which is globally unique and stable across re-queries.
-- Written by rootrecord-api-kilauea's `runUsgsKilaueaDiscordCron` (src/usgs-discord-cron.ts).
-- Lives in the shared `root-record` D1; other shards have this migration file too for parity
-- but never read/write the table.
CREATE TABLE IF NOT EXISTS discord_posted_quakes (
  event_id TEXT PRIMARY KEY,
  posted_at TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'usgs',
  magnitude REAL,
  place TEXT
);
CREATE INDEX IF NOT EXISTS idx_discord_posted_quakes_posted_at ON discord_posted_quakes(posted_at);
