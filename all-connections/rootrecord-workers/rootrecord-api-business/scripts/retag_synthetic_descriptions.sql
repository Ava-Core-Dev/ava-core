-- Align time_entries category_id with description intent (gap-fill / generic blurbs).
-- user_key = user:rootrecord@outlook.com

UPDATE bm_owned_row SET doc = json_set(json_set(doc, '$.category_id', '11b1fb2bd3755d879a24900ff9cce173'), '$.updated_at', strftime('%Y-%m-%dT%H:%M:%fZ','now')), updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE user_key = 'user:rootrecord@outlook.com' AND coll = 'time_entries' AND id = 'd89f9545ef945405a955ab855b019652';

UPDATE bm_owned_row SET doc = json_set(json_set(doc, '$.category_id', '11b1fb2bd3755d879a24900ff9cce173'), '$.updated_at', strftime('%Y-%m-%dT%H:%M:%fZ','now')), updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE user_key = 'user:rootrecord@outlook.com' AND coll = 'time_entries' AND id = 'e3b75275d2e25a8bb3acec37f60b0937';

UPDATE bm_owned_row SET doc = json_set(json_set(doc, '$.category_id', 'ebd9c74d64a450fc92fdbb35079eac24'), '$.updated_at', strftime('%Y-%m-%dT%H:%M:%fZ','now')), updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE user_key = 'user:rootrecord@outlook.com' AND coll = 'time_entries' AND id = 'fbc34f747603588cafc2c35ae762992e';

UPDATE bm_owned_row SET doc = json_set(json_set(doc, '$.category_id', 'ebd9c74d64a450fc92fdbb35079eac24'), '$.updated_at', strftime('%Y-%m-%dT%H:%M:%fZ','now')), updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE user_key = 'user:rootrecord@outlook.com' AND coll = 'time_entries' AND id = '8f304ca856f252cdbd34eecb081af7a2';

UPDATE bm_owned_row SET doc = json_set(json_set(doc, '$.category_id', '89128ff82cc354a8b088270b42965fa8'), '$.updated_at', strftime('%Y-%m-%dT%H:%M:%fZ','now')), updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE user_key = 'user:rootrecord@outlook.com' AND coll = 'time_entries' AND id = 'fd67c3abbc5050d08fd848d55b3c7786';

UPDATE bm_owned_row SET doc = json_set(json_set(doc, '$.category_id', '7887e7cd4c5c5c689a3adf56e791d5b5'), '$.updated_at', strftime('%Y-%m-%dT%H:%M:%fZ','now')), updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE user_key = 'user:rootrecord@outlook.com' AND coll = 'time_entries' AND id = '1af1c6a78ace528098d1671d3c709b2c';

UPDATE bm_owned_row SET doc = json_set(json_set(doc, '$.category_id', 'd5f6f2776f4454ea8870d945a2524570'), '$.updated_at', strftime('%Y-%m-%dT%H:%M:%fZ','now')), updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE user_key = 'user:rootrecord@outlook.com' AND coll = 'time_entries' AND id = '5bcf5152d2d75ad98ab58eab7ae3a313';
