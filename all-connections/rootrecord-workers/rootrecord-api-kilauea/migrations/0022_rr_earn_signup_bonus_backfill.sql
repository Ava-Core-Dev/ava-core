-- Catch-up: one-time 50,000 signup bonus (same as registration) for all license accounts
-- that have no row in rr_earn_signup_bonus (accounts created before automatic grant).
-- Tied to fixed granted_at for this batch only; runs once with D1 migrations.
INSERT INTO rr_earn_signup_bonus (user_id, units, granted_at)
SELECT
  'user:' || LOWER(email) AS user_id,
  50000 AS units,
  '2026-04-29T22:30:00.000Z' AS granted_at
FROM license_accounts
WHERE NOT EXISTS (
  SELECT
    1
  FROM
    rr_earn_signup_bonus s
  WHERE
    s.user_id = 'user:' || LOWER(license_accounts.email)
);

-- Ensure a balance row exists (same as grantSignupBonusOnRegistration).
INSERT OR
IGNORE INTO rr_earn_balance (user_id, balance, updated_at)
SELECT
  s.user_id,
  0,
  '2026-04-29T22:30:00.000Z'
FROM
  rr_earn_signup_bonus s
WHERE
  s.granted_at = '2026-04-29T22:30:00.000Z'
  AND NOT EXISTS (
    SELECT
      1
    FROM
      rr_earn_balance b
    WHERE
      b.user_id = s.user_id
  );

-- Add 50k only for this backfill batch (idempotent: migration never re-runs).
UPDATE rr_earn_balance
SET
  balance = balance + 50000,
  updated_at = '2026-04-29T22:30:00.000Z'
WHERE
  user_id IN (
    SELECT
      user_id
    FROM
      rr_earn_signup_bonus
    WHERE
      granted_at = '2026-04-29T22:30:00.000Z'
  );
