-- Public goal posters: display name, optional Minecraft head, optional uploaded avatar.

CREATE TABLE IF NOT EXISTS rg_profiles (
  email TEXT PRIMARY KEY NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  bio TEXT,
  avatar_kind TEXT NOT NULL DEFAULT 'auto',
  minecraft_uuid TEXT,
  minecraft_username TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_rg_profiles_slug ON rg_profiles(slug);

CREATE TABLE IF NOT EXISTS rg_profile_avatars (
  email TEXT PRIMARY KEY NOT NULL,
  content_type TEXT NOT NULL,
  bytes BLOB NOT NULL,
  updated_at TEXT NOT NULL
);

ALTER TABLE rg_goals ADD COLUMN posted_by_email TEXT;

UPDATE rg_goals
SET posted_by_email = lower(substr(user_id, 6))
WHERE posted_by_email IS NULL AND user_id LIKE 'user:%';

INSERT OR IGNORE INTO rg_profiles (
  email, slug, display_name, bio, avatar_kind, created_at, updated_at
) VALUES (
  'rootrecord@outlook.com',
  'ava',
  'Ava',
  'Root Record operator. Public server goals live here.',
  'auto',
  datetime('now'),
  datetime('now')
);
