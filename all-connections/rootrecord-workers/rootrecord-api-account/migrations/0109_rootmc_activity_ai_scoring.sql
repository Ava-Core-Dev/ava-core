-- Weekly activity AI judgment audit + top-5 in-game award metadata.

CREATE TABLE IF NOT EXISTS rootmc_weekly_activity_ai_runs (
  week_key TEXT NOT NULL,
  kind TEXT NOT NULL,
  grok_model TEXT,
  grok_ok INTEGER NOT NULL DEFAULT 0,
  prompt_json TEXT,
  response_json TEXT,
  created_at TEXT NOT NULL,
  PRIMARY KEY (week_key, kind)
);

ALTER TABLE rootmc_top_active_player_awards ADD COLUMN rank INTEGER NOT NULL DEFAULT 1;
ALTER TABLE rootmc_top_active_player_awards ADD COLUMN pro_granted INTEGER NOT NULL DEFAULT 0;
