-- Feature Lava Watchers ahead of official feeds and ensure discontinued Two Pineapples is gone.
DELETE FROM kilauea_live_streams WHERE id = 'two_pineapples';

UPDATE kilauea_live_streams
SET sort_order = sort_order + 10
WHERE id <> 'lava_watchers' AND sort_order < 10;

INSERT INTO kilauea_live_streams (id, title, description, watch_url, youtube_video_id, sort_order, updated_at)
VALUES (
  'lava_watchers',
  'Lava Watchers',
  'Featured content provider — independent Kīlauea livestream and commentary.',
  'https://www.youtube.com/@LavaWatchers/live',
  'yalZ2sXN_5k',
  0,
  datetime('now')
)
ON CONFLICT(id) DO UPDATE SET
  title = excluded.title,
  description = excluded.description,
  watch_url = excluded.watch_url,
  youtube_video_id = excluded.youtube_video_id,
  sort_order = excluded.sort_order,
  updated_at = excluded.updated_at;
