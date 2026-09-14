import type { D1Database } from "@cloudflare/workers-types";

import { json } from "./cors";
import { netWorthForPlayer } from "./rootmc-economy";
import { treasurySummaryForPlayer } from "./rootmc-treasury";
import { goldItemEventsForPlayer } from "./rootmc-gold-item-events";
import {
  profileByAccountId,
  publicStatsPageUrl,
  requireSignedInAccount,
  rootstatLinkByMinecraftUuid,
  sharedWorldsForAccount,
  str,
  record,
} from "./realm-lib";
import type { AuthEnv } from "./primary-auth";
import { mintAuthToken, sessionFromRequest } from "./primary-auth";
import {
  completeAppLinkLogin,
  consumeLinkCode,
  loadLinkCode,
  upsertGlobalMinecraftLink,
  validateLinkCodeRow,
} from "./rootmc-minecraft-link";
import { provisionMinecraftPlayerAccount } from "./rootmc-provision-account";
import { verifyUrl } from "./rootmc-site";
import { blueprintMemberFlags } from "./rootmc-blueprints";
import { isCurrentTopActivePlayer } from "./rootmc-top-active-player";
import {
  governancePowerForUuid,
  formatGovernancePowerLine,
  isGovernanceEligible,
} from "./rootmc-governance-voting";
import { resolveServerId } from "./rootmc-daily-report";
import { isG2Worker } from "./g2/g2-db";

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const CODE_LEN = 6;
const CODE_TTL_MS = 15 * 60 * 1000;

export interface RootStatEnv extends AuthEnv {
  DB: D1Database;
  SITE_URL?: string;
  WORKER_SHARD?: string;
  ROOTSTAT_DEV_SERVER_ID?: string;
  ROOTSTAT_DEV_SERVER_SECRET?: string;
  G2_DEV_REALM_ID?: string;
  G2_DEV_REALM_SECRET?: string;
  /** Cloudflare Hyperdrive -> Shockbyte MySQL (economy cron pull / Towny). */
  ROOTMC_MYSQL?: {
    host: string;
    port: number;
    user: string;
    password: string;
    database: string;
  };
  /** Cloudflare Hyperdrive -> Claims (gen3) MySQL. */
  ROOTMC_MYSQL_CLAIMS?: {
    host: string;
    port: number;
    user: string;
    password: string;
    database: string;
  };
  ROOTMC_MYSQL_TABLE_PREFIX?: string;
  /** Hyperdrive-synced live mirror D1 (rootmc-live) — same as DB after cutover. */
  LIVE_DB?: D1Database;
  /** Pre-cutover production D1 archive. Do not delete. */
  LEGACY_DB?: D1Database;
  WEBSTAT_DB?: D1Database;
}

async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash), (b) => b.toString(16).padStart(2, "0")).join("");
}

function nowIso(): string {
  return new Date().toISOString();
}

function normalizeMinecraftUuid(raw: string): string | null {
  const uuid = str(raw).toLowerCase();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(uuid)) {
    return null;
  }
  return uuid;
}

const MCMMO_SKILL_KEYS = [
  "mining",
  "woodcutting",
  "repair",
  "unarmed",
  "herbalism",
  "excavation",
  "archery",
  "swords",
  "axes",
  "acrobatics",
  "taming",
  "fishing",
  "alchemy",
  "crossbows",
  "tridents",
  "maces",
  "spears",
  "salvage",
  "smelting",
  "defense",
  "elytra",
] as const;

export function parseMcmmoRow(row: Record<string, unknown>): Record<string, unknown> {
  let skills: Record<string, number> = {};
  try {
    const parsed = JSON.parse(str(row.skills_json) || "{}");
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      skills = parsed as Record<string, number>;
    }
  } catch {
    skills = {};
  }

  return {
    server_id: str(row.server_id) || null,
    power_level: Number(row.power_level) || 0,
    skills,
    synced_at: row.synced_at || null,
    updated_at: row.updated_at || null,
    minecraft_username: row.minecraft_username || null,
  };
}

