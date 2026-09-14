/**
 * Root-Webstat ingest + public reads + hourly pull cron.
 * Hosts compute series locally; this Worker stores published values in WEBSTAT_DB.
 */

import type { D1Database } from "@cloudflare/workers-types";

import { json } from "./cors";
import { str } from "./realm-lib";
import { validateServerAuth, type RootStatEnv } from "./rootstat-minecraft";

const METRICS = ["total", "average", "mean", "median", "highest", "lowest", "count"] as const;

export type WebstatEnv = RootStatEnv & {
  WEBSTAT_DB?: D1Database;
};

type SeriesObj = Record<string, unknown> & {
  unit?: string;
  highest_holder?: string;
  lowest_holder?: string;
  total?: number;
  average?: number;
  mean?: number;
  median?: number;
  highest?: number;
  lowest?: number;
  count?: number;
};

type SnapshotPayload = {
  schema?: string;
  server_id?: string;
  server_name?: string;
  computed_at?: string;
  source?: string;
  webstat_url?: string;
  web_port?: number;
  mc_day_id?: number;
  completed_mc_day_id?: number;
  full_time?: number;
  ticks_per_day?: number;
  series?: Record<string, SeriesObj>;
};

function webstatDb(env: WebstatEnv): D1Database | null {
  return env.WEBSTAT_DB ?? null;
}

