/**
 * Public LIVE_DB reads for rootmc.net/data (Hyperdrive MySQL mirrors in rootmc-live).
 * Never reads env.DB / LEGACY_DB.
 */
import type { D1Database } from "@cloudflare/workers-types";

import { json } from "./cors";
import { withShortPublicCache } from "./rootmc-hyperdrive";
import type { RootStatEnv } from "./rootstat-minecraft";

/** Retired dual-host IDs — never use for public economy. */
export const LIVE_CLAIMS_SERVER_ID = "4963895e-0964-48b8-81b7-1f40a966e8be";
export const LIVE_TOWNY_SERVER_ID = "15bbc057-4f8b-4761-abdb-7b7e4d9c7512";
/** Singular live production (play.rootmc.net / Root-Economy). */
export const LIVE_PRODUCTION_SERVER_ID = "rootmc";

export function isLegacyDualHostId(serverId: string | null | undefined): boolean {
  const id = String(serverId || "").trim().toLowerCase();
  return id === LIVE_CLAIMS_SERVER_ID.toLowerCase() || id === LIVE_TOWNY_SERVER_ID.toLowerCase();
}

const WINDOWS = ["1h", "8h", "12h", "24h", "48h", "7d", "1m", "year"] as const;
const WINDOW_MS: Record<(typeof WINDOWS)[number], number> = {
  "1h": 3600_000,
  "8h": 8 * 3600_000,
  "12h": 12 * 3600_000,
  "24h": 24 * 3600_000,
  "48h": 48 * 3600_000,
  "7d": 7 * 24 * 3600_000,
  "1m": 30 * 24 * 3600_000,
  year: 365 * 24 * 3600_000,
};

type DatasetDef = {
  id: string;
  title: string;
  unit: string;
  description: string;
  /** MySQL source table name candidates (before m_ prefix). */
  mysqlTables: string[];
  kind: "balances" | "playtime" | "gold_found" | "shops" | "times" | "online" | "sync";
};

const DATASETS: DatasetDef[] = [
  {
    id: "balances",
    title: "Balances",
    unit: "G",
    description: "Player wallet balances on this host (LIVE_DB mirror)",
    mysqlTables: ["root_economy_balances"],
    kind: "balances",
  },
  {
    id: "playtime",
    title: "Playtime",
    unit: "s",
    description: "Player playtime seconds (network scope *)",
    mysqlTables: ["root_playtime", "root_rootmc_playtime"],
    kind: "playtime",
  },
  {
    id: "gold_found",
    title: "Gold found",
    unit: "G",
    description: "Physical gold found — mined / found / events",
    mysqlTables: ["root_gold_found"],
    kind: "gold_found",
  },
  {
    id: "shops",
    title: "Shops",
    unit: "",
    description: "Chest shop / market listings",
    mysqlTables: ["root_rootstat_shop_listings", "root_shop_listings"],
    kind: "shops",
  },
  {
    id: "times",
    title: "Times",
    unit: "",
    description: "Live Minecraft day / online / AFK (hub projection)",
    mysqlTables: ["root_times_status"],
    kind: "times",
  },
  {
    id: "online",
    title: "Online",
    unit: "players",
    description: "Current online player count + sample history",
    mysqlTables: ["root_times_status"],
    kind: "online",
  },
  {
    id: "sync",
    title: "Sync health",
    unit: "",
    description: "Hyperdrive → LIVE_DB table sync status",
    mysqlTables: [],
    kind: "sync",
  },
];

type LiveEnv = Pick<RootStatEnv, "LIVE_DB">;

function mirrorName(mysqlTable: string): string {
  const s = String(mysqlTable || "")
    .trim()
    .replace(/[^a-zA-Z0-9_]/g, "_")
    .slice(0, 60)
    .toLowerCase();
  return `m_${s || "unknown"}`;
}

function nowIso(): string {
  return new Date().toISOString();
}