export async function playtimeStatsForPlayer(
  db: D1Database,
  serverId: string,
  uuid: string,
): Promise<Record<string, unknown> | null> {
  const row = await db
    .prepare(
      `SELECT server_id, minecraft_uuid, minecraft_username, total_playtime_seconds,
              first_join_at, last_login_at, synced_at, updated_at
       FROM rootstat_player_playtime
       WHERE server_id = ? AND minecraft_uuid = ?
       LIMIT 1`,
    )
    .bind(serverId, uuid)
    .first<Record<string, unknown>>();

  if (!row) return null;

  return {
    server_id: str(row.server_id) || null,
    total_playtime_seconds: Number(row.total_playtime_seconds) || 0,
    first_join_at: row.first_join_at || null,
    last_login_at: row.last_login_at || null,
    synced_at: row.synced_at || null,
    updated_at: row.updated_at || null,
    minecraft_username: row.minecraft_username || null,
  };
}

export async function playtimeLeaderboardForServer(
  db: D1Database,
  serverId: string,
  limit = 25,
): Promise<Record<string, unknown>[]> {
  const { results } = await db
    .prepare(
      `SELECT minecraft_uuid, minecraft_username, total_playtime_seconds,
              last_login_at, synced_at
       FROM rootstat_player_playtime
       WHERE server_id = ?
       ORDER BY total_playtime_seconds DESC
       LIMIT ?`,
    )
    .bind(serverId, Math.min(100, Math.max(1, limit)))
    .all<Record<string, unknown>>();

  return (results || []).map((row, idx) => ({
    rank: idx + 1,
    minecraft_uuid: str(row.minecraft_uuid),
    minecraft_username: row.minecraft_username || null,
    total_playtime_seconds: Number(row.total_playtime_seconds) || 0,
    last_login_at: row.last_login_at || null,
    synced_at: row.synced_at || null,
  }));
}

export async function mcmmoLeaderboardForServer(
  db: D1Database,
  serverId: string,
  limit = 25,
): Promise<Record<string, unknown>[]> {
  const { results } = await db
    .prepare(
      `SELECT minecraft_uuid, minecraft_username, power_level, synced_at
       FROM rootstat_mcmmo_stats
       WHERE server_id = ?
       ORDER BY power_level DESC
       LIMIT ?`,
    )
    .bind(serverId, Math.min(100, Math.max(1, limit)))
    .all<Record<string, unknown>>();

  return (results || []).map((row, idx) => ({
    rank: idx + 1,
    minecraft_uuid: str(row.minecraft_uuid),
    minecraft_username: row.minecraft_username || null,
    power_level: Number(row.power_level) || 0,
    synced_at: row.synced_at || null,
  }));
}

export async function mcmmoStatsForPlayer(
  db: D1Database,
  serverId: string,
  uuid: string,
): Promise<Record<string, unknown> | null> {
  const row = await db
    .prepare(
      `SELECT server_id, minecraft_uuid, minecraft_username, power_level, skills_json, synced_at, updated_at
       FROM rootstat_mcmmo_stats
       WHERE server_id = ? AND minecraft_uuid = ?
       LIMIT 1`,
    )
    .bind(serverId, uuid)
    .first<Record<string, unknown>>();

  if (!row) return null;
  return parseMcmmoRow(row);
}

export async function mcmmoStatsAllServersForUuid(
  db: D1Database,
  uuid: string,
): Promise<Record<string, unknown>[]> {
  const { results } = await db
    .prepare(
      `SELECT server_id, minecraft_uuid, minecraft_username, power_level, skills_json, synced_at, updated_at
       FROM rootstat_mcmmo_stats
       WHERE minecraft_uuid = ?
       ORDER BY updated_at DESC`,
    )
    .bind(uuid)
    .all<Record<string, unknown>>();

  return (results || []).map(parseMcmmoRow);
}

async function latestServerIdForUuid(db: D1Database, uuid: string): Promise<string | null> {
  const row = await db
    .prepare(
      `SELECT server_id FROM rootstat_player_playtime
       WHERE minecraft_uuid = ?
       ORDER BY updated_at DESC
       LIMIT 1`,
    )
    .bind(uuid)
    .first<{ server_id: string }>();
  if (row?.server_id) return str(row.server_id) || null;

  const worth = await db
    .prepare(
      `SELECT server_id FROM rootstat_player_net_worth
       WHERE minecraft_uuid = ?
       ORDER BY synced_at DESC
       LIMIT 1`,
    )
    .bind(uuid)
    .first<{ server_id: string }>();
  return worth?.server_id ? str(worth.server_id) || null : null;
}

export async function playerStatsBundleForUuid(
  db: D1Database,
  uuid: string,
  serverId?: string | null,
): Promise<Record<string, unknown>> {
  return buildPublicStats(db, uuid, serverId);
}

