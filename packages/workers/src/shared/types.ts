/** Shared types for all CF Workers in this monorepo. */

export interface AvaEnv {
  AVA_HEARTBEAT_DB: D1Database;
  AVA_OPERATOR_KEY?: string;
  AVA_ORIGIN_URL?: string;  // e.g. https://ava-origin.rootmc.net
}

export interface ScheduledEvent {
  scheduledTime: number;
  cron: string;
}
