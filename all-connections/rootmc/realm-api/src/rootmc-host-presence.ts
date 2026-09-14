/**
 * Host presence sessions  -  per-device uptime + merged dev active time (laptop ∪ workstation).
 */

import type { D1Database } from "@cloudflare/workers-types";

import { json } from "./cors";
import { DEV_WORKSTATION_STALE_MS, isDevWorkstationOnline, readDevWorkstationRecord, workstationLabel } from "./rootmc-dev-workstation";
import { resolveServerId } from "./rootmc-daily-report";

const HST_OFFSET_MS = 10 * 60 * 60 * 1000;
const DEV_WORKSTATION_KEYS = ["laptop", "primary"] as const;

type PresenceSessionRow = {
  id: number;
  host_key: string;
  host_kind: string;
  started_at: string;
  ended_at: string | null;
  end_reason: string | null;
};

type TimeInterval = { startMs: number; endMs: number };

export type HostUptimeInfo = {
  hostKey: string;
  label: string;
  online: boolean;
  todayMs: number;
  sessionMs: number | null;
};

export type DevPresenceUptimeSummary = {
  hstDayKey: string;
  laptop: HostUptimeInfo;
  workstation: HostUptimeInfo;
  server: HostUptimeInfo;
  mergedDevTodayMs: number;
  mergedDevTodayIntervals: Array<{ start: string; end: string | null }>;
  todayIntervalsByHost: {
    laptop: Array<{ start: string; end: string | null }>;
    primary: Array<{ start: string; end: string | null }>;
    server: Array<{ start: string; end: string | null }>;
  };
};

function str(v: unknown): string {
  return String(v ?? "").trim();
}

function nowIso(): string {
  return new Date().toISOString();
}

