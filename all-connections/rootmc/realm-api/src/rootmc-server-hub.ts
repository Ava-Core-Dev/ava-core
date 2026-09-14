import { json } from "./cors";
import { record, str } from "./realm-lib";
import type { RootStatEnv } from "./rootstat-minecraft";
import { validateServerAuth } from "./rootstat-minecraft";

const STALE_MS = 2 * 60 * 1000;
/** Keep ~13 months so Y range has room to grow. */
const SAMPLE_RETENTION_MS = 400 * 24 * 60 * 60 * 1000;
const SAMPLE_QUERY_LIMIT = 20_000;
const SAMPLE_CHART_POINTS = 720;
const MAX_PLAYERS = 200;
const MAX_PLUGINS = 64;

function liveDb(env: RootStatEnv): D1Database {
  return env.LIVE_DB || env.DB;
}

const RANGE_MS: Record<string, number> = {
  "8h": 8 * 60 * 60 * 1000,
  "12h": 12 * 60 * 60 * 1000,
  "24h": 24 * 60 * 60 * 1000,
  "48h": 48 * 60 * 60 * 1000,
  "7d": 7 * 24 * 60 * 60 * 1000,
  m: 30 * 24 * 60 * 60 * 1000,
  "30d": 30 * 24 * 60 * 60 * 1000,
  y: 365 * 24 * 60 * 60 * 1000,
  "365d": 365 * 24 * 60 * 60 * 1000,
};

function parseRangeKey(raw: string | null): string {
  const key = String(raw || "24h").trim().toLowerCase();
  return RANGE_MS[key] != null ? key : "24h";
}

function downsampleSamples<T>(rows: T[], maxPoints: number): T[] {
  if (rows.length <= maxPoints) return rows;
  const out: T[] = [];
  const step = (rows.length - 1) / (maxPoints - 1);
  for (let i = 0; i < maxPoints; i++) {
    out.push(rows[Math.round(i * step)]!);
  }
  return out;
}

type PlayerRow = { name: string; afk: boolean };
type PluginRow = { id: string; version: string };

async function ensureTables(db: D1Database): Promise<void> {
  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS rootmc_server_times_status (
         server_id TEXT PRIMARY KEY NOT NULL,
         day_id INTEGER NOT NULL DEFAULT 0,
         tod_ticks INTEGER NOT NULL DEFAULT 0,
         full_time INTEGER NOT NULL DEFAULT 0,
         phase TEXT NOT NULL DEFAULT '',
         length_minutes INTEGER NOT NULL DEFAULT 30,
         online INTEGER NOT NULL DEFAULT 0,
         afk INTEGER NOT NULL DEFAULT 0,
         players_json TEXT NOT NULL DEFAULT '[]',
         plugins_json TEXT NOT NULL DEFAULT '[]',
         timezone TEXT NOT NULL DEFAULT 'UTC',
         updated_at TEXT NOT NULL
       )`,
    )
    .run();
  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS rootmc_server_times_samples (
         id INTEGER PRIMARY KEY AUTOINCREMENT,
         server_id TEXT NOT NULL,
         ts TEXT NOT NULL,
         online INTEGER NOT NULL DEFAULT 0,
         afk INTEGER NOT NULL DEFAULT 0,
         tod_ticks INTEGER NOT NULL DEFAULT 0,
         phase TEXT NOT NULL DEFAULT ''
       )`,
    )
    .run();
  await db
    .prepare(
      `CREATE INDEX IF NOT EXISTS idx_rootmc_times_samples_server_ts
       ON rootmc_server_times_samples (server_id, ts)`,
    )
    .run();
}

function parsePlayers(raw: unknown): PlayerRow[] {
  if (!Array.isArray(raw)) return [];
  const out: PlayerRow[] = [];
  for (const item of raw) {
    if (out.length >= MAX_PLAYERS) break;
    const r = record(item);
    const name = str(r.name).slice(0, 32);
    if (!name) continue;
    out.push({ name, afk: Boolean(r.afk) });
  }
  return out;
}

function parsePlugins(raw: unknown): PluginRow[] {
  if (!Array.isArray(raw)) return [];
  const out: PluginRow[] = [];
  for (const item of raw) {
    if (out.length >= MAX_PLUGINS) break;
    const r = record(item);
    const id = str(r.id || r.name).slice(0, 64).toLowerCase();
    const version = str(r.version).slice(0, 32) || "?";
    if (!id) continue;
    out.push({ id, version });
  }
  return out;
}

