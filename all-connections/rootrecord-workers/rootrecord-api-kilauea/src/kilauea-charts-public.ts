import type { D1Database } from "@cloudflare/workers-types";

import { json } from "./cors";
import {
  computeEarthquakeActivity,
  fetchHawaiiEarthquakeEvents,
  KILAUEA_EQ_COUNT_MIN_MAG,
  type EqEvent,
} from "./kilauea-earthquake-stats";

type ChartsEnv = { DB: D1Database };

const HST_UTC_OFFSET_MS = 10 * 3600 * 1000;
const REPORTS_PAGE_SIZE = 10;
const REPORTS_PAGE_SIZE_MAX = 10;

function hstDayKey(timeMs: number): string {
  const d = new Date(timeMs - HST_UTC_OFFSET_MS);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function publicSummary(raw: unknown, max = 320): string {
  const s = String(raw ?? "")
    .replace(/\bGrok\b/gi, "AI")
    .replace(/\bxAI\b/g, "AI")
    .replace(/\s+/g, " ")
    .trim();
  return s.length > max ? `${s.slice(0, max - 1).trim()}…` : s;
}

/** Full brief text for web — preserve paragraph breaks; only cap total length. */
function publicReportBody(raw: unknown, max: number): string {
  const s = String(raw ?? "")
    .replace(/\bGrok\b/gi, "AI")
    .replace(/\bxAI\b/g, "AI")
    .replace(/\bAva Ivy\b/gi, "")
    .replace(/\bAva\b/g, "")
    .replace(/\bOptiPlex\b/gi, "")
    .replace(/\bRoot Server\b/gi, "")
    .replace(/\bMariaDB\b/gi, "")
    .replace(/\bCursor\b/g, "")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\r\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (s.length <= max) return s;
  const slice = s.slice(0, max - 1);
  const lastBreak = Math.max(slice.lastIndexOf("\n\n"), slice.lastIndexOf("\n"));
  const trimmed = (lastBreak > max * 0.5 ? slice.slice(0, lastBreak) : slice).trimEnd();
  return `${trimmed}…`;
}

function magnitudeBins(events: EqEvent[]): Array<{ label: string; count: number }> {
  const edges = [
    { label: "M1.0–1.9", min: 1, max: 2 },
    { label: "M2.0–2.9", min: 2, max: 3 },
    { label: "M3.0–3.9", min: 3, max: 4 },
    { label: "M4.0–4.9", min: 4, max: 5 },
    { label: "M5.0+", min: 5, max: 99 },
  ];
  return edges.map(({ label, min, max }) => ({
    label,
    count: events.filter((e) => {
      const m = e.magnitude;
      return m != null && m >= min && (max >= 99 ? true : m < max);
    }).length,
  }));
}

function dailyCounts(events: EqEvent[], days: number, nowMs = Date.now()): Array<{ date: string; count: number; max_magnitude: number | null }> {
  const startMs = nowMs - days * 86400000;
  const byDay = new Map<string, { count: number; max: number | null }>();
  for (let i = 0; i < days; i++) {
    const key = hstDayKey(nowMs - i * 86400000);
    byDay.set(key, { count: 0, max: null });
  }
  for (const e of events) {
    if (e.time_ms < startMs || e.time_ms > nowMs) continue;
    const key = hstDayKey(e.time_ms);
    const row = byDay.get(key);
    if (!row) continue;
    row.count += 1;
    const mag = e.magnitude;
    if (mag != null && (row.max == null || mag > row.max)) row.max = mag;
  }
  return [...byDay.entries()]
    .map(([date, v]) => ({ date, count: v.count, max_magnitude: v.max }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

function chartEvents(events: EqEvent[], days: number, nowMs = Date.now()): Array<Record<string, unknown>> {
  const startMs = nowMs - days * 86400000;
  return events
    .filter((e) => e.time_ms >= startMs && e.time_ms <= nowMs && e.magnitude != null)
    .sort((a, b) => a.time_ms - b.time_ms)
    .map((e) => ({
      time_ms: e.time_ms,
      time_iso: e.time_iso,
      date_hst: hstDayKey(e.time_ms),
      magnitude: e.magnitude,
      place: e.place,
      url: e.url || null,
    }));
}

export async function handleBigIslandEarthquakesChartGet(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const days = Math.min(90, Math.max(7, Math.floor(Number(url.searchParams.get("days") || "30"))));
  const minMag = KILAUEA_EQ_COUNT_MIN_MAG;
  const lookbackDays = Math.max(days + 35, 90);
  const fetched = await fetchHawaiiEarthquakeEvents(minMag, lookbackDays, 6000);
  if (!fetched.ok) {
    return json({ ok: false, detail: fetched.error || "USGS earthquake feed unavailable." }, 502);
  }
  const events = fetched.events;
  const nowMs = Date.now();
  const windowEvents = events.filter((e) => e.time_ms >= nowMs - days * 86400000);
  const activity = computeEarthquakeActivity(events, { minMag, nowMs });

  return json(
    {
      ok: true,
      min_magnitude: minMag,
      days,
      count_description: activity.count_description,
      generated_at: new Date(nowMs).toISOString(),
      totals: {
        in_window: windowEvents.length,
        fetched: events.length,
      },
      activity: {
        windows: activity.windows,
        activity_change: activity.activity_change,
      },
      daily_counts: dailyCounts(events, days, nowMs),
      magnitude_bins: magnitudeBins(windowEvents),
      events: chartEvents(events, days, nowMs),
    },
    200,
    { "Cache-Control": "public, max-age=300" },
  );
}

type ReportRow = {
  id: string;
  source_type: string;
  source_id: string;
  source_time: string | null;
  severity: string | null;
  event: string | null;
  magnitude: number | null;
  headline: string | null;
  url: string | null;
  free_text: string;
  pro_text: string;
  created_at: string;
  discord_posted_at: string | null;
};

export async function handleKilaueaAiReportsPublicGet(request: Request, env: ChartsEnv): Promise<Response> {
  const url = new URL(request.url);
  const page = Math.max(1, Math.floor(Number(url.searchParams.get("page") || "1")));
  const limit = Math.min(REPORTS_PAGE_SIZE_MAX, Math.max(1, Math.floor(Number(url.searchParams.get("limit") || String(REPORTS_PAGE_SIZE)))));
  const skipLatest = url.searchParams.get("skip_latest") === "1";
  const explicitOffset = url.searchParams.get("offset");
  const offset =
    explicitOffset != null && explicitOffset !== ""
      ? Math.max(0, Math.floor(Number(explicitOffset)))
      : skipLatest
        ? 1 + (page - 1) * limit
        : (page - 1) * limit;
  const full = url.searchParams.get("full") === "1" || (limit === 1 && offset === 0);

  const totalRow = await env.DB.prepare(`SELECT COUNT(*) AS total FROM kilauea_ai_analyses`)
    .first<{ total: number }>()
    .catch(() => null);
  const total = Number(totalRow?.total || 0);
  const listTotal = skipLatest ? Math.max(0, total - 1) : total;
  const totalPages = listTotal > 0 ? Math.ceil(listTotal / limit) : 1;

  const { results } = await env.DB.prepare(
    `SELECT id, source_type, source_id, source_time, severity, event, magnitude, headline, url,
            free_text, pro_text, created_at, discord_posted_at
     FROM kilauea_ai_analyses
     ORDER BY created_at DESC
     LIMIT ? OFFSET ?`,
  )
    .bind(limit, offset)
    .all<ReportRow>();

  const reports = (results || []).map((r) => {
    const combined = [r.free_text, r.pro_text].filter(Boolean).join("\n\n").trim();
    const summary = publicSummary(combined || r.headline || r.event || "", full ? 800 : 480);
    return {
      id: r.id,
      created_at: r.created_at,
      source_type: r.source_type,
      event: r.event,
      magnitude: r.magnitude,
      headline: r.headline,
      url: r.url,
      summary,
      body: publicReportBody(combined, full ? 12000 : 8000),
      discord_posted_at: r.discord_posted_at,
    };
  });

  return json(
    {
      ok: true,
      page,
      limit,
      offset,
      skip_latest: skipLatest,
      total,
      list_total: listTotal,
      total_pages: totalPages,
      has_prev: page > 1,
      has_next: page < totalPages,
      reports,
    },
    200,
    { "Cache-Control": "public, max-age=60" },
  );
}