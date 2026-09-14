-- Dedupe automated Global Updater feeds (e.g. Kīlauea USGS / AI) per category + source id.
CREATE TABLE IF NOT EXISTS root_updates_discord_event_post (
  category TEXT NOT NULL,
  source_id TEXT NOT NULL,
  posted_at TEXT NOT NULL,
  PRIMARY KEY (category, source_id)
);

CREATE INDEX IF NOT EXISTS idx_root_updates_discord_event_post_at
  ON root_updates_discord_event_post(posted_at DESC);
