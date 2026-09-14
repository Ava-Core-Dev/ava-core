-- Rename legacy blocknotes_* D1 tables and columns to rootmc_* (idempotent on fresh DBs that already use rootmc names).

ALTER TABLE blocknotes_player_profiles RENAME TO rootmc_player_profiles;
ALTER TABLE blocknotes_shared_worlds RENAME TO rootmc_shared_worlds;
ALTER TABLE blocknotes_friend_requests RENAME TO rootmc_friend_requests;
ALTER TABLE blocknotes_friendships RENAME TO rootmc_friendships;
ALTER TABLE blocknotes_groups RENAME TO rootmc_groups;
ALTER TABLE blocknotes_group_members RENAME TO rootmc_group_members;
ALTER TABLE blocknotes_group_invites RENAME TO rootmc_group_invites;
ALTER TABLE blocknotes_group_messages RENAME TO rootmc_group_messages;
ALTER TABLE blocknotes_world_ai_reports RENAME TO rootmc_world_ai_reports;
ALTER TABLE blocknotes_reference_meta RENAME TO rootmc_reference_meta;
ALTER TABLE blocknotes_reference_bundle RENAME TO rootmc_reference_bundle;
ALTER TABLE blocknotes_account_snapshot RENAME TO rootmc_account_snapshot;
ALTER TABLE blocknotes_group_chambers RENAME TO rootmc_group_chambers;

ALTER TABLE rootstat_servers RENAME COLUMN blocknotes_plugin_version TO rootmc_plugin_version;
ALTER TABLE rootstat_servers RENAME COLUMN blocknotes_last_seen_at TO rootmc_last_seen_at;
