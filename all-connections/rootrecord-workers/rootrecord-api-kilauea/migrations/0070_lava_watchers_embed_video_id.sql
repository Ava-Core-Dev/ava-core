-- Use iframe-compatible YouTube embed settings for Lava Watchers, matching the USGS feeds.
UPDATE kilauea_live_streams
SET
  youtube_video_id = 'yalZ2sXN_5k',
  watch_url = 'https://www.youtube.com/@LavaWatchers/live',
  updated_at = datetime('now')
WHERE id = 'lava_watchers';
