-- Lava Watchers goes live with a new YouTube video id each session; pin to @channel/live instead.
UPDATE kilauea_live_streams
SET
  youtube_video_id = NULL,
  watch_url = 'https://www.youtube.com/@LavaWatchers/live',
  updated_at = datetime('now')
WHERE id = 'lava_watchers';
