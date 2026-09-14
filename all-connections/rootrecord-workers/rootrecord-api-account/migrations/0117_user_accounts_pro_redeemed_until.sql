-- Weekly Top Active Player awards extend Pro via pro_redeemed_until (see accounts.ts).
ALTER TABLE user_accounts ADD COLUMN pro_redeemed_until TEXT;
CREATE INDEX IF NOT EXISTS idx_user_accounts_pro_redeemed_until ON user_accounts(pro_redeemed_until);
