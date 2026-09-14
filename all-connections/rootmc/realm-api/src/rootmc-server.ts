import type { D1Database } from "@cloudflare/workers-types";

import { json } from "./cors";
import { requireSignedInAccount, str, record } from "./realm-lib";
import type { RootStatEnv } from "./rootstat-minecraft";
import { netWorthForPlayer } from "./rootmc-economy";
import {
  mcmmoLeaderboardForServer,
  mcmmoStatsForPlayer,
  playtimeLeaderboardForServer,
  playtimeStatsForPlayer,
  validateServerAuth,
} from "./rootstat-minecraft";
import {
  goldFoundLeaderboardForServer,
  goldFoundSummaryForServer,
  latestGoldFoundSyncedAt,
} from "./rootmc-gold-found";
import { goldItemEventsForPlayer, recentGoldItemEventsForServer } from "./rootmc-gold-item-events";
import { getActiveSeason, seasonPayload } from "./rootmc-season-arcs";
import { upsertServerLiveStats } from "./rootmc-live-economy-status";
import { touchServerPresenceOnHeartbeat } from "./rootmc-host-presence";
import { fetchActivityTimezonePublic } from "./rootmc-activity-mysql";
import {
  emptyHourBuckets,
  formatMaintenanceWindow,
  HST_OFFSET_MINUTES,
  isHourInMaintenanceWindow,
  shiftBucketsToOffset,
} from "./rootmc-timezone-defs";

import {
  ROOTMC_MARKET,
  ROOTMC_PLAY_HOST,
  ROOTMC_PLUGINS,
  ROOTMC_REALM_HOME,
  ROOTMC_MAP_URL,
  ROOTMC_VERIFY,
  verifyUrl,
  wikiPlayerUrl,
} from "./rootmc-site";
import { isLegacyDualHostId, LIVE_PRODUCTION_SERVER_ID } from "./rootmc-live-public";

export const ROOTMC_SERVER_IP = "15.204.13.9";
export const FEATURED_SERVER_ADDRESS = ROOTMC_PLAY_HOST;
export { ROOTMC_MAP_URL, ROOTMC_PLAY_HOST };

/** Public server  -  play host and map are always exposed on realm + Discord. */
export const ROOTMC_HIDE_CONNECTION_DETAILS_PRELAUNCH = false;

export const ROOTMC_ADDRESS_PUBLIC_PLACEHOLDER = ROOTMC_PLAY_HOST;

export function publicServerAddress(address: string | null | undefined): string {
  if (ROOTMC_HIDE_CONNECTION_DETAILS_PRELAUNCH) {
    return ROOTMC_ADDRESS_PUBLIC_PLACEHOLDER;
  }
  return str(address) || FEATURED_SERVER_ADDRESS;
}

export function publicMapUrl(mapUrl: string | null | undefined): string | null {
  if (ROOTMC_HIDE_CONNECTION_DETAILS_PRELAUNCH) return null;
  const url = str(mapUrl);
  return url || ROOTMC_MAP_URL;
}

export const REALM_PLUGIN_BASE = ROOTMC_PLUGINS;

/** Published plugin jars (remote server pulls via RootMC heartbeat  -  no SSH). */
export const PLUGIN_RELEASES = {
  rootmc: {
    version: "1.8.112",
    filename: "rootmc-1.8.112.jar",
    url: `${REALM_PLUGIN_BASE}/rootmc-1.8.112.jar`,
  },
  root_essentials: {
    version: "1.8.111",
    filename: "root-essentials-1.8.111.jar",
    url: `${REALM_PLUGIN_BASE}/root-essentials-1.8.111.jar`,
  },
  root_core: {
    version: "1.8.112",
    filename: "root-core-1.8.112.jar",
    url: `${REALM_PLUGIN_BASE}/root-core-1.8.112.jar`,
  },
  root_skills: {
    version: "1.8.111",
    filename: "root-skills-1.8.111.jar",
    url: `${REALM_PLUGIN_BASE}/root-skills-1.8.111.jar`,
  },
} as const;

