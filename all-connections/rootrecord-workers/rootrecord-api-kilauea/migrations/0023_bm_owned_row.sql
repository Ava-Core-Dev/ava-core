-- RootRecord Business Manager mobile — isolated JSON rows per user (earn uses user:email key; same key here).
CREATE TABLE IF NOT EXISTS bm_owned_row (
  user_key TEXT NOT NULL,
  coll TEXT NOT NULL,
  id TEXT NOT NULL,
  doc TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (user_key, coll, id)
);
CREATE INDEX IF NOT EXISTS bm_owned_row_coll ON bm_owned_row (user_key, coll);
