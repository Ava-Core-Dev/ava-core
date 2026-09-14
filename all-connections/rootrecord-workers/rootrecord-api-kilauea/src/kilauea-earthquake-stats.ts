/** Hawaiʻi-region USGS earthquake windows for Kīlauea hazard reports. */

/** Minimum magnitude used for public brief event counts (USGS catalog). */
export const KILAUEA_EQ_COUNT_MIN_MAG = 1.0;

export const HAWAII_EQ_BBOX = {
  minlatitude: 18.8,
  maxlatitude: 22.6,
  minlongitude: -161.0,
  maxlongitude: -154.5,
};

const USGS_EQ_USER_AGENT = "RootRecordKilauea/1.0 (root@rootrecord.info)";
const HST_UTC_OFFSET_MS = 10 * 3600 * 1000;
/** Rolling windows only consider events within this many days — avoids stale years in "recent". */
const RECENT_ROLLING_MAX_DAYS = 35;

export type EqEvent = {
  id: string;
  magnitude: number | null;
  place: string;
  time_ms: number;
  time_iso: string;
  url: string;
  tsunami: boolean;
  depth_km: number | null;
  lat: number | null;
  lon: number | null;
};

export type EqWindowStats = {
  label: string;
  count: number;
  largest: { magnitude: number; place: string; time_iso: string } | null;
  unavailable?: boolean;
};

export type ActivityChangeWindow = {
  current: number;
  prior: number;
  pct: number | null;
  label: string;
};

export type EarthquakeActivitySummary = {
  ok: boolean;
  min_magnitude: number;
  count_description: string;
  fetched_count: number;
  windows: {
    since_last_report: EqWindowStats;
    last_hour: EqWindowStats;
    last_12_hours: EqWindowStats;
    last_24_hours: EqWindowStats;
    last_7_days: EqWindowStats;
    last_month: EqWindowStats;
    this_year: EqWindowStats;
    last_year: EqWindowStats;
  };
  activity_change: {
    last_24h_vs_prior_24h: ActivityChangeWindow;
    last_7d_vs_prior_7d: ActivityChangeWindow;
    since_last_report_vs_prior_period?: ActivityChangeWindow;
  };
  error?: string;
};

function truncate(raw: string, max: number): string {
  const s = raw.replace(/\s+/g, " ").trim();
  return s.length > max ? `${s.slice(0, Math.max(0, max - 1))}…` : s;
}

function isoFromMs(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return "";
  return new Date(ms).toISOString().replace("T", " ").replace(/\.\d{3}Z$/, " UTC");
}

