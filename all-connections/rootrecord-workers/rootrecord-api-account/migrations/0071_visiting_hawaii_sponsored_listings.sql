-- Visiting Hawaiʻi sponsored local business listings ($100/year via Stripe).

CREATE TABLE IF NOT EXISTS visiting_hawaii_sponsored_listings (
  id TEXT PRIMARY KEY NOT NULL,
  account_id TEXT NOT NULL,
  business_name TEXT NOT NULL,
  contact_email TEXT NOT NULL,
  contact_phone TEXT,
  website_url TEXT,
  island_id TEXT NOT NULL,
  category_id TEXT NOT NULL,
  sub_filters_json TEXT NOT NULL DEFAULT '[]',
  title TEXT NOT NULL,
  short_description TEXT NOT NULL,
  description TEXT NOT NULL,
  image_url TEXT NOT NULL,
  lat REAL,
  lng REAL,
  address_line TEXT,
  cost_range TEXT,
  cta_label TEXT,
  cta_url TEXT,
  status TEXT NOT NULL DEFAULT 'draft',
  stripe_checkout_session_id TEXT,
  stripe_subscription_id TEXT,
  stripe_customer_id TEXT,
  paid_through TEXT,
  rotation_weight INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  activated_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_vh_sponsored_account ON visiting_hawaii_sponsored_listings(account_id);
CREATE INDEX IF NOT EXISTS idx_vh_sponsored_active_lookup ON visiting_hawaii_sponsored_listings(island_id, category_id, status);