function requireLive(env: LiveEnv): D1Database | Response {
  if (!env.LIVE_DB) {
    return json({ ok: false, detail: "LIVE_DB binding missing" }, 503);
  }
  return env.LIVE_DB;
}

function resolveServerIds(idOrScope: string): string[] | null {
  const raw = String(idOrScope || "").trim().toLowerCase();
  if (!raw) return null;
  // Legacy Towny/Claims scopes → singular live production only.
  if (
    raw === "claims" ||
    raw === "towny" ||
    raw === "official" ||
    raw === "combined" ||
    raw === "live" ||
    raw === LIVE_PRODUCTION_SERVER_ID ||
    raw === LIVE_CLAIMS_SERVER_ID.toLowerCase() ||
    raw === LIVE_TOWNY_SERVER_ID.toLowerCase()
  ) {
    return [LIVE_PRODUCTION_SERVER_ID];
  }
  // UUID or opaque server_id
  return [String(idOrScope).trim()];
}

async function loadServerRow(db: D1Database, serverId: string) {
  const conn = await db
    .prepare(
      `SELECT server_id, display_name, role, game_address, webstat_url,
              mysql_binding, mysql_database, table_prefixes, updated_at
       FROM server_connections WHERE server_id = ? LIMIT 1`,
    )
    .bind(serverId)
    .first<{
      server_id: string;
      display_name: string;
      role: string;
      game_address: string;
      webstat_url: string;
      mysql_binding: string;
      mysql_database: string;
      table_prefixes: string;
      updated_at: string;
    }>();
  const sync = await db
    .prepare(
      `SELECT server_id, display_name, role, last_sync_at, last_sync_ok, table_count, row_count, updated_at
       FROM servers WHERE server_id = ? LIMIT 1`,
    )
    .bind(serverId)
    .first<{
      server_id: string;
      display_name: string;
      role: string;
      last_sync_at: string;
      last_sync_ok: number;
      table_count: number;
      row_count: number;
      updated_at: string;
    }>();
  return { connection: conn, sync };
}

async function listSyncTables(db: D1Database, serverId: string) {
  const res = await db
    .prepare(
      `SELECT table_name, last_ok_at, row_count, error
       FROM sync_table_state WHERE server_id = ?
       ORDER BY table_name ASC`,
    )
    .bind(serverId)
    .all<{ table_name: string; last_ok_at: string; row_count: number; error: string }>();
  return res.results || [];
}

async function resolveMirror(
  db: D1Database,
  serverId: string,
  mysqlCandidates: string[],
): Promise<{ mysql: string; mirror: string } | null> {
  const tables = await listSyncTables(db, serverId);
  const byLower = new Map(tables.map((t) => [t.table_name.toLowerCase(), t.table_name]));
  for (const cand of mysqlCandidates) {
    const hit = byLower.get(cand.toLowerCase());
    if (hit) return { mysql: hit, mirror: mirrorName(hit) };
  }
  // Fallback: try first candidate even if not in sync_table_state
  for (const cand of mysqlCandidates) {
    const mirror = mirrorName(cand);
    try {
      const probe = await db
        .prepare(`SELECT 1 AS ok FROM \`${mirror}\` WHERE _server_id = ? LIMIT 1`)
        .bind(serverId)
        .first<{ ok: number }>();
      if (probe) return { mysql: cand, mirror };
    } catch {
      // table missing
    }
  }
  return null;
}

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function pick(row: Record<string, unknown>, ...names: string[]): unknown {
  const lower = new Map(Object.keys(row).map((k) => [k.toLowerCase(), k]));
  for (const n of names) {
    const key = lower.get(n.toLowerCase());
    if (key != null && row[key] != null && String(row[key]).trim() !== "") return row[key];
  }
  return undefined;
}

async function fetchMirrorRows(
  db: D1Database,
  mirror: string,
  serverId: string,
  limit = 2000,
): Promise<Record<string, unknown>[]> {
  const res = await db
    .prepare(`SELECT * FROM \`${mirror}\` WHERE _server_id = ? LIMIT ?`)
    .bind(serverId, limit)
    .all<Record<string, unknown>>();
  return res.results || [];
}