function num(v: unknown): number {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

function intOrNull(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

/** Upsert one published snapshot + flatten series metrics into value rows. */
export async function ingestWebstatPayload(
  env: WebstatEnv,
  payload: SnapshotPayload,
  ingestVia: "push" | "pull",
  expectedServerId?: string,
): Promise<{ ok: true; server_id: string; mc_day_id: number } | { ok: false; detail: string; status: number }> {
  const db = webstatDb(env);
  if (!db) {
    return { ok: false, detail: "WEBSTAT_DB binding missing.", status: 503 };
  }

  const serverId = str(payload.server_id) || str(expectedServerId);
  const mcDayId = intOrNull(payload.mc_day_id);
  if (!serverId || mcDayId == null) {
    return { ok: false, detail: "server_id and mc_day_id required.", status: 400 };
  }
  if (expectedServerId && serverId !== expectedServerId) {
    return { ok: false, detail: "server_id mismatch.", status: 400 };
  }

  const ingestedAt = new Date().toISOString();
  const completed = intOrNull(payload.completed_mc_day_id);
  const fullTime = intOrNull(payload.full_time);
  const ticks = intOrNull(payload.ticks_per_day) ?? 24000;
  const schema = str(payload.schema) || "root-webstat/v1";
  const series = payload.series && typeof payload.series === "object" ? payload.series : {};

  await db
    .prepare(
      `INSERT INTO webstat_snapshots (
         server_id, mc_day_id, completed_mc_day_id, full_time, ticks_per_day,
         server_name, computed_at, schema_version, source, ingest_via, ingested_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(server_id, mc_day_id) DO UPDATE SET
         completed_mc_day_id = excluded.completed_mc_day_id,
         full_time = excluded.full_time,
         ticks_per_day = excluded.ticks_per_day,
         server_name = excluded.server_name,
         computed_at = excluded.computed_at,
         schema_version = excluded.schema_version,
         source = excluded.source,
         ingest_via = excluded.ingest_via,
         ingested_at = excluded.ingested_at`,
    )
    .bind(
      serverId,
      mcDayId,
      completed,
      fullTime,
      ticks,
      str(payload.server_name) || null,
      str(payload.computed_at) || ingestedAt,
      schema,
      str(payload.source) || "paper",
      ingestVia,
      ingestedAt,
    )
    .run();

  const stmts: ReturnType<D1Database["prepare"]>[] = [];
  for (const [seriesId, raw] of Object.entries(series)) {
    if (!seriesId || !raw || typeof raw !== "object") continue;
    const s = raw as SeriesObj;
    const unit = str(s.unit) || null;
    for (const metric of METRICS) {
      const value = num(s[metric]);
      let holder: string | null = null;
      if (metric === "highest") holder = str(s.highest_holder) || null;
      if (metric === "lowest") holder = str(s.lowest_holder) || null;
      stmts.push(
        db
          .prepare(
            `INSERT INTO webstat_series_values (
               server_id, mc_day_id, series_id, metric, value_real, unit, holder, ingested_at
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(server_id, mc_day_id, series_id, metric) DO UPDATE SET
               value_real = excluded.value_real,
               unit = excluded.unit,
               holder = excluded.holder,
               ingested_at = excluded.ingested_at`,
          )
          .bind(serverId, mcDayId, seriesId, metric, value, unit, holder, ingestedAt),
      );
    }
  }
  if (stmts.length) {
    await db.batch(stmts);
  }

  // Register public JSON base so hourly pull cron can reach Shockbyte additional ports.
  const webstatUrl = str(payload.webstat_url).replace(/\/$/, "");
  if (webstatUrl && env.DB) {
    try {
      await env.DB.prepare(
        `UPDATE rootstat_servers
         SET webstat_url = ?, updated_at = ?
         WHERE server_id = ?`,
      )
        .bind(webstatUrl, ingestedAt, serverId)
        .run();
    } catch (e) {
      console.warn("webstat_url register failed", serverId, e instanceof Error ? e.message : String(e));
    }
  }

  return { ok: true, server_id: serverId, mc_day_id: mcDayId };
}

async function loadSnapshotBundle(
  db: D1Database,
  serverId: string,
  mcDayId: number,
): Promise<Record<string, unknown> | null> {
  const snap = await db
    .prepare(`SELECT * FROM webstat_snapshots WHERE server_id = ? AND mc_day_id = ? LIMIT 1`)
    .bind(serverId, mcDayId)
    .first<Record<string, unknown>>();
  if (!snap) return null;

  const { results } = await db
    .prepare(
      `SELECT series_id, metric, value_real, unit, holder
       FROM webstat_series_values
       WHERE server_id = ? AND mc_day_id = ?
       ORDER BY series_id, metric`,
    )
    .bind(serverId, mcDayId)
    .all<{
      series_id: string;
      metric: string;
      value_real: number;
      unit: string | null;
      holder: string | null;
    }>();

  const series: Record<string, SeriesObj> = {};
  for (const row of results || []) {
    const sid = row.series_id;
    if (!series[sid]) {
      series[sid] = { id: sid, unit: row.unit || "" };
    }
    const s = series[sid];
    s[row.metric as (typeof METRICS)[number]] = row.value_real;
    if (row.metric === "highest" && row.holder) s.highest_holder = row.holder;
    if (row.metric === "lowest" && row.holder) s.lowest_holder = row.holder;
    if (row.unit) s.unit = row.unit;
  }

  return {
    schema: snap.schema_version || "root-webstat/v1",
    server_id: snap.server_id,
    server_name: snap.server_name,
    computed_at: snap.computed_at,
    source: snap.source,
    mc_day_id: snap.mc_day_id,
    completed_mc_day_id: snap.completed_mc_day_id,
    full_time: snap.full_time,
    ticks_per_day: snap.ticks_per_day,
    ingest_via: snap.ingest_via,
    ingested_at: snap.ingested_at,
    series,
  };
}

export async function handleRootMcWebstat(
  request: Request,
  env: WebstatEnv,
  subpath: string,
  method: string,
): Promise<Response | null> {
  if (!subpath.startsWith("/rootmc/")) return null;

  // POST /rootmc/server/:id/webstat
  if (method === "POST") {
    const m = subpath.match(/^\/rootmc\/server\/([^/]+)\/webstat\/?$/);
    if (!m) return null;
    const pathServerId = decodeURIComponent(m[1]);
    const auth = await validateServerAuth(env, request);
    if (auth instanceof Response) return auth;
    if (auth.serverId !== pathServerId) {
      return json({ detail: "Server id does not match credentials." }, 403);
    }
    let body: SnapshotPayload;
    try {
      body = (await request.json()) as SnapshotPayload;
    } catch {
      return json({ detail: "Invalid JSON." }, 400);
    }
    if (!str(body.server_id)) body.server_id = pathServerId;
    const result = await ingestWebstatPayload(env, body, "push", pathServerId);
    if (!result.ok) return json({ detail: result.detail }, result.status);
    return json({ ok: true, server_id: result.server_id, mc_day_id: result.mc_day_id });
  }

  if (method !== "GET") return null;

  // GET /rootmc/server/:id/live — public Webstat base URL for site UUID redirects
  {
    const m = subpath.match(/^\/rootmc\/server\/([^/]+)\/live\/?$/);
    if (m) {
      const serverId = decodeURIComponent(m[1]);
      if (!env.DB) return json({ detail: "DB binding missing." }, 503);
      const row = await env.DB.prepare(
        `SELECT server_id, server_name, webstat_url
         FROM rootstat_servers
         WHERE server_id = ?
         LIMIT 1`,
      )
        .bind(serverId)
        .first<{ server_id: string; server_name: string | null; webstat_url: string | null }>();
      if (!row) return json({ detail: "Server not found." }, 404);
      const webstatUrl = str(row.webstat_url).replace(/\/$/, "");
      if (!webstatUrl) {
        return json({ detail: "No webstat_url registered for this server." }, 404);
      }
      return json({
        server_id: row.server_id,
        name: row.server_name || null,
        server_name: row.server_name || null,
        webstat_url: webstatUrl,
      });
    }
  }

  const db = webstatDb(env);
  if (!db) return json({ detail: "WEBSTAT_DB binding missing." }, 503);

  // GET /rootmc/webstat/day/:mcDayId
  {
    const m = subpath.match(/^\/rootmc\/webstat\/day\/(-?\d+)\/?$/);
    if (m) {
      const day = Number(m[1]);
      const { results: snaps } = await db
        .prepare(
          `SELECT server_id, mc_day_id FROM webstat_snapshots WHERE mc_day_id = ? ORDER BY server_id`,
        )
        .bind(day)
        .all<{ server_id: string; mc_day_id: number }>();
      const servers = [];
      for (const row of snaps || []) {
        const bundle = await loadSnapshotBundle(db, row.server_id, row.mc_day_id);
        if (bundle) servers.push(bundle);
      }
      return json({ mc_day_id: day, servers });
    }
  }

  // GET /rootmc/webstat  — latest per server
  if (subpath === "/rootmc/webstat" || subpath === "/rootmc/webstat/") {
    const { results } = await db
      .prepare(
        `SELECT s.server_id, s.mc_day_id
         FROM webstat_snapshots s
         INNER JOIN (
           SELECT server_id, MAX(mc_day_id) AS mc_day_id
           FROM webstat_snapshots
           GROUP BY server_id
         ) latest ON latest.server_id = s.server_id AND latest.mc_day_id = s.mc_day_id
         ORDER BY s.server_name, s.server_id`,
      )
      .all<{ server_id: string; mc_day_id: number }>();
    const servers = [];
    for (const row of results || []) {
      const bundle = await loadSnapshotBundle(db, row.server_id, row.mc_day_id);
      if (bundle) servers.push(bundle);
    }
    return json({ servers });
  }

  // GET /rootmc/server/:id/webstat?mc_day_id=
  {
    const m = subpath.match(/^\/rootmc\/server\/([^/]+)\/webstat\/?$/);
    if (!m) return null;
    const serverId = decodeURIComponent(m[1]);
    const url = new URL(request.url);
    const dayParam = url.searchParams.get("mc_day_id");
    let mcDayId: number | null = dayParam != null ? intOrNull(dayParam) : null;
    if (mcDayId == null) {
      const latest = await db
        .prepare(
          `SELECT mc_day_id FROM webstat_snapshots WHERE server_id = ? ORDER BY mc_day_id DESC LIMIT 1`,
        )
        .bind(serverId)
        .first<{ mc_day_id: number }>();
      if (!latest) return json({ detail: "No webstat snapshot for this server." }, 404);
      mcDayId = latest.mc_day_id;
    }
    const bundle = await loadSnapshotBundle(db, serverId, mcDayId);
    if (!bundle) return json({ detail: "Snapshot not found." }, 404);
    return json(bundle);
  }
}

/** Hourly: pull /stats.json from registered servers that published a webstat_url. */
export async function runWebstatPullCron(env: WebstatEnv): Promise<{
  ok: boolean;
  attempted: number;
  stored: number;
  skipped: number;
  errors: string[];
}> {
  const errors: string[] = [];
  if (!webstatDb(env)) {
    return { ok: false, attempted: 0, stored: 0, skipped: 0, errors: ["WEBSTAT_DB missing"] };
  }

  const { results } = await env.DB.prepare(
    `SELECT server_id, webstat_url FROM rootstat_servers
     WHERE webstat_url IS NOT NULL AND TRIM(webstat_url) != ''
     ORDER BY featured DESC, updated_at DESC`,
  ).all<{ server_id: string; webstat_url: string }>();

  const rows = results || [];
  let stored = 0;
  let skipped = 0;

  for (const row of rows) {
    const base = str(row.webstat_url).replace(/\/$/, "");
    if (!base) {
      skipped++;
      continue;
    }
    const url = base.includes("/stats.json") ? base : `${base}/stats.json`;
    try {
      const res = await fetch(url, {
        method: "GET",
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(15_000),
      });
      if (!res.ok) {
        errors.push(`${row.server_id}: HTTP ${res.status}`);
        continue;
      }
      const payload = (await res.json()) as SnapshotPayload;
      if (!str(payload.server_id)) payload.server_id = row.server_id;
      const result = await ingestWebstatPayload(env, payload, "pull", row.server_id);
      if (!result.ok) {
        errors.push(`${row.server_id}: ${result.detail}`);
      } else {
        stored++;
      }
    } catch (e) {
      errors.push(`${row.server_id}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  return {
    ok: errors.length === 0,
    attempted: rows.length,
    stored,
    skipped,
    errors: errors.slice(0, 20),
  };
}
