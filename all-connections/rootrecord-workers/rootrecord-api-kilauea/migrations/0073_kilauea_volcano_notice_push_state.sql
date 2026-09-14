-- Tracks last USGS HANS notice id pushed via FCM to Kīlauea Android (cron dedupe).
CREATE TABLE IF NOT EXISTS kilauea_volcano_notice_push_state (
  id TEXT PRIMARY KEY NOT NULL,
  last_notice_id TEXT NOT NULL,
  pushed_at TEXT NOT NULL
);

INSERT OR IGNORE INTO kilauea_volcano_notice_push_state (id, last_notice_id, pushed_at)
VALUES ('current', '', '1970-01-01T00:00:00.000Z');