export const ROOTMC_CONFIG_DEFAULTS = {
  "cloud.stats-url-base": "https://rootmc.net/player",
  "cloud.sync-interval-minutes": 5,
} as const;

export const FEATURED_SERVER_DEFAULTS = {
  server_id: "rootmc",
  server_name: "RootMC",
  server_address: FEATURED_SERVER_ADDRESS,
  default_world_name: "RootMC",
  game_version: "26.3",
  map_url: ROOTMC_MAP_URL as string | null,
  verify_url: ROOTMC_VERIFY,
  realm_url: ROOTMC_REALM_HOME,
};

/** Legacy server id  -  D1 rows may still use rootrecord-smp until migrated. */
export const LEGACY_SERVER_ID = "rootrecord-smp";

function nowIso(): string {
  return new Date().toISOString();
}

function pluginActive(lastSeen: string | null | undefined): boolean {
  if (!lastSeen) return false;
  const ms = Date.parse(lastSeen);
  if (Number.isNaN(ms)) return false;
  return Date.now() - ms < 15 * 60 * 1000;
}

function rootstatActive(lastSeen: string | null | undefined): boolean {
  if (!lastSeen) return false;
  const ms = Date.parse(lastSeen);
  if (Number.isNaN(ms)) return false;
  return Date.now() - ms < 24 * 60 * 60 * 1000;
}

/** Featured / server lists drop entries with no heartbeat or RootStat sync in this window. */
const FEATURED_LIST_MAX_AGE_MS = 3 * 24 * 60 * 60 * 1000;

function lastPingMs(row: ServerRow): number | null {
  const times = [row.rootmc_last_seen_at, row.rootstat_last_seen_at]
    .map((s) => Date.parse(s || ""))
    .filter((ms) => !Number.isNaN(ms));
  if (times.length === 0) return null;
  return Math.max(...times);
}

function pingedWithin(row: ServerRow, windowMs: number): boolean {
  const last = lastPingMs(row);
  if (last === null) return false;
  return Date.now() - last < windowMs;
}

type ServerRow = {
  server_id: string;
  server_name: string;
  server_address: string;
  default_world_name: string;
  game_version: string;
  map_url: string | null;
  rootmc_plugin_version: string | null;
  rootmc_last_seen_at: string | null;
  rootstat_last_seen_at: string | null;
  featured: number;
};

function parseServerRow(raw: Record<string, unknown>): ServerRow {
  return {
    server_id: str(raw.server_id) || FEATURED_SERVER_DEFAULTS.server_id,
    server_name: str(raw.server_name) || FEATURED_SERVER_DEFAULTS.server_name,
    server_address: str(raw.server_address) || FEATURED_SERVER_DEFAULTS.server_address,
    default_world_name: str(raw.default_world_name) || FEATURED_SERVER_DEFAULTS.default_world_name,
    game_version: str(raw.game_version) || FEATURED_SERVER_DEFAULTS.game_version,
    map_url: str(raw.map_url) || null,
    rootmc_plugin_version: str(raw.rootmc_plugin_version) || null,
    rootmc_last_seen_at: str(raw.rootmc_last_seen_at) || null,
    rootstat_last_seen_at: str(raw.rootstat_last_seen_at) || null,
    featured: Number(raw.featured) || 0,
  };
}

function serverIsConnected(row: ServerRow): boolean {
  if (pluginActive(row.rootmc_last_seen_at)) return true;
  if (rootstatActive(row.rootstat_last_seen_at)) return true;
  return false;
}

function serverListedInFeatured(row: ServerRow): boolean {
  return pingedWithin(row, FEATURED_LIST_MAX_AGE_MS);
}

