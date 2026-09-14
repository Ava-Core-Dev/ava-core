-- Volcano photo submissions (approved-only gallery).
-- Storage: R2 object keys live in these rows; objects are private until approved.

CREATE TABLE IF NOT EXISTS volcano_photo_submissions (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  status TEXT NOT NULL, -- pending | approved | rejected
  created_at TEXT NOT NULL,
  reviewed_at TEXT,
  reviewed_by TEXT,
  rejection_reason TEXT,
  caption TEXT,
  content_type TEXT,
  bytes INTEGER,
  r2_key_original TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_volcano_photos_status_created
  ON volcano_photo_submissions(status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_volcano_photos_account_created
  ON volcano_photo_submissions(account_id, created_at DESC);

