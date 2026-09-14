import type { D1Database } from "@cloudflare/workers-types";

import { sessionFromRequest, type AuthEnv } from "./primary-auth";
import { json } from "./cors";
import { loadProFlags } from "./free-tier";
import { playerStatsUrl, siteUrl } from "./rootmc-site";
import { isLegacyDualHostId, LIVE_PRODUCTION_SERVER_ID } from "./rootmc-live-public";

export const FREE_GROUP_LIMIT = 1;
export const PRO_GROUP_LIMIT = 5;

export function sanitizeRealmUsername(raw: unknown): string | null {
  if (raw == null) return null;
  const s = String(raw).trim();
  if (s.length < 3 || s.length > 20) return null;
  if (!/^[a-zA-Z0-9_]+$/.test(s)) return null;
  return s;
}

export function normalizeFriendPair(a: string, b: string): [string, string] {
  return a < b ? [a, b] : [b, a];
}

export async function requireSignedInAccount(
  request: Request,
  env: AuthEnv,
): Promise<{ email: string; accountId: string } | Response> {
  const sess = await sessionFromRequest(env, request);
  if (!sess?.accountId) return json({ detail: "Sign in required for Realm social features." }, 401);
  return { email: sess.email, accountId: sess.accountId };
}

export async function maxOwnedGroups(db: D1Database, email: string): Promise<number> {
  const { pro } = await loadProFlags(db, `user:${email.trim().toLowerCase()}`);
  return pro ? PRO_GROUP_LIMIT : FREE_GROUP_LIMIT;
}

export async function profileByAccountId(db: D1Database, accountId: string) {
  return db
    .prepare("SELECT * FROM rootmc_player_profiles WHERE account_id = ? LIMIT 1")
    .bind(accountId)
    .first<Record<string, unknown>>();
}

export async function profileByRealmUsername(db: D1Database, username: string) {
  return db
    .prepare("SELECT * FROM rootmc_player_profiles WHERE realm_username = ? COLLATE NOCASE LIMIT 1")
    .bind(username.trim())
    .first<Record<string, unknown>>();
}

export async function profileByMinecraftUuid(db: D1Database, uuid: string) {
  return db
    .prepare("SELECT * FROM rootmc_player_profiles WHERE LOWER(minecraft_uuid) = LOWER(?) LIMIT 1")
    .bind(uuid.trim())
    .first<Record<string, unknown>>();
}

export async function rootstatLinkByMinecraftUuid(db: D1Database, uuid: string) {
  return db
    .prepare(
      `SELECT minecraft_uuid, minecraft_username, account_id, email, verified_at, updated_at
       FROM rootstat_minecraft_links WHERE LOWER(minecraft_uuid) = LOWER(?) LIMIT 1`,
    )
    .bind(uuid.trim())
    .first<Record<string, unknown>>();
}

const MINECRAFT_UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function publicStatsPageUrl(minecraftUuid: string): string {
  return playerStatsUrl(minecraftUuid);
}

export async function resolveProfileLookup(db: D1Database, idOrUsername: string) {
  const key = idOrUsername.trim();
  if (!key) return null;
  const byId = await profileByAccountId(db, key);
  if (byId) return byId;
  if (MINECRAFT_UUID_RE.test(key)) {
    const byUuid = await profileByMinecraftUuid(db, key);
    if (byUuid) return byUuid;
  }
  return profileByRealmUsername(db, key);
}

export function publicProfilePayload(
  row: Record<string, unknown>,
  worlds: Array<Record<string, unknown>>,
): Record<string, unknown> {
  return {
    account_id: row.account_id,
    realm_username: row.realm_username || null,
    minecraft_username: row.minecraft_username || null,
    minecraft_uuid: row.minecraft_uuid || null,
    skin_url: row.skin_url || null,
    bio: row.bio || null,
    avatar_url: row.minecraft_uuid
      ? `https://crafatar.com/avatars/${String(row.minecraft_uuid).replace(/-/g, "")}?overlay&size=128`
      : null,
    shared_worlds: worlds,
    profile_url: row.realm_username
      ? `${siteUrl()}/player/${row.realm_username}`
      : `${siteUrl()}/player/${row.account_id}`,
    stats_url: row.minecraft_uuid ? publicStatsPageUrl(String(row.minecraft_uuid)) : null,
  };
}

export async function sharedWorldsForAccount(db: D1Database, accountId: string) {
  const { results } = await db
    .prepare(
      `SELECT world_key, world_name, game_version, seed, note_count, sort_order, updated_at
       FROM rootmc_shared_worlds
       WHERE account_id = ? AND is_public = 1
       ORDER BY sort_order ASC, updated_at DESC`,
    )
    .bind(accountId)
    .all<Record<string, unknown>>();
  return results || [];
}

