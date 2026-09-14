-- Root Record Website Hosting: personal sites (trial → $10/mo) + lapse invoices.

CREATE TABLE IF NOT EXISTS rr_sites (
  id TEXT PRIMARY KEY NOT NULL,
  account_id TEXT NOT NULL,
  slug TEXT,
  title TEXT NOT NULL DEFAULT '',
  custom_domain TEXT,
  nameserver_status TEXT NOT NULL DEFAULT 'none',
  trial_ends_at TEXT,
  subscription_status TEXT NOT NULL DEFAULT 'trialing',
  stripe_subscription_id TEXT,
  config_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_rr_sites_account ON rr_sites (account_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_rr_sites_slug ON rr_sites (slug) WHERE slug IS NOT NULL AND slug != '';
CREATE UNIQUE INDEX IF NOT EXISTS idx_rr_sites_custom_domain ON rr_sites (custom_domain)
  WHERE custom_domain IS NOT NULL AND custom_domain != '';
CREATE INDEX IF NOT EXISTS idx_rr_sites_subscription ON rr_sites (subscription_status);

CREATE TABLE IF NOT EXISTS rr_site_invoices (
  id TEXT PRIMARY KEY NOT NULL,
  site_id TEXT NOT NULL,
  amount_cents INTEGER NOT NULL DEFAULT 1000,
  due_at TEXT NOT NULL,
  paid_at TEXT,
  stripe_invoice_id TEXT,
  status TEXT NOT NULL DEFAULT 'open',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (site_id) REFERENCES rr_sites(id)
);

CREATE INDEX IF NOT EXISTS idx_rr_site_invoices_site ON rr_site_invoices (site_id);
CREATE INDEX IF NOT EXISTS idx_rr_site_invoices_status ON rr_site_invoices (status);
