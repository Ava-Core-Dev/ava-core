-- Public goals: image, SPL mint, per-goal custodial donate wallet, Stripe donate link.

ALTER TABLE rg_goals ADD COLUMN image_url TEXT;
ALTER TABLE rg_goals ADD COLUMN token_mint TEXT;
ALTER TABLE rg_goals ADD COLUMN token_symbol TEXT;
ALTER TABLE rg_goals ADD COLUMN token_name TEXT;
ALTER TABLE rg_goals ADD COLUMN token_status TEXT;
ALTER TABLE rg_goals ADD COLUMN token_signature TEXT;
ALTER TABLE rg_goals ADD COLUMN metadata_uri TEXT;
ALTER TABLE rg_goals ADD COLUMN donate_wallet_pubkey TEXT;
ALTER TABLE rg_goals ADD COLUMN donate_wallet_enc TEXT;
ALTER TABLE rg_goals ADD COLUMN donate_wallet_iv TEXT;
ALTER TABLE rg_goals ADD COLUMN stripe_payment_link TEXT;
ALTER TABLE rg_goals ADD COLUMN stripe_product_id TEXT;
ALTER TABLE rg_goals ADD COLUMN stripe_price_id TEXT;
ALTER TABLE rg_goals ADD COLUMN is_server_goal INTEGER NOT NULL DEFAULT 0;
ALTER TABLE rg_goals ADD COLUMN raised_cents INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS rg_goal_blobs (
  goal_id TEXT PRIMARY KEY NOT NULL,
  content_type TEXT NOT NULL,
  bytes BLOB NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS rg_goal_donations (
  id TEXT PRIMARY KEY NOT NULL,
  goal_id TEXT NOT NULL,
  source TEXT NOT NULL,
  amount_cents INTEGER,
  amount_atomic TEXT,
  currency TEXT NOT NULL DEFAULT 'usd',
  tx_ref TEXT,
  payer_email TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_rg_goals_public ON rg_goals(public_enabled, deleted_at, is_server_goal);
CREATE INDEX IF NOT EXISTS idx_rg_goals_donate_wallet ON rg_goals(donate_wallet_pubkey);
CREATE INDEX IF NOT EXISTS idx_rg_goal_donations_goal ON rg_goal_donations(goal_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_rg_goal_donations_tx ON rg_goal_donations(tx_ref);
