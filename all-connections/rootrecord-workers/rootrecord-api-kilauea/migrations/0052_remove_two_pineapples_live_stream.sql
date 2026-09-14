-- Remove discontinued Two Pineapples partnership stream from Live Feeds.
DELETE FROM kilauea_live_streams WHERE id = 'two_pineapples';
