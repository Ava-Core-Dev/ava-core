-- Normalize earn tables to atomic interpretation.
-- Example: balance 2_000_000 atomic -> 0.02 whole Roots on display.
-- This is a safe no-op for integer data; it exists as a barrier against partial-float writes.

UPDATE rr_earn_balance SET balance = CAST(ROUND(CAST(balance AS REAL)) AS INTEGER) WHERE balance > 0;
UPDATE rr_earn_app_day SET units_earned = CAST(ROUND(CAST(units_earned AS REAL)) AS INTEGER) WHERE units_earned > 0;
UPDATE rr_earn_app_total SET total_units = CAST(ROUND(CAST(total_units AS REAL)) AS INTEGER) WHERE total_units > 0;
UPDATE rr_earn_signup_bonus SET units = CAST(ROUND(CAST(units AS REAL)) AS INTEGER) WHERE units > 0;
UPDATE rr_earn_app_first_open SET units = CAST(ROUND(CAST(units AS REAL)) AS INTEGER) WHERE units > 0;
UPDATE rr_earn_custodial_ledger SET units = CAST(ROUND(CAST(units AS REAL)) AS INTEGER) WHERE units > 0;
UPDATE rr_earn_internal_transfer SET units = CAST(ROUND(CAST(units AS REAL)) AS INTEGER) WHERE units > 0;
UPDATE rr_earn_discord_peer_transfer SET units = CAST(ROUND(CAST(units AS REAL)) AS INTEGER) WHERE units > 0;
