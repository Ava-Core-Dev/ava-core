/**
 * Host CPU/RAM/disk minute rollups  -  game server + dev workstations.
 */

import type { D1Database } from "@cloudflare/workers-types";
import type { RowDataPacket } from "mysql2/promise";

import { json } from "./cors";
import { validateDevWorkstationAuth, workstationLabel } from "./rootmc-dev-workstation";
import type { RootStatEnv } from "./rootstat-minecraft";
import { validateServerAuth } from "./rootstat-minecraft";
import {
  openRootMcMysql,
  rootMcMysqlTablePrefix,
  type RootMcHyperdriveEnv,
  withShortPublicCache,
} from "./rootmc-hyperdrive";

export type HostMetricsEnv = RootStatEnv & {
  ROOTMC_DEV_WORKSTATION_KEY?: string;
} & RootMcHyperdriveEnv;

export type MinuteIngestBody = {
  host_key?: string;
  workstation_id?: string;
  minute_ts?: string;
  cpu_avg_pct?: number;
  ram_avg_pct?: number;
  disk_used_pct?: number;
  tps_avg?: number | null;
  sample_count?: number;
};

function str(v: unknown): string {
  return String(v ?? "").trim();
}

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function nowIso(): string {
  return new Date().toISOString();
}

function minuteFloorIso(iso?: string): string {
  const d = iso ? new Date(iso) : new Date();
  if (!Number.isFinite(d.getTime())) return minuteFloorIso();
  d.setUTCSeconds(0, 0);
  return d.toISOString();
}

function clampPct(v: number): number {
  return Math.max(0, Math.min(100, v));
}

export function hostLabelForKey(hostKey: string, hostKind: string): string {
  if (hostKind === "workstation") return workstationLabel(hostKey);
  return "play.rootmc.net";
}

async function resolveServerLabel(db: D1Database, serverId: string): Promise<string> {
  const row = await db
    .prepare(`SELECT server_name, server_address FROM rootstat_servers WHERE server_id = ? LIMIT 1`)
    .bind(serverId)
    .first<{ server_name: string | null; server_address: string | null }>();
  return str(row?.server_address) || str(row?.server_name) || "play.rootmc.net";
}

export async function readHostMetricsLastHourAvg(
  db: D1Database,
  hostKey: string,
): Promise<{
  cpu_avg_pct: number;
  ram_avg_pct: number;
  disk_used_pct: number;
  tps_avg: number | null;
} | null> {
  const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const row = await db
    .prepare(
      `SELECT AVG(cpu_avg_pct) AS cpu_avg_pct,
              AVG(ram_avg_pct) AS ram_avg_pct,
              AVG(disk_used_pct) AS disk_used_pct,
              AVG(tps_avg) AS tps_avg,
              COUNT(*) AS n
       FROM rootmc_host_metrics_minute
       WHERE host_key = ? AND minute_ts >= ?`,
    )
    .bind(hostKey, since)
    .first<{
      cpu_avg_pct: number | null;
      ram_avg_pct: number | null;
      disk_used_pct: number | null;
      tps_avg: number | null;
      n: number;
    }>();
  if (!row || !row.n) return null;
  return {
    cpu_avg_pct: round1(num(row.cpu_avg_pct)),
    ram_avg_pct: round1(num(row.ram_avg_pct)),
    disk_used_pct: round1(num(row.disk_used_pct)),
    tps_avg: row.tps_avg === null ? null : round2(num(row.tps_avg)),
  };
}

export function formatServerSpecsLine(
  specs: {
    cpu_avg_pct: number;
    ram_avg_pct: number;
    disk_used_pct: number;
    tps_avg: number | null;
  } | null,
): string {
  if (!specs) {
    return "\u2022 **Server specs:** _No metrics in the last hour yet._";
  }
  const tps =
    specs.tps_avg === null ? "" : ` \u00B7 **TPS:** ${specs.tps_avg.toFixed(2)}`;
  return (
    `\u2022 **Server specs (1h avg):** **CPU:** ${specs.cpu_avg_pct.toFixed(1)}%` +
    ` \u00B7 **RAM:** ${specs.ram_avg_pct.toFixed(1)}%` +
    ` \u00B7 **Disk:** ${specs.disk_used_pct.toFixed(1)}%${tps}`
  );
}

