CREATE TABLE IF NOT EXISTS discord_oauth_states (
  state TEXT PRIMARY KEY NOT NULL,
  account_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_discord_oauth_states_expires_at
  ON discord_oauth_states (expires_at);

CREATE TABLE IF NOT EXISTS discord_account_links (
  account_id TEXT PRIMARY KEY NOT NULL,
  email TEXT NOT NULL,
  discord_user_id TEXT NOT NULL UNIQUE,
  discord_username TEXT,
  discord_global_name TEXT,
  discord_email TEXT,
  linked_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_discord_account_links_discord_user_id
  ON discord_account_links (discord_user_id);