function emptyPct(): Record<string, number | null> {
  const out: Record<string, number | null> = {};
  for (const w of WINDOWS) out[w] = null;
  return out;
}

function pctChange(current: number, past: number | null): number | null {
  if (past == null || !Number.isFinite(past) || past === 0) {
    if (past === 0 && current === 0) return 0;
    if (past === 0 && current !== 0) return null;
    return null;
  }
  return ((current - past) / Math.abs(past)) * 100;
}

async function timesSamplePct(
  db: D1Database,
  serverId: string,
  currentOnline: number,
): Promise<{
  pct_change: Record<string, number | null>;
  pct_change_average: Record<string, number | null>;
  pct_change_total: Record<string, number | null>;
}> {
  const pct = emptyPct();
  const pctAvg = emptyPct();
  const pctTot = emptyPct();
  const now = Date.now();
  for (const w of WINDOWS) {
    const since = new Date(now - WINDOW_MS[w]).toISOString();
    const rows = await db
      .prepare(
        `SELECT online FROM rootmc_server_times_samples
         WHERE server_id = ? AND ts >= ? ORDER BY ts ASC`,
      )
      .bind(serverId, since)
      .all<{ online: number }>();
    const vals = (rows.results || []).map((r) => num(r.online));
    if (!vals.length) continue;
    const first = vals[0]!;
    const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
    const total = vals.reduce((a, b) => a + b, 0);
    pct[w] = pctChange(currentOnline, first);
    pctAvg[w] = pctChange(currentOnline, avg);
    pctTot[w] = pctChange(currentOnline, total / Math.max(1, vals.length));
  }
  return { pct_change: pct, pct_change_average: pctAvg, pct_change_total: pctTot };
}

function summarizeNumbers(values: number[]): {
  current: number | null;
  average: number | null;
  total: number | null;
  count: number;
} {
  if (!values.length) {
    return { current: null, average: null, total: null, count: 0 };
  }
  const total = values.reduce((a, b) => a + b, 0);
  return {
    current: values[0] ?? null,
    average: total / values.length,
    total,
    count: values.length,
  };
}

