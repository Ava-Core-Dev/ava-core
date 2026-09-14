-- Root Goals: categories, goals, achievements, ledger entries, AI refresh quotas.

CREATE TABLE IF NOT EXISTS rg_categories (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_rg_categories_user ON rg_categories(user_id);

CREATE TABLE IF NOT EXISTS rg_onboarding_drafts (
  owner_key TEXT PRIMARY KEY NOT NULL,
  draft_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS rg_goals (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL,
  slug TEXT NOT NULL,
  title TEXT NOT NULL,
  category_id TEXT,
  purpose TEXT NOT NULL DEFAULT '',
  requires_money INTEGER NOT NULL DEFAULT 0,
  estimated_cost_cents INTEGER,
  user_steps_summary TEXT NOT NULL DEFAULT '',
  min_days INTEGER,
  max_days INTEGER,
  target_date_est TEXT,
  user_input_json TEXT NOT NULL DEFAULT '{}',
  ai_summary_text TEXT,
  ai_plan_json TEXT,
  ai_model TEXT,
  ai_prompt_json TEXT,
  ai_response_json TEXT,
  ai_generated_at TEXT,
  public_enabled INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_rg_goals_user_slug ON rg_goals(user_id, slug);
CREATE INDEX IF NOT EXISTS idx_rg_goals_user_active ON rg_goals(user_id, deleted_at);

CREATE TABLE IF NOT EXISTS rg_goal_achievements (
  id TEXT PRIMARY KEY NOT NULL,
  goal_id TEXT NOT NULL,
  title TEXT NOT NULL,
  completed_at TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_rg_achievements_goal ON rg_goal_achievements(goal_id);

CREATE TABLE IF NOT EXISTS rg_goal_entries (
  id TEXT PRIMARY KEY NOT NULL,
  goal_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  amount_cents INTEGER,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_rg_entries_goal ON rg_goal_entries(goal_id);

CREATE TABLE IF NOT EXISTS rg_goal_ai_refresh_daily (
  goal_id TEXT NOT NULL,
  day_utc TEXT NOT NULL,
  refresh_count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (goal_id, day_utc)
);

CREATE TABLE IF NOT EXISTS rg_user_ai_refresh_daily (
  user_id TEXT NOT NULL,
  day_utc TEXT NOT NULL,
  goals_touched INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, day_utc)
);
