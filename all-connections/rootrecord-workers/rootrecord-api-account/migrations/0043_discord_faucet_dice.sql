-- Faucet pool (Root Units) + per-user claim cooldown + dice duel challenges (Root Units escrow on accept).

CREATE TABLE IF NOT EXISTS rr_discord_faucet_pool (
  id INTEGER PRIMARY KEY CHECK (id = 1) NOT NULL,
  balance INTEGER NOT NULL DEFAULT 0
);

INSERT OR IGNORE INTO rr_discord_faucet_pool (id, balance) VALUES (1, 0);

CREATE TABLE IF NOT EXISTS rr_discord_faucet_claim (
  discord_user_id TEXT PRIMARY KEY NOT NULL,
  last_claim_at TEXT NOT NULL,
  last_amount INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS discord_dice_challenges (
  id TEXT PRIMARY KEY NOT NULL,
  challenger_discord_user_id TEXT NOT NULL,
  opponent_discord_user_id TEXT NOT NULL,
  units INTEGER NOT NULL,
  state TEXT NOT NULL,
  challenger_roll INTEGER,
  opponent_roll INTEGER,
  winner_discord_user_id TEXT,
  created_at TEXT NOT NULL,
  resolved_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_discord_dice_challenges_state_created
  ON discord_dice_challenges (state, created_at);
