-- 0033: Decommission custodial Solana wallets + introduce rewards-based Pro redemption.
--
-- Part 1 — return wallet balance to pending.
-- The portal previously parked some rewards in an on-chain custodial RRTT wallet
-- (rr_earn_custodial_state.units_sent_to_custodial). With Solana retired, anything still
-- in-wallet has to flow back into the D1 pending bucket so users don't lose it.
-- Mechanics: pending = rr_earn_balance.balance - rr_earn_custodial_state.units_sent_to_custodial.
-- Snapping `sent` down to `withdrawn` reabsorbs the un-withdrawn portion (= wallet balance)
-- into pending. Already-withdrawn units stay deducted (those left the system).
-- Wipe cached on-chain counters so /auth/me + /earn/summary stop reporting wallet figures.
UPDATE rr_earn_custodial_state
SET units_sent_to_custodial = units_withdrawn_from_custodial,
    custodial_rrtt_onchain = 0,
    sol_balance_lamports_cached = 0,
    cache_updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE units_sent_to_custodial > units_withdrawn_from_custodial;

-- Part 2 — Pro membership earned by burning testing rewards (100,000 points = 1 month).
-- Stored as ISO-8601 UTC (`2026-06-10T17:30:00.000Z`); NULL = no active redemption.
-- Effective pro_unlocked is the OR of:
--   * billing-driven pro (Stripe subscription / lifetime in user_accounts.pro_unlocked)
--   * (pro_redeemed_until IS NOT NULL AND pro_redeemed_until > now)
-- See accounts.ts / readUserAccountAccessFlags for the merged read path.
ALTER TABLE user_accounts ADD COLUMN pro_redeemed_until TEXT;
CREATE INDEX IF NOT EXISTS idx_user_accounts_pro_redeemed_until ON user_accounts (pro_redeemed_until);
