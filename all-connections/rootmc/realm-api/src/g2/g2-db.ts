import type { AuthEnv } from "../primary-auth";
import type { RootMcHyperdriveEnv } from "../rootmc-hyperdrive";

export function isG2Worker(env: { WORKER_SHARD?: string }): boolean {
  return String(env.WORKER_SHARD || "").trim() === "rootmc-api-g2";
}

export type G2Env = AuthEnv &
  RootMcHyperdriveEnv & {
  DB: D1Database;
  SITE_URL?: string;
  WORKER_SHARD?: string;
  G2_DEV_REALM_ID?: string;
  G2_DEV_REALM_SECRET?: string;
  DISCORD_ROOTMC_OAUTH_REDIRECT_URI?: string;
  DISCORD_ROOTMC_CLIENT_ID?: string;
  DISCORD_ROOTMC_CLIENT_SECRET?: string;
  DISCORD_ROOTMC_BOT_TOKEN?: string;
  DISCORD_ROOTMC_GUILD_ID?: string;
  DISCORD_ROOTMC_LINKED_ROLE_ID?: string;
  DISCORD_ROOTMC_MINECRAFT_SYNC_ROLE_ID?: string;
  DISCORD_ROOTMC_GENERAL_CHAT_CHANNEL_ID?: string;
  DISCORD_ROOTMC_ADMINS_CHANNEL_ID?: string;
};

export function nowMs(): number {
  return Date.now();
}

export function msToIso(ms: number): string {
  return new Date(ms).toISOString();
}

export function str(v: unknown): string {
  return v == null ? "" : String(v).trim();
}

export async function resolveG2FeaturedRealmId(db: D1Database): Promise<string | null> {
  const row = await db
    .prepare(
      `SELECT realm_id FROM g2_realm
       WHERE featured = 1
       ORDER BY updated_at_ms DESC
       LIMIT 1`,
    )
    .first<{ realm_id: string }>();
  if (row?.realm_id) return row.realm_id;
  const any = await db
    .prepare("SELECT realm_id FROM g2_realm ORDER BY created_at_ms ASC LIMIT 1")
    .first<{ realm_id: string }>();
  return any?.realm_id || null;
}
