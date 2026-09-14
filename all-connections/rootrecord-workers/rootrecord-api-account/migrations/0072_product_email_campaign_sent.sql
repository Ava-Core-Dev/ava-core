-- Tracks one-time product/update emails per recipient (bulk Zoho sends with dedupe).
CREATE TABLE IF NOT EXISTS rr_product_email_campaign_sent (
  campaign_id TEXT NOT NULL,
  email TEXT NOT NULL,
  sent_at TEXT NOT NULL,
  PRIMARY KEY (campaign_id, email)
);

CREATE INDEX IF NOT EXISTS idx_rr_product_email_campaign_id
  ON rr_product_email_campaign_sent(campaign_id, sent_at DESC);
