-- BlockNotes Realm: player profiles, friends, groups, shared worlds

CREATE TABLE IF NOT EXISTS blocknotes_player_profiles (
  account_id TEXT PRIMARY KEY NOT NULL,
  realm_username TEXT UNIQUE COLLATE NOCASE,
  minecraft_username TEXT,
  minecraft_uuid TEXT,
  skin_url TEXT,
  bio TEXT,
  public_profile INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_blocknotes_profiles_realm_username
  ON blocknotes_player_profiles(realm_username);

CREATE TABLE IF NOT EXISTS blocknotes_shared_worlds (
  id TEXT PRIMARY KEY NOT NULL,
  account_id TEXT NOT NULL,
  world_key TEXT NOT NULL,
  world_name TEXT NOT NULL,
  game_version TEXT,
  seed TEXT,
  note_count INTEGER NOT NULL DEFAULT 0,
  is_public INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL,
  UNIQUE(account_id, world_key)
);

CREATE INDEX IF NOT EXISTS idx_blocknotes_shared_worlds_account
  ON blocknotes_shared_worlds(account_id, sort_order ASC);

CREATE TABLE IF NOT EXISTS blocknotes_friend_requests (
  id TEXT PRIMARY KEY NOT NULL,
  from_account_id TEXT NOT NULL,
  to_account_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  message TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(from_account_id, to_account_id)
);

CREATE INDEX IF NOT EXISTS idx_blocknotes_friend_requests_to
  ON blocknotes_friend_requests(to_account_id, status);

CREATE TABLE IF NOT EXISTS blocknotes_friendships (
  account_id_a TEXT NOT NULL,
  account_id_b TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY(account_id_a, account_id_b)
);

CREATE TABLE IF NOT EXISTS blocknotes_groups (
  id TEXT PRIMARY KEY NOT NULL,
  owner_account_id TEXT NOT NULL,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_blocknotes_groups_owner
  ON blocknotes_groups(owner_account_id);

CREATE TABLE IF NOT EXISTS blocknotes_group_members (
  group_id TEXT NOT NULL,
  account_id TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'member',
  joined_at TEXT NOT NULL,
  PRIMARY KEY(group_id, account_id)
);

CREATE TABLE IF NOT EXISTS blocknotes_group_invites (
  id TEXT PRIMARY KEY NOT NULL,
  group_id TEXT NOT NULL,
  inviter_account_id TEXT NOT NULL,
  invitee_account_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(group_id, invitee_account_id)
);

CREATE INDEX IF NOT EXISTS idx_blocknotes_group_invites_invitee
  ON blocknotes_group_invites(invitee_account_id, status);

CREATE TABLE IF NOT EXISTS blocknotes_group_messages (
  id TEXT PRIMARY KEY NOT NULL,
  group_id TEXT NOT NULL,
  sender_account_id TEXT NOT NULL,
  body TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_blocknotes_group_messages_group
  ON blocknotes_group_messages(group_id, created_at DESC);