async function buildDatasetPayload(
  db: D1Database,
  serverIds: string[],
  def: DatasetDef,
): Promise<Record<string, unknown>> {
  const computedAt = nowIso();
  const base = {
    schema: "rootmc-live/dataset/v1",
    id: def.id,
    title: def.title,
    unit: def.unit,
    description: def.description,
    server_ids: serverIds,
    computed_at: computedAt,
    source: "LIVE_DB",
    windows: [...WINDOWS],
  };

  if (def.kind === "sync") {
    const tables: Array<Record<string, unknown>> = [];
    for (const sid of serverIds) {
      const list = await listSyncTables(db, sid);
      for (const t of list) {
        tables.push({
          server_id: sid,
          table: t.table_name,
          mirror: mirrorName(t.table_name),
          last_ok_at: t.last_ok_at,
          row_count: t.row_count,
          error: t.error || "",
        });
      }
    }
    return {
      ...base,
      summary: {
        current: tables.length,
        average: null,
        total: tables.reduce((a, t) => a + num(t.row_count), 0),
        count: tables.length,
        pct_change: emptyPct(),
        pct_change_average: emptyPct(),
        pct_change_total: emptyPct(),
      },
      rows: tables,
      columns: ["server_id", "table", "mirror", "row_count", "last_ok_at", "error"],
    };
  }

  if (def.kind === "times" || def.kind === "online") {
    const rows: Array<Record<string, unknown>> = [];
    let onlineSum = 0;
    for (const sid of serverIds) {
      const status = await db
        .prepare(
          `SELECT server_id, day_id, tod_ticks, full_time, phase, length_minutes,
                  online, afk, players_json, plugins_json, timezone, updated_at
           FROM rootmc_server_times_status WHERE server_id = ? LIMIT 1`,
        )
        .bind(sid)
        .first<Record<string, unknown>>();
      if (!status) {
        // try mirror
        const resolved = await resolveMirror(db, sid, def.mysqlTables);
        if (resolved) {
          const mrows = await fetchMirrorRows(db, resolved.mirror, sid, 5);
          if (mrows[0]) {
            const r = mrows[0];
            const online = num(pick(r, "online"));
            onlineSum += online;
            rows.push({
              server_id: sid,
              phase: String(pick(r, "phase") ?? "—"),
              online,
              afk: num(pick(r, "afk")),
              tod_ticks: num(pick(r, "tod_ticks", "todTicks")),
              timezone: String(pick(r, "timezone") ?? "UTC"),
              updated_at: String(pick(r, "updated_at", "updatedAt") ?? ""),
            });
            continue;
          }
        }
        continue;
      }
      const online = num(status.online);
      onlineSum += online;
      rows.push({
        server_id: sid,
        phase: String(status.phase ?? "—"),
        online,
        afk: num(status.afk),
        tod_ticks: num(status.tod_ticks),
        day_id: num(status.day_id),
        timezone: String(status.timezone ?? "UTC"),
        updated_at: String(status.updated_at ?? ""),
        players: status.players_json,
      });
    }
    const pct =
      serverIds.length === 1
        ? await timesSamplePct(db, serverIds[0]!, onlineSum)
        : {
            pct_change: emptyPct(),
            pct_change_average: emptyPct(),
            pct_change_total: emptyPct(),
          };
    return {
      ...base,
      summary: {
        current: onlineSum,
        average: rows.length ? onlineSum / rows.length : null,
        total: onlineSum,
        count: rows.length,
        ...pct,
      },
      rows,
      columns: ["server_id", "phase", "online", "afk", "tod_ticks", "timezone", "updated_at"],
    };
  }

  // Mirror-backed numeric / table datasets
  const outRows: Array<Record<string, unknown>> = [];
  const values: number[] = [];
  let sourceMysql: string | null = null;
  let sourceMirror: string | null = null;

  for (const sid of serverIds) {
    const resolved = await resolveMirror(db, sid, def.mysqlTables);
    if (!resolved) continue;
    sourceMysql = resolved.mysql;
    sourceMirror = resolved.mirror;
    let raw: Record<string, unknown>[] = [];
    try {
      raw = await fetchMirrorRows(db, resolved.mirror, sid, 3000);
    } catch (e) {
      return {
        ...base,
        ok: false,
        detail: e instanceof Error ? e.message : String(e),
        summary: {
          current: null,
          average: null,
          total: null,
          count: 0,
          pct_change: emptyPct(),
          pct_change_average: emptyPct(),
          pct_change_total: emptyPct(),
        },
        rows: [],
        columns: [],
      };
    }

    for (const r of raw) {
      if (def.kind === "balances") {
        const player = String(pick(r, "minecraft_username", "username", "name") ?? "");
        const balance = num(pick(r, "balance", "amount", "gold"));
        if (!player && balance === 0) continue;
        if (balance <= 0.0001) continue;
        values.push(balance);
        outRows.push({ server_id: sid, player, balance });
      } else if (def.kind === "playtime") {
        const scope = String(pick(r, "scope") ?? "*");
        if (scope !== "*" && scope !== "") continue;
        const player = String(pick(r, "username", "minecraft_username", "name") ?? "");
        const seconds = num(pick(r, "seconds", "total_playtime_seconds", "playtime_seconds"));
        if (seconds <= 0) continue;
        values.push(seconds);
        outRows.push({ server_id: sid, player, seconds });
      } else if (def.kind === "gold_found") {
        const player = String(pick(r, "minecraft_username", "username") ?? "");
        const mined =
          num(pick(r, "mined_ore_g")) + num(pick(r, "mined_block_g"));
        const found =
          num(pick(r, "loot_chest_g")) +
          num(pick(r, "loot_mob_g")) +
          num(pick(r, "pickup_g"));
        const events = num(pick(r, "find_events", "events"));
        const total = num(pick(r, "total_gold_g"));
        if (total <= 0 && mined <= 0 && found <= 0) continue;
        values.push(total || mined + found);
        outRows.push({
          server_id: sid,
          player,
          mined,
          found,
          events,
          total: total || mined + found,
        });
      } else if (def.kind === "shops") {
        const owner = String(pick(r, "owner_username", "owner", "seller") ?? "");
        const item = String(pick(r, "item_key", "item", "material") ?? "");
        const price = num(pick(r, "price", "sell_price", "buy_price"));
        const stock = num(pick(r, "stock", "quantity", "amount"));
        if (!item && !owner) continue;
        values.push(price);
        outRows.push({
          server_id: sid,
          listing: `${owner} ${item}`.trim(),
          owner,
          item,
          price,
          stock,
        });
      }
    }
  }

  // Sort largest first
  if (def.kind === "balances") {
    outRows.sort((a, b) => num(b.balance) - num(a.balance));
  } else if (def.kind === "playtime") {
    outRows.sort((a, b) => num(b.seconds) - num(a.seconds));
  } else if (def.kind === "gold_found") {
    outRows.sort((a, b) => num(b.total) - num(a.total));
  } else if (def.kind === "shops") {
    outRows.sort((a, b) => num(b.price) - num(a.price));
  }

  const summaryNums = summarizeNumbers(values);
  const columns =
    def.kind === "gold_found"
      ? ["#", "player", "mined", "found", "events"]
      : def.kind === "balances"
        ? ["player", "balance"]
        : def.kind === "playtime"
          ? ["player", "seconds"]
          : def.kind === "shops"
            ? ["owner", "item", "price", "stock"]
            : [];

  // Rank gold_found for UI
  const rows =
    def.kind === "gold_found"
      ? outRows.slice(0, 500).map((r, i) => ({ rank: i + 1, ...r }))
      : outRows.slice(0, 500);

  return {
    ...base,
    mysql_table: sourceMysql,
    mirror_table: sourceMirror,
    summary: {
      ...summaryNums,
      pct_change: emptyPct(),
      pct_change_average: emptyPct(),
      pct_change_total: emptyPct(),
    },
    rows,
    columns,
  };
}

