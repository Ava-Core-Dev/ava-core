-- Full Grok prompt/response archive + prior-report chain (Kīlauea / BlockNotes pattern).
-- grok_model / grok_ok on rootmc_daily_reports already exist (0090).

ALTER TABLE rootmc_daily_category_reports ADD COLUMN id TEXT;
ALTER TABLE rootmc_daily_category_reports ADD COLUMN prompt_json TEXT;
ALTER TABLE rootmc_daily_category_reports ADD COLUMN response_json TEXT;
ALTER TABLE rootmc_daily_category_reports ADD COLUMN prior_report_id TEXT;

ALTER TABLE rootmc_daily_reports ADD COLUMN id TEXT;
ALTER TABLE rootmc_daily_reports ADD COLUMN prompt_json TEXT;
ALTER TABLE rootmc_daily_reports ADD COLUMN response_json TEXT;
ALTER TABLE rootmc_daily_reports ADD COLUMN prior_report_id TEXT;
ALTER TABLE rootmc_daily_reports ADD COLUMN metrics_fingerprint TEXT;
ALTER TABLE rootmc_daily_reports ADD COLUMN unchanged_from_prior INTEGER NOT NULL DEFAULT 0;

ALTER TABLE blocknotes_world_ai_reports ADD COLUMN prior_report_id TEXT;
