-- RootMC gallery: public profile screenshots + private rule-break reports.

CREATE TABLE IF NOT EXISTS rg_gallery (
  id TEXT PRIMARY KEY NOT NULL,
  email TEXT NOT NULL,
  kind TEXT NOT NULL,
  caption TEXT,
  accused_minecraft TEXT,
  accused_uuid TEXT,
  status TEXT NOT NULL DEFAULT 'public',
  content_type TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_rg_gallery_kind_status ON rg_gallery(kind, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_rg_gallery_email ON rg_gallery(email, created_at DESC);

CREATE TABLE IF NOT EXISTS rg_gallery_blobs (
  id TEXT PRIMARY KEY NOT NULL,
  content_type TEXT NOT NULL,
  bytes BLOB NOT NULL,
  updated_at TEXT NOT NULL
);