export async function handleRootMcLivePublic(
  request: Request,
  env: LiveEnv,
  subpath: string,
  method: string,
): Promise<Response | null> {
  if (!subpath.startsWith("/rootmc/live")) return null;
  // POST sync is handled elsewhere
  if (method !== "GET") return null;

  const live = requireLive(env);
  if (live instanceof Response) return live;
  const db = live;

  const path = subpath.replace(/\/+$/, "") || "/";
  const url = new URL(request.url);

  // GET /rootmc/live/servers
  if (path === "/rootmc/live/servers") {
    const res = await db
      .prepare(
        `SELECT c.server_id, c.display_name, c.role, c.game_address, c.webstat_url,
                c.mysql_binding, c.updated_at AS connection_updated_at,
                s.last_sync_at, s.last_sync_ok, s.table_count, s.row_count
         FROM server_connections c
         LEFT JOIN servers s ON s.server_id = c.server_id
         WHERE c.server_id = ? OR c.role = 'live'
         ORDER BY CASE WHEN c.server_id = ? THEN 0 ELSE 1 END, c.display_name ASC`,
      )
      .bind(LIVE_PRODUCTION_SERVER_ID, LIVE_PRODUCTION_SERVER_ID)
      .all<Record<string, unknown>>();
    const servers = (res.results || []).filter(
      (row) => !isLegacyDualHostId(String(row.server_id || "")),
    );
    return withShortPublicCache(
      json({
        ok: true,
        source: "LIVE_DB",
        computed_at: nowIso(),
        servers,
        scopes: [
          { id: "live", server_id: LIVE_PRODUCTION_SERVER_ID, href: "/data/official/" },
          { id: "official", server_ids: [LIVE_PRODUCTION_SERVER_ID], href: "/data/official/" },
          // Legacy URLs still resolve, but they point at singular live production.
          { id: "towny", server_id: LIVE_PRODUCTION_SERVER_ID, href: "/data/towny/", legacy: true },
          { id: "claims", server_id: LIVE_PRODUCTION_SERVER_ID, href: "/data/claims/", legacy: true },
        ],
      }),
    );
  }

  // GET /rootmc/live/servers/:id[/catalog|/data/:dataset]
  const m = path.match(/^\/rootmc\/live\/servers\/([^/]+)(?:\/(catalog|data(?:\/([^/]+))?))?$/);
  if (!m) {
    if (path === "/rootmc/live" || path === "/rootmc/live/") {
      return withShortPublicCache(
        json({
          ok: true,
          source: "LIVE_DB",
          endpoints: [
            "GET /api/rootmc/live/servers",
            "GET /api/rootmc/live/servers/:id",
            "GET /api/rootmc/live/servers/:id/catalog",
            "GET /api/rootmc/live/servers/:id/data/:dataset",
          ],
        }),
      );
    }
    return null;
  }

  const idRaw = decodeURIComponent(m[1] || "");
  const serverIds = resolveServerIds(idRaw);
  if (!serverIds?.length) {
    return json({ ok: false, detail: "invalid server id" }, 400);
  }

  const rest = m[2] || "";
  const datasetId = m[3] ? decodeURIComponent(m[3]) : "";

  if (!rest) {
    // server detail
    const servers = [];
    for (const sid of serverIds) {
      const { connection, sync } = await loadServerRow(db, sid);
      const tables = await listSyncTables(db, sid);
      servers.push({
        server_id: sid,
        connection: connection || null,
        sync: sync || null,
        tables,
      });
    }
    return withShortPublicCache(
      json({
        ok: true,
        source: "LIVE_DB",
        computed_at: nowIso(),
        server_ids: serverIds,
        servers,
      }),
    );
  }

  if (rest === "catalog") {
    const scopeBase = (() => {
      const r = idRaw.toLowerCase();
      if (r === "claims" || r === LIVE_CLAIMS_SERVER_ID.toLowerCase()) return "/data/claims";
      if (r === "towny" || r === LIVE_TOWNY_SERVER_ID.toLowerCase()) return "/data/towny";
      if (r === "official" || r === "combined" || r === "live" || r === LIVE_PRODUCTION_SERVER_ID) {
        return "/data/official";
      }
      return `/data/servers/${encodeURIComponent(idRaw)}`;
    })();
    const datasets = DATASETS.map((d) => ({
      id: d.id,
      title: d.title,
      unit: d.unit,
      description: d.description,
      href: `${scopeBase}/${d.id}/`,
      api: `/api/rootmc/live/servers/${encodeURIComponent(idRaw)}/data/${d.id}`,
    }));
    return withShortPublicCache(
      json({
        ok: true,
        schema: "rootmc-live/catalog/v1",
        source: "LIVE_DB",
        server_ids: serverIds,
        computed_at: nowIso(),
        windows: [...WINDOWS],
        datasets,
      }),
    );
  }

  if (rest.startsWith("data")) {
    const id = datasetId || String(url.searchParams.get("set") || "").trim();
    const def = DATASETS.find((d) => d.id === id);
    if (!def) {
      return json(
        {
          ok: false,
          detail: "unknown dataset",
          known: DATASETS.map((d) => d.id),
        },
        404,
      );
    }
    try {
      const payload = await buildDatasetPayload(db, serverIds, def);
      return withShortPublicCache(json({ ok: true, ...payload }));
    } catch (e) {
      return json(
        {
          ok: false,
          detail: e instanceof Error ? e.message : String(e),
          id: def.id,
          source: "LIVE_DB",
        },
        503,
      );
    }
  }

  return null;
}
