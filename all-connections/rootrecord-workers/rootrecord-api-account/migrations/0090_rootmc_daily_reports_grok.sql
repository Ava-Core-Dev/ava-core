-- RootMC daily reports: store Grok narrative alongside Discord post.

ALTER TABLE rootmc_daily_reports ADD COLUMN report_text TEXT;
ALTER TABLE rootmc_daily_reports ADD COLUMN grok_model TEXT;
ALTER TABLE rootmc_daily_reports ADD COLUMN grok_ok INTEGER NOT NULL DEFAULT 0;
