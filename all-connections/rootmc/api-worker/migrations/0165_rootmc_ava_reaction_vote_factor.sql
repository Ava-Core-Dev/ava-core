-- Ava reaction quality → small governance vote-factor bonus (Discord reactors on Ava posts).
-- Additive to raw_weight after EC×Pro; capped so shards stay primary.
CREATE TABLE IF NOT EXISTS rootmc_ava_reaction_vote_factor (
  discord_user_id TEXT PRIMARY KEY NOT NULL,
  good_count INTEGER NOT NULL DEFAULT 0,
  bad_count INTEGER NOT NULL DEFAULT 0,
  neutral_count INTEGER NOT NULL DEFAULT 0,
  quality_score REAL NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_ava_reaction_vote_factor_score
  ON rootmc_ava_reaction_vote_factor (quality_score DESC);
