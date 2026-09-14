/** RootMC milestone dates + release timeline for daily AI reports. */

/** First HST day counted as live public production data (early open). */
export const ROOTMC_REAL_DATA_START_HST = "2026-06-21";

export const ROOTMC_PUBLIC_LAUNCH_HST = ROOTMC_REAL_DATA_START_HST;

export const ROOTMC_MILESTONE_EVENTS = [
  {
    id: "public-launch",
    name: "Public launch",
    /** Midnight HST at the start of June 21, 2026 */
    startMs: Date.parse("2026-06-21T10:00:00.000Z"),
    note: "RootMC opened to the public (ahead of schedule)",
  },
] as const;

export type RootMcCountdownEvent = {
  id: string;
  name: string;
  startMs: number;
  note?: string;
  source: "milestone" | "discord";
};

function str(v: unknown): string {
  return String(v ?? "").trim();
}

export function formatCountdown(msUntil: number): string {
  const total = Math.max(0, Math.floor(msUntil / 1000));
  const days = Math.floor(total / 86400);
  const hours = Math.floor((total % 86400) / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

export function formatDaysSince(msSince: number): string {
  const days = Math.max(0, Math.floor(msSince / 86400000));
  return days === 1 ? "1 day" : `${days} days`;
}

export function isRootMcTestDataPeriod(at = new Date()): boolean {
  const realStart = Date.parse(`${ROOTMC_REAL_DATA_START_HST}T10:00:00.000Z`);
  return at.getTime() < realStart;
}

export function isRootMcPublicLive(at = new Date()): boolean {
  return !isRootMcTestDataPeriod(at);
}

export function buildTestDataDisclaimer(at = new Date()): string {
  if (!isRootMcTestDataPeriod(at)) return "";
  return (
    "_**Test data notice:** All server metrics in this report are pre-release test data until **" +
    `${ROOTMC_REAL_DATA_START_HST}** (midnight HST). ` +
    "Live production intelligence begins when RootMC opens to the public._"
  );
}

export function mergeCountdownEvents(discordEvents: RootMcCountdownEvent[] = []): RootMcCountdownEvent[] {
  const milestones: RootMcCountdownEvent[] = ROOTMC_MILESTONE_EVENTS.map((e) => ({
    id: e.id,
    name: e.name,
    startMs: e.startMs,
    note: e.note,
    source: "milestone" as const,
  }));
  const seen = new Set(milestones.map((e) => e.name.toLowerCase()));
  const merged = [...milestones];
  for (const ev of discordEvents) {
    const key = ev.name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(ev);
  }
  merged.sort((a, b) => a.startMs - b.startMs);
  return merged;
}

function formatHstWhen(startMs: number): string {
  return new Date(startMs).toLocaleString("en-US", {
    timeZone: "Pacific/Honolulu",
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

/** Countdown for upcoming milestones/events; days-since for releases that have passed. */
export function buildReleaseTimelineBlock(events: RootMcCountdownEvent[], at = new Date()): string {
  const now = at.getTime();
  const lines: string[] = [];

  for (const e of events.filter((ev) => ev.source === "milestone")) {
    const when = formatHstWhen(e.startMs);
    const tail = e.note ? `  -  ${e.note}` : "";
    if (e.startMs > now) {
      lines.push(`- **${e.name}**  -  ${formatCountdown(e.startMs - now)} remaining (${when} HST)${tail}`);
    } else {
      lines.push(`- **${e.name}**  -  **${formatDaysSince(now - e.startMs)} since launch** (${when} HST)${tail}`);
    }
  }

  const upcomingDiscord = events.filter((e) => e.source === "discord" && e.startMs > now);
  for (const e of upcomingDiscord.slice(0, 4)) {
    const when = formatHstWhen(e.startMs);
    const note = e.note ? e.note.replace(/\s+/g, " ").trim() : "";
    const tail = note ? `  -  ${note.length > 72 ? `${note.slice(0, 71)}...` : note}` : "";
    lines.push(`- **${e.name}**  -  ${formatCountdown(e.startMs - now)} left (${when})${tail}`);
  }

  if (!lines.length) return "_No RootMC release milestones configured._";
  return lines.join("\n");
}

/** @deprecated use buildReleaseTimelineBlock */
export function buildCountdownBlock(events: RootMcCountdownEvent[], at = new Date()): string {
  return buildReleaseTimelineBlock(events, at);
}

export function buildReleaseTimelineContext(at = new Date()): Record<string, unknown> {
  const now = at.getTime();
  const publicLive = isRootMcPublicLive(at);
  const milestones = ROOTMC_MILESTONE_EVENTS.map((m) => ({
    id: m.id,
    name: m.name,
    note: m.note,
    start_hst: formatHstWhen(m.startMs),
    status: m.startMs > now ? "upcoming" : "released",
    ...(m.startMs > now
      ? { countdown: formatCountdown(m.startMs - now) }
      : { days_since_release: Math.floor((now - m.startMs) / 86400000) }),
  }));
  return {
    server_status: publicLive ? "public_live" : "pre_launch",
    test_data_period: !publicLive,
    public_since_hst: publicLive ? ROOTMC_PUBLIC_LAUNCH_HST : null,
    real_data_starts_hst: ROOTMC_REAL_DATA_START_HST,
    milestones,
  };
}

export function parseDiscordScheduledEvents(raw: unknown): RootMcCountdownEvent[] {
  if (!Array.isArray(raw)) return [];
  const out: RootMcCountdownEvent[] = [];
  for (const row of raw) {
    if (!row || typeof row !== "object") continue;
    const rec = row as Record<string, unknown>;
    const name = str(rec.name);
    const start = str(rec.scheduled_start_time);
    if (!name || !start) continue;
    const startMs = Date.parse(start);
    if (Number.isNaN(startMs)) continue;
    out.push({
      id: str(rec.id) || name.toLowerCase().replace(/\s+/g, "-"),
      name,
      startMs,
      note: str(rec.description) || undefined,
      source: "discord",
    });
  }
  return out;
}
