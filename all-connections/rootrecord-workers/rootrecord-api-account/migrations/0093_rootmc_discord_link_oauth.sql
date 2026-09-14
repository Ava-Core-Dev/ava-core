-- RootMC: Discord OAuth state for Minecraft link codes (no RootRecord sign-in required)

CREATE TABLE IF NOT EXISTS rootmc_discord_oauth_states (
  state TEXT PRIMARY KEY NOT NULL,
  link_code TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_rootmc_discord_oauth_states_expires
  ON rootmc_discord_oauth_states (expires_at);
