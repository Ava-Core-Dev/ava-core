/** Shared types for all CF Workers in this monorepo. */

export interface AvaEnv {
  AVA_HEARTBEAT_DB: D1Database;
  ROOTMC_LIVE_DB?: D1Database;
  LIVE_DB?: Hyperdrive;
  AVA_OPERATOR_KEY?: string;
  AVA_ORIGIN_URL?: string;  // e.g. https://ava-origin.rootmc.net
  AVA_ECOFLOW_ACCESS_KEY?: string;
  AVA_ECOFLOW_SECRET_KEY?: string;
  AVA_ECOFLOW_SN?: string;
  AVA_ECOFLOW_BASE_URL?: string;
}

export interface ScheduledEvent {
  scheduledTime: number;
  cron: string;
}