export async function ingestHostMetricsMinute(
  db: D1Database,
  input: {
    hostKey: string;
    hostKind: "server" | "workstation";
    hostLabel?: string;
    minuteTs?: string;
    cpuAvgPct: number;
    ramAvgPct: number;
    diskUsedPct: number;
    tpsAvg?: number | null;
    sampleCount: number;
  },
): Promise<void> {
  const hostKey = str(input.hostKey);
  if (!hostKey) throw new Error("host_key required");
  const minuteTs = minuteFloorIso(input.minuteTs);
  const cpu = clampPct(num(input.cpuAvgPct));
  const ram = clampPct(num(input.ramAvgPct));
  const disk = clampPct(num(input.diskUsedPct));
  const tps = input.tpsAvg === null || input.tpsAvg === undefined ? null : Math.max(0, num(input.tpsAvg));
  const samples = Math.max(1, Math.floor(num(input.sampleCount)));
  const label = str(input.hostLabel) || hostLabelForKey(hostKey, input.hostKind);
  const now = nowIso();

  await db
    .prepare(
      `INSERT INTO rootmc_host_metrics_minute (
         host_key, host_kind, host_label, minute_ts,
         cpu_avg_pct, ram_avg_pct, disk_used_pct, tps_avg, sample_count, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(host_key, minute_ts) DO UPDATE SET
         host_kind = excluded.host_kind,
         host_label = excluded.host_label,
         cpu_avg_pct = excluded.cpu_avg_pct,
         ram_avg_pct = excluded.ram_avg_pct,
         disk_used_pct = excluded.disk_used_pct,
         tps_avg = excluded.tps_avg,
         sample_count = excluded.sample_count,
         created_at = excluded.created_at`,
    )
    .bind(hostKey, input.hostKind, label, minuteTs, cpu, ram, disk, tps, samples, now)
    .run();

  const tpsContribution = tps === null ? 0 : tps * samples;
  await db
    .prepare(
      `INSERT INTO rootmc_host_metrics_lifetime (
         host_key, host_kind, host_label,
         cpu_sum, ram_sum, disk_sum, tps_sum, sample_total, minute_count,
         first_minute_ts, last_minute_ts, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)
       ON CONFLICT(host_key) DO UPDATE SET
         host_kind = excluded.host_kind,
         host_label = excluded.host_label,
         cpu_sum = rootmc_host_metrics_lifetime.cpu_sum + excluded.cpu_sum,
         ram_sum = rootmc_host_metrics_lifetime.ram_sum + excluded.ram_sum,
         disk_sum = rootmc_host_metrics_lifetime.disk_sum + excluded.disk_sum,
         tps_sum = rootmc_host_metrics_lifetime.tps_sum + excluded.tps_sum,
         sample_total = rootmc_host_metrics_lifetime.sample_total + excluded.sample_total,
         minute_count = rootmc_host_metrics_lifetime.minute_count + 1,
         first_minute_ts = COALESCE(rootmc_host_metrics_lifetime.first_minute_ts, excluded.first_minute_ts),
         last_minute_ts = excluded.last_minute_ts,
         updated_at = excluded.updated_at`,
    )
    .bind(
      hostKey,
      input.hostKind,
      label,
      cpu * samples,
      ram * samples,
      disk * samples,
      tpsContribution,
      samples,
      minuteTs,
      minuteTs,
      now,
    )
    .run();
}

