-- Gold supply breakdown: physical gold by item type and location; system account Notes.
ALTER TABLE rootstat_player_physical_gold ADD COLUMN inv_nugget_g REAL NOT NULL DEFAULT 0;
ALTER TABLE rootstat_player_physical_gold ADD COLUMN inv_ingot_g REAL NOT NULL DEFAULT 0;
ALTER TABLE rootstat_player_physical_gold ADD COLUMN inv_block_g REAL NOT NULL DEFAULT 0;
ALTER TABLE rootstat_player_physical_gold ADD COLUMN inv_other_g REAL NOT NULL DEFAULT 0;
ALTER TABLE rootstat_player_physical_gold ADD COLUMN ender_nugget_g REAL NOT NULL DEFAULT 0;
ALTER TABLE rootstat_player_physical_gold ADD COLUMN ender_ingot_g REAL NOT NULL DEFAULT 0;
ALTER TABLE rootstat_player_physical_gold ADD COLUMN ender_block_g REAL NOT NULL DEFAULT 0;
ALTER TABLE rootstat_player_physical_gold ADD COLUMN ender_other_g REAL NOT NULL DEFAULT 0;
ALTER TABLE rootstat_player_physical_gold ADD COLUMN chest_nugget_g REAL NOT NULL DEFAULT 0;
ALTER TABLE rootstat_player_physical_gold ADD COLUMN chest_ingot_g REAL NOT NULL DEFAULT 0;
ALTER TABLE rootstat_player_physical_gold ADD COLUMN chest_block_g REAL NOT NULL DEFAULT 0;
ALTER TABLE rootstat_player_physical_gold ADD COLUMN chest_other_g REAL NOT NULL DEFAULT 0;
ALTER TABLE rootstat_player_physical_gold ADD COLUMN shop_nugget_g REAL NOT NULL DEFAULT 0;
ALTER TABLE rootstat_player_physical_gold ADD COLUMN shop_ingot_g REAL NOT NULL DEFAULT 0;
ALTER TABLE rootstat_player_physical_gold ADD COLUMN shop_block_g REAL NOT NULL DEFAULT 0;
ALTER TABLE rootstat_player_physical_gold ADD COLUMN shop_other_g REAL NOT NULL DEFAULT 0;
ALTER TABLE rootstat_player_physical_gold ADD COLUMN towny_nugget_g REAL NOT NULL DEFAULT 0;
ALTER TABLE rootstat_player_physical_gold ADD COLUMN towny_ingot_g REAL NOT NULL DEFAULT 0;
ALTER TABLE rootstat_player_physical_gold ADD COLUMN towny_block_g REAL NOT NULL DEFAULT 0;
ALTER TABLE rootstat_player_physical_gold ADD COLUMN towny_other_g REAL NOT NULL DEFAULT 0;

ALTER TABLE rootstat_physical_gold_summary ADD COLUMN unattributed_nugget_g REAL NOT NULL DEFAULT 0;
ALTER TABLE rootstat_physical_gold_summary ADD COLUMN unattributed_ingot_g REAL NOT NULL DEFAULT 0;
ALTER TABLE rootstat_physical_gold_summary ADD COLUMN unattributed_block_g REAL NOT NULL DEFAULT 0;
ALTER TABLE rootstat_physical_gold_summary ADD COLUMN unattributed_other_g REAL NOT NULL DEFAULT 0;
ALTER TABLE rootstat_physical_gold_summary ADD COLUMN towny_blocks_scanned INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS rootstat_system_account_balances (
  server_id TEXT NOT NULL,
  minecraft_uuid TEXT NOT NULL,
  minecraft_username TEXT NOT NULL,
  account_type TEXT NOT NULL,
  notes_g REAL NOT NULL DEFAULT 0,
  synced_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (server_id, minecraft_uuid)
);

CREATE INDEX IF NOT EXISTS idx_rootstat_system_accounts_server_type
  ON rootstat_system_account_balances (server_id, account_type);