async function buildPublicStats(
  db: D1Database,
  uuid: string,
  serverId?: string | null,
): Promise<Record<string, unknown>> {
  const statsUrl = publicStatsPageUrl(uuid);
  const mcmmoServers = await mcmmoStatsAllServersForUuid(db, uuid);
  const resolvedServerId =
    serverId || str(mcmmoServers[0]?.server_id) || (await latestServerIdForUuid(db, uuid)) || "rootmc";
  const mcmmo = await mcmmoStatsForPlayer(db, str(resolvedServerId), uuid);
  const playtime = await playtimeStatsForPlayer(db, str(resolvedServerId), uuid);
  const netWorth = await netWorthForPlayer(db, str(resolvedServerId), uuid);
  const treasury = await treasurySummaryForPlayer(db, str(resolvedServerId), uuid);
  const goldItemEvents = await goldItemEventsForPlayer(db, str(resolvedServerId), uuid, 40);
  const link = await rootstatLinkByMinecraftUuid(db, uuid);
  if (!link) {
    return {
      minecraft_uuid: uuid,
      verified: false,
      stats_url: statsUrl,
      minecraft_username: mcmmo?.minecraft_username || mcmmoServers[0]?.minecraft_username || null,
      avatar_url: `https://crafatar.com/avatars/${uuid.replace(/-/g, "")}?overlay&size=128`,
      mcmmo,
      mcmmo_servers: mcmmoServers,
      playtime,
      net_worth: netWorth,
      treasury,
      gold_item_events: goldItemEvents,
    };
  }

  const username = str(link.minecraft_username);
  const accountId = str(link.account_id);
  const profile = accountId ? await profileByAccountId(db, accountId) : null;
  const publicProfile = profile ? Number(profile.public_profile) !== 0 : true;
  const worlds =
    profile && publicProfile && accountId ? await sharedWorldsForAccount(db, accountId) : [];

  return {
    minecraft_uuid: str(link.minecraft_uuid) || uuid,
    minecraft_username: username || null,
    verified: true,
    verified_at: link.verified_at || null,
    updated_at: link.updated_at || null,
    stats_url: statsUrl,
    avatar_url: `https://crafatar.com/avatars/${uuid.replace(/-/g, "")}?overlay&size=128`,
    realm_username: profile?.realm_username || null,
    bio: publicProfile ? profile?.bio || null : null,
    shared_worlds: publicProfile ? worlds : [],
    profile_public: publicProfile,
    mcmmo,
    mcmmo_servers: mcmmoServers,
    playtime,
    net_worth: netWorth,
    treasury,
    gold_item_events: goldItemEvents,
  };
}

function randomCode(): string {
  const bytes = new Uint8Array(CODE_LEN);
  crypto.getRandomValues(bytes);
  let out = "";
  for (let i = 0; i < CODE_LEN; i++) {
    out += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
  }
  return out;
}