function parseTimeMs(raw: unknown): number {
  if (typeof raw === "number" && Number.isFinite(raw)) {
    // USGS uses epoch ms; values below ~1e12 are epoch seconds.
    if (raw > 0 && raw < 1e12) return raw * 1000;
    return raw;
  }
  const parsed = Date.parse(String(raw ?? ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function hstDateLabel(timeMs: number): string {
  if (!timeMs) return "";
  const d = new Date(timeMs - HST_UTC_OFFSET_MS);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day} HST`;
}

function sinceLastReportLabel(sinceLastMs: number, now: number): string {
  const hours = Math.max(1, Math.round((now - sinceLastMs) / 3600000));
  if (hours < 48) return `Since last report (${hours}h ago)`;
  const days = Math.max(1, Math.round((now - sinceLastMs) / 86400000));
  return `Since last report (${days}d ago)`;
}

function isPlausibleEventTime(timeMs: number, now: number): boolean {
  return timeMs > 0 && timeMs <= now + 5 * 60 * 1000 && timeMs >= now - 400 * 86400000;
}

function hstCalendarYear(nowMs = Date.now()): number {
  return new Date(nowMs - HST_UTC_OFFSET_MS).getUTCFullYear();
}

function hstYearStartMs(year: number): number {
  return Date.UTC(year, 0, 1, 10, 0, 0, 0);
}

function hstYearEndMs(year: number): number {
  return Date.UTC(year + 1, 0, 1, 10, 0, 0, 0) - 1;
}

function pctChange(current: number, prior: number): number | null {
  if (prior === 0) return current === 0 ? 0 : null;
  return Math.round(((current - prior) / prior) * 100);
}

function formatPct(pct: number | null, current: number, prior: number): string {
  if (prior === 0 && current > 0) return "new activity vs quiet prior period";
  if (pct === null) return "unchanged";
  if (pct === 0) return "unchanged";
  return `${pct > 0 ? "+" : ""}${pct}%`;
}

function windowStats(events: EqEvent[], fromMs: number, toMs: number): Pick<EqWindowStats, "count" | "largest"> {
  const filtered = events.filter((e) => e.time_ms >= fromMs && e.time_ms <= toMs);
  let largest: EqWindowStats["largest"] = null;
  for (const e of filtered) {
    const mag = e.magnitude;
    if (mag == null || !Number.isFinite(mag)) continue;
    if (!largest || mag > largest.magnitude) {
      largest = { magnitude: mag, place: e.place || "Hawaiʻi region", time_iso: e.time_iso };
    }
  }
  return { count: filtered.length, largest };
}

export function normalizeEarthquakeRecord(raw: Record<string, unknown>): EqEvent | null {
  const time_ms = parseTimeMs(raw.time_ms ?? raw.time ?? raw.time_iso);
  if (!time_ms) return null;
  const magRaw = raw.magnitude ?? raw.mag;
  const magnitude = magRaw == null || magRaw === "" ? null : Number(magRaw);
  return {
    id: String(raw.id || ""),
    magnitude: Number.isFinite(magnitude) ? magnitude : null,
    place: String(raw.place || raw.title || "Hawaiʻi region").trim(),
    time_ms,
    time_iso: String(raw.time_iso || isoFromMs(time_ms)),
    url: String(raw.url || ""),
    tsunami: Boolean(raw.tsunami),
    depth_km: raw.depth_km == null ? null : Number(raw.depth_km),
    lat: raw.lat == null ? null : Number(raw.lat),
    lon: raw.lon == null ? null : Number(raw.lon),
  };
}

export function normalizeEarthquakeRecords(raw: unknown): EqEvent[] {
  const rows = Array.isArray(raw) ? raw : [];
  const out: EqEvent[] = [];
  for (const row of rows) {
    if (!row || typeof row !== "object" || Array.isArray(row)) continue;
    const event = normalizeEarthquakeRecord(row as Record<string, unknown>);
    if (event) out.push(event);
  }
  out.sort((a, b) => b.time_ms - a.time_ms);
  return out;
}

export function mapUsgsFeatureToEvent(f: Record<string, unknown>): EqEvent | null {
  const p = (f.properties as Record<string, unknown> | undefined) || {};
  const coords = ((f.geometry as Record<string, unknown> | undefined)?.coordinates as unknown[]) || [];
  const time_ms = parseTimeMs(p.time);
  if (!time_ms || !isPlausibleEventTime(time_ms, Date.now())) return null;
  const mag = p.mag == null ? null : Number(p.mag);
  return {
    id: String(f.id || ""),
    magnitude: Number.isFinite(mag) ? mag : null,
    place: String(p.place || "Hawaiʻi region").trim(),
    time_ms,
    time_iso: isoFromMs(time_ms),
    url: String(p.url || ""),
    tsunami: Boolean(p.tsunami),
    depth_km: coords.length > 2 ? Number(coords[2]) : null,
    lat: coords.length > 1 ? Number(coords[1]) : null,
    lon: coords.length > 0 ? Number(coords[0]) : null,
  };
}

export function eventsToLegacyRecords(events: EqEvent[]): Array<Record<string, unknown>> {
  return events.map((e) => ({
    id: e.id,
    magnitude: e.magnitude,
    place: e.place,
    time: e.time_ms,
    time_iso: e.time_iso,
    url: e.url,
    tsunami: e.tsunami,
    depth_km: e.depth_km,
    lat: e.lat,
    lon: e.lon,
  }));
}

function earthquakeCountDescription(minMag: number): string {
  const magLabel = Number.isInteger(minMag) ? `M${minMag}` : `M${minMag.toFixed(1)}`;
  return `_Counts: ${magLabel}+ USGS events in the Hawaiʻi region (18.8°–22.6°N, 154.5°–161°W). Recent windows are rolling; calendar totals use HST year boundaries._`;
}

export function computeEarthquakeActivity(
  events: EqEvent[],
  opts: { sinceLastReportIso?: string | null; nowMs?: number; minMag?: number },
): EarthquakeActivitySummary {
  const now = opts.nowMs ?? Date.now();
  const minMag = opts.minMag ?? KILAUEA_EQ_COUNT_MIN_MAG;
  const quakes = events.filter(
    (e) => (e.magnitude == null || e.magnitude >= minMag) && isPlausibleEventTime(e.time_ms, now),
  );
  const recentQuakes = quakes.filter((e) => e.time_ms >= now - RECENT_ROLLING_MAX_DAYS * 86400000);

  const msAgo = (hours: number) => now - hours * 3600 * 1000;
  const daysAgo = (days: number) => now - days * 86400 * 1000;
  const year = hstCalendarYear(now);
  const thisYearStart = hstYearStartMs(year);
  const lastYearStart = hstYearStartMs(year - 1);
  const lastYearEnd = hstYearEndMs(year - 1);

  const sinceLastMs = opts.sinceLastReportIso ? parseTimeMs(opts.sinceLastReportIso) : 0;
  const sinceLastValid = sinceLastMs > 0 && sinceLastMs < now;

  const labeled = (label: string, pool: EqEvent[], fromMs: number, toMs = now): EqWindowStats => ({
    label,
    ...windowStats(pool, fromMs, toMs),
  });

  const windows: EarthquakeActivitySummary["windows"] = {
    since_last_report: sinceLastValid
      ? labeled(sinceLastReportLabel(sinceLastMs, now), recentQuakes, sinceLastMs)
      : { label: "Since last report", count: 0, largest: null, unavailable: true },
    last_hour: labeled("Last hour", recentQuakes, msAgo(1)),
    last_12_hours: labeled("Last 12 hours", recentQuakes, msAgo(12)),
    last_24_hours: labeled("Last 24 hours", recentQuakes, msAgo(24)),
    last_7_days: labeled("Last 7 days", recentQuakes, daysAgo(7)),
    last_month: labeled("Last 30 days", recentQuakes, daysAgo(30)),
    this_year: labeled(`${year} year-to-date (HST)`, quakes, thisYearStart),
    last_year: { label: `${year - 1} calendar year (HST)`, ...windowStats(quakes, lastYearStart, lastYearEnd) },
  };

  const last24 = windows.last_24_hours.count;
  const prior24 = windowStats(recentQuakes, msAgo(48), msAgo(24)).count;
  const last7 = windows.last_7_days.count;
  const prior7 = windowStats(recentQuakes, daysAgo(14), daysAgo(7)).count;

  let sinceLastChange: ActivityChangeWindow | undefined;
  if (sinceLastValid) {
    const duration = now - sinceLastMs;
    const sinceCount = windows.since_last_report.count;
    const priorCount = windowStats(recentQuakes, sinceLastMs - duration, sinceLastMs).count;
    sinceLastChange = {
      current: sinceCount,
      prior: priorCount,
      pct: pctChange(sinceCount, priorCount),
      label: "since last report vs equal prior period",
    };
  }

  return {
    ok: true,
    min_magnitude: minMag,
    count_description: earthquakeCountDescription(minMag),
    fetched_count: quakes.length,
    windows,
    activity_change: {
      last_24h_vs_prior_24h: {
        current: last24,
        prior: prior24,
        pct: pctChange(last24, prior24),
        label: "24h vs prior 24h",
      },
      last_7d_vs_prior_7d: {
        current: last7,
        prior: prior7,
        pct: pctChange(last7, prior7),
        label: "7d vs prior 7d",
      },
      ...(sinceLastChange ? { since_last_report_vs_prior_period: sinceLastChange } : {}),
    },
  };
}

export function formatWindowLine(w: EqWindowStats): string {
  if (w.unavailable) return `${w.label}: n/a (no prior report)`;
  const base = `${w.label}: ${w.count}`;
  if (w.largest) {
    const when = hstDateLabel(parseTimeMs(w.largest.time_iso));
    const whenText = when ? ` on ${when}` : "";
    return `${base} — largest M${w.largest.magnitude.toFixed(1)}${whenText} near ${truncate(w.largest.place, 60)}`;
  }
  return base;
}

function formatEarthquakeCountDescription(summary: EarthquakeActivitySummary): string {
  return summary.count_description || earthquakeCountDescription(summary.min_magnitude);
}

export function formatEarthquakeActivitySection(summary: EarthquakeActivitySummary | undefined): string {
  if (!summary || !summary.ok) return "**Seismic activity:** Unavailable this pull.";
  const recentLines = [
    "**Seismic activity — recent**",
    formatEarthquakeCountDescription(summary),
    `• ${formatWindowLine(summary.windows.since_last_report)}`,
    `• ${formatWindowLine(summary.windows.last_hour)}`,
    `• ${formatWindowLine(summary.windows.last_12_hours)}`,
    `• ${formatWindowLine(summary.windows.last_24_hours)}`,
    `• ${formatWindowLine(summary.windows.last_7_days)}`,
    `• ${formatWindowLine(summary.windows.last_month)}`,
  ];
  const ch = summary.activity_change;
  const changeParts = [
    ch.since_last_report_vs_prior_period
      ? `since last report ${formatPct(ch.since_last_report_vs_prior_period.pct, ch.since_last_report_vs_prior_period.current, ch.since_last_report_vs_prior_period.prior)} (${ch.since_last_report_vs_prior_period.current} vs ${ch.since_last_report_vs_prior_period.prior})`
      : "",
    `24h ${formatPct(ch.last_24h_vs_prior_24h.pct, ch.last_24h_vs_prior_24h.current, ch.last_24h_vs_prior_24h.prior)} (${ch.last_24h_vs_prior_24h.current} vs ${ch.last_24h_vs_prior_24h.prior} prior day)`,
    `7d ${formatPct(ch.last_7d_vs_prior_7d.pct, ch.last_7d_vs_prior_7d.current, ch.last_7d_vs_prior_7d.prior)} (${ch.last_7d_vs_prior_7d.current} vs ${ch.last_7d_vs_prior_7d.prior} prior week)`,
  ].filter(Boolean);
  recentLines.push(`• **Activity change (rolling):** ${changeParts.join("; ")}.`);

  const annualLines = [
    "**Seismic totals — calendar**",
    `• ${formatWindowLine(summary.windows.this_year)}`,
    `• ${formatWindowLine(summary.windows.last_year)}`,
  ];

  return [...recentLines, "", ...annualLines].join("\n");
}

export function attachEarthquakeActivity(
  context: Record<string, unknown>,
  sinceLastReportIso?: string | null,
  minMag = KILAUEA_EQ_COUNT_MIN_MAG,
): EarthquakeActivitySummary {
  const events = normalizeEarthquakeRecords(context.hawaii_earthquakes);
  const summary = computeEarthquakeActivity(events, { sinceLastReportIso, minMag });
  context.earthquake_activity = summary;
  return summary;
}

export function peakMagnitude(summary: EarthquakeActivitySummary | undefined, ...keys: Array<keyof EarthquakeActivitySummary["windows"]>): number {
  if (!summary?.ok) return 0;
  let peak = 0;
  for (const key of keys) {
    const mag = summary.windows[key]?.largest?.magnitude;
    if (mag != null && mag > peak) peak = mag;
  }
  return peak;
}

export async function fetchHawaiiEarthquakeEvents(
  minMag: number,
  lookbackDays = 400,
  limit?: number,
): Promise<{ ok: boolean; events: EqEvent[]; url: string; error?: string }> {
  const now = Date.now();
  const year = hstCalendarYear(now);
  const calendarStart = hstYearStartMs(year - 1);
  const rollingStart = now - lookbackDays * 86400000;
  const startMs = lookbackDays < 365 ? rollingStart : calendarStart;
  const eventLimit =
    limit ?? (lookbackDays < 365 ? 6000 : minMag <= KILAUEA_EQ_COUNT_MIN_MAG ? 20000 : 3000);
  const u = new URL("https://earthquake.usgs.gov/fdsnws/event/1/query");
  u.searchParams.set("format", "geojson");
  u.searchParams.set("orderby", "time");
  u.searchParams.set("limit", String(eventLimit));
  u.searchParams.set("minmagnitude", String(minMag));
  u.searchParams.set("starttime", new Date(startMs).toISOString());
  u.searchParams.set("endtime", new Date(now).toISOString());
  for (const [k, v] of Object.entries(HAWAII_EQ_BBOX)) u.searchParams.set(k, String(v));

  try {
    const res = await fetch(u.toString(), { headers: { "User-Agent": USGS_EQ_USER_AGENT } });
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    const features = Array.isArray(data.features) ? (data.features as Array<Record<string, unknown>>) : [];
    const events: EqEvent[] = [];
    for (const f of features) {
      const event = mapUsgsFeatureToEvent(f);
      if (event) events.push(event);
    }
    events.sort((a, b) => b.time_ms - a.time_ms);
    return { ok: res.ok, events, url: u.toString(), error: res.ok ? undefined : `HTTP ${res.status}` };
  } catch (e) {
    return {
      ok: false,
      events: [],
      url: u.toString(),
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

/** Last N days of events for AI context and triggers — not multi-year history. */
export function recentEarthquakeRecords(
  events: EqEvent[],
  days = RECENT_ROLLING_MAX_DAYS,
  limit = 30,
): Array<Record<string, unknown>> {
  const now = Date.now();
  const cutoff = now - days * 86400000;
  return eventsToLegacyRecords(
    events.filter((e) => e.time_ms >= cutoff && e.time_ms <= now + 5 * 60 * 1000).slice(0, limit),
  );
}

/** Drop bulk historical earthquake rows from Grok context; keep structured stats. */
export function slimEarthquakeContextForAi(context: Record<string, unknown>): Record<string, unknown> {
  const events = normalizeEarthquakeRecords(context.hawaii_earthquakes);
  const { hawaii_earthquakes: _drop, ...rest } = context;
  return {
    ...rest,
    hawaii_earthquakes_recent: recentEarthquakeRecords(events),
    hawaii_earthquakes_fetched: events.length,
  };
}
