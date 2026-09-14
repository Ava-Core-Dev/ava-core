SELECT
  email,
  account_id,
  pro_unlocked,
  life_member,
  subscription_status,
  stripe_customer_id,
  stripe_subscription_id,
  updated_at
FROM user_accounts
WHERE lower(email) = 'storeyalexander94@gmail.com'
LIMIT 1;