function featureTiles(plugins: PluginRow[], timesLive: boolean): Array<{
  id: string;
  label: string;
  status: "live" | "installed" | "stub";
  version: string | null;
  href: string;
}> {
  const byId = new Map(plugins.map((p) => [p.id, p]));
  const has = (id: string) => byId.has(id);
  const ver = (id: string) => byId.get(id)?.version ?? null;
  return [
    {
      id: "root-times",
      label: "Times",
      status: timesLive ? "live" : has("root-times") ? "installed" : "stub",
      version: ver("root-times"),
      href: "time/",
    },
    {
      id: "root-core",
      label: "Core",
      status: has("root-core") ? "installed" : "stub",
      version: ver("root-core"),
      href: "",
    },
    {
      id: "economy",
      label: "Economy",
      status: has("rootmc") || has("root-essentials") ? "installed" : "stub",
      version: ver("rootmc") || ver("root-essentials"),
      href: "economy/",
    },
    {
      id: "market",
      label: "Market",
      status: has("rootmc-shops") ? "installed" : "stub",
      version: ver("rootmc-shops"),
      href: "market/",
    },
    {
      id: "leaderboard",
      label: "Leaderboard",
      status: "stub",
      version: null,
      href: "leaderboard/",
    },
    {
      id: "resources",
      label: "Resources",
      status: "stub",
      version: null,
      href: "resources/",
    },
    {
      id: "daily-report",
      label: "Daily report",
      status: "stub",
      version: null,
      href: "daily-report/",
    },
    {
      id: "player",
      label: "Players",
      status: "stub",
      version: null,
      href: "player/",
    },
  ];
}

async function loadServerMeta(
  db: D1Database,
  serverId: string,
): Promise<{
  server_name: string | null;
  server_address: string | null;
  game_version: string | null;
  rootmc_plugin_version: string | null;
  rootmc_last_seen_at: string | null;
  map_url: string | null;
  online_players: number | null;
  live_stats_at: string | null;
} | null> {
  const row = await db
    .prepare(
      `SELECT s.server_name, s.server_address, s.game_version, s.rootmc_plugin_version,
              s.rootmc_last_seen_at, s.map_url,
              live.online_players AS online_players, live.updated_at AS live_stats_at
       FROM rootstat_servers s
       LEFT JOIN rootmc_server_live_stats live ON live.server_id = s.server_id
       WHERE s.server_id = ?
       LIMIT 1`,
    )
    .bind(serverId)
    .first<{
      server_name: string | null;
      server_address: string | null;
      game_version: string | null;
      rootmc_plugin_version: string | null;
      rootmc_last_seen_at: string | null;
      map_url: string | null;
      online_players: number | null;
      live_stats_at: string | null;
    }>();
  return row ?? null;
}

/**
 * POST /api/rootmc/times/status
 * GET  /api/rootmc/server/:id/hub
 * GET  /api/rootmc/server/:id/times
 */
export async function handleRootMcServerHub(
  request: Request,
  env: RootStatEnv,
  subpath: string,
  method: string,
): Promise<Response | null> {
  if (method === "POST" && subpath === "/rootmc/times/status") {
    return postTimesStatus(request, env);
  }

  const hubMatch = subpath.match(/^\/rootmc\/server\/([^/]+)\/hub\/?$/);
  if (method === "GET" && hubMatch) {
    return getHub(env, decodeURIComponent(hubMatch[1]));
  }

  const timesMatch = subpath.match(/^\/rootmc\/server\/([^/]+)\/times\/?$/);
  if (method === "GET" && timesMatch) {
    return getTimes(env, decodeURIComponent(timesMatch[1]), request);
  }

  return null;
}

async function postTimesStatus(request: Request, env: RootStatEnv): Promise<Response> {
  const server = await validateServerAuth(env, request);
  if (server instanceof Response) return server;

  // Times status is MySQL → Hyperdrive → LIVE_DB only. HTTPS push retired.
  return json(
    {
      ok: false,
      retired: true,
      detail:
        "POST /times/status retired. Write root_times_status on host MySQL; Hyperdrive syncs to LIVE_DB.",
    },
    410,
  );
}

