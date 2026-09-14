-- Fingerprint prior-day metrics to skip redundant Grok briefs when nothing changed.

ALTER TABLE rootmc_daily_category_reports ADD COLUMN metrics_fingerprint TEXT;
ALTER TABLE rootmc_daily_category_reports ADD COLUMN unchanged_from_prior INTEGER NOT NULL DEFAULT 0;
