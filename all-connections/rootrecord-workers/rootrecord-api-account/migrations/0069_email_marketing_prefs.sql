CREATE TABLE IF NOT EXISTS rr_email_marketing_prefs (
  account_id TEXT PRIMARY KEY NOT NULL,
  email TEXT NOT NULL COLLATE NOCASE,
  general_newsletter INTEGER NOT NULL DEFAULT 1,
  kilauea_newsletter INTEGER NOT NULL DEFAULT 1,
  business_manager_newsletter INTEGER NOT NULL DEFAULT 1,
  simple_weather_newsletter INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_rr_email_marketing_prefs_email ON rr_email_marketing_prefs(email);
