-- Root Goals v2: AI Actions, Suggestions, audit runs, indexes.

CREATE TABLE IF NOT EXISTS rg_goal_actions (
  id TEXT PRIMARY KEY NOT NULL,
  goal_id TEXT NOT NULL,
  id_hint TEXT,
  title TEXT NOT NULL,
  detail TEXT NOT NULL DEFAULT '',
  priority TEXT NOT NULL DEFAULT 'medium',
  sort_order INTEGER NOT NULL DEFAULT 0,
  completed_at TEXT,
  deleted_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_rg_goal_actions_goal ON rg_goal_actions(goal_id);

CREATE TABLE IF NOT EXISTS rg_goal_suggestions (
  id TEXT PRIMARY KEY NOT NULL,
  goal_id TEXT NOT NULL,
  id_hint TEXT,
  title TEXT NOT NULL,
  detail TEXT NOT NULL DEFAULT '',
  category TEXT,
  deleted_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_rg_goal_suggestions_goal ON rg_goal_suggestions(goal_id);

CREATE TABLE IF NOT EXISTS rg_goal_ai_runs (
  id TEXT PRIMARY KEY NOT NULL,
  goal_id TEXT NOT NULL,
  pass_number INTEGER NOT NULL DEFAULT 1,
  reason TEXT,
  prompt_json TEXT NOT NULL,
  response_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_rg_goal_ai_runs_goal ON rg_goal_ai_runs(goal_id);

CREATE INDEX IF NOT EXISTS idx_rg_goals_category ON rg_goals(category_id);
