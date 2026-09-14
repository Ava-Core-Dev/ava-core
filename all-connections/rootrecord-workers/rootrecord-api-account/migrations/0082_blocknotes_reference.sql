-- Block Notes offline reference bundles (blocks, items, mobs, etc.) served to mobile/web clients.
-- Seed data: 0083_blocknotes_reference_seed.sql
-- Regenerate: node Web/cloudflare/rootrecord-api-blocknotes/scripts/seed-reference.mjs
-- Source JSON: Web/cloudflare/rootmc-realm-api/reference/

CREATE TABLE IF NOT EXISTS blocknotes_reference_meta (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  version TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS blocknotes_reference_bundle (
  category TEXT PRIMARY KEY,
  json_blob TEXT NOT NULL,
  byte_size INTEGER NOT NULL DEFAULT 0,
  content_sha256 TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_blocknotes_reference_bundle_updated
  ON blocknotes_reference_bundle (updated_at);
