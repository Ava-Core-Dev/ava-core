ALTER TABLE user_accounts ADD COLUMN first_time_email_sent INTEGER NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS idx_user_accounts_first_time_email_sent ON user_accounts (first_time_email_sent);
