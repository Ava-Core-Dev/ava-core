-- Stripe webhook + Billing: link Stripe customer/subscription to portal row.
ALTER TABLE user_accounts ADD COLUMN stripe_customer_id TEXT;
ALTER TABLE user_accounts ADD COLUMN stripe_subscription_id TEXT;
ALTER TABLE user_accounts ADD COLUMN subscription_status TEXT NOT NULL DEFAULT 'none';

CREATE TABLE IF NOT EXISTS stripe_webhook_events (
  id TEXT PRIMARY KEY,
  received_at TEXT NOT NULL
);
