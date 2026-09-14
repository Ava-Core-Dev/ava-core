-- Towny town snapshots: claimed plot count + town bank (for intelligence reports).

ALTER TABLE rootmc_towny_towns ADD COLUMN plot_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE rootmc_towny_towns ADD COLUMN town_balance_gold REAL NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_rootmc_towny_towns_plots
  ON rootmc_towny_towns (server_id, is_active, plot_count DESC);
