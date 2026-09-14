-- July 2026 entry snapshot for per-player gold-found (mined since July = current − baseline).
ALTER TABLE rootstat_player_gold_found ADD COLUMN baseline_total_gold_g REAL NOT NULL DEFAULT 0;
ALTER TABLE rootstat_player_gold_found ADD COLUMN baseline_mined_ore_g REAL NOT NULL DEFAULT 0;
ALTER TABLE rootstat_player_gold_found ADD COLUMN baseline_mined_block_g REAL NOT NULL DEFAULT 0;
ALTER TABLE rootstat_player_gold_found ADD COLUMN baseline_locked_at TEXT;
