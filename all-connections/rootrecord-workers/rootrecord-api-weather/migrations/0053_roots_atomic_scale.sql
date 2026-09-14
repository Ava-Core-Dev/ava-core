-- Internal Roots ledger uses atomic integers (1 = 0.00000001 whole Root).
-- If any legacy tooling accidentally multiplied balances by 1e8, undo it.

UPDATE rr_earn_balance SET balance = balance / 100000000 WHERE balance >= 1000000000000;
UPDATE rr_earn_app_day SET units_earned = units_earned / 100000000 WHERE units_earned >= 1000000000000;
UPDATE rr_earn_app_total SET total_units = total_units / 100000000 WHERE total_units >= 1000000000000;
UPDATE rr_earn_signup_bonus SET units = units / 100000000 WHERE units >= 1000000000000;
UPDATE rr_earn_app_first_open SET units = units / 100000000 WHERE units >= 1000000000000;
UPDATE rr_earn_custodial_ledger SET units = units / 100000000 WHERE units >= 1000000000000;
UPDATE rr_earn_internal_transfer SET units = units / 100000000 WHERE units >= 1000000000000;
UPDATE rr_earn_discord_peer_transfer SET units = units / 100000000 WHERE units >= 1000000000000;
UPDATE root_economy_daily SET total_circulation = total_circulation / 100000000 WHERE total_circulation >= 1000000000000;
UPDATE root_economy_snapshot SET total_circulation = total_circulation / 100000000 WHERE total_circulation >= 1000000000000;
