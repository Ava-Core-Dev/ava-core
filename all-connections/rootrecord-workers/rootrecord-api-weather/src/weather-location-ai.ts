import type { D1Database } from "@cloudflare/workers-types";

import { resolveUserId } from "./auth";
import { json } from "./cors";
import { loadProFlags, utcDayKey } from "./free-tier";

const DAILY_REFRESH_LIMIT = 2;
const REPORT_LIMIT = 5;

type WeatherAiEnv = {
  DB: D1Database;
  JWT_SECRET: string;
  GROK_API_BEARER_TOKEN?: string;
  GROK_API_URL?: string;
  GROK_MODEL?: string;
};

type LocationRow = {
  id: string;
  user_id: string;
  name: string;
  latitude: number;
  longitude: number;
  created_at: string;
};

type WeatherDataRow = {
  id: number;
  fetched_at: string;
  bundle_json: string;
};

type WeatherAiReportRow = {
  id: string;
  user_id: string;
  location_id: string;
  day_utc: string;
  location_name: string;
  latitude: number;
  longitude: number;
  weather_data_id: number | null;
  weather_fetched_at: string | null;
  summary_text: string;
  report_text: string;
  source_data_json: string;
  model: string | null;
  prompt_json: string;
  response_json: string;
  created_at: string;
};

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

