/**
 * Discord /devuptime  -  weekly / monthly / yearly host presence reports (dev role).
 */

import type { D1Database } from "@cloudflare/workers-types";

import { resolveServerId } from "./rootmc-daily-report";
import {
  currentHstDayKey,
  formatDurationShort,
  hstDayBoundsMs,
  mergeIntervals,
  readDevPresenceUptimeSummary,
  readHostUptimeByDay,
  readMergedDevUptimeByDay,
  type DevPresenceUptimeSummary,
} from "./rootmc-host-presence";
import { workstationLabel } from "./rootmc-dev-workstation";

/** Discord role that may run /devuptime. */
export const ROOTMC_DEV_UPTIME_ROLE_ID = "1527411605803892916";

export type DevUptimePeriod = "weekly" | "monthly" | "yearly";

const PERIOD_DAYS: Record<DevUptimePeriod, number> = {
  weekly: 7,
  monthly: 30,
  yearly: 365,
};

const PERIOD_LABEL: Record<DevUptimePeriod, string> = {
  weekly: "Weekly",
  monthly: "Monthly",
  yearly: "Yearly",
};

type PresenceSessionRow = {
  id: number;
  host_key: string;
  host_kind: string;
  started_at: string;
  ended_at: string | null;
  end_reason: string | null;
};

type TimeInterval = { startMs: number; endMs: number };

export function parseDevUptimePeriod(raw: string): DevUptimePeriod | null {
  const key = String(raw || "").trim().toLowerCase();
  if (key === "weekly" || key === "week" || key === "w") return "weekly";
  if (key === "monthly" || key === "month" || key === "m") return "monthly";
  if (key === "yearly" || key === "year" || key === "y" || key === "annual") return "yearly";
  return null;
}

export function memberHasDevUptimeRole(interaction: Record<string, unknown>): boolean {
  const member = (interaction.member as Record<string, unknown> | undefined) || {};
  const roles = (member.roles as unknown[]) || [];
  return roles.some((r) => String(r) === ROOTMC_DEV_UPTIME_ROLE_ID);
}

function formatHstDay(dayKey: string): string {
  const start = Date.parse(`${dayKey}T12:00:00-10:00`);
  if (!Number.isFinite(start)) return dayKey;
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "Pacific/Honolulu",
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(start));
}

function pct(part: number, whole: number): string {
  if (whole <= 0) return "0%";
  return `${Math.round((1000 * part) / whole) / 10}%`;
}