async function resolveHeartbeatMaintenance(env: RootStatEnv): Promise<{
  maintenance_active: boolean;
  maintenance_window: string | null;
}> {
  try {
    const activity = await fetchActivityTimezonePublic(env);
    const globalInHst = emptyHourBuckets();
    if (activity?.mysql) {
      for (const z of activity.timezones) {
        const shifted = shiftBucketsToOffset(z.hourBuckets, z.offsetMinutes, HST_OFFSET_MINUTES);
        for (let h = 0; h < 24; h++) globalInHst[h] += shifted[h] || 0;
      }
    }
    const buckets = globalInHst.some((v) => (v || 0) > 0) ? globalInHst : emptyHourBuckets();
    const window = formatMaintenanceWindow(buckets) || null;
    const hstHour = (new Date().getUTCHours() - 10 + 24) % 24;
    const active = window ? isHourInMaintenanceWindow(buckets, hstHour) : false;
    return { maintenance_active: active, maintenance_window: window };
  } catch {
    return { maintenance_active: false, maintenance_window: null };
  }
}

function publicServerPayload(row: ServerRow) {
  const rootmcOnline = pluginActive(row.rootmc_last_seen_at);
  const rootstatOnline = rootstatActive(row.rootstat_last_seen_at);
  return {
    server_id: row.server_id,
    name: row.server_name,
    address: publicServerAddress(row.server_address),
    default_world_name: row.default_world_name,
    game_version: row.game_version,
    map_url: publicMapUrl(row.map_url),
    verify_url: FEATURED_SERVER_DEFAULTS.verify_url,
    realm_url: FEATURED_SERVER_DEFAULTS.realm_url,
    featured: row.featured !== 0,
    connected: serverIsConnected(row),
    rootmc_plugin_installed: rootmcOnline,
    rootmc_plugin_version: row.rootmc_plugin_version,
    rootmc_last_seen_at: row.rootmc_last_seen_at,
    rootmc_sync_active: rootstatOnline,
    rootstat_active: rootstatOnline,
    rootstat_last_seen_at: row.rootstat_last_seen_at,
  };
}

async function connectedServerRows(db: D1Database): Promise<ServerRow[]> {
  const { results } = await db
    .prepare(
      `SELECT server_id, server_name, server_address, default_world_name, map_url, game_version,
              rootmc_plugin_version, rootmc_last_seen_at, rootstat_last_seen_at, featured
       FROM rootstat_servers
       ORDER BY featured DESC, updated_at DESC`,
    )
    .all<Record<string, unknown>>();

  return (results || []).map(parseServerRow).filter(serverListedInFeatured);
}

async function featuredServerRow(db: D1Database): Promise<ServerRow | null> {
  const rows = await connectedServerRows(db);
  const production = rows.find(
    (r) => r.featured !== 0 && !isLegacyDualHostId(r.server_id) && r.server_id === LIVE_PRODUCTION_SERVER_ID,
  );
  if (production) return production;
  const featured = rows.find((r) => r.featured !== 0 && !isLegacyDualHostId(r.server_id));
  if (featured) return featured;
  const liveNamed = rows.find((r) => !isLegacyDualHostId(r.server_id));
  if (liveNamed) return liveNamed;
  // Synthetic singular production — never fall back to old Towny/Claims UUIDs.
  return {
    server_id: FEATURED_SERVER_DEFAULTS.server_id,
    server_name: FEATURED_SERVER_DEFAULTS.server_name,
    server_address: FEATURED_SERVER_DEFAULTS.server_address,
    default_world_name: FEATURED_SERVER_DEFAULTS.default_world_name,
    game_version: FEATURED_SERVER_DEFAULTS.game_version,
    map_url: FEATURED_SERVER_DEFAULTS.map_url,
    rootmc_plugin_version: null,
    rootmc_last_seen_at: new Date().toISOString(),
    rootstat_last_seen_at: new Date().toISOString(),
    featured: 1,
  };
}

