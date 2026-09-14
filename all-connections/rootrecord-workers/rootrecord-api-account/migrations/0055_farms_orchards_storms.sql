-- Orchards / vegetables progress + global lightning row index for cross-account storms.
ALTER TABLE rr_farms_progress ADD COLUMN orchards_json TEXT;
ALTER TABLE rr_farms_progress ADD COLUMN vegetables_json TEXT;

CREATE TABLE IF NOT EXISTS rr_farms_global_state (
  state_key TEXT PRIMARY KEY NOT NULL,
  value_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