function num(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function record(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

function recordArray(v: unknown): Array<Record<string, unknown>> {
  return Array.isArray(v) ? v.filter((x): x is Record<string, unknown> => Boolean(x && typeof x === "object" && !Array.isArray(x))) : [];
}

function truncate(s: string, max: number): string {
  const t = s.trim();
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}...` : t;
}

function publicText(raw: unknown, max: number): string {
  return truncate(
    String(raw ?? "")
      .replace(/\bGrok\b/gi, "AI")
      .replace(/\bxAI\b/g, "AI")
      .replace(/\s+/g, " ")
      .trim(),
    max,
  );
}

function jsonForArchive(v: unknown): string {
  return JSON.stringify(v, (_k, value) => (typeof value === "bigint" ? value.toString() : value));
}

function nextUtcReset(dayUtc: string): string {
  const [y, m, d] = dayUtc.split("-").map((part) => Number(part));
  if (!y || !m || !d) return new Date(Date.now() + 86400 * 1000).toISOString();
  return new Date(Date.UTC(y, m - 1, d + 1, 0, 0, 0)).toISOString();
}

function quotaPayload(used: number, dayUtc: string): Record<string, unknown> {
  const safeUsed = Math.max(0, Math.min(DAILY_REFRESH_LIMIT, Math.floor(used)));
  return {
    used_today: safeUsed,
    remaining_today: Math.max(0, DAILY_REFRESH_LIMIT - safeUsed),
    limit_per_location: DAILY_REFRESH_LIMIT,
    reset_at: nextUtcReset(dayUtc),
    day_utc: dayUtc,
  };
}

function reportPayload(row: WeatherAiReportRow): Record<string, unknown> {
  let sourceData: Record<string, unknown> = {};
  try {
    sourceData = JSON.parse(row.source_data_json || "{}") as Record<string, unknown>;
  } catch {
    sourceData = {};
  }
  return {
    id: row.id,
    location_id: row.location_id,
    location_name: row.location_name,
    latitude: row.latitude,
    longitude: row.longitude,
    weather_data_id: row.weather_data_id,
    weather_fetched_at: row.weather_fetched_at,
    summary_text: publicText(row.summary_text, 700),
    report_text: publicText(row.report_text, 1800),
    source_data: sourceData,
    created_at: row.created_at,
  };
}

async function readLocation(db: D1Database, userId: string, locationId: string): Promise<LocationRow | null> {
  const row = await db
    .prepare("SELECT id, user_id, name, latitude, longitude, created_at FROM rrwm_locations WHERE id = ? AND user_id = ? LIMIT 1")
    .bind(locationId, userId)
    .first<LocationRow>();
  return row || null;
}

async function readLatestWeatherData(db: D1Database, userId: string, locationId: string): Promise<WeatherDataRow | null> {
  const row = await db
    .prepare(
      `SELECT id, fetched_at, bundle_json
       FROM weather_data
       WHERE user_id = ? AND location_id = ?
       ORDER BY fetched_at DESC LIMIT 1`,
    )
    .bind(userId, locationId)
    .first<WeatherDataRow>();
  return row || null;
}

async function usedToday(db: D1Database, userId: string, locationId: string, dayUtc: string): Promise<number> {
  const row = await db
    .prepare(
      `SELECT COUNT(*) AS count
       FROM weather_location_ai_reports
       WHERE user_id = ? AND location_id = ? AND day_utc = ?`,
    )
    .bind(userId, locationId, dayUtc)
    .first<{ count: number }>();
  return Math.max(0, Math.floor(Number(row?.count || 0)));
}

async function latestReports(db: D1Database, userId: string, locationId: string): Promise<WeatherAiReportRow[]> {
  const { results } = await db
    .prepare(
      `SELECT *
       FROM weather_location_ai_reports
       WHERE user_id = ? AND location_id = ?
       ORDER BY created_at DESC LIMIT ?`,
    )
    .bind(userId, locationId, REPORT_LIMIT)
    .all<WeatherAiReportRow>();
  return results || [];
}

function compactSourceData(location: LocationRow, weather: WeatherDataRow, bundle: Record<string, unknown>): Record<string, unknown> {
  const current = record(bundle.current);
  const observation = record(current.observation);
  const hourlyNow = record(current.hourly_now);
  const forecast = record(bundle.forecast);
  const alerts = record(bundle.alerts);
  const canada = record(bundle.canada_alerts);
  const usgs = record(bundle.usgs);
  const periods = recordArray(forecast.periods);
  const hourly = recordArray(forecast.hourly);
  const alertRows = recordArray(alerts.alerts);
  const canadaRows = recordArray(canada.alerts);
  const quakeRows = recordArray(usgs.events);

  return {
    location: {
      id: location.id,
      name: location.name,
      latitude: Number(location.latitude),
      longitude: Number(location.longitude),
    },
    weather_data: {
      id: weather.id,
      fetched_at: weather.fetched_at,
      bundle_fetched_at: str(bundle.fetched_at),
    },
    availability: {
      current: Boolean(Object.keys(current).length),
      forecast_periods: periods.length,
      hourly_periods: hourly.length,
      alerts: alertRows.length + canadaRows.length,
      earthquakes: quakeRows.length,
      source: str(alerts.source) || str(current.source) || null,
    },
  };
}

function buildPromptContext(location: LocationRow, weather: WeatherDataRow, bundle: Record<string, unknown>): Record<string, unknown> {
  const current = record(bundle.current);
  const observation = record(current.observation);
  const hourlyNow = record(current.hourly_now);
  const forecast = record(bundle.forecast);
  const alerts = record(bundle.alerts);
  const canada = record(bundle.canada_alerts);
  const usgs = record(bundle.usgs);

  return {
    generated_at: new Date().toISOString(),
    instruction:
      "Write a concise Weather Manager AI report using only this cached app data. Include a short summary and a practical member report. Do not invent measurements, warnings, or official guidance.",
    location: {
      name: location.name,
      latitude: Number(location.latitude),
      longitude: Number(location.longitude),
    },
    cached_weather: {
      weather_data_id: weather.id,
      fetched_at: weather.fetched_at,
      current: {
        observation,
        hourly_now: hourlyNow,
      },
      forecast: {
        periods: recordArray(forecast.periods).slice(0, 10),
        hourly: recordArray(forecast.hourly).slice(0, 12),
      },
      alerts: {
        source: alerts.source || null,
        alerts: recordArray(alerts.alerts).slice(0, 6),
        canada_alerts: recordArray(canada.alerts).slice(0, 6),
      },
      hazards: {
        earthquakes: recordArray(usgs.events).slice(0, 6),
      },
    },
  };
}

function fallbackReport(ctx: Record<string, unknown>, detail: string): Record<string, unknown> {
  const location = record(ctx.location);
  const cached = record(ctx.cached_weather);
  const current = record(record(cached.current).observation);
  const hourlyNow = record(record(cached.current).hourly_now);
  const alerts = record(record(cached.alerts));
  const hazards = record(record(cached.hazards));
  const temp = num(current.temperature) ?? num(hourlyNow.temperature);
  const condition = str(hourlyNow.shortForecast) || str(current.textDescription);
  const alertCount = recordArray(alerts.alerts).length + recordArray(alerts.canada_alerts).length;
  const quakeCount = recordArray(hazards.earthquakes).length;
  const summary = [
    `Cached weather summary for ${str(location.name) || "this location"}.`,
    temp != null ? `Current temperature is about ${temp.toFixed(1)} C.` : "",
    condition ? `Conditions: ${condition}.` : "",
    alertCount ? `${alertCount} active weather alert item(s) are included in the cached data.` : "No active weather alerts are included in the cached data.",
  ].filter(Boolean).join(" ");
  const report = [
    summary,
    quakeCount ? `${quakeCount} nearby earthquake item(s) are present in the saved hazards data.` : "No nearby earthquake rows are present in the saved hazards data.",
    "Refresh the weather dashboard before generating again if you need newer source data.",
  ].join(" ");
  return {
    ok: false,
    fallback_report: true,
    detail,
    summary_text: publicText(summary, 700),
    report_text: publicText(report, 1800),
  };
}

function grokResponseText(response: Record<string, unknown>): string {
  const message = (response.choices as Array<Record<string, unknown>> | undefined)?.[0]?.message as Record<string, unknown> | undefined;
  const content = message?.content;
  if (typeof content === "string") return content.trim();
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === "string") return part;
        if (part && typeof part === "object") {
          const obj = part as Record<string, unknown>;
          return String(obj.text || obj.content || "");
        }
        return "";
      })
      .join("")
      .trim();
  }
  return "";
}

function parseAiJson(content: string): { summary_text: string; report_text: string } {
  const cleaned = content.replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  const candidate = start >= 0 && end > start ? cleaned.slice(start, end + 1) : cleaned;
  const obj = JSON.parse(candidate) as Record<string, unknown>;
  return {
    summary_text: publicText(str(obj.summary_text), 700),
    report_text: publicText(str(obj.report_text), 1800),
  };
}

async function callWeatherAi(env: WeatherAiEnv, ctx: Record<string, unknown>): Promise<Record<string, unknown>> {
  const token = String(env.GROK_API_BEARER_TOKEN || "").trim();
  const apiUrl = String(env.GROK_API_URL || "https://api.x.ai/v1/chat/completions").trim();
  const model = String(env.GROK_MODEL || "grok-3-latest").trim();
  const body = {
    model,
    messages: [
      {
        role: "system",
        content:
          "You write concise Weather Manager member reports from cached app weather data. Use only provided data. " +
          "Be clear about uncertainty and timestamps. Do not invent alerts, measurements, emergency instructions, provider names, API details, or model details. " +
          "Return JSON only: {\"summary_text\":\"short data summary, <=350 chars\",\"report_text\":\"member weather report, <=1100 chars\"}.",
      },
      { role: "user", content: jsonForArchive(ctx) },
    ],
    temperature: 0.2,
  };
  if (!token) {
    return { ...fallbackReport(ctx, "Grok API bearer token is not configured."), model, request: body };
  }
  try {
    const res = await fetch(apiUrl, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const response = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    const content = grokResponseText(response);
    if (!content) {
      return { ...fallbackReport(ctx, `AI response was empty with status ${res.status}.`), status: res.status, model, request: body, response };
    }
    try {
      const parsed = parseAiJson(content);
      return { ok: res.ok, status: res.status, model, request: body, response, content, ...parsed };
    } catch (e) {
      return {
        ...fallbackReport(ctx, `AI response was not parseable JSON: ${e instanceof Error ? e.message : String(e)}`),
        status: res.status,
        model,
        request: body,
        response,
        content,
      };
    }
  } catch (e) {
    return { ...fallbackReport(ctx, e instanceof Error ? e.message : String(e)), model, request: body };
  }
}

async function insertReport(
  env: WeatherAiEnv,
  userId: string,
  location: LocationRow,
  weather: WeatherDataRow,
  sourceData: Record<string, unknown>,
  promptContext: Record<string, unknown>,
  ai: Record<string, unknown>,
  dayUtc: string,
): Promise<WeatherAiReportRow | null> {
  const id = crypto.randomUUID();
  const createdAt = new Date().toISOString();
  await env.DB.prepare(
    `INSERT INTO weather_location_ai_reports
     (id, user_id, location_id, day_utc, location_name, latitude, longitude, weather_data_id, weather_fetched_at,
      summary_text, report_text, source_data_json, model, prompt_json, response_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      id,
      userId,
      location.id,
      dayUtc,
      location.name,
      Number(location.latitude),
      Number(location.longitude),
      weather.id,
      weather.fetched_at,
      str(ai.summary_text) || "AI summary was not available.",
      str(ai.report_text) || "AI report was not available.",
      jsonForArchive(sourceData),
      str(ai.model) || null,
      jsonForArchive(promptContext),
      jsonForArchive(ai),
      createdAt,
    )
    .run();
  const row = await env.DB.prepare("SELECT * FROM weather_location_ai_reports WHERE id = ? LIMIT 1")
    .bind(id)
    .first<WeatherAiReportRow>();
  return row || null;
}

async function responseForLocation(env: WeatherAiEnv, userId: string, location: LocationRow, dayUtc: string, status = 200): Promise<Response> {
  const used = await usedToday(env.DB, userId, location.id, dayUtc);
  const reports = await latestReports(env.DB, userId, location.id);
  return json(
    {
      location,
      reports: reports.map(reportPayload),
      quota: quotaPayload(used, dayUtc),
      pro_unlocked: true,
    },
    status,
  );
}

export async function handleWeatherLocationAi(
  request: Request,
  env: WeatherAiEnv,
  subpath: string,
  method: string,
): Promise<Response | null> {
  if (subpath !== "/weather/location-ai") return null;

  const user = await resolveUserId(request, env);
  if (user instanceof Response) return user;
  const { pro } = await loadProFlags(env.DB, user);
  if (!pro) {
    return json(
      {
        detail: "pro_required",
        message: "Weather AI reports require Pro or Lifetime membership.",
      },
      403,
    );
  }

  const dayUtc = utcDayKey();
  let locationId = "";
  if (method === "GET") {
    locationId = new URL(request.url).searchParams.get("location_id") || "";
  } else if (method === "POST") {
    let body: { location_id?: string };
    try {
      body = (await request.json()) as typeof body;
    } catch {
      return json({ detail: "Invalid JSON" }, 400);
    }
    locationId = body.location_id || "";
  } else {
    return null;
  }

  locationId = locationId.trim().slice(0, 128);
  if (!locationId) return json({ detail: "location_id is required." }, 400);

  const location = await readLocation(env.DB, user, locationId);
  if (!location) return json({ detail: "Location not found." }, 404);

  if (method === "GET") {
    return responseForLocation(env, user, location, dayUtc);
  }

  const used = await usedToday(env.DB, user, location.id, dayUtc);
  if (used >= DAILY_REFRESH_LIMIT) {
    return responseForLocation(env, user, location, dayUtc, 429);
  }

  const weather = await readLatestWeatherData(env.DB, user, location.id);
  if (!weather?.bundle_json) {
    return json(
      {
        detail: "weather_data_required",
        message: "Refresh weather for this saved location before generating an AI report.",
        location,
        quota: quotaPayload(used, dayUtc),
      },
      409,
    );
  }

  let bundle: Record<string, unknown>;
  try {
    bundle = JSON.parse(weather.bundle_json) as Record<string, unknown>;
  } catch {
    return json({ detail: "Cached weather data is not readable. Refresh weather for this location and try again." }, 409);
  }

  const sourceData = compactSourceData(location, weather, bundle);
  const promptContext = buildPromptContext(location, weather, bundle);
  const ai = await callWeatherAi(env, promptContext);
  const row = await insertReport(env, user, location, weather, sourceData, promptContext, ai, dayUtc);
  if (!row) return json({ detail: "Could not save AI report." }, 500);

  const nextUsed = await usedToday(env.DB, user, location.id, dayUtc);
  return json(
    {
      location,
      report: reportPayload(row),
      reports: [reportPayload(row), ...(await latestReports(env.DB, user, location.id)).filter((r) => r.id !== row.id).map(reportPayload)],
      quota: quotaPayload(nextUsed, dayUtc),
      pro_unlocked: true,
    },
    200,
  );
}
