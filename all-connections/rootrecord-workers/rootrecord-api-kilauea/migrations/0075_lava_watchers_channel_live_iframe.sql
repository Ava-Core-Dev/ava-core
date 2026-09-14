-- Iframe embed for @channel/live (not the mobile watch page).
UPDATE kilauea_live_streams
SET
  youtube_video_id = 'live:UC-I69toJP1JJGUSID_xwmLw',
  watch_url = 'https://www.youtube.com/@LavaWatchers/live',
  updated_at = datetime('now')
WHERE id = 'lava_watchers';
