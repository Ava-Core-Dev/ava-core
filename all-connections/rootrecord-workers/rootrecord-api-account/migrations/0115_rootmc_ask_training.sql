CREATE TABLE IF NOT EXISTS rootmc_ask_turns (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  server_id TEXT NOT NULL,
  minecraft_uuid TEXT NOT NULL,
  minecraft_username TEXT,
  question_raw TEXT NOT NULL,
  question_normalized TEXT NOT NULL,
  question_hash TEXT NOT NULL,
  response_lines_json TEXT NOT NULL,
  link_url TEXT,
  source TEXT NOT NULL,
  parent_turn_id INTEGER,
  feedback TEXT,
  grok_model TEXT,
  prompt_json TEXT,
  response_json TEXT,
  training_json TEXT,
  good_answer INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_rootmc_ask_turns_player_hash_time
  ON rootmc_ask_turns(server_id, minecraft_uuid, question_hash, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_rootmc_ask_turns_good
  ON rootmc_ask_turns(good_answer, question_normalized);

CREATE TABLE IF NOT EXISTS rootmc_ask_canned (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  question_normalized TEXT NOT NULL,
  question_hash TEXT NOT NULL,
  keywords_json TEXT NOT NULL,
  response_lines_json TEXT NOT NULL,
  link_url TEXT,
  source_turn_id INTEGER,
  good_count INTEGER NOT NULL DEFAULT 1,
  last_used_at TEXT,
  created_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_rootmc_ask_canned_hash
  ON rootmc_ask_canned(question_hash);
