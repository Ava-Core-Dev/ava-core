-- UTC day → distinct Discord message count (ingested developer feed), for operator charts.
CREATE TABLE IF NOT EXISTS discord_activity_daily (
  day TEXT PRIMARY KEY NOT NULL,
  message_count INTEGER NOT NULL DEFAULT 0
);
