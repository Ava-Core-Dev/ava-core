-- One row per Discord message snowflake already applied to discord_user_activity counters.
-- Lets channel backfill / reprocessing upsert authors for rows that were already in developer_messages.
-- Apply with other account D1 migrations, deploy rootrecord-api-account, then run channel backfill to completion
-- and POST /api/internal/discord-activity-daily-rebuild if needed.
-- If you previously had partial discord_user_activity rows and will full-backfill history, reset first to avoid
-- double-counting the same Discord message: DELETE FROM discord_activity_counted_message; DELETE FROM discord_user_activity;
CREATE TABLE IF NOT EXISTS discord_activity_counted_message (
  discord_message_id TEXT PRIMARY KEY NOT NULL
);