function randomServerId(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function randomServerSecret(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

function serverHeaders(request: Request): { serverId: string; serverSecret: string } {
  return {
    serverId: str(request.headers.get("X-RootStat-Server-Id")),
    serverSecret: str(request.headers.get("X-RootStat-Server-Secret")),
  };
}

export async function validateServerAuth(
  env: RootStatEnv,
  request: Request,
): Promise<{ serverId: string } | Response> {
  const { serverId, serverSecret } = serverHeaders(request);
  if (!serverId || !serverSecret) {
    return json({ detail: "Missing X-RootStat-Server-Id or X-RootStat-Server-Secret." }, 401);
  }

  // Gen 2 D1 has g2_realm_credentials only — never query Gen 1 rootstat_servers here.
  if (isG2Worker(env)) {
    const devId = str(env.G2_DEV_REALM_ID);
    const devSecret = str(env.G2_DEV_REALM_SECRET);
    if (devId && devSecret && serverId === devId && serverSecret === devSecret) {
      return { serverId };
    }
    const row = await env.DB.prepare(
      "SELECT secret_hash FROM g2_realm_credentials WHERE realm_id = ? LIMIT 1",
    )
      .bind(serverId)
      .first<{ secret_hash: string }>();
    if (!row?.secret_hash) {
      return json({ detail: "Unknown realm. Register credentials in plugins/RootMC/cloud.yml." }, 403);
    }
    const hash = await sha256Hex(serverSecret);
    if (hash !== row.secret_hash) {
      return json({ detail: "Invalid realm secret." }, 403);
    }
    return { serverId };
  }

  const devId = str(env.ROOTSTAT_DEV_SERVER_ID);
  const devSecret = str(env.ROOTSTAT_DEV_SERVER_SECRET);
  if (devId && devSecret && serverId === devId && serverSecret === devSecret) {
    return { serverId };
  }

  const row = await env.DB.prepare(
    "SELECT server_secret_hash FROM rootstat_servers WHERE server_id = ? LIMIT 1",
  )
    .bind(serverId)
    .first<{ server_secret_hash: string }>();

  if (!row?.server_secret_hash) {
    return json({ detail: "Unknown server. Register server credentials in cloud.yml." }, 403);
  }

  const hash = await sha256Hex(serverSecret);
  if (hash !== row.server_secret_hash) {
    return json({ detail: "Invalid server secret." }, 403);
  }

  return { serverId };
}

function likePattern(raw: string): string {
  const escaped = raw.replace(/[%_\\]/g, "\\$&");
  return `%${escaped}%`;
}

export async function searchPublicPlayers(
  db: D1Database,
  query: string,
  limit: number,
): Promise<
  Array<{
    minecraft_uuid: string;
    minecraft_username: string | null;
    verified: boolean;
    stats_url: string;
  }>
> {
  const raw = query.trim();
  if (raw.length < 2) return [];

  const exactUuid = normalizeMinecraftUuid(raw);
  if (exactUuid) {
    const link = await rootstatLinkByMinecraftUuid(db, exactUuid);
    let username = str(link?.minecraft_username) || null;
    if (!username) {
      const pt = await db
        .prepare(
          `SELECT minecraft_username FROM rootstat_player_playtime
           WHERE minecraft_uuid = ? ORDER BY updated_at DESC LIMIT 1`,
        )
        .bind(exactUuid)
        .first<{ minecraft_username: string | null }>();
      username = str(pt?.minecraft_username) || null;
    }
    return [
      {
        minecraft_uuid: exactUuid,
        minecraft_username: username,
        verified: !!link,
        stats_url: publicStatsPageUrl(exactUuid),
      },
    ];
  }

  const pattern = likePattern(raw);
  const lim = Math.min(25, Math.max(1, limit));

  const { results } = await db
    .prepare(
      `SELECT minecraft_uuid,
              MAX(minecraft_username) AS minecraft_username,
              MAX(verified) AS verified
       FROM (
         SELECT minecraft_uuid, minecraft_username, 1 AS verified
         FROM rootstat_minecraft_links
         WHERE minecraft_username LIKE ? ESCAPE '\\' COLLATE NOCASE
         UNION ALL
         SELECT minecraft_uuid, minecraft_username, 0 AS verified
         FROM rootstat_player_playtime
         WHERE minecraft_username LIKE ? ESCAPE '\\' COLLATE NOCASE
         UNION ALL
         SELECT minecraft_uuid, minecraft_username, 0 AS verified
         FROM rootstat_mcmmo_stats
         WHERE minecraft_username LIKE ? ESCAPE '\\' COLLATE NOCASE
         UNION ALL
         SELECT minecraft_uuid, minecraft_username, 0 AS verified
         FROM rootstat_player_balances
         WHERE minecraft_username LIKE ? ESCAPE '\\' COLLATE NOCASE
       )
       GROUP BY minecraft_uuid
       ORDER BY verified DESC, minecraft_username ASC
       LIMIT ?`,
    )
    .bind(pattern, pattern, pattern, pattern, lim)
    .all<{ minecraft_uuid: string; minecraft_username: string | null; verified: number }>();

  return (results || []).map((row) => {
    const uuid = str(row.minecraft_uuid).toLowerCase();
    return {
      minecraft_uuid: uuid,
      minecraft_username: str(row.minecraft_username) || null,
      verified: Number(row.verified) > 0,
      stats_url: publicStatsPageUrl(uuid),
    };
  });
}

export async function handleRootStatMinecraft(
  request: Request,
  env: RootStatEnv,
  subpath: string,
  method: string,
): Promise<Response | null> {
  if (!subpath.startsWith("/realm/minecraft")) return null;
  const rest = subpath.slice("/realm/minecraft".length) || "/";

  if (method === "GET" && rest.startsWith("/stats/")) {
    const pathPart = rest.slice("/stats/".length);
    const qIdx = pathPart.indexOf("?");
    const uuidRaw = qIdx >= 0 ? pathPart.slice(0, qIdx) : pathPart.split("/")[0];
    const uuid = normalizeMinecraftUuid(uuidRaw);
    if (!uuid) return json({ detail: "Valid minecraft uuid required." }, 400);
    const url = new URL(request.url);
    const serverId = str(url.searchParams.get("server_id")) || null;
    return json({ stats: await buildPublicStats(env.DB, uuid, serverId) });
  }

  if (method === "GET" && rest === "/players/search") {
    const url = new URL(request.url);
    const q = str(url.searchParams.get("q")).trim();
    const limit = Math.min(25, Math.max(1, Number(url.searchParams.get("limit")) || 15));
    if (q.length < 2) {
      return json({ players: [], query: q });
    }
    const players = await searchPublicPlayers(env.DB, q, limit);
    return json({ players, query: q });
  }

  if (method === "POST" && rest === "/server/register") {
    const auth = await requireSignedInAccount(request, env);
    if (auth instanceof Response) return auth;

    let body: { server_name?: string } = {};
    try {
      body = record(JSON.parse(await request.text()));
    } catch {
      return json({ detail: "Invalid JSON body." }, 400);
    }

    const serverId = randomServerId();
    const serverSecret = randomServerSecret();
    const serverName = str(body.server_name) || "Minecraft server";
    const now = nowIso();
    const hash = await sha256Hex(serverSecret);

    await env.DB.prepare(
      `INSERT INTO rootstat_servers
         (server_id, server_name, server_secret_hash, owner_account_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
      .bind(serverId, serverName, hash, auth.accountId, now, now)
      .run();

    return json({
      server_id: serverId,
      server_secret: serverSecret,
      server_name: serverName,
      note: "Copy server_id and server_secret into RootStat config.yml  -  the secret is shown only once.",
    });
  }

  if (method === "GET" && rest === "/server/mine") {
    const auth = await requireSignedInAccount(request, env);
    if (auth instanceof Response) return auth;

    const { results } = await env.DB.prepare(
      `SELECT server_id, server_name, created_at, updated_at
       FROM rootstat_servers
       WHERE owner_account_id = ?
       ORDER BY created_at DESC`,
    )
      .bind(auth.accountId)
      .all<Record<string, unknown>>();

    return json({ servers: results || [] });
  }

  if (method === "POST" && rest === "/link/start") {
    const server = await validateServerAuth(env, request);
    if (server instanceof Response) return server;

    let body: { uuid?: string; username?: string } = {};
    try {
      body = record(JSON.parse(await request.text()));
    } catch {
      return json({ detail: "Invalid JSON body." }, 400);
    }

    const uuid = str(body.uuid).toLowerCase();
    const username = str(body.username);
    if (!uuid || !/^[0-9a-f-]{36}$/.test(uuid)) {
      return json({ detail: "Valid minecraft uuid required." }, 400);
    }
    if (!username || username.length > 16) {
      return json({ detail: "Valid minecraft username required." }, 400);
    }

    const now = new Date();
    const expiresAt = new Date(now.getTime() + CODE_TTL_MS).toISOString();
    const createdAt = now.toISOString();

    let code = randomCode();
    for (let attempt = 0; attempt < 5; attempt++) {
      const existing = await env.DB.prepare(
        "SELECT code FROM rootstat_link_codes WHERE code = ? LIMIT 1",
      )
        .bind(code)
        .first();
      if (!existing) break;
      code = randomCode();
    }

    await env.DB.prepare(
      "DELETE FROM rootstat_link_codes WHERE minecraft_uuid = ? AND consumed_at IS NULL",
    )
      .bind(uuid)
      .run();

    await env.DB.prepare(
      `INSERT INTO rootstat_link_codes
         (code, minecraft_uuid, minecraft_username, server_id, created_at, expires_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
      .bind(code, uuid, username, server.serverId, createdAt, expiresAt)
      .run();

    const base = verifyUrl(env);
    return json({
      code,
      verify_url: `${base}?code=${encodeURIComponent(code)}`,
      expires_at: expiresAt,
      minecraft_username: username,
      // Discord Gateway bot (local-edge) accepts: DM "link CODE" — no Cloudflare Worker required.
      discord_dm_hint: `DM the RootMC bot: link ${code}`,
    });
  }

  if (method === "GET" && rest === "/link/preview") {
    const url = new URL(request.url);
    const code = str(url.searchParams.get("code")).toUpperCase();
    if (!code) return json({ detail: "code query param required." }, 400);

    const row = await env.DB.prepare(
      `SELECT code, minecraft_username, expires_at, consumed_at
       FROM rootstat_link_codes WHERE code = ? LIMIT 1`,
    )
      .bind(code)
      .first<Record<string, unknown>>();

    if (!row) return json({ valid: false, reason: "not_found" });
    if (row.consumed_at) return json({ valid: false, reason: "consumed" });
    if (String(row.expires_at) < nowIso()) return json({ valid: false, reason: "expired" });

    return json({
      valid: true,
      code: row.code,
      minecraft_username: row.minecraft_username,
      expires_at: row.expires_at,
    });
  }

  if (method === "POST" && rest === "/link/app/complete") {
    let body: { code?: string } = {};
    try {
      body = record(JSON.parse(await request.text()));
    } catch {
      return json({ detail: "Invalid JSON body." }, 400);
    }
    return completeAppLinkLogin(env, str(body.code));
  }

  if (method === "POST" && rest === "/link/complete") {
    let body: { code?: string } = {};
    try {
      body = record(JSON.parse(await request.text()));
    } catch {
      return json({ detail: "Invalid JSON body." }, 400);
    }

    const code = str(body.code).toUpperCase();
    if (!code) return json({ detail: "Verification code required." }, 400);

    const linkRow = validateLinkCodeRow(await loadLinkCode(env.DB, code));
    if (linkRow instanceof Response) return linkRow;

    const session = await sessionFromRequest(env, request);
    let accountId: string;
    let email: string;
    let provisioned = false;

    if (session?.accountId && session.email) {
      accountId = session.accountId;
      email = session.email;
    } else {
      const account = await provisionMinecraftPlayerAccount(
        env.DB,
        linkRow.minecraft_uuid,
        linkRow.minecraft_username,
      );
      accountId = account.accountId;
      email = account.email;
      provisioned = account.created;
    }

    await upsertGlobalMinecraftLink(
      env.DB,
      linkRow.minecraft_uuid,
      linkRow.minecraft_username,
      accountId,
      email,
    );
    await consumeLinkCode(env.DB, code, accountId);

    const token = provisioned ? await mintAuthToken(env, email, accountId) : null;

    return json({
      ok: true,
      minecraft_uuid: linkRow.minecraft_uuid,
      minecraft_username: linkRow.minecraft_username,
      account_id: accountId,
      provisioned,
      token: token || undefined,
    });
  }

  if (method === "GET" && rest === "/link/status") {
    const server = await validateServerAuth(env, request);
    if (server instanceof Response) return server;

    const url = new URL(request.url);
    const uuid = str(url.searchParams.get("uuid")).toLowerCase();
    if (!uuid) return json({ detail: "uuid query param required." }, 400);

    const row = await env.DB.prepare(
      `SELECT minecraft_uuid, minecraft_username, account_id, email, verified_at, updated_at
       FROM rootstat_minecraft_links WHERE minecraft_uuid = ? LIMIT 1`,
    )
      .bind(uuid)
      .first<Record<string, unknown>>();

    if (!row) {
      return json({
        linked: false,
        minecraft_uuid: uuid,
        stats_url: publicStatsPageUrl(uuid),
        discord_linked: false,
        verify_url: verifyUrl(env),
      });
    }

    const accountId = str(row.account_id);
    const discordRow = accountId
      ? await env.DB.prepare(
          `SELECT discord_user_id, discord_username, discord_global_name
           FROM discord_account_links WHERE account_id = ? LIMIT 1`,
        )
          .bind(accountId)
          .first<{ discord_user_id: string; discord_username: string | null; discord_global_name: string | null }>()
      : null;
    const discordUserId = str(discordRow?.discord_user_id);
    const discordLinked = !!discordUserId;
    const email = str(row.email);
    const memberFlags = email ? await blueprintMemberFlags(env.DB, email) : null;
    const topActive = await isCurrentTopActivePlayer(env.DB, str(row.minecraft_uuid) || uuid).catch(() => false);

    return json({
      linked: true,
      minecraft_uuid: row.minecraft_uuid,
      minecraft_username: row.minecraft_username,
      account_id: row.account_id,
      email: row.email,
      verified_at: row.verified_at,
      updated_at: row.updated_at,
      stats_url: publicStatsPageUrl(str(row.minecraft_uuid) || uuid),
      discord_linked: discordLinked,
      discord_user_id: discordLinked ? discordUserId : undefined,
      discord_username: discordLinked
        ? str(discordRow?.discord_global_name) || str(discordRow?.discord_username) || undefined
        : undefined,
      discord_profile_url: discordLinked ? `https://discord.com/users/${discordUserId}` : undefined,
      verify_url: verifyUrl(env),
      pro_unlocked: memberFlags?.pro_unlocked ?? false,
      life_member: memberFlags?.life_member ?? false,
      top_active_player: topActive,
      blueprint_eligible: memberFlags?.blueprint_eligible ?? false,
    });
  }

  if (method === "GET" && rest === "/governance/voting-power") {
    const server = await validateServerAuth(env, request);
    if (server instanceof Response) return server;

    const url = new URL(request.url);
    const uuid = str(url.searchParams.get("uuid")).toLowerCase();
    if (!uuid) return json({ detail: "uuid query param required." }, 400);

    const serverId = await resolveServerId(env.DB);
    const power = await governancePowerForUuid(env.DB, serverId, uuid, undefined, env);
    const votingChannelId = str((env as Record<string, unknown>).DISCORD_ROOTMC_VOTING_CHANNEL_ID);
    const guildId = str(env.DISCORD_ROOTMC_GUILD_ID) || "1516108585740800042";
    const votingChannelUrl = votingChannelId
      ? `https://discord.com/channels/${guildId}/${votingChannelId}`
      : "https://rootmc.net/wiki/constitution/#governance-voting";

    return json({
      ok: true,
      eligible: isGovernanceEligible(power),
      share_percent: power?.share_percent ?? 0,
      playtime_seconds: power?.playtime_seconds ?? 0,
      gen1_playtime_seconds: power?.gen1_playtime_seconds ?? 0,
      gen2_playtime_seconds: power?.gen2_playtime_seconds ?? 0,
      net_worth: power?.net_worth ?? 0,
      site_multiplier: power?.site_multiplier ?? 1,
      total_votes: power?.total_votes ?? 0,
      vote_points: power?.vote_points ?? 1,
      sites_voted: power?.sites_voted ?? [],
      voting_channel_url: votingChannelUrl,
      constitution_url: "https://rootmc.net/wiki/constitution/#governance-voting",
      summary: power ? formatGovernancePowerLine(power) : null,
    });
  }

  if (method === "GET" && rest === "/sync") {
    const server = await validateServerAuth(env, request);
    if (server instanceof Response) return server;

    const url = new URL(request.url);
    const since = str(url.searchParams.get("since"));

    let stmt;
    if (since) {
      stmt = env.DB.prepare(
        `SELECT minecraft_uuid, minecraft_username, account_id, email, verified_at, updated_at
         FROM rootstat_minecraft_links
         WHERE updated_at >= ?
         ORDER BY updated_at ASC`,
      ).bind(since);
    } else {
      stmt = env.DB.prepare(
        `SELECT minecraft_uuid, minecraft_username, account_id, email, verified_at, updated_at
         FROM rootstat_minecraft_links
         ORDER BY updated_at ASC`,
      );
    }

    const { results } = await stmt.all<Record<string, unknown>>();
    return json({
      players: results || [],
      synced_at: nowIso(),
      server_id: server.serverId,
    });
  }

  if (method === "POST" && rest === "/mcmmo/sync") {
    const server = await validateServerAuth(env, request);
    if (server instanceof Response) return server;

    let body: { players?: unknown[] } = {};
    try {
      body = record(JSON.parse(await request.text()));
    } catch {
      return json({ detail: "Invalid JSON body." }, 400);
    }

    const players = Array.isArray(body.players) ? body.players : [];
    const now = nowIso();
    let upserted = 0;

    for (const raw of players) {
      const row = record(raw);
      const uuid = normalizeMinecraftUuid(str(row.minecraft_uuid));
      if (!uuid) continue;

      const skillsIn = record(row.skills);
      const skills: Record<string, number> = {};
      for (const key of MCMMO_SKILL_KEYS) {
        const val = skillsIn[key];
        if (typeof val === "number" && Number.isFinite(val)) {
          skills[key] = Math.max(0, Math.floor(val));
        }
      }

      let powerLevel = Number(row.power_level);
      const hasMcmmo = Object.keys(skills).length > 0 || (Number.isFinite(powerLevel) && powerLevel > 0);
      if (hasMcmmo) {
        if (!Number.isFinite(powerLevel) || powerLevel <= 0) {
          powerLevel = Object.values(skills).reduce((sum, n) => sum + n, 0);
        }

        await env.DB.prepare(
          `INSERT INTO rootstat_mcmmo_stats
             (server_id, minecraft_uuid, minecraft_username, power_level, skills_json, synced_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(server_id, minecraft_uuid) DO UPDATE SET
             minecraft_username = excluded.minecraft_username,
             power_level = excluded.power_level,
             skills_json = excluded.skills_json,
             synced_at = excluded.synced_at,
             updated_at = excluded.updated_at`,
        )
          .bind(
            server.serverId,
            uuid,
            str(row.minecraft_username) || null,
            Math.floor(powerLevel),
            JSON.stringify(skills),
            str(row.synced_at) || now,
            now,
          )
          .run();
      }

      const playtimeSeconds = Number(row.playtime_seconds);
      const hasPlaytime =
        Number.isFinite(playtimeSeconds) ||
        str(row.first_join_at) ||
        str(row.last_login_at);
      if (hasPlaytime) {
        await env.DB.prepare(
          `INSERT INTO rootstat_player_playtime
             (server_id, minecraft_uuid, minecraft_username, total_playtime_seconds,
              first_join_at, last_login_at, synced_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(server_id, minecraft_uuid) DO UPDATE SET
             minecraft_username = excluded.minecraft_username,
             total_playtime_seconds = excluded.total_playtime_seconds,
             first_join_at = COALESCE(excluded.first_join_at, first_join_at),
             last_login_at = COALESCE(excluded.last_login_at, last_login_at),
             synced_at = excluded.synced_at,
             updated_at = excluded.updated_at`,
        )
          .bind(
            server.serverId,
            uuid,
            str(row.minecraft_username) || null,
            Number.isFinite(playtimeSeconds) ? Math.max(0, Math.floor(playtimeSeconds)) : 0,
            str(row.first_join_at) || null,
            str(row.last_login_at) || null,
            str(row.synced_at) || now,
            now,
          )
          .run();
      }

      if (hasMcmmo || hasPlaytime) {
        upserted++;
      }
    }

    await env.DB.prepare(
      `UPDATE rootstat_servers SET rootstat_last_seen_at = ?, updated_at = ? WHERE server_id = ?`,
    )
      .bind(now, now, server.serverId)
      .run();

    return json({ ok: true, upserted, synced_at: now, server_id: server.serverId });
  }

  if (method === "GET" && rest === "/me") {
    const auth = await requireSignedInAccount(request, env);
    if (auth instanceof Response) return auth;

    const { results } = await env.DB.prepare(
      `SELECT minecraft_uuid, minecraft_username, account_id, email, verified_at, updated_at
       FROM rootstat_minecraft_links
       WHERE account_id = ?
       ORDER BY verified_at DESC`,
    )
      .bind(auth.accountId)
      .all<Record<string, unknown>>();

    return json({ links: results || [] });
  }

  if (method === "POST" && rest === "/memberships/redeem-voucher") {
    const server = await validateServerAuth(env, request);
    if (server instanceof Response) return server;

    let body: Record<string, unknown>;
    try {
      body = JSON.parse(await request.text()) as Record<string, unknown>;
    } catch {
      return json({ detail: "Invalid JSON body." }, 400);
    }
    const uuid = str(body.minecraft_uuid).toLowerCase();
    const voucherId = str(body.voucher_id);
    if (!/^[0-9a-f-]{36}$/.test(uuid)) {
      return json({ detail: "minecraft_uuid required." }, 400);
    }
    if (!voucherId) return json({ detail: "voucher_id required." }, 400);

    const link = await env.DB.prepare(
      `SELECT account_id, email FROM rootstat_minecraft_links WHERE minecraft_uuid = ? LIMIT 1`,
    )
      .bind(uuid)
      .first<{ account_id: string; email: string | null }>();
    if (!link?.account_id || !link.email) {
      return json({ detail: "Player not linked." }, 404);
    }

    const { redeemProVoucher } = await import("./rootmc-pro-vouchers");
    const result = await redeemProVoucher(env.DB, {
      voucherId,
      accountId: link.account_id,
      email: String(link.email),
    });
    if (!result.ok) return json({ ok: false, detail: result.detail }, 400);
    return json({
      ok: true,
      tier: result.tier,
      pro_paid_until: result.pro_paid_until ?? null,
      life_member: result.tier === "lifetime",
    });
  }

  return json({ detail: "Not Found" }, 404);
}