export async function handleRootMcServer(
  request: Request,
  env: RootStatEnv,
  subpath: string,
  method: string,
): Promise<Response | null> {
  if (!subpath.startsWith("/rootmc/server")) return null;
  const rest = subpath.slice("/rootmc/server".length) || "/";

  if (method === "GET" && rest === "/config") {
    const row = await featuredServerRow(env.DB);
    if (!row) {
      return json({ featured_server: null });
    }
    const payload = publicServerPayload(row);
    const seasonRow = await getActiveSeason(env.DB);
    return json({
      featured_server: {
        server_id: payload.server_id,
        name: payload.name,
        address: payload.address,
        default_world_name: payload.default_world_name,
        game_version: payload.game_version,
        map_url: payload.map_url,
        verify_url: payload.verify_url,
        realm_url: payload.realm_url,
        rootmc_plugin_installed: payload.rootmc_plugin_installed,
        rootmc_plugin_version: payload.rootmc_plugin_version,
        rootmc_last_seen_at: payload.rootmc_last_seen_at,
      },
      season: seasonPayload(seasonRow).active,
    });
  }

  if (method === "GET" && rest === "/featured") {
    const rows = await connectedServerRows(env.DB);
    return json({
      servers: rows.map(publicServerPayload),
    });
  }

  if (method === "GET" && rest.startsWith("/") && rest.endsWith("/mcmmo/me")) {
    const auth = await requireSignedInAccount(request, env);
    if (auth instanceof Response) return auth;

    const serverId = decodeURIComponent(rest.slice(1, -"/mcmmo/me".length));
    if (!serverId) return json({ detail: "server_id required." }, 400);

    const link = await env.DB.prepare(
      `SELECT minecraft_uuid, minecraft_username FROM rootstat_minecraft_links WHERE account_id = ? LIMIT 1`,
    )
      .bind(auth.accountId)
      .first<Record<string, unknown>>();

    const uuid = str(link?.minecraft_uuid);
    if (!uuid) {
      return json({
        server_id: serverId,
        minecraft_linked: false,
        rootstat_linked: false,
        mcmmo: null,
      });
    }

    const mcmmo = await mcmmoStatsForPlayer(env.DB, serverId, uuid);
    const playtime = await playtimeStatsForPlayer(env.DB, serverId, uuid);
    return json({
      server_id: serverId,
      minecraft_linked: true,
      rootstat_linked: true,
      minecraft_uuid: uuid,
      minecraft_username: link?.minecraft_username || null,
      mcmmo,
      playtime,
    });
  }

  if (method === "GET" && rest.startsWith("/") && rest.endsWith("/playtime/me")) {
    const auth = await requireSignedInAccount(request, env);
    if (auth instanceof Response) return auth;

    const serverId = decodeURIComponent(rest.slice(1, -"/playtime/me".length));
    if (!serverId) return json({ detail: "server_id required." }, 400);

    const link = await env.DB.prepare(
      `SELECT minecraft_uuid, minecraft_username FROM rootstat_minecraft_links WHERE account_id = ? LIMIT 1`,
    )
      .bind(auth.accountId)
      .first<Record<string, unknown>>();

    const uuid = str(link?.minecraft_uuid);
    if (!uuid) {
      return json({
        server_id: serverId,
        minecraft_linked: false,
        rootstat_linked: false,
        playtime: null,
      });
    }

    const playtime = await playtimeStatsForPlayer(env.DB, serverId, uuid);
    return json({
      server_id: serverId,
      minecraft_linked: true,
      rootstat_linked: true,
      minecraft_uuid: uuid,
      minecraft_username: link?.minecraft_username || null,
      playtime,
    });
  }

  const playtimeLeaderboardMatch = rest.match(/^\/([^/]+)\/playtime\/leaderboard$/);
  if (method === "GET" && playtimeLeaderboardMatch) {
    const serverId = decodeURIComponent(playtimeLeaderboardMatch[1]);
    const url = new URL(request.url);
    const limit = Number(url.searchParams.get("limit")) || 25;
    const leaderboard = await playtimeLeaderboardForServer(env.DB, serverId, limit);
    return json({
      server_id: serverId,
      leaderboard,
      synced_at: new Date().toISOString(),
    });
  }

  const mcmmoLeaderboardMatch = rest.match(/^\/([^/]+)\/mcmmo\/leaderboard$/);
  if (method === "GET" && mcmmoLeaderboardMatch) {
    const serverId = decodeURIComponent(mcmmoLeaderboardMatch[1]);
    const url = new URL(request.url);
    const limit = Number(url.searchParams.get("limit")) || 25;
    const leaderboard = await mcmmoLeaderboardForServer(env.DB, serverId, limit);
    return json({
      server_id: serverId,
      leaderboard,
      synced_at: new Date().toISOString(),
    });
  }

  const goldFoundLeaderboardMatch = rest.match(/^\/([^/]+)\/gold-found\/leaderboard$/);
  if (method === "GET" && goldFoundLeaderboardMatch) {
    const serverId = decodeURIComponent(goldFoundLeaderboardMatch[1]);
    const url = new URL(request.url);
    const limit = Number(url.searchParams.get("limit")) || 25;
    const order = url.searchParams.get("order") === "total" ? "total" : "since_july";
    const [leaderboard, summary, syncedAt] = await Promise.all([
      goldFoundLeaderboardForServer(env.DB, serverId, limit, order),
      goldFoundSummaryForServer(env.DB, serverId),
      latestGoldFoundSyncedAt(env.DB, serverId),
    ]);
    return json({
      server_id: serverId,
      leaderboard,
      summary,
      synced_at: syncedAt || new Date().toISOString(),
    });
  }

  const goldItemEventsMatch = rest.match(/^\/([^/]+)\/gold-items\/events$/);
  if (method === "GET" && goldItemEventsMatch) {
    const serverId = decodeURIComponent(goldItemEventsMatch[1]);
    const url = new URL(request.url);
    let uuid = str(url.searchParams.get("uuid")).toLowerCase();
    const player = str(url.searchParams.get("player"));
    const limit = Number(url.searchParams.get("limit")) || 50;
    const offset = Number(url.searchParams.get("offset")) || 0;

    if (!uuid && player) {
      const row = await env.DB.prepare(
        `SELECT minecraft_uuid
         FROM rootstat_player_balances
         WHERE server_id = ? AND LOWER(minecraft_username) = LOWER(?)
         LIMIT 1`,
      )
        .bind(serverId, player)
        .first<{ minecraft_uuid: string }>();
      uuid = str(row?.minecraft_uuid).toLowerCase();
    }

    const { events, total } = await recentGoldItemEventsForServer(env.DB, serverId, {
      uuid: uuid || undefined,
      limit,
      offset,
    });
    return json({
      server_id: serverId,
      minecraft_uuid: uuid || null,
      player: player || null,
      events,
      total,
      has_more: uuid ? false : offset + events.length < total,
      synced_at: new Date().toISOString(),
    });
  }

  if (method === "GET" && rest === "/membership") {
    const auth = await requireSignedInAccount(request, env);
    if (auth instanceof Response) return auth;

    const rows = await connectedServerRows(env.DB);

    const link = await env.DB.prepare(
      `SELECT minecraft_uuid, minecraft_username, verified_at
       FROM rootstat_minecraft_links
       WHERE account_id = ?
       LIMIT 1`,
    )
      .bind(auth.accountId)
      .first<Record<string, unknown>>();

    const linked = Boolean(link?.minecraft_uuid);
    const uuid = str(link?.minecraft_uuid);

    const servers = await Promise.all(
      rows.map(async (row) => {
        const payload = publicServerPayload(row);
        const mcmmo =
          linked && uuid ? await mcmmoStatsForPlayer(env.DB, row.server_id, uuid) : null;
        const playtime =
          linked && uuid ? await playtimeStatsForPlayer(env.DB, row.server_id, uuid) : null;
        const netWorth =
          linked && uuid ? await netWorthForPlayer(env.DB, row.server_id, uuid) : null;
        // Listed servers already passed the featured ping window  -  linked users are on that SMP.
        const belongsToServer = linked && serverListedInFeatured(row);
        return {
          ...payload,
          mcmmo,
          playtime,
          net_worth: netWorth,
          belongs_to_server: belongsToServer,
          auto_add_world: belongsToServer && row.featured !== 0,
        };
      }),
    );

    const primary = rows.find((r) => r.featured !== 0) ?? rows[0];

    return json({
      account_id: auth.accountId,
      minecraft_linked: linked,
      rootstat_linked: linked,
      minecraft_username: link?.minecraft_username || null,
      minecraft_uuid: uuid || null,
      verified_at: link?.verified_at || null,
      servers,
      featured_server: primary
        ? {
            server_id: primary.server_id,
            name: primary.server_name,
            address: primary.server_address,
            default_world_name: primary.default_world_name,
            game_version: primary.game_version,
            map_url: primary.map_url,
          }
        : null,
    });
  }

  if (method === "POST" && rest === "/heartbeat") {
    const server = await validateServerAuth(env, request);
    if (server instanceof Response) return server;

    let body: {
      plugin_version?: string;
      server_address?: string;
      default_world_name?: string;
      map_url?: string;
      game_version?: string;
      online_players?: number;
    } = {};
    try {
      body = record(JSON.parse(await request.text()));
    } catch {
      return json({ detail: "Invalid JSON body." }, 400);
    }

    const now = nowIso();
    const pluginVersion = str(body.plugin_version) || "unknown";
    const address = str(body.server_address) || FEATURED_SERVER_ADDRESS;
    const worldName = str(body.default_world_name) || FEATURED_SERVER_DEFAULTS.default_world_name;
    const mapUrl = str(body.map_url) || null;
    const gameVersion = str(body.game_version) || FEATURED_SERVER_DEFAULTS.game_version;
    const hasOnlinePlayers = body.online_players !== undefined && body.online_players !== null;
    const onlinePlayers = hasOnlinePlayers
      ? Math.max(0, Math.floor(Number(body.online_players) || 0))
      : null;

    await env.DB.prepare(
      `UPDATE rootstat_servers
       SET server_address = COALESCE(?, server_address),
           default_world_name = COALESCE(?, default_world_name),
           map_url = COALESCE(?, map_url),
           game_version = COALESCE(?, game_version),
           rootmc_plugin_version = ?,
           rootmc_last_seen_at = ?,
           updated_at = ?
       WHERE server_id = ?`,
    )
      .bind(address, worldName, mapUrl, gameVersion, pluginVersion, now, now, server.serverId)
      .run();

    await touchServerPresenceOnHeartbeat(env.DB, server.serverId, now);

    if (onlinePlayers !== null) {
      await upsertServerLiveStats(env.DB, server.serverId, onlinePlayers, now);
    }

    const maintenance = await resolveHeartbeatMaintenance(env);

    return json({
      ok: true,
      server_id: server.serverId,
      rootmc_plugin_version: pluginVersion,
      seen_at: now,
      rootstat_config_defaults: ROOTMC_CONFIG_DEFAULTS,
      maintenance_active: maintenance.maintenance_active,
      maintenance_window: maintenance.maintenance_window,
      plugin_updates: [
        { plugin: "rootmc", ...PLUGIN_RELEASES.rootmc },
        { plugin: "root-essentials", ...PLUGIN_RELEASES.root_essentials },
      ],
    });
  }

  return json({ detail: "Not Found" }, 404);
}

export async function featuredServerForMobileConfig(
  db: D1Database,
): Promise<Record<string, unknown> | null> {
  const row = await featuredServerRow(db);
  if (!row) return null;
  return {
    server_id: row.server_id,
    name: row.server_name,
    address: publicServerAddress(row.server_address),
    default_world_name: row.default_world_name,
    game_version: row.game_version,
    map_url: publicMapUrl(row.map_url),
    verify_url: FEATURED_SERVER_DEFAULTS.verify_url,
    realm_url: FEATURED_SERVER_DEFAULTS.realm_url,
    rootmc_plugin_installed: pluginActive(row.rootmc_last_seen_at),
  };
}
