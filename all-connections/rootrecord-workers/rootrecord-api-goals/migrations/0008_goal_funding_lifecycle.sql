-- Goal share tokens: 100 whole tokens = 100% of target. Lifecycle: open → withdrawn | refunded.
ALTER TABLE rg_goals ADD COLUMN funding_status TEXT NOT NULL DEFAULT 'open';
ALTER TABLE rg_goals ADD COLUMN funding_closed_at TEXT;
ALTER TABLE rg_goals ADD COLUMN tokens_minted INTEGER NOT NULL DEFAULT 0;
ALTER TABLE rg_goals ADD COLUMN token_cluster TEXT;

ALTER TABLE rg_goal_donations ADD COLUMN payer_account_id TEXT;
ALTER TABLE rg_goal_donations ADD COLUMN tokens_minted INTEGER NOT NULL DEFAULT 0;
ALTER TABLE rg_goal_donations ADD COLUMN ata_cost_cents INTEGER;
ALTER TABLE rg_goal_donations ADD COLUMN share_cents INTEGER;

CREATE INDEX IF NOT EXISTS idx_rg_goal_donations_payer ON rg_goal_donations(payer_account_id);
