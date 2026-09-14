-- Grok synthesis from proposal/bill Discord discussion threads.

ALTER TABLE rootmc_legislation_items ADD COLUMN synthesized_description TEXT;
ALTER TABLE rootmc_legislation_items ADD COLUMN synthesis_at TEXT;
ALTER TABLE rootmc_legislation_items ADD COLUMN synthesis_message_count INTEGER NOT NULL DEFAULT 0;

ALTER TABLE rootmc_weekly_bills ADD COLUMN synthesized_description TEXT;
ALTER TABLE rootmc_weekly_bills ADD COLUMN synthesis_at TEXT;