async function readSessionsOverlapping(
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

function clipSession(
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

function hostStats(
  sessions: PresenceSessionRow[],
  hostKey: string,
  windowStartMs: number,
  windowEndMs: number,
  nowMs: number,
): {
  uptimeMs: number;
  sessionCount: number;
  timeouts: number;
  shutdowns: number;
  longestMs: number;
  intervals: TimeInterval[];
} {
  const hostSessions = sessions.filter((s) => s.host_key === hostKey);
  const intervals: TimeInterval[] = [];
  let longestMs = 0;
  let timeouts = 0;
  let shutdowns = 0;
  for (const row of hostSessions) {
    const iv = clipSession(row.started_at, row.ended_at, windowStartMs, windowEndMs, nowMs);
    if (iv) {
      intervals.push(iv);
      longestMs = Math.max(longestMs, iv.endMs - iv.startMs);
    }
    if (row.end_reason === "timeout") timeouts += 1;
    if (row.end_reason === "shutdown") shutdowns += 1;
  }
  const merged = mergeIntervals(intervals);
  return {
    uptimeMs: merged.reduce((s, iv) => s + Math.max(0, iv.endMs - iv.startMs), 0),
    sessionCount: hostSessions.length,
    timeouts,
    shutdowns,
    longestMs,
    intervals: merged,
  };
}

function monthBuckets(
  days: Array<{ day: string; ms: number }>,
): Array<{ label: string; ms: number; daysOnline: number }> {
  const map = new Map<string, { ms: number; daysOnline: number }>();
  for (const row of days) {
    const key = row.day.slice(0, 7);
    const cur = map.get(key) || { ms: 0, daysOnline: 0 };
    cur.ms += row.ms;
    if (row.ms > 0) cur.daysOnline += 1;
    map.set(key, cur);
  }
  return [...map.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([label, v]) => ({ label, ms: v.ms, daysOnline: v.daysOnline }));
}

function shiftHstDayKey(dayKey: string, deltaDays: number): string {
  const { startMs } = hstDayBoundsMs(dayKey);
  return currentHstDayKey(new Date(startMs + deltaDays * 24 * 60 * 60 * 1000 + 12 * 60 * 60 * 1000));
}

export async function buildDevUptimePeriodReport(
  db: D1Database,
  period: DevUptimePeriod,
  nowMs = Date.now(),
): Promise<string> {
  const dayCount = PERIOD_DAYS[period];
  const serverId = await resolveServerId(db);
  const endDayKey = currentHstDayKey(new Date(nowMs));
  const startDayKey = shiftHstDayKey(endDayKey, -(dayCount - 1));
  const { startMs: windowStartMs } = hstDayBoundsMs(startDayKey);
  const { endMs: windowEndMs } = hstDayBoundsMs(endDayKey);
  const windowMs = Math.max(1, windowEndMs - windowStartMs + 1);

  const hostKeys = ["laptop", "primary", serverId];
  const [sessions, summary, mergedDays, laptopDays, primaryDays, serverDays] = await Promise.all([
    readSessionsOverlapping(db, hostKeys, windowStartMs, windowEndMs),
    readDevPresenceUptimeSummary(db, serverId, nowMs),
    readMergedDevUptimeByDay(db, serverId, dayCount, nowMs),
    readHostUptimeByDay(db, "laptop", dayCount, nowMs),
    readHostUptimeByDay(db, "primary", dayCount, nowMs),
    readHostUptimeByDay(db, serverId, dayCount, nowMs),
  ]);

  const laptop = hostStats(sessions, "laptop", windowStartMs, windowEndMs, nowMs);
  const primary = hostStats(sessions, "primary", windowStartMs, windowEndMs, nowMs);
  const server = hostStats(sessions, serverId, windowStartMs, windowEndMs, nowMs);

  const mergedIntervals = mergeIntervals([
    ...sessions
      .filter((s) => s.host_key === "laptop" || s.host_key === "primary")
      .map((s) => clipSession(s.started_at, s.ended_at, windowStartMs, windowEndMs, nowMs))
      .filter((iv): iv is TimeInterval => iv != null),
  ]);
  const mergedMs = mergedIntervals.reduce((s, iv) => s + Math.max(0, iv.endMs - iv.startMs), 0);

  const lines: string[] = [];
  lines.push(`**Dev uptime  -  ${PERIOD_LABEL[period]}** (HST)`);
  lines.push(`**Period:** ${formatHstDay(startDayKey)} -> ${formatHstDay(endDayKey)} (${dayCount} days)`);
  lines.push("");
  lines.push("**Current status**");
  lines.push(statusLine(summary));
  lines.push("");
  lines.push("**Totals (period)**");
  lines.push(hostTotalLine(workstationLabel("primary"), primary, dayCount, windowMs));
  lines.push(hostTotalLine(workstationLabel("laptop"), laptop, dayCount, windowMs));
  lines.push(hostTotalLine("Game server", server, dayCount, windowMs));
  lines.push(
    `\u2022 **Merged dev active** (laptop ∪ workstation): **${formatDurationShort(mergedMs)}**  -  ${pct(mergedMs, windowMs)} of period  -  avg **${formatDurationShort(mergedMs / dayCount)}**/day`,
  );
  lines.push("");
  lines.push("**Power cycles**");
  lines.push(
    `\u2022 **${workstationLabel("primary")}:** ${primary.sessionCount} session(s)  -  ${primary.shutdowns} clean shutdown  -  ${primary.timeouts} heartbeat timeout`,
  );
  lines.push(
    `\u2022 **${workstationLabel("laptop")}:** ${laptop.sessionCount} session(s)  -  ${laptop.shutdowns} clean shutdown  -  ${laptop.timeouts} heartbeat timeout`,
  );
  lines.push(
    `\u2022 **Game server:** ${server.sessionCount} session(s)  -  ${server.shutdowns} clean shutdown  -  ${server.timeouts} heartbeat timeout`,
  );
  lines.push("");
  lines.push("**Highlights**");
  lines.push(
    `\u2022 Longest continuous online  -  Workstation **${formatDurationShort(primary.longestMs)}**  -  Laptop **${formatDurationShort(laptop.longestMs)}**  -  Server **${formatDurationShort(server.longestMs)}**`,
  );

  const bestMerged = [...mergedDays].sort((a, b) => b.mergedDevMs - a.mergedDevMs)[0];
  if (bestMerged && bestMerged.mergedDevMs > 0) {
    lines.push(
      `\u2022 Most active merged-dev day: **${formatHstDay(bestMerged.day)}** (${formatDurationShort(bestMerged.mergedDevMs)})`,
    );
  }

  lines.push("");
  if (period === "weekly") {
    lines.push("**By day (merged dev)**");
    for (const row of mergedDays) {
      const mark = row.mergedDevMs > 0 ? "●" : "○";
      lines.push(
        `${mark} \`${row.day}\` ${formatDurationShort(row.mergedDevMs)}  -  WS ${formatDurationShort(dayMs(primaryDays, row.day))}  -  LT ${formatDurationShort(dayMs(laptopDays, row.day))}  -  SV ${formatDurationShort(dayMs(serverDays, row.day))}`,
      );
    }
  } else if (period === "monthly") {
    lines.push("**Top active days (merged dev)**");
    const top = [...mergedDays].sort((a, b) => b.mergedDevMs - a.mergedDevMs).slice(0, 10);
    for (const row of top) {
      if (row.mergedDevMs <= 0) continue;
      lines.push(`\u2022 ${formatHstDay(row.day)}  -  **${formatDurationShort(row.mergedDevMs)}**`);
    }
    const zeroDays = mergedDays.filter((d) => d.mergedDevMs <= 0).length;
    lines.push(`\u2022 Days with no merged-dev activity: **${zeroDays}** / ${dayCount}`);
  } else {
    lines.push("**By month (merged dev)**");
    const months = monthBuckets(mergedDays.map((d) => ({ day: d.day, ms: d.mergedDevMs })));
    for (const m of months) {
      lines.push(
        `\u2022 **${m.label}**  -  ${formatDurationShort(m.ms)}  -  ${m.daysOnline} day(s) with activity`,
      );
    }
  }

  lines.push("");
  lines.push(
    `_Source: host presence sessions (power-on / heartbeat timeout / shutdown). Heartbeat stale window 15m._`,
  );

  let out = lines.join("\n");
  if (out.length > 1900) {
    out = `${out.slice(0, 1850)}\n\n_...truncated_`;
  }
  return out;
}

function dayMs(rows: Array<{ day: string; uptimeMs: number }>, day: string): number {
  return rows.find((r) => r.day === day)?.uptimeMs ?? 0;
}

function hostTotalLine(
  label: string,
  stats: { uptimeMs: number; sessionCount: number },
  dayCount: number,
  windowMs: number,
): string {
  return `\u2022 **${label}:** **${formatDurationShort(stats.uptimeMs)}** online  -  ${pct(stats.uptimeMs, windowMs)}  -  ${stats.sessionCount} session(s)  -  avg **${formatDurationShort(stats.uptimeMs / dayCount)}**/day`;
}

function statusLine(summary: DevPresenceUptimeSummary): string {
  const bit = (label: string, online: boolean, todayMs: number, sessionMs: number | null) => {
    if (online) {
      const session = sessionMs != null ? `  -  session ${formatDurationShort(sessionMs)}` : "";
      return `\u2022 **${label}:** Online  -  today ${formatDurationShort(todayMs)}${session}`;
    }
    return `\u2022 **${label}:** Offline  -  today ${formatDurationShort(todayMs)}`;
  };
  return [
    bit(summary.workstation.label, summary.workstation.online, summary.workstation.todayMs, summary.workstation.sessionMs),
    bit(summary.laptop.label, summary.laptop.online, summary.laptop.todayMs, summary.laptop.sessionMs),
    bit(summary.server.label, summary.server.online, summary.server.todayMs, summary.server.sessionMs),
    `\u2022 **Merged dev today:** ${formatDurationShort(summary.mergedDevTodayMs)}`,
  ].join("\n");
}