async function getHub(env: RootStatEnv, serverId: string): Promise<Response> {
  if (!serverId || serverId.length > 80) {
    return json({ detail: "Invalid server id." }, 400);
  }
  const timesDb = liveDb(env);
  try {
    await ensureTables(timesDb);
  } catch {
    // continue
  }

  const meta = await loadServerMeta(env.DB, serverId);
  if (!meta) {
    return json({ detail: "Server not found." }, 404);
  }

  const times = await timesDb
    .prepare(
      `SELECT day_id, tod_ticks, full_time, phase, length_minutes, online, afk,
            players_json, plugins_json, timezone, updated_at
     FROM rootmc_server_times_status WHERE server_id = ? LIMIT 1`,
    )
    .bind(serverId)
    .first<{
      day_id: number;
      tod_ticks: number;
      full_time: number;
      phase: string;
      length_minutes: number;
      online: number;
      afk: number;
      players_json: string;
      plugins_json: string;
      timezone: string;
      updated_at: string;
    }>();

  let plugins: PluginRow[] = [];
  try {
    plugins = parsePlugins(JSON.parse(times?.plugins_json || "[]"));
  } catch {
    plugins = [];
  }
  if (!plugins.length && meta.rootmc_plugin_version) {
    plugins.push({ id: "rootmc", version: meta.rootmc_plugin_version });
  }

  const timesUpdated = times?.updated_at ? Date.parse(times.updated_at) : NaN;
  const timesLive = Number.isFinite(timesUpdated) && Date.now() - timesUpdated <= STALE_MS;
  const features = featureTiles(plugins, timesLive);

  return json({
    server_id: serverId,
    server_name: meta.server_name,
    server_address: meta.server_address,
    game_version: meta.game_version,
    rootmc_plugin_version: meta.rootmc_plugin_version,
    rootmc_last_seen_at: meta.rootmc_last_seen_at,
    map_url: meta.map_url,
    online_players:
      timesLive && times
        ? times.online
        : meta.online_players != null
          ? Number(meta.online_players)
          : null,
    live_stats_at: meta.live_stats_at,
    plugins,
    features,
    times_summary: times
      ? {
          dayId: times.day_id,
          todTicks: times.tod_ticks,
          phase: times.phase,
          lengthMinutes: times.length_minutes,
          online: times.online,
          afk: times.afk,
          timezone: times.timezone,
          updated_at: times.updated_at,
          stale: !timesLive,
        }
      : null,
    updated_at: times?.updated_at || meta.live_stats_at || meta.rootmc_last_seen_at,
  });
}

async function getTimes(env: RootStatEnv, serverId: string, request: Request): Promise<Response> {
  if (!serverId || serverId.length > 80) {
    return json({ detail: "Invalid server id." }, 400);
  }
  const timesDb = liveDb(env);
  try {
    await ensureTables(timesDb);
  } catch {
    // continue
  }

  const meta = await loadServerMeta(env.DB, serverId);
  if (!meta) {
    return json({ detail: "Server not found." }, 404);
  }

  const rangeKey = parseRangeKey(new URL(request.url).searchParams.get("range"));
  const rangeMs = RANGE_MS[rangeKey]!;
  const rangeCutoff = new Date(Date.now() - rangeMs).toISOString();

  const times = await timesDb
    .prepare(
      `SELECT day_id, tod_ticks, full_time, phase, length_minutes, online, afk,
            players_json, plugins_json, timezone, updated_at
     FROM rootmc_server_times_status WHERE server_id = ? LIMIT 1`,
    )
    .bind(serverId)
    .first<{
      day_id: number;
      tod_ticks: number;
      full_time: number;
      phase: string;
      length_minutes: number;
      online: number;
      afk: number;
      players_json: string;
      plugins_json: string;
      timezone: string;
      updated_at: string;
    }>();

  const samples = await timesDb
    .prepare(
      `SELECT ts, online, afk, tod_ticks, phase
     FROM rootmc_server_times_samples
     WHERE server_id = ? AND ts >= ?
     ORDER BY ts ASC
     LIMIT ${SAMPLE_QUERY_LIMIT}`,
    )
    .bind(serverId, rangeCutoff)
    .all<{ ts: string; online: number; afk: number; tod_ticks: number; phase: string }>();

  let players: PlayerRow[] = [];
  try {
    players = parsePlayers(JSON.parse(times?.players_json || "[]"));
  } catch {
    players = [];
  }

  const updatedAt = times?.updated_at || null;
  const updatedMs = updatedAt ? Date.parse(updatedAt) : NaN;
  const stale = !Number.isFinite(updatedMs) || Date.now() - updatedMs > STALE_MS;

  const rawList = samples.results || [];
  let peakOnline = 0;
  for (const s of rawList) {
    peakOnline = Math.max(peakOnline, Number(s.online) || 0);
  }
  const sampleList = downsampleSamples(rawList, SAMPLE_CHART_POINTS);

  return json({
    server_id: serverId,
    server_name: meta.server_name,
    stale,
    updated_at: updatedAt,
    dayId: times?.day_id ?? 0,
    todTicks: times?.tod_ticks ?? 0,
    fullTime: times?.full_time ?? 0,
    phase: times?.phase ?? "—",
    lengthMinutes: times?.length_minutes ?? 30,
    online: times?.online ?? 0,
    afk: times?.afk ?? 0,
    timezone: times?.timezone ?? "UTC",
    players,
    range: rangeKey,
    range_hours: Math.round(rangeMs / (60 * 60 * 1000)),
    peak_online_48h: peakOnline,
    peak_online: peakOnline,
    sample_count: rawList.length,
    sample_window_hours: Math.round(SAMPLE_RETENTION_MS / (60 * 60 * 1000)),
    samples: sampleList.map((s) => ({
      ts: s.ts,
      online: s.online,
      afk: s.afk,
      todTicks: s.tod_ticks,
      phase: s.phase,
    })),
  });
}