async function authorizeIngest(
  request: Request,
  env: HostMetricsEnv,
  body: MinuteIngestBody,
): Promise<{ hostKey: string; hostKind: "server" | "workstation" } | Response> {
  const server = await validateServerAuth(env, request);
  if (!(server instanceof Response)) {
    return { hostKey: server.serverId, hostKind: "server" };
  }
  if (!validateDevWorkstationAuth(request, env)) {
    return json({ detail: "Unauthorized." }, 401);
  }
  const hostKey = str(body.workstation_id || body.host_key) || "primary";
  if (hostKey !== "primary" && hostKey !== "laptop") {
    return json({ detail: "Invalid workstation_id." }, 400);
  }
  return { hostKey, hostKind: "workstation" };
}

export async function handleHostMetricsRoutes(
  request: Request,
  env: HostMetricsEnv,
  subpath: string,
  method: string,
): Promise<Response | null> {
  if (!subpath.startsWith("/rootmc/host-metrics")) return null;
  const rest = subpath.slice("/rootmc/host-metrics".length) || "/";

  if (method === "POST" && rest === "/minute") {
    let body: MinuteIngestBody = {};
    try {
      body = (await request.json()) as MinuteIngestBody;
    } catch {
      return json({ detail: "Invalid JSON body." }, 400);
    }
    const auth = await authorizeIngest(request, env, body);
    if (auth instanceof Response) return auth;

    const samples = Math.max(1, Math.floor(num(body.sample_count)));
    let hostLabel = hostLabelForKey(auth.hostKey, auth.hostKind);
    if (auth.hostKind === "server") {
      hostLabel = await resolveServerLabel(env.DB, auth.hostKey);
    }

    await ingestHostMetricsMinute(env.DB, {
      hostKey: auth.hostKey,
      hostKind: auth.hostKind,
      hostLabel,
      minuteTs: body.minute_ts,
      cpuAvgPct: num(body.cpu_avg_pct),
      ramAvgPct: num(body.ram_avg_pct),
      diskUsedPct: num(body.disk_used_pct),
      tpsAvg: body.tps_avg === undefined ? null : num(body.tps_avg),
      sampleCount: samples,
    });

    return json({
      ok: true,
      host_key: auth.hostKey,
      minute_ts: minuteFloorIso(body.minute_ts),
    });
  }

  if (method === "GET" && rest === "/summary") {
    const lifetime = await env.DB.prepare(
      `SELECT host_key, host_kind, host_label, cpu_sum, ram_sum, disk_sum, tps_sum,
              sample_total, minute_count, first_minute_ts, last_minute_ts, updated_at
       FROM rootmc_host_metrics_lifetime
       ORDER BY host_kind, host_label`,
    ).all<{
      host_key: string;
      host_kind: string;
      host_label: string;
      cpu_sum: number;
      ram_sum: number;
      disk_sum: number;
      tps_sum: number;
      sample_total: number;
      minute_count: number;
      first_minute_ts: string | null;
      last_minute_ts: string | null;
      updated_at: string;
    }>();

    const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();

    const recent = await env.DB.prepare(
      `SELECT host_key, minute_ts, cpu_avg_pct, ram_avg_pct, disk_used_pct, tps_avg, sample_count
       FROM rootmc_host_metrics_minute
       WHERE minute_ts >= ?
       ORDER BY host_key, minute_ts DESC`,
    )
      .bind(since)
      .all<{
      host_key: string;
      minute_ts: string;
      cpu_avg_pct: number;
      ram_avg_pct: number;
      disk_used_pct: number;
      tps_avg: number | null;
      sample_count: number;
    }>();

    const lifetimeRows = [...(lifetime.results || [])];
    const recentRows = [...(recent.results || [])];
    const mysql = await openRootMcMysql(env);
    if (mysql) {
      try {
        const prefix = rootMcMysqlTablePrefix(env);
        const [serverLifetime] = await mysql.query<
          Array<RowDataPacket & {
            host_key: string;
            cpu_sum: number;
            ram_sum: number;
            disk_sum: number;
            tps_sum: number;
            sample_total: number;
            minute_count: number;
            first_minute_ts: Date | string;
            last_minute_ts: Date | string;
            updated_at: Date | string;
          }>
        >(
          `SELECT host_key,
                  SUM(cpu_sum) AS cpu_sum,
                  SUM(ram_sum) AS ram_sum,
                  SUM(disk_sum) AS disk_sum,
                  SUM(tps_sum) AS tps_sum,
                  SUM(sample_total) AS sample_total,
                  SUM(minute_count) AS minute_count,
                  MIN(metric_date) AS first_minute_ts,
                  MAX(metric_date) AS last_minute_ts,
                  MAX(updated_at) AS updated_at
           FROM ${prefix}host_metrics_day
           GROUP BY host_key`,
        );
        for (const row of serverLifetime) {
          const staleIndex = lifetimeRows.findIndex((existing) => existing.host_key === row.host_key);
          if (staleIndex >= 0) lifetimeRows.splice(staleIndex, 1);
          lifetimeRows.push({
            ...row,
            host_kind: "server",
            host_label: "play.rootmc.net",
            first_minute_ts: new Date(row.first_minute_ts).toISOString(),
            last_minute_ts: new Date(row.last_minute_ts).toISOString(),
            updated_at: new Date(row.updated_at).toISOString(),
          });
        }
        const [serverRecent] = await mysql.query<
          Array<RowDataPacket & {
            host_key: string;
            minute_ts: Date | string;
            cpu_avg_pct: number;
            ram_avg_pct: number;
            disk_used_pct: number;
            tps_avg: number | null;
            sample_count: number;
          }>
        >(
          `SELECT host_key, minute_ts, cpu_avg_pct, ram_avg_pct, disk_used_pct, tps_avg, sample_count
           FROM ${prefix}host_metrics_minute
           WHERE minute_ts >= UTC_TIMESTAMP() - INTERVAL 1 HOUR
           ORDER BY host_key, minute_ts DESC`,
        );
        const mysqlHostKeys = new Set(serverRecent.map((row) => row.host_key));
        for (let index = recentRows.length - 1; index >= 0; index -= 1) {
          if (mysqlHostKeys.has(recentRows[index].host_key)) recentRows.splice(index, 1);
        }
        for (const row of serverRecent) {
          recentRows.push({ ...row, minute_ts: new Date(row.minute_ts).toISOString() });
        }
      } catch (error) {
        console.warn("host_metrics_hyperdrive_fallback", String(error).slice(0, 300));
      } finally {
        await mysql.end();
      }
    }

    const hosts = lifetimeRows.map((row) => {
      const samples = Math.max(1, Number(row.sample_total) || 0);
      const tpsSamples =
        row.host_kind === "server" && Number(row.tps_sum) > 0 ? samples : 0;
      return {
        host_key: row.host_key,
        host_kind: row.host_kind,
        host_label: row.host_label,
        all_time: {
          cpu_avg_pct: round1(Number(row.cpu_sum) / samples),
          ram_avg_pct: round1(Number(row.ram_sum) / samples),
          disk_used_pct: round1(Number(row.disk_sum) / samples),
          tps_avg: tpsSamples > 0 ? round2(Number(row.tps_sum) / tpsSamples) : null,
          minute_count: Number(row.minute_count) || 0,
          sample_total: samples,
          first_minute_ts: row.first_minute_ts,
          last_minute_ts: row.last_minute_ts,
        },
        updated_at: row.updated_at,
      };
    });

    const recentByHost: Record<string, typeof recent.results> = {};
    for (const row of recentRows) {
      if (!recentByHost[row.host_key]) recentByHost[row.host_key] = [];
      if (recentByHost[row.host_key].length < 60) recentByHost[row.host_key].push(row);
    }

    return withShortPublicCache(json({
      ok: true,
      hosts,
      recent_minutes: recentByHost,
      synced_at: nowIso(),
    }));
  }

  return json({ detail: "Not Found" }, 404);
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
