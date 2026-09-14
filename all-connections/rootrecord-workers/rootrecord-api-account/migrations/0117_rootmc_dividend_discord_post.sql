-- Track Discord economy-channel post for monthly Activity Dividend reports.

ALTER TABLE rootmc_treasury_dividend_runs ADD COLUMN discord_channel_id TEXT;
ALTER TABLE rootmc_treasury_dividend_runs ADD COLUMN discord_message_id TEXT;
ALTER TABLE rootmc_treasury_dividend_runs ADD COLUMN report_posted_at TEXT;