export function currentHstDayKey(at = new Date()): string {
  const hstMs = at.getTime() - HST_OFFSET_MS;
  const hst = new Date(hstMs);
  let y = hst.getUTCFullYear();
  let m = hst.getUTCMonth();
  let day = hst.getUTCDate();
  const minuteOfDay = hst.getUTCHours() * 60 + hst.getUTCMinutes();
  if (minuteOfDay < 30) {
    const prev = new Date(Date.UTC(y, m, day) - 24 * 60 * 60 * 1000);
    y = prev.getUTCFullYear();
    m = prev.getUTCMonth();
    day = prev.getUTCDate();
  }
  return `${y}-${String(m + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function hstDayBoundsMs(dayKey: string): { startMs: number; endMs: number } {
  const startMs = Date.parse(`${dayKey}T00:30:00-10:00`);
  const endMs = startMs + 24 * 60 * 60 * 1000 - 1;
  return { startMs, endMs };
}

export function formatDurationShort(ms: number): string {
  const totalMin = Math.max(0, Math.floor(ms / 60_000));
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h > 0 && m > 0) return `${h}h ${m}m`;
  if (h > 0) return `${h}h`;
  return `${m}m`;
}

export function mergeIntervals(intervals: TimeInterval[]): TimeInterval[] {
  if (!intervals.length) return [];
  const sorted = [...intervals].sort((a, b) => a.startMs - b.startMs);
  const merged: TimeInterval[] = [{ ...sorted[0] }];
  for (let i = 1; i < sorted.length; i++) {
    const cur = sorted[i];
    const last = merged[merged.length - 1];
    if (cur.startMs <= last.endMs) {
      last.endMs = Math.max(last.endMs, cur.endMs);
    } else {
      merged.push({ ...cur });
    }
  }
  return merged;
}

export function sumIntervalDurationMs(intervals: TimeInterval[]): number {
  return intervals.reduce((sum, iv) => sum + Math.max(0, iv.endMs - iv.startMs), 0);
}

function clipSessionToWindow(
  startedAt: string,
  endedAt: string | null,
  windowStartMs: number,
  windowEndMs: number,
  nowMs: number,
): TimeInterval | null {
  const startMs = Date.parse(startedAt);
  if (!Number.isFinite(startMs)) return null;
  const endMs = endedAt ? Date.parse(endedAt) : nowMs;
  if (!Number.isFinite(endMs)) return null;
  const clipStart = Math.max(startMs, windowStartMs);
  const clipEnd = Math.min(endMs, windowEndMs);
  if (clipEnd <= clipStart) return null;
  return { startMs: clipStart, endMs: clipEnd };
}

function sessionsToIntervals(
  sessions: PresenceSessionRow[],
  windowStartMs: number,
  windowEndMs: number,
  nowMs: number,
): TimeInterval[] {
  const out: TimeInterval[] = [];
  for (const row of sessions) {
    const iv = clipSessionToWindow(row.started_at, row.ended_at, windowStartMs, windowEndMs, nowMs);
    if (iv) out.push(iv);
  }
  return out;
}

async function readOpenSession(
  db: D1Database,
  hostKey: string,
): Promise<PresenceSessionRow | null> {
  return db
    .prepare(
      `SELECT id, host_key, host_kind, started_at, ended_at, end_reason
       FROM rootmc_host_presence_session
       WHERE host_key = ? AND ended_at IS NULL
       ORDER BY started_at DESC
       LIMIT 1`,
    )
    .bind(hostKey)
    .first<PresenceSessionRow>();
}

async function readSessionsForHosts(
  db: D1Database,
  hostKeys: string[],
  sinceIso: string,
): Promise<PresenceSessionRow[]> {
  if (!hostKeys.length) return [];
  const placeholders = hostKeys.map(() => "?").join(", ");
  const { results } = await db
    .prepare(
      `SELECT id, host_key, host_kind, started_at, ended_at, end_reason
       FROM rootmc_host_presence_session
       WHERE host_key IN (${placeholders})
         AND started_at >= ?
       ORDER BY started_at ASC`,
    )
    .bind(...hostKeys, sinceIso)
    .all<PresenceSessionRow>();
  return results || [];
}

/** Sessions that overlap [windowStartMs, windowEndMs] (includes open sessions). */
async function readSessionsOverlappingWindow(
  db: D1Database,
  hostKeys: string[],
  windowStartMs: number,
  windowEndMs: number,
): Promise<PresenceSessionRow[]> {
  if (!hostKeys.length) return [];
  const placeholders = hostKeys.map(() => "?").join(", ");
  const startIso = new Date(windowStartMs).toISOString();
  const endIso = new Date(windowEndMs).toISOString();
  const { results } = await db
    .prepare(
      `SELECT id, host_key, host_kind, started_at, ended_at, end_reason
       FROM rootmc_host_presence_session
       WHERE host_key IN (${placeholders})
         AND started_at <= ?
         AND (ended_at IS NULL OR ended_at >= ?)
       ORDER BY started_at ASC`,
    )
    .bind(...hostKeys, endIso, startIso)
    .all<PresenceSessionRow>();
  return results || [];
}

async function openPresenceSession(
  db: D1Database,
  hostKey: string,
  hostKind: "workstation" | "server",
  startedAt = nowIso(),
): Promise<void> {
  const open = await readOpenSession(db, hostKey);
  if (open) return;
  await db
    .prepare(
      `INSERT INTO rootmc_host_presence_session
         (host_key, host_kind, started_at, end_reason, created_at)
       VALUES (?, ?, ?, 'open', ?)`,
    )
    .bind(hostKey, hostKind, startedAt, nowIso())
    .run();
}

async function closeOpenPresenceSession(
  db: D1Database,
  hostKey: string,
  endedAt: string,
  endReason: string,
): Promise<void> {
  await db
    .prepare(
      `UPDATE rootmc_host_presence_session
       SET ended_at = ?, end_reason = ?
       WHERE host_key = ? AND ended_at IS NULL`,
    )
    .bind(endedAt, endReason, hostKey)
    .run();
}

export async function touchWorkstationPresenceOnHeartbeat(
  db: D1Database,
  workstationId: string,
  seenAt = nowIso(),
): Promise<void> {
  await openPresenceSession(db, workstationId, "workstation", seenAt);
}

export async function closeWorkstationPresenceOnShutdown(
  db: D1Database,
  workstationId: string,
  endedAt = nowIso(),
): Promise<void> {
  await closeOpenPresenceSession(db, workstationId, endedAt, "shutdown");
}

export async function closeWorkstationPresenceOnTimeout(
  db: D1Database,
  workstationId: string,
  lastSeenAt: string,
  detectedAt = nowIso(),
): Promise<void> {
  const lastMs = Date.parse(lastSeenAt);
  const endedAt =
    Number.isFinite(lastMs) && Date.now() - lastMs > DEV_WORKSTATION_STALE_MS
      ? new Date(lastMs + DEV_WORKSTATION_STALE_MS).toISOString()
      : detectedAt;
  await closeOpenPresenceSession(db, workstationId, endedAt, "timeout");
}

export async function touchServerPresenceOnHeartbeat(
  db: D1Database,
  serverId: string,
  seenAt = nowIso(),
): Promise<void> {
  await openPresenceSession(db, serverId, "server", seenAt);
}

function isServerOnline(lastSeenAt: string | null, nowMs = Date.now()): boolean {
  const seen = Date.parse(str(lastSeenAt));
  return Number.isFinite(seen) && nowMs - seen <= DEV_WORKSTATION_STALE_MS;
}

export async function closeStalePresenceSessions(
  db: D1Database,
  serverId: string,
  now = new Date(),
): Promise<string[]> {
  const details: string[] = [];
  const nowMs = now.getTime();
  const nowIsoStr = now.toISOString();

  for (const workstationId of DEV_WORKSTATION_KEYS) {
    const open = await readOpenSession(db, workstationId);
    if (!open) continue;
    const record = await readDevWorkstationRecord(db, workstationId);
    if (isDevWorkstationOnline(record, nowMs)) continue;
    const lastSeen = str(record?.last_seen_at) || open.started_at;
    await closeWorkstationPresenceOnTimeout(db, workstationId, lastSeen, nowIsoStr);
    details.push(`${workstationId}:closed`);
  }

  const serverRow = await db
    .prepare(`SELECT rootmc_last_seen_at FROM rootstat_servers WHERE server_id = ? LIMIT 1`)
    .bind(serverId)
    .first<{ rootmc_last_seen_at: string | null }>();
  const serverOpen = await readOpenSession(db, serverId);
  if (serverOpen && !isServerOnline(serverRow?.rootmc_last_seen_at ?? null, nowMs)) {
    const lastSeen = str(serverRow?.rootmc_last_seen_at) || serverOpen.started_at;
    const lastMs = Date.parse(lastSeen);
    const endedAt =
      Number.isFinite(lastMs) && nowMs - lastMs > DEV_WORKSTATION_STALE_MS
        ? new Date(lastMs + DEV_WORKSTATION_STALE_MS).toISOString()
        : nowIsoStr;
    await closeOpenPresenceSession(db, serverId, endedAt, "timeout");
    details.push("server:closed");
  }

  return details;
}

export function formatHostStatusWithUptime(label: string, online: boolean, todayMs: number, sessionMs: number | null): string {
  const today = formatDurationShort(todayMs);
  if (online) {
    const session = sessionMs !== null ? ` \u00B7 session ${formatDurationShort(sessionMs)}` : "";
    return `\u2022 **${label}:** Online \u00B7 today ${today}${session}`;
  }
  return `\u2022 **${label}:** Offline \u00B7 today ${today}`;
}

export async function readDevPresenceUptimeSummary(
  db: D1Database,
  serverId: string,
  nowMs = Date.now(),
): Promise<DevPresenceUptimeSummary> {
  const hstDayKey = currentHstDayKey(new Date(nowMs));
  const { startMs, endMs } = hstDayBoundsMs(hstDayKey);
  const sinceIso = new Date(startMs - 48 * 60 * 60 * 1000).toISOString();

  const [laptopRecord, primaryRecord, serverRow, sessions] = await Promise.all([
    readDevWorkstationRecord(db, "laptop"),
    readDevWorkstationRecord(db, "primary"),
    db
      .prepare(`SELECT rootmc_last_seen_at FROM rootstat_servers WHERE server_id = ? LIMIT 1`)
      .bind(serverId)
      .first<{ rootmc_last_seen_at: string | null }>(),
    readSessionsForHosts(db, [...DEV_WORKSTATION_KEYS, serverId], sinceIso),
  ]);

  const laptopOnline = isDevWorkstationOnline(laptopRecord, nowMs);
  const workstationOnline = isDevWorkstationOnline(primaryRecord, nowMs);
  const serverOnline = isServerOnline(serverRow?.rootmc_last_seen_at ?? null, nowMs);

  function hostUptime(hostKey: string, label: string, online: boolean): HostUptimeInfo {
    const hostSessions = sessions.filter((s) => s.host_key === hostKey);
    const todayIntervals = sessionsToIntervals(hostSessions, startMs, endMs, nowMs);
    const todayMs = sumIntervalDurationMs(todayIntervals);
    let sessionMs: number | null = null;
    if (online) {
      const open = hostSessions.find((s) => !s.ended_at);
      if (open) {
        sessionMs = Math.max(0, nowMs - Date.parse(open.started_at));
      }
    }
    return { hostKey, label, online, todayMs, sessionMs };
  }

  const laptop = hostUptime("laptop", workstationLabel("laptop"), laptopOnline);
  const workstation = hostUptime("primary", workstationLabel("primary"), workstationOnline);
  const server = hostUptime(serverId, "Game server", serverOnline);

  const devSessions = sessions.filter((s) => s.host_key === "laptop" || s.host_key === "primary");
  const devIntervals = mergeIntervals(sessionsToIntervals(devSessions, startMs, endMs, nowMs));
  const mergedDevTodayMs = sumIntervalDurationMs(devIntervals);

  function intervalsForHost(hostKey: string) {
    const hostSessions = sessions.filter((s) => s.host_key === hostKey);
    return sessionsToIntervals(hostSessions, startMs, endMs, nowMs).map((iv) => ({
      start: new Date(iv.startMs).toISOString(),
      end: iv.endMs >= nowMs ? null : new Date(iv.endMs).toISOString(),
    }));
  }

  return {
    hstDayKey,
    laptop,
    workstation,
    server,
    mergedDevTodayMs,
    mergedDevTodayIntervals: devIntervals.map((iv) => ({
      start: new Date(iv.startMs).toISOString(),
      end: iv.endMs >= nowMs ? null : new Date(iv.endMs).toISOString(),
    })),
    todayIntervalsByHost: {
      laptop: intervalsForHost("laptop"),
      primary: intervalsForHost("primary"),
      server: intervalsForHost(serverId),
    },
  };
}

export async function readMergedDevUptimeByDay(
  db: D1Database,
  _serverId: string,
  dayCount = 7,
  nowMs = Date.now(),
): Promise<Array<{ day: string; mergedDevMs: number }>> {
  const days: Array<{ day: string; mergedDevMs: number }> = [];
  const endDayKey = currentHstDayKey(new Date(nowMs));
  const startDayKey = (() => {
    const { startMs } = hstDayBoundsMs(endDayKey);
    return currentHstDayKey(new Date(startMs + 12 * 60 * 60 * 1000 - (dayCount - 1) * 24 * 60 * 60 * 1000));
  })();
  const { startMs: windowStartMs } = hstDayBoundsMs(startDayKey);
  const { endMs: windowEndMs } = hstDayBoundsMs(endDayKey);
  const sessions = await readSessionsOverlappingWindow(
    db,
    [...DEV_WORKSTATION_KEYS],
    windowStartMs,
    windowEndMs,
  );

  for (let i = dayCount - 1; i >= 0; i--) {
    const { startMs: anchor } = hstDayBoundsMs(endDayKey);
    const dayKey = currentHstDayKey(new Date(anchor + 12 * 60 * 60 * 1000 - i * 24 * 60 * 60 * 1000));
    const { startMs, endMs } = hstDayBoundsMs(dayKey);
    const merged = mergeIntervals(sessionsToIntervals(sessions, startMs, endMs, nowMs));
    days.push({ day: dayKey, mergedDevMs: sumIntervalDurationMs(merged) });
  }
  return days;
}

export async function readHostUptimeByDay(
  db: D1Database,
  hostKey: string,
  dayCount = 7,
  nowMs = Date.now(),
): Promise<Array<{ day: string; uptimeMs: number }>> {
  const days: Array<{ day: string; uptimeMs: number }> = [];
  const endDayKey = currentHstDayKey(new Date(nowMs));
  const startDayKey = (() => {
    const { startMs } = hstDayBoundsMs(endDayKey);
    return currentHstDayKey(new Date(startMs + 12 * 60 * 60 * 1000 - (dayCount - 1) * 24 * 60 * 60 * 1000));
  })();
  const { startMs: windowStartMs } = hstDayBoundsMs(startDayKey);
  const { endMs: windowEndMs } = hstDayBoundsMs(endDayKey);
  const sessions = await readSessionsOverlappingWindow(db, [hostKey], windowStartMs, windowEndMs);

  for (let i = dayCount - 1; i >= 0; i--) {
    const { startMs: anchor } = hstDayBoundsMs(endDayKey);
    const dayKey = currentHstDayKey(new Date(anchor + 12 * 60 * 60 * 1000 - i * 24 * 60 * 60 * 1000));
    const { startMs, endMs } = hstDayBoundsMs(dayKey);
    const merged = mergeIntervals(sessionsToIntervals(sessions, startMs, endMs, nowMs));
    days.push({ day: dayKey, uptimeMs: sumIntervalDurationMs(merged) });
  }
  return days;
}

export async function runHostPresenceMaintenance(
  db: D1Database,
  serverId: string,
  now = new Date(),
): Promise<{ ok: boolean; detail: string }> {
  const closed = await closeStalePresenceSessions(db, serverId, now);
  return { ok: true, detail: closed.join("; ") || "idle" };
}

export type PresenceChartRange = "hour" | "day" | "week" | "month" | "year";

export type PresenceChartSeries = {
  range: PresenceChartRange;
  window_start: string;
  window_end: string;
  unit: "ms";
  labels: string[];
  series: {
    laptop: number[];
    primary: number[];
    server: number[];
    merged_dev: number[];
  };
  weekday_peak: {
    labels: string[];
    laptop: number[];
    primary: number[];
    server: number[];
    merged_dev: number[];
  };
};

const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function resolveViewerTimeZone(timeZone?: string | null): string {
  const tz = String(timeZone || "").trim();
  if (!tz) return "Pacific/Honolulu";
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz }).format(new Date());
    return tz;
  } catch {
    return "Pacific/Honolulu";
  }
}

function dayKeyInTz(ms: number, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(ms));
}

function weekdayIndexInTz(ms: number, timeZone: string): number {
  const wd = new Intl.DateTimeFormat("en-US", { timeZone, weekday: "short" }).format(new Date(ms));
  const idx = WEEKDAY_LABELS.indexOf(wd);
  return idx >= 0 ? idx : 0;
}

/** UTC ms of local midnight for YYYY-MM-DD in timeZone. */
function zonedDayStartMs(dayKey: string, timeZone: string): number {
  const [y, mo, d] = dayKey.split("-").map((n) => Number(n));
  let lo = Date.UTC(y, mo - 1, d) - 36 * 3600 * 1000;
  let hi = Date.UTC(y, mo - 1, d) + 36 * 3600 * 1000;
  while (hi - lo > 250) {
    const mid = Math.floor((lo + hi) / 2);
    if (dayKeyInTz(mid, timeZone) >= dayKey) hi = mid;
    else lo = mid;
  }
  return hi;
}

function listRecentDayKeys(timeZone: string, dayCount: number, nowMs: number): string[] {
  const keys: string[] = [];
  const seen = new Set<string>();
  for (let t = nowMs; keys.length < dayCount && t > nowMs - (dayCount + 3) * 86400000; t -= 60 * 60 * 1000) {
    const k = dayKeyInTz(t, timeZone);
    if (!seen.has(k)) {
      seen.add(k);
      keys.push(k);
    }
  }
  return keys.reverse().slice(-dayCount);
}

function rangeWindow(
  range: PresenceChartRange,
  nowMs: number,
  timeZone = "Pacific/Honolulu",
): {
  startMs: number;
  endMs: number;
  bucketStarts: number[];
  labels: string[];
} {
  const tz = resolveViewerTimeZone(timeZone);
  const endMs = nowMs;
  if (range === "hour") {
    const startMs = endMs - 60 * 60 * 1000;
    const bucketMs = 5 * 60 * 1000;
    const bucketStarts: number[] = [];
    const labels: string[] = [];
    for (let t = startMs; t < endMs; t += bucketMs) {
      bucketStarts.push(t);
      labels.push(
        new Date(t).toLocaleTimeString("en-US", {
          timeZone: tz,
          hour: "numeric",
          minute: "2-digit",
        }),
      );
    }
    return { startMs, endMs, bucketStarts, labels };
  }
  if (range === "day") {
    const startMs = endMs - 24 * 60 * 60 * 1000;
    const bucketMs = 60 * 60 * 1000;
    const bucketStarts: number[] = [];
    const labels: string[] = [];
    for (let t = startMs; t < endMs; t += bucketMs) {
      bucketStarts.push(t);
      labels.push(
        new Date(t).toLocaleTimeString("en-US", {
          timeZone: tz,
          hour: "numeric",
        }),
      );
    }
    return { startMs, endMs, bucketStarts, labels };
  }
  if (range === "week" || range === "month") {
    const dayCount = range === "week" ? 7 : 30;
    const dayKeys = listRecentDayKeys(tz, dayCount, nowMs);
    const bucketStarts = dayKeys.map((k) => zonedDayStartMs(k, tz));
    const labels = dayKeys.map((k) => k.slice(5));
    const startMs = bucketStarts[0] ?? nowMs - dayCount * 86400000;
    const lastStart = bucketStarts[bucketStarts.length - 1] ?? startMs;
    const nextKey = dayKeyInTz(lastStart + 36 * 3600 * 1000, tz);
    // end of last day ≈ start of tomorrow; clamp to now
    let dayEnd = zonedDayStartMs(nextKey, tz);
    if (dayKeyInTz(lastStart, tz) === nextKey) {
      dayEnd = lastStart + 24 * 3600 * 1000;
    }
    return { startMs, endMs: Math.min(dayEnd, endMs), bucketStarts, labels };
  }
  // year  -  12 calendar months in viewer TZ
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    year: "numeric",
    month: "numeric",
  }).formatToParts(new Date(nowMs));
  const endYear = Number(parts.find((p) => p.type === "year")?.value) || new Date(nowMs).getUTCFullYear();
  const endMonth = (Number(parts.find((p) => p.type === "month")?.value) || 1) - 1;
  const bucketStarts: number[] = [];
  const labels: string[] = [];
  for (let i = 11; i >= 0; i--) {
    let y = endYear;
    let m = endMonth - i;
    while (m < 0) {
      m += 12;
      y -= 1;
    }
    const dayKey = `${y}-${String(m + 1).padStart(2, "0")}-01`;
    bucketStarts.push(zonedDayStartMs(dayKey, tz));
    labels.push(
      new Date(Date.UTC(y, m, 15)).toLocaleString("en-US", { month: "short", year: "2-digit", timeZone: "UTC" }),
    );
  }
  const startMs = bucketStarts[0];
  return { startMs, endMs, bucketStarts, labels };
}

function fillBuckets(intervals: TimeInterval[], bucketStarts: number[], windowEndMs: number): number[] {
  const values = bucketStarts.map(() => 0);
  for (let i = 0; i < bucketStarts.length; i++) {
    const b0 = bucketStarts[i];
    const b1 = i + 1 < bucketStarts.length ? bucketStarts[i + 1] : windowEndMs;
    for (const iv of intervals) {
      const o0 = Math.max(iv.startMs, b0);
      const o1 = Math.min(iv.endMs, b1);
      if (o1 > o0) values[i] += o1 - o0;
    }
  }
  return values;
}

function fillWeekdayPeaks(intervals: TimeInterval[], timeZone: string): number[] {
  const values = [0, 0, 0, 0, 0, 0, 0];
  const sliceMs = 60 * 60 * 1000;
  for (const iv of intervals) {
    let t = iv.startMs;
    while (t < iv.endMs) {
      const next = Math.min(iv.endMs, t + sliceMs);
      values[weekdayIndexInTz(t, timeZone)] += next - t;
      t = next;
    }
  }
  return values;
}

export async function buildPresenceChartSeries(
  db: D1Database,
  serverId: string,
  range: PresenceChartRange,
  nowMs = Date.now(),
  timeZone?: string | null,
): Promise<PresenceChartSeries & { time_zone: string }> {
  const tz = resolveViewerTimeZone(timeZone);
  const { startMs, endMs, bucketStarts, labels } = rangeWindow(range, nowMs, tz);
  const hostKeys = [...DEV_WORKSTATION_KEYS, serverId];
  const sessions = await readSessionsOverlappingWindow(db, hostKeys, startMs, endMs);

  const laptopIv = sessionsToIntervals(
    sessions.filter((s) => s.host_key === "laptop"),
    startMs,
    endMs,
    nowMs,
  );
  const primaryIv = sessionsToIntervals(
    sessions.filter((s) => s.host_key === "primary"),
    startMs,
    endMs,
    nowMs,
  );
  const serverIv = sessionsToIntervals(
    sessions.filter((s) => s.host_key === serverId),
    startMs,
    endMs,
    nowMs,
  );
  const mergedIv = mergeIntervals([...laptopIv, ...primaryIv]);

  return {
    range,
    time_zone: tz,
    window_start: new Date(startMs).toISOString(),
    window_end: new Date(endMs).toISOString(),
    unit: "ms",
    labels,
    series: {
      laptop: fillBuckets(laptopIv, bucketStarts, endMs),
      primary: fillBuckets(primaryIv, bucketStarts, endMs),
      server: fillBuckets(serverIv, bucketStarts, endMs),
      merged_dev: fillBuckets(mergedIv, bucketStarts, endMs),
    },
    weekday_peak: {
      labels: [...WEEKDAY_LABELS],
      laptop: fillWeekdayPeaks(laptopIv, tz),
      primary: fillWeekdayPeaks(primaryIv, tz),
      server: fillWeekdayPeaks(serverIv, tz),
      merged_dev: fillWeekdayPeaks(mergedIv, tz),
    },
  };
}

export function parsePresenceChartRange(raw: string | null): PresenceChartRange {
  const v = String(raw || "").trim().toLowerCase();
  if (v === "hour" || v === "day" || v === "week" || v === "month" || v === "year") return v;
  return "week";
}

export type HostUptimeLifetime = {
  host_key: string;
  tracking_since: string | null;
  online_ms: number;
  elapsed_ms: number;
  uptime_pct: number;
};

/** Online time ÷ wall time since first presence session for that host. */
export async function readHostLifetimeUptime(
  db: D1Database,
  hostKey: string,
  nowMs = Date.now(),
): Promise<HostUptimeLifetime> {
  const first = await db
    .prepare(
      `SELECT MIN(started_at) AS first_started
       FROM rootmc_host_presence_session
       WHERE host_key = ?`,
    )
    .bind(hostKey)
    .first<{ first_started: string | null }>();

  const trackingSince = str(first?.first_started) || null;
  if (!trackingSince) {
    return { host_key: hostKey, tracking_since: null, online_ms: 0, elapsed_ms: 0, uptime_pct: 0 };
  }

  const startMs = Date.parse(trackingSince);
  if (!Number.isFinite(startMs) || startMs >= nowMs) {
    return { host_key: hostKey, tracking_since: trackingSince, online_ms: 0, elapsed_ms: 0, uptime_pct: 0 };
  }

  const sessions = await readSessionsOverlappingWindow(db, [hostKey], startMs, nowMs);
  const intervals = sessionsToIntervals(sessions, startMs, nowMs, nowMs);
  const onlineMs = sumIntervalDurationMs(mergeIntervals(intervals));
  const elapsedMs = Math.max(1, nowMs - startMs);
  const pct = Math.max(0, Math.min(100, (onlineMs / elapsedMs) * 100));

  return {
    host_key: hostKey,
    tracking_since: trackingSince,
    online_ms: onlineMs,
    elapsed_ms: elapsedMs,
    uptime_pct: Math.round(pct * 10) / 10,
  };
}

/** Merged laptop ∪ workstation online ÷ wall time since earliest of the two started tracking. */
export async function readMergedDevLifetimeUptime(
  db: D1Database,
  nowMs = Date.now(),
): Promise<HostUptimeLifetime> {
  const hostKeys = [...DEV_WORKSTATION_KEYS];
  const first = await db
    .prepare(
      `SELECT MIN(started_at) AS first_started
       FROM rootmc_host_presence_session
       WHERE host_key IN (?, ?)`,
    )
    .bind(hostKeys[0], hostKeys[1])
    .first<{ first_started: string | null }>();

  const trackingSince = str(first?.first_started) || null;
  if (!trackingSince) {
    return { host_key: "merged_dev", tracking_since: null, online_ms: 0, elapsed_ms: 0, uptime_pct: 0 };
  }

  const startMs = Date.parse(trackingSince);
  if (!Number.isFinite(startMs) || startMs >= nowMs) {
    return { host_key: "merged_dev", tracking_since: trackingSince, online_ms: 0, elapsed_ms: 0, uptime_pct: 0 };
  }

  const sessions = await readSessionsOverlappingWindow(db, hostKeys, startMs, nowMs);
  const intervals = mergeIntervals(sessionsToIntervals(sessions, startMs, nowMs, nowMs));
  const onlineMs = sumIntervalDurationMs(intervals);
  const elapsedMs = Math.max(1, nowMs - startMs);
  const pct = Math.max(0, Math.min(100, (onlineMs / elapsedMs) * 100));

  return {
    host_key: "merged_dev",
    tracking_since: trackingSince,
    online_ms: onlineMs,
    elapsed_ms: elapsedMs,
    uptime_pct: Math.round(pct * 10) / 10,
  };
}

export async function handleHostPresenceRoutes(
  request: Request,
  env: { DB: D1Database },
  subpath: string,
  method: string,
): Promise<Response | null> {
  if (!subpath.startsWith("/rootmc/host-presence")) return null;
  const rest = subpath.slice("/rootmc/host-presence".length) || "/";

  if (method === "GET" && rest === "/summary") {
    const serverId = await resolveServerId(env.DB);
    const url = new URL(request.url);
    const dayCount = Math.min(30, Math.max(1, Math.floor(Number(url.searchParams.get("days")) || 7)));
    const sessionLookbackDays = Math.min(30, Math.max(dayCount, 7));
    const sinceIso = new Date(Date.now() - sessionLookbackDays * 24 * 60 * 60 * 1000).toISOString();
    const [summary, recentDays, laptopDays, primaryDays, serverDays, recentSessions] = await Promise.all([
      readDevPresenceUptimeSummary(env.DB, serverId),
      readMergedDevUptimeByDay(env.DB, serverId, dayCount),
      readHostUptimeByDay(env.DB, "laptop", dayCount),
      readHostUptimeByDay(env.DB, "primary", dayCount),
      readHostUptimeByDay(env.DB, serverId, dayCount),
      readSessionsForHosts(env.DB, [...DEV_WORKSTATION_KEYS, serverId], sinceIso),
    ]);
    return json({
      ...summary,
      recent_days: recentDays,
      uptime_by_day: {
        laptop: laptopDays,
        primary: primaryDays,
        server: serverDays,
        merged_dev: recentDays,
      },
      recent_sessions: [...recentSessions]
        .sort((a, b) => Date.parse(b.started_at) - Date.parse(a.started_at))
        .slice(0, 80)
        .map((s) => ({
          id: s.id,
          host_key: s.host_key,
          host_kind: s.host_kind,
          started_at: s.started_at,
          ended_at: s.ended_at,
          end_reason: s.end_reason,
        })),
    });
  }

  return json({ detail: "Not Found" }, 404);
}