export async function isFriend(db: D1Database, a: string, b: string): Promise<boolean> {
  const [low, high] = normalizeFriendPair(a, b);
  const row = await db
    .prepare(
      "SELECT 1 AS ok FROM rootmc_friendships WHERE account_id_a = ? AND account_id_b = ? LIMIT 1",
    )
    .bind(low, high)
    .first<{ ok: number }>();
  return row?.ok === 1;
}

export async function isGroupMember(db: D1Database, groupId: string, accountId: string): Promise<boolean> {
  const row = await db
    .prepare("SELECT 1 AS ok FROM rootmc_group_members WHERE group_id = ? AND account_id = ? LIMIT 1")
    .bind(groupId, accountId)
    .first<{ ok: number }>();
  return row?.ok === 1;
}

export function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

export function record(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

export function recordArray(v: unknown): Array<Record<string, unknown>> {
  return Array.isArray(v)
    ? v.filter((x): x is Record<string, unknown> => Boolean(x && typeof x === "object" && !Array.isArray(x)))
    : [];
}

const PUBLIC_SERVER_FALLBACK_ID = "rootmc";

/** Map URL slugs like rootmc to the live featured server row when needed. */
export async function resolvePublicServerId(
  db: D1Database,
  requested: string,
  fallbackId = PUBLIC_SERVER_FALLBACK_ID,
): Promise<string> {
  const id = str(requested).trim();
  if (id) {
    const row = await db
      .prepare(`SELECT server_id FROM rootstat_servers WHERE server_id = ? LIMIT 1`)
      .bind(id)
      .first<{ server_id: string }>();
    if (row?.server_id) return row.server_id;

    const priced = await db
      .prepare(`SELECT server_id FROM rootstat_shop_prices WHERE server_id = ? LIMIT 1`)
      .bind(id)
      .first<{ server_id: string }>();
    if (priced?.server_id) return priced.server_id;
  }

  const featured = await db
    .prepare(
      `SELECT server_id FROM rootstat_servers
       WHERE featured = 1
       ORDER BY updated_at DESC
       LIMIT 1`,
    )
    .first<{ server_id: string }>();
  if (featured?.server_id) return featured.server_id;

  return id || fallbackId;
}

/** Pick the server_id that actually has economy rows (live production only). */
export async function resolveEconomyServerId(
  db: D1Database,
  requested: string,
  fallbackId = PUBLIC_SERVER_FALLBACK_ID,
): Promise<string> {
  const candidates: string[] = [];
  const add = (id: string) => {
    const s = str(id);
    if (!s || isLegacyDualHostId(s)) return;
    if (!candidates.includes(s)) candidates.push(s);
  };

  // Canonical live production first — never old Towny/Claims UUIDs.
  add(LIVE_PRODUCTION_SERVER_ID);
  add(fallbackId);
  add(await resolvePublicServerId(db, requested, fallbackId));
  if (requested) add(requested);

  const featured = await db
    .prepare(
      `SELECT server_id FROM rootstat_servers WHERE featured = 1 ORDER BY updated_at DESC LIMIT 1`,
    )
    .first<{ server_id: string }>();
  if (featured?.server_id) add(featured.server_id);

  const live = await db
    .prepare(
      `SELECT server_id FROM rootstat_servers
       WHERE rootmc_last_seen_at IS NOT NULL AND rootmc_last_seen_at != ''
       ORDER BY rootmc_last_seen_at DESC
       LIMIT 1`,
    )
    .first<{ server_id: string }>();
  if (live?.server_id) add(live.server_id);

  let bestId = LIVE_PRODUCTION_SERVER_ID;
  let bestSync = "";

  for (const id of candidates) {
    const row = await db
      .prepare(
        `SELECT MAX(synced_at) AS latest FROM (
           SELECT synced_at FROM rootstat_player_net_worth WHERE server_id = ?
           UNION ALL
           SELECT synced_at FROM rootstat_player_balances WHERE server_id = ?
           UNION ALL
           SELECT synced_at FROM rootstat_shop_listings WHERE server_id = ?
         )`,
      )
      .bind(id, id, id)
      .first<{ latest: string | null }>();
    const latest = str(row?.latest);
    if (latest) {
      if (!bestSync || latest > bestSync) {
        bestSync = latest;
        bestId = id;
      }
    }
  }
  if (bestSync) return bestId;

  for (const id of candidates) {
    const row = await db
      .prepare(
        `SELECT 1 AS ok FROM rootstat_shop_prices WHERE server_id = ? AND avg_price > 0 LIMIT 1`,
      )
      .bind(id)
      .first<{ ok: number }>();
    if (row?.ok === 1) return id;
  }

  return LIVE_PRODUCTION_SERVER_ID;
}
