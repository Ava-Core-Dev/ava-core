import type { D1Database } from "@cloudflare/workers-types";
import { NWS_USER_AGENT } from "./cors";
import { bumpUsageMetric } from "./usage";
import { fetchOpenMeteoCurrent, type OpenMeteoBackfill } from "./open-meteo";
import {
  FREE_DAILY_FRESH_FETCH_CAP,
  bumpFreeFreshFetch,
  freeFreshFetchesToday,
  loadProFlags,
  staleAnyAgeBundle,
  utcDayKey,
} from "./free-tier";

const ACCU_BASE = "https://dataservice.accuweather.com";

/**
 * Merge an Open-Meteo backfill into an NWS observation + hourly_now.
 * Only fills fields the primary source left null/undefined — never overwrites NWS data.
 * Returns a list of field names actually backfilled so the caller can mark provenance.
 */
function mergeOpenMeteoBackfill(
  observation: Record<string, unknown>,
  hourlyNow: Record<string, unknown>,
  om: OpenMeteoBackfill,
): string[] {
  const filled: string[] = [];
  const isEmpty = (v: unknown): boolean => {
    if (v === null || v === undefined) return true;
    if (typeof v === "object" && v !== null && !Array.isArray(v)) {
      const o = v as Record<string, unknown>;
      if ("value" in o && (o.value === null || o.value === undefined)) return true;
    }
    return false;
  };
  for (const [k, v] of Object.entries(om.observation)) {
    if (v !== null && v !== undefined && isEmpty(observation[k])) {
      observation[k] = v;
      filled.push(k);
    }
  }
  for (const [k, v] of Object.entries(om.hourly_now)) {
    if (v !== null && v !== undefined && isEmpty(hourlyNow[k])) {
      hourlyNow[k] = v;
    }
  }
  return filled;
}

async function nwsFetch(url: string): Promise<Record<string, unknown>> {
  const r = await fetch(url, {
    headers: { "User-Agent": NWS_USER_AGENT, Accept: "application/geo+json" },
  });
  if (!r.ok) throw new Error(`NWS ${r.status}`);
  return (await r.json()) as Record<string, unknown>;
}

function haversineMiles(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const r = 3958.7613;
  const p1 = (aLat * Math.PI) / 180;
  const p2 = (bLat * Math.PI) / 180;
  const dphi = ((bLat - aLat) * Math.PI) / 180;
  const dlmb = ((bLon - aLon) * Math.PI) / 180;
  const h = Math.sin(dphi / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dlmb / 2) ** 2;
  return 2 * r * Math.asin(Math.sqrt(h));
}

function nwsQuantValue(node: unknown): number | null {
  if (node == null) return null;
  if (typeof node === "number") {
    if (!Number.isFinite(node)) return null;
    return node;
  }
  if (typeof node === "object" && node !== null && "value" in node) {
    const v = (node as { value: unknown }).value;
    if (v == null) return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/** Accu nested `Metric` / `Imperial` `.Value` (Pascal) or `.value` (camel); `null` must not become 0 via `Number(null)`. */
function accuDualScalar(metricOrImperial: unknown): number | null {
  if (metricOrImperial == null || typeof metricOrImperial !== "object") return null;
  const o = metricOrImperial as Record<string, unknown>;
  const raw = o.Value ?? o.value;
  if (raw == null || raw === "") return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

/** Prefer PascalCase Accu JSON keys, then camelCase (dataservice is usually PascalCase). */
function accuProp(cc: Record<string, unknown>, pascal: string): unknown {
  const v = cc[pascal];
  if (v !== undefined && v !== null) return v;
  const camel = pascal.charAt(0).toLowerCase() + pascal.slice(1);
  return cc[camel];
}

/** AccuWeather dual-unit temperature: Metric °C, else Imperial °F → °C. */
function accuTempMetricC(dual: unknown): number | null {
  const o = dual as Record<string, unknown> | null | undefined;
  if (!o || typeof o !== "object") return null;
  const flat = o.Value ?? o.value;
  if (
    (typeof flat === "number" || typeof flat === "string") &&
    !("Metric" in o) &&
    !("Imperial" in o)
  ) {
    const v = Number(flat);
    if (!Number.isFinite(v)) return null;
    const unit = String(o.Unit ?? o.unit ?? "").toUpperCase();
    if (unit === "F" || unit.endsWith("F")) return ((v - 32) * 5) / 9;
    return v;
  }
  const m = accuDualScalar(o.Metric);
  if (m != null) return m;
  const f = accuDualScalar(o.Imperial);
  if (f == null) return null;
  return ((f - 32) * 5) / 9;
}

/** AccuWeather dual-unit speed: Metric km/h, else Imperial mph → km/h. */
function accuSpeedMetricKmh(dual: unknown): number | null {
  const o = dual as Record<string, unknown> | null | undefined;
  if (!o || typeof o !== "object") return null;
  const m = accuDualScalar(o.Metric);
  if (m != null) return m;
  const mph = accuDualScalar(o.Imperial);
  if (mph == null) return null;
  return mph * 1.60934;
}

/** AccuWeather dual-unit small length: Metric mm, else Imperial in → mm. */
function accuLengthMetricMm(dual: unknown): number | null {
  const o = dual as Record<string, unknown> | null | undefined;
  if (!o || typeof o !== "object") return null;
  const m = accuDualScalar(o.Metric);
  if (m != null) return m;
  const inch = accuDualScalar(o.Imperial);
  if (inch == null) return null;
  return inch * 25.4;
}

/** AccuWeather dual-unit visibility: Metric km, else Imperial mi → km. */
function accuVisibilityMetricKm(dual: unknown): number | null {
  const o = dual as Record<string, unknown> | null | undefined;
  if (!o || typeof o !== "object") return null;
  const m = accuDualScalar(o.Metric);
  if (m != null) return m;
  const mi = accuDualScalar(o.Imperial);
  if (mi == null) return null;
  return mi * 1.60934;
}

/** AccuWeather pressure: Metric mb, else Imperial inHg → mb. */
function accuPressureMetricMb(dual: unknown): number | null {
  const o = dual as Record<string, unknown> | null | undefined;
  if (!o || typeof o !== "object") return null;
  const m = accuDualScalar(o.Metric);
  if (m != null) return m;
  const inHg = accuDualScalar(o.Imperial);
  if (inHg == null) return null;
  return inHg * 33.8639;
}

/** Ceiling height: Metric m, else Imperial ft → m. */
function accuCeilingMetricM(dual: unknown): number | null {
  const o = dual as Record<string, unknown> | null | undefined;
  if (!o || typeof o !== "object") return null;
  const m = accuDualScalar(o.Metric);
  if (m != null) return m;
  const ft = accuDualScalar(o.Imperial);
  if (ft == null) return null;
  return ft * 0.3048;
}

/** Stull (2011) wet-bulb °C from air T °C and RH % — when Accu omits `WetBulbTemperature`. */
function wetBulbFromRhApprox(tempC: number, rhPct: number): number | null {
  if (!Number.isFinite(tempC) || !Number.isFinite(rhPct)) return null;
  const RH = Math.max(0, Math.min(100, rhPct));
  const T = tempC;
  const tw =
    T * Math.atan(0.151977 * Math.sqrt(RH + 8.313659)) +
    Math.atan(T + RH) -
    Math.atan(RH - 1.676331) +
    0.00391838 * RH ** 1.5 * Math.atan(0.023101 * RH) -
    4.686035;
  return Number.isFinite(tw) ? tw : null;
}

function accuCloudCoverPercent(raw: unknown): number | null {
  if (raw == null) return null;
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  if (typeof raw === "string" && String(raw).trim()) {
    const n = Number(String(raw).trim());
    return Number.isFinite(n) ? n : null;
  }
  if (typeof raw === "object" && raw !== null) {
    const o = raw as Record<string, unknown>;
    if ("Metric" in o || "Imperial" in o) {
      const m = accuDualScalar(o.Metric);
      if (m != null) return m;
      const im = accuDualScalar(o.Imperial);
      return im != null && Number.isFinite(im) ? im : null;
    }
    const v = o.Value ?? o.value;
    if (v == null || v === "") return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/** Accu `RelativeHumidity` as 0–100 % (number, percent string, or rare nested Value). */
function accuRelativeHumidityPct(raw: unknown): number | null {
  if (raw == null) return null;
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  if (typeof raw === "string") {
    const m = String(raw).trim().match(/(\d+(?:\.\d+)?)/);
    if (!m) return null;
    const n = Number(m[1]);
    return Number.isFinite(n) ? n : null;
  }
  if (typeof raw === "object" && raw !== null) {
    const o = raw as Record<string, unknown>;
    const v = o.Value ?? o.value;
    if (v == null || v === "") return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function accuUvIndex(raw: unknown): number | null {
  if (raw == null) return null;
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  if (typeof raw === "string" && String(raw).trim()) {
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  }
  if (typeof raw === "object" && raw !== null) {
    const o = raw as Record<string, unknown>;
    const v = o.Value ?? o.value ?? o.UVIndex ?? o.UVIndexFloat;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function observationMetricScore(props: Record<string, unknown>): number {
  const keys = ["temperature", "relativeHumidity", "windSpeed", "barometricPressure"] as const;
  let s = 0;
  for (const k of keys) {
    if (nwsQuantValue(props[k]) != null) s += 1;
  }
  return s;
}

function parseHourlyWindSpeedToKmh(raw: unknown): number | null {
  if (raw == null) return null;
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  const text = String(raw).trim().toLowerCase();
  if (!text) return null;
  const nums = [...text.matchAll(/\d+(?:\.\d+)?/g)].map((m) => parseFloat(m[0]!));
  if (nums.length === 0) return null;
  const n = Math.max(...nums);
  if (text.includes("km/h") || text.includes("kmh")) return n;
  if (text.includes("knot") || /\bkt\b/.test(text)) return n * 1.852;
  if (text.includes("m/s") || text.includes("mps")) return n * 3.6;
  if (text.includes("mph")) return n * 1.60934;
  return n * 1.60934;
}

function mergeHourlyIntoObservation(
  observation: Record<string, unknown>,
  hourly: Record<string, unknown>
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...observation };
  if (!hourly || Object.keys(hourly).length === 0) return out;
  if (nwsQuantValue(out.relativeHumidity) == null) {
    const rh = hourly.relativeHumidity as Record<string, unknown> | undefined;
    if (rh && rh.value != null) {
      out.relativeHumidity = {
        unitCode: (rh.unitCode as string) || "wmoUnit:percent",
        value: Number(rh.value),
      };
    }
  }
  if (nwsQuantValue(out.windSpeed) == null) {
    const kmh = parseHourlyWindSpeedToKmh(hourly.windSpeed);
    if (kmh != null) {
      out.windSpeed = { unitCode: "wmoUnit:km_h-1", value: kmh };
    }
  }
  if (nwsQuantValue(out.windDirection) == null) {
    const wd = hourly.windDirection;
    if (typeof wd === "string" && wd.trim()) {
      out.windDirectionCardinal = wd.trim();
    }
  }
  if (nwsQuantValue(out.temperature) == null && hourly.temperature != null) {
    let t = Number(hourly.temperature);
    if (Number.isFinite(t)) {
      let unit = String(hourly.temperatureUnit || "")
        .trim()
        .toUpperCase();
      if (unit !== "F" && unit !== "C") unit = "F";
      // Hourly grid uses letter F|C; default F matches US "units":"us". SI grids use Celsius numbers + "C".
      if (unit === "F") t = ((t - 32) * 5) / 9;
      out.temperature = { unitCode: "wmoUnit:degC", value: t };
    }
  }
  return out;
}

async function bestObservationFromStations(
  features: Array<Record<string, unknown>>,
  maxStations = 8
): Promise<Record<string, unknown>> {
  let best: Record<string, unknown> = {};
  let bestScore = -1;
  for (const feat of features.slice(0, maxStations)) {
    const sid = ((feat.properties as Record<string, unknown>) || {}).stationIdentifier as string | undefined;
    if (!sid) continue;
    try {
      const obs = await nwsFetch(`https://api.weather.gov/stations/${sid}/observations/latest`);
      const props = ((obs.properties as Record<string, unknown>) || {}) as Record<string, unknown>;
      const score = observationMetricScore(props);
      if (score > bestScore) {
        bestScore = score;
        best = props;
      }
      if (score >= 4) break;
    } catch {
      /* try next station */
    }
  }
  return best;
}

function weatherGridKey(lat: number, lon: number): string {
  return `${Math.round(lat * 1000) / 1000},${Math.round(lon * 1000) / 1000}`;
}

function isoAgeSeconds(iso: string): number | null {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  return (Date.now() - t) / 1000;
}

function weatherDataTtlSec(env: { WEATHER_DATA_TTL_SEC?: string }): number {
  // Default 1h. Was 10min, which caused frequent AccuWeather hits even when nothing changed.
  // Per-product policy: hourly endpoints update at most once an hour, 5-day daily once a day.
  // Both controlled at the AccuWeather call layer via `accuFetchJson({ ttlSec })`.
  const n = parseInt(String(env.WEATHER_DATA_TTL_SEC ?? "3600"), 10);
  return Number.isFinite(n) && n > 0 ? n : 3600;
}

/**
 * Per-endpoint AccuWeather TTLs (seconds). Used by `accuFetchJson` via the Workers Cache API.
 * Goal: never double-call the same AccuWeather endpoint for the same location within its TTL,
 * regardless of which Worker shard, user, or trigger (login / dashboard hit / etc) initiated it.
 *
 *   daily/5day    →  24h  (user-visible 5-day outlook changes meaningfully ~once/day)
 *   hourly/*hour  →   1h  (rolling window; refreshing more often burns credits with no UX gain)
 *   currentcond.  →  30m  (live conditions; sub-30-min refresh isn't worth the credit cost)
 *   alarms        →  10m  (severe-weather alerts; AccuWeather TOS-compatible polling)
 *   locations     →  30d  (city geoposition lookups effectively don't change)
 */
const ACCU_TTL_FALLBACK_SEC = 600;
function accuTtlForPath(path: string): number {
  if (path.startsWith("/forecasts/v1/daily/")) return 86400;
  if (path.startsWith("/forecasts/v1/hourly/")) return 3600;
  if (path.startsWith("/currentconditions/v1/")) return 1800;
  if (path.startsWith("/alarms/v1/")) return 600;
  if (path.startsWith("/locations/v1/")) return 30 * 86400;
  return ACCU_TTL_FALLBACK_SEC;
}

interface AccuEnv {
  ACCUWEATHER_API_KEY?: string;
  ACCUWEATHER_LANGUAGE?: string;
}

function accuEnabled(env?: AccuEnv): boolean {
  return Boolean(String(env?.ACCUWEATHER_API_KEY || "").trim());
}

/** Known AccuWeather `Description.Type` abbreviations (USGS, NWS, etc.) when no plain-language `Text` is present. */
const ACCU_ALERT_TYPE_LABEL: Record<string, string> = {
  VOW: "Volcano Warning",
  VOWS: "Volcano Watch",
  VOA: "Volcano Activity",
  TOA: "Telephone Outage Advisory",
  TOE: "Telephone Outage Emergency",
  HWO: "Hazardous Weather Outlook",
  SMW: "Special Marine Warning",
  SPS: "Special Weather Statement",
  FLW: "Flood Warning",
  FLS: "Flood Statement",
  FFA: "Flash Flood Watch",
  FFW: "Flash Flood Warning",
  SQW: "Snow Squall Warning",
};

function humanizeAccuTypeCode(code: string): string {
  const c = String(code || "")
    .trim()
    .toUpperCase();
  if (!c) return "Weather alert";
  if (ACCU_ALERT_TYPE_LABEL[c]) return ACCU_ALERT_TYPE_LABEL[c];
  if (c.length <= 5 && /^[A-Z0-9]+$/.test(c)) return `Government alert (${c})`;
  return String(code).trim();
}

function accuDescriptionObject(a: Record<string, unknown>): Record<string, unknown> | null {
  const d = a.Description;
  if (d && typeof d === "object" && !Array.isArray(d)) return d as Record<string, unknown>;
  return null;
}

function strFromUnknown(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

/** Narrative text often lives in `Area[]` when root `Text` is null (e.g. USGS volcano products). */
function collectAccuAreaNarrative(area: unknown): { text: string; areaNames: string[] } {
  const areaNames: string[] = [];
  const texts: string[] = [];
  if (!Array.isArray(area)) return { text: "", areaNames };
  for (const item of area) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const name = strFromUnknown(o.Name);
    if (name) areaNames.push(name);
    for (const k of ["Text", "Summary"] as const) {
      const s = strFromUnknown(o[k]);
      if (s) texts.push(s);
    }
    const la = o.LastAction;
    if (la && typeof la === "object") {
      const l = la as Record<string, unknown>;
      const e = strFromUnknown(l.English);
      const loc = strFromUnknown(l.Localized);
      if (e) texts.push(e);
      else if (loc) texts.push(loc);
    }
  }
  return { text: texts.filter(Boolean).join("\n\n"), areaNames };
}

/** AccuWeather `/alerts/v1`: `Description` is an object; root `Text` is often null for third-party issuers. */
function normalizeAccuAlertRow(
  a: Record<string, unknown>,
  locKey: string,
  i: number
): Record<string, unknown> {
  const descObj = accuDescriptionObject(a);
  const category = strFromUnknown(a.Category) || strFromUnknown(descObj?.Category);
  const typeCode = strFromUnknown(a.Type) || strFromUnknown(descObj?.Type);
  const level = strFromUnknown(a.Level) || strFromUnknown(descObj?.Level);
  const descEnglish = strFromUnknown(descObj?.English) || strFromUnknown(descObj?.Localized);
  const rootText = strFromUnknown(a.Text);
  const disclaimer = strFromUnknown(a.Disclaimer);
  const { text: areaText, areaNames } = collectAccuAreaNarrative(a.Area);

  const narrativeParts = [rootText, descEnglish, areaText, disclaimer].filter((s) => s.length > 0);
  let textBlob = narrativeParts.join("\n\n").trim();

  const titled = strFromUnknown(a.Title) || strFromUnknown(a.Name) || strFromUnknown(a.EnglishType);
  const firstLine =
    textBlob.split(/\r?\n/).find((ln) => ln.trim().length > 0)?.trim() ||
    textBlob.split(/(?<=[.!?])\s+/)[0]?.trim() ||
    "";

  const typeHuman = humanizeAccuTypeCode(typeCode);
  const event =
    (titled.length > 1 ? titled : "") ||
    (firstLine.length > 2 ? firstLine.slice(0, 200) : "") ||
    (category && typeCode ? `${category} — ${typeHuman}` : "") ||
    (category ? category : "") ||
    typeHuman;

  if (!textBlob) {
    const shortKind =
      category && typeCode ? `${category} (${typeCode})` : category || typeHuman || typeCode || "Weather alert";
    const fallbackBits = [
      shortKind,
      level ? `Level: ${level}` : "",
      strFromUnknown(a.Source) ? `Issued by: ${strFromUnknown(a.Source)}` : "",
    ].filter(Boolean);
    textBlob = fallbackBits.join("\n\n") || typeHuman;
  }

  const headline = textBlob.length > 600 ? `${textBlob.slice(0, 600)}…` : textBlob;
  const areaDesc =
    areaNames.length > 0
      ? [...new Set(areaNames)].join("; ")
      : typeof a.Area === "string"
        ? strFromUnknown(a.Area)
        : "";

  const priority = (a.Priority ?? descObj?.Priority ?? a.Severity ?? descObj?.Level) as unknown;
  const detailRaw = String(a.MobileLink ?? a.Link ?? "").trim();
  const detailUrl = /^https?:\/\//i.test(detailRaw) ? detailRaw : undefined;

  return {
    id: a.AlertID ?? a.ID ?? `${locKey}-${i}`,
    event: event || "Weather alert",
    headline,
    description: textBlob,
    instruction: strFromUnknown(a.Action),
    severity: priority ?? "",
    urgency: typeof a.Urgency === "string" ? a.Urgency : "",
    certainty: typeof a.Certainty === "string" ? a.Certainty : "",
    areaDesc,
    sent: a.Effective ?? a.Date ?? null,
    effective: a.Effective ?? a.Date ?? null,
    ends: a.Expires ?? null,
    senderName: strFromUnknown(a.Source) || "Weather alerts",
    provider: "accuweather",
    detailUrl,
  };
}

function nwsAlertDetailUrl(
  feature: Record<string, unknown>,
  props: Record<string, unknown>
): string | undefined {
  const web = typeof props.web === "string" ? props.web.trim() : "";
  if (web.startsWith("http")) return web;
  const fid = typeof feature.id === "string" ? feature.id.trim() : "";
  if (fid.startsWith("http")) return fid;
  return undefined;
}

async function accuFetchJson<T>(
  env: AccuEnv,
  path: string,
  params: Record<string, string>,
  opts?: { db?: D1Database; metric?: string; ttlSec?: number }
): Promise<T> {
  const apiKey = String(env.ACCUWEATHER_API_KEY || "").trim();
  if (!apiKey) throw new Error("accuweather_not_configured");
  const u = new URL(`${ACCU_BASE}${path}`);
  u.searchParams.set("language", String(env.ACCUWEATHER_LANGUAGE || "en-us"));
  for (const [k, v] of Object.entries(params)) {
    u.searchParams.set(k, v);
  }
  // Cache key excludes the API key (which rotates) but includes language + path + params.
  // Workers Cache API is per-data-center; for a low-traffic app this still cuts double-calls
  // by ~250x worst case (one cold fill per DC) and ~Nx in practice (most users share a DC).
  const ttlSec = opts?.ttlSec ?? accuTtlForPath(path);
  const cacheUrl = new URL(u.toString());
  const cacheKey = new Request(cacheUrl.toString());
  const cache = (caches as unknown as { default?: Cache }).default || null;
  if (cache && ttlSec > 0) {
    try {
      const hit = await cache.match(cacheKey);
      if (hit && hit.ok) {
        await bumpUsageMetric(opts?.db, "accu.cache.hit", 1);
        return (await hit.json()) as T;
      }
    } catch {
      /* cache miss / unsupported — fall through to network */
    }
  }
  // Network fetch. The API key is appended only to the actual request, never to the cache key.
  const reqUrl = new URL(u.toString());
  reqUrl.searchParams.set("apikey", apiKey);
  const r = await fetch(reqUrl.toString(), { headers: { Accept: "application/json" } });
  if (!r.ok) throw new Error(`ACCU ${r.status}`);
  await bumpUsageMetric(opts?.db, opts?.metric || "accu.call.unknown", 1);
  const body = await r.text();
  if (cache && ttlSec > 0) {
    try {
      await cache.put(
        cacheKey,
        new Response(body, {
          status: 200,
          headers: {
            "content-type": "application/json",
            "cache-control": `public, max-age=${ttlSec}`,
          },
        }),
      );
    } catch {
      /* best-effort cache write */
    }
  }
  return JSON.parse(body) as T;
}

async function accuLocationKey(
  env: AccuEnv,
  db: D1Database | undefined,
  lat: number,
  lon: number
): Promise<{ key: string; city?: string; state?: string }> {
  const row = await accuFetchJson<Record<string, unknown>>(
    env,
    "/locations/v1/cities/geoposition/search",
    {
      q: `${lat.toFixed(4)},${lon.toFixed(4)}`,
      details: "false",
    },
    { db, metric: "accu.call.location_lookup" }
  );
  const key = String(row?.Key || "").trim();
  if (!key) throw new Error("accuweather_location_missing");
  const city = typeof row?.LocalizedName === "string" ? row.LocalizedName : undefined;
  const admin = (row?.AdministrativeArea as Record<string, unknown>) || {};
  const state = typeof admin.ID === "string" ? admin.ID : undefined;
  return { key, city, state };
}

type AccuLoc = { key: string; city?: string; state?: string };

export async function weatherCurrent(
  lat: number,
  lon: number,
  env?: AccuEnv,
  db?: D1Database,
  precomputedLoc?: AccuLoc
): Promise<Record<string, unknown>> {
  if (accuEnabled(env)) {
    try {
      const loc = precomputedLoc || (await accuLocationKey(env || {}, db, lat, lon));
      const current = await accuFetchJson<Array<Record<string, unknown>>>(
        env || {},
        `/currentconditions/v1/${encodeURIComponent(loc.key)}`,
        // `metric` is not a documented Current Conditions parameter on dataservice; it can yield
        // incomplete dual-unit blobs. Rely on `details=true` + Metric/Imperial parsing instead.
        { details: "true" },
        { db, metric: "accu.call.current_conditions" }
      );
      const c = (Array.isArray(current) ? current[0] : null) || {};
      const cc = c as Record<string, unknown>;
      const icon = Number(accuProp(cc, "WeatherIcon"));
      const tempC = accuTempMetricC(accuProp(cc, "Temperature"));
      const humidity = accuRelativeHumidityPct(accuProp(cc, "RelativeHumidity"));
      const windRec = (accuProp(cc, "Wind") as Record<string, unknown> | undefined) || undefined;
      const windGustRec = (accuProp(cc, "WindGust") as Record<string, unknown> | undefined) || undefined;
      const windKmh = accuSpeedMetricKmh(windRec?.Speed as unknown);
      const pressureMb = accuPressureMetricMb(accuProp(cc, "Pressure"));
      const phrase = typeof accuProp(cc, "WeatherText") === "string" ? String(accuProp(cc, "WeatherText")) : "";
      const visKm = accuVisibilityMetricKm(accuProp(cc, "Visibility"));
      const cloudPct = accuCloudCoverPercent(accuProp(cc, "CloudCover"));
      const uv = accuUvIndex(accuProp(cc, "UVIndexFloat") ?? accuProp(cc, "UVIndex"));
      const gustKmh = accuSpeedMetricKmh(windGustRec?.Speed as unknown ?? null);
      const feelsLikeC =
        accuTempMetricC(accuProp(cc, "RealFeelTemperature")) ??
        accuTempMetricC(accuProp(cc, "RealFeelTemperatureShade")) ??
        accuTempMetricC(accuProp(cc, "ApparentTemperature")) ??
        accuTempMetricC(accuProp(cc, "WindChillTemperature")) ??
        accuTempMetricC(accuProp(cc, "HeatIndex")) ??
        (Number.isFinite(tempC) ? tempC : null);
      const dewPointC = accuTempMetricC(accuProp(cc, "DewPoint"));
      const wetBulbC =
        accuTempMetricC(accuProp(cc, "WetBulbTemperature")) ??
        accuTempMetricC(accuProp(cc, "WetBulbGlobeTemperature")) ??
        (tempC != null && Number.isFinite(tempC) && humidity != null && Number.isFinite(humidity)
          ? wetBulbFromRhApprox(tempC, humidity)
          : null);
      const ceilingM = accuCeilingMetricM(accuProp(cc, "Ceiling"));
      const precipSum = (accuProp(cc, "PrecipitationSummary") as Record<string, unknown>) || {};
      const precip1hMm =
        accuLengthMetricMm(accuProp(cc, "Precip1hr")) ??
        accuLengthMetricMm((precipSum as Record<string, unknown>).PastHour) ??
        accuLengthMetricMm((precipSum as Record<string, unknown>).pastHour) ??
        accuLengthMetricMm((precipSum as Record<string, unknown>).Precipitation) ??
        accuLengthMetricMm((precipSum as Record<string, unknown>).precipitation);
      const past3hMm =
        accuLengthMetricMm((precipSum as Record<string, unknown>).Past3Hours) ??
        accuLengthMetricMm((precipSum as Record<string, unknown>).past3Hours);
      const past6hMm =
        accuLengthMetricMm((precipSum as Record<string, unknown>).Past6Hours) ??
        accuLengthMetricMm((precipSum as Record<string, unknown>).past6Hours);
      const pressureTendencyRec =
        (accuProp(cc, "PressureTendency") as Record<string, unknown> | undefined) || undefined;
      const pressureTrend =
        typeof pressureTendencyRec?.LocalizedText === "string" ? String(pressureTendencyRec.LocalizedText) : "";
      const outObs: Record<string, unknown> = {
        temperature: Number.isFinite(tempC) ? { unitCode: "wmoUnit:degC", value: tempC } : null,
        feelsLike: Number.isFinite(feelsLikeC) ? { unitCode: "wmoUnit:degC", value: feelsLikeC } : null,
        dewpoint: Number.isFinite(dewPointC) ? { unitCode: "wmoUnit:degC", value: dewPointC } : null,
        wetBulbTemperature: Number.isFinite(wetBulbC) ? { unitCode: "wmoUnit:degC", value: wetBulbC } : null,
        relativeHumidity:
          humidity != null && Number.isFinite(humidity) ? { unitCode: "wmoUnit:percent", value: humidity } : null,
        windSpeed: Number.isFinite(windKmh) ? { unitCode: "wmoUnit:km_h-1", value: windKmh } : null,
        windGust: Number.isFinite(gustKmh) ? { unitCode: "wmoUnit:km_h-1", value: gustKmh } : null,
        barometricPressure:
          pressureMb != null && Number.isFinite(pressureMb) ? { unitCode: "wmoUnit:Pa", value: pressureMb * 100 } : null,
        visibility: visKm != null && Number.isFinite(visKm) ? { unitCode: "wmoUnit:m", value: visKm * 1000 } : null,
        ceiling: Number.isFinite(ceilingM) ? { unitCode: "wmoUnit:m", value: ceilingM } : null,
        cloudCover: Number.isFinite(cloudPct) ? { unitCode: "wmoUnit:percent", value: cloudPct } : null,
        uvIndex: Number.isFinite(uv) ? uv : null,
        precip1h: Number.isFinite(precip1hMm) ? { unitCode: "wmoUnit:mm", value: precip1hMm } : null,
        precipPast3h: Number.isFinite(past3hMm) ? { unitCode: "wmoUnit:mm", value: past3hMm } : null,
        precipPast6h: Number.isFinite(past6hMm) ? { unitCode: "wmoUnit:mm", value: past6hMm } : null,
        pressureTendency: pressureTrend || null,
        textDescription: phrase || null,
        windDirectionCardinal:
          typeof windRec?.Direction === "object" &&
          typeof (windRec.Direction as Record<string, unknown>)?.English === "string"
            ? String((windRec.Direction as Record<string, unknown>).English)
            : null,
      };
      return {
        available: true,
        source: "accuweather",
        attribution: "Forecast",
        raw: { location: loc, current: c },
        icon: Number.isFinite(icon) ? icon : null,
        observation: outObs,
        hourly_now: {
          shortForecast: phrase,
          icon: Number.isFinite(icon) ? icon : null,
          temperature: tempC,
          temperatureUnit: "C",
          feelsLike: Number.isFinite(feelsLikeC) ? feelsLikeC : null,
          dewPoint: Number.isFinite(dewPointC) ? dewPointC : null,
          wetBulb: Number.isFinite(wetBulbC) ? wetBulbC : null,
          relativeHumidity: {
            unitCode: "wmoUnit:percent",
            value: humidity != null && Number.isFinite(humidity) ? humidity : null,
          },
          windSpeed: windKmh != null && Number.isFinite(windKmh) ? `${Math.round(windKmh)} km/h` : null,
          windGust: gustKmh != null && Number.isFinite(gustKmh) ? `${Math.round(gustKmh)} km/h` : null,
          visibility: visKm != null && Number.isFinite(visKm) ? `${visKm.toFixed(1)} km` : null,
          cloudCover: cloudPct != null && Number.isFinite(cloudPct) ? `${Math.round(cloudPct)}%` : null,
          uvIndex: uv != null && Number.isFinite(uv) ? uv : null,
          ceiling: ceilingM != null && Number.isFinite(ceilingM) ? `${Math.round(ceilingM)} m` : null,
          precip1h: precip1hMm != null && Number.isFinite(precip1hMm) ? `${precip1hMm.toFixed(1)} mm` : null,
          precipPast3h: past3hMm != null && Number.isFinite(past3hMm) ? `${past3hMm.toFixed(1)} mm` : null,
          precipPast6h: past6hMm != null && Number.isFinite(past6hMm) ? `${past6hMm.toFixed(1)} mm` : null,
          pressureTendency: pressureTrend || null,
          windDirection:
            typeof windRec?.Direction === "object" &&
            typeof (windRec.Direction as Record<string, unknown>)?.English === "string"
              ? String((windRec.Direction as Record<string, unknown>).English)
              : null,
        },
        city: loc.city,
        state: loc.state,
      };
    } catch {
      // AccuWeather threw (quota, 401, transient 5xx). Fall through to the NWS path below
      // so we still produce a usable observation; Open-Meteo backfill fills the gaps NWS
      // doesn't publish (feels-like / wet-bulb / gusts). Tagged so callers can see why.
      await bumpUsageMetric(db, "accu.current.fallthrough_to_nws", 1);
    }
  }
  try {
    const points = await nwsFetch(`https://api.weather.gov/points/${lat.toFixed(4)},${lon.toFixed(4)}`);
    const props = (points.properties as Record<string, unknown>) || {};
    const stationsUrl = props.observationStations as string | undefined;
    const forecastUrl = props.forecast as string | undefined;
    const forecastHourlyUrl = props.forecastHourly as string | undefined;
    let observation: Record<string, unknown> = {};
    if (stationsUrl) {
      try {
        const stations = await nwsFetch(stationsUrl);
        const features = (stations.features as Array<Record<string, unknown>>) || [];
        if (features.length) {
          observation = await bestObservationFromStations(features);
        }
      } catch {
        /* ignore */
      }
    }
    let hourlyFirst: Record<string, unknown> = {};
    if (forecastHourlyUrl) {
      try {
        const hourly = await nwsFetch(forecastHourlyUrl);
        const periods = ((((hourly.properties as Record<string, unknown>) || {}).periods as unknown[]) ||
          []) as Array<Record<string, unknown>>;
        if (periods[0]) hourlyFirst = periods[0];
      } catch {
        /* ignore */
      }
    }
    observation = mergeHourlyIntoObservation(observation, hourlyFirst);
    // Open-Meteo backfill: NWS observations do not publish feels-like, wet-bulb, gusts,
    // cloud cover, or precip totals reliably. Fill those gaps with real Open-Meteo
    // measurements (no API key, no AccuWeather quota). Never overwrites NWS values.
    let backfilled: string[] = [];
    let source: string = "nws";
    try {
      const om = await fetchOpenMeteoCurrent(lat, lon, { db });
      if (om) {
        backfilled = mergeOpenMeteoBackfill(observation, hourlyFirst, om);
        if (backfilled.length > 0) source = "nws+open-meteo";
      }
    } catch {
      /* backfill is best-effort */
    }
    const rel = (props.relativeLocation as Record<string, unknown>) || {};
    const relProps = (rel.properties as Record<string, unknown>) || {};
    return {
      available: true,
      source,
      attribution: source === "nws+open-meteo" ? "NWS + Open-Meteo" : "NWS",
      backfilled_fields: backfilled,
      observation,
      hourly_now: hourlyFirst,
      forecast_url: forecastUrl,
      forecast_hourly_url: forecastHourlyUrl,
      city: relProps.city,
      state: relProps.state,
    };
  } catch {
    // NWS unreachable too — try Open-Meteo as primary so the bundle still has something useful.
    try {
      const om = await fetchOpenMeteoCurrent(lat, lon, { db });
      if (om) {
        return {
          available: true,
          source: "open-meteo",
          attribution: "Open-Meteo",
          observation: om.observation,
          hourly_now: om.hourly_now,
        };
      }
    } catch {
      /* fall through */
    }
    return { available: false, reason: "nws_points_unavailable" };
  }
}

export async function weatherForecast(
  lat: number,
  lon: number,
  env?: AccuEnv,
  db?: D1Database,
  precomputedLoc?: AccuLoc
): Promise<Record<string, unknown>> {
  if (accuEnabled(env)) {
    try {
      const loc = precomputedLoc || (await accuLocationKey(env || {}, db, lat, lon));
      const [daily, hourly] = await Promise.all([
        accuFetchJson<Record<string, unknown>>(
          env || {},
          `/forecasts/v1/daily/5day/${encodeURIComponent(loc.key)}`,
          {
            details: "true",
            metric: "true",
          },
          { db, metric: "accu.call.forecast_daily_5day" }
        ),
        accuFetchJson<Array<Record<string, unknown>>>(
          env || {},
          // 72-hour (3-day) hourly — matches user-facing multi-day hourly expectation.
          // AccuWeather pricing tiers: 1h / 12h / 24h / 72h / 120h (skip 48h tier).
          `/forecasts/v1/hourly/72hour/${encodeURIComponent(loc.key)}`,
          { details: "true", metric: "true" },
          { db, metric: "accu.call.forecast_hourly_72hour" }
        ),
      ]);
      const dailyPeriods = (((daily?.DailyForecasts as unknown[]) || []) as Array<Record<string, unknown>>).flatMap((d, idx) => {
        const date = String(d.Date || "");
        const day = (d.Day as Record<string, unknown>) || {};
        const night = (d.Night as Record<string, unknown>) || {};
        const temp = (d.Temperature as Record<string, unknown>) || {};
        const maxC = accuTempMetricC(temp.Maximum);
        const minC = accuTempMetricC(temp.Minimum);
        return [
          {
            number: idx * 2 + 1,
            name: `Day ${idx + 1}`,
            isDaytime: true,
            startTime: date,
            temperature: maxC != null && Number.isFinite(maxC) ? maxC : null,
            temperatureUnit: "C",
            shortForecast: typeof day.IconPhrase === "string" ? day.IconPhrase : "",
            icon: Number.isFinite(Number(day.Icon)) ? Number(day.Icon) : null,
          },
          {
            number: idx * 2 + 2,
            name: `Night ${idx + 1}`,
            isDaytime: false,
            startTime: date,
            temperature: minC != null && Number.isFinite(minC) ? minC : null,
            temperatureUnit: "C",
            shortForecast: typeof night.IconPhrase === "string" ? night.IconPhrase : "",
            icon: Number.isFinite(Number(night.Icon)) ? Number(night.Icon) : null,
          },
        ];
      });
      const hourlyPeriods = (((hourly as unknown[]) || []) as Array<Record<string, unknown>>).map((h, idx) => {
        const hWind = (h.Wind as Record<string, unknown>) || {};
        const hWindSpeed = (hWind.Speed as Record<string, unknown>) || {};
        const hWindDir = (hWind.Direction as Record<string, unknown>) || {};
        const tC = accuTempMetricC(h.Temperature);
        const rh = Number(h.RelativeHumidity);
        const windKmh = accuSpeedMetricKmh(hWindSpeed as unknown);
        const icon = Number((h as Record<string, unknown>)?.WeatherIcon);
        return {
          number: idx + 1,
          startTime: h.DateTime,
          temperature: tC != null && Number.isFinite(tC) ? tC : null,
          temperatureUnit: "C",
          shortForecast: typeof h.IconPhrase === "string" ? h.IconPhrase : "",
          icon: Number.isFinite(icon) ? icon : null,
          windSpeed: windKmh != null && Number.isFinite(windKmh) ? `${Math.round(windKmh)} km/h` : null,
          windDirection: typeof hWindDir.English === "string" ? hWindDir.English : null,
          relativeHumidity: Number.isFinite(rh) ? { unitCode: "wmoUnit:percent", value: rh } : null,
        };
      });
      return {
        available: true,
        source: "accuweather",
        attribution: "Forecast",
        raw: { location: loc, daily, hourly },
        periods: dailyPeriods,
        hourly: hourlyPeriods,
        hourly_grid_units: "si",
      };
    } catch {
      // AccuWeather can fail from quota/key expiry/plan changes. Fall through to NWS instead of
      // blanking the forecast card.
      await bumpUsageMetric(db, "accu.forecast.fallthrough_to_nws", 1);
    }
  }
  try {
    const points = await nwsFetch(`https://api.weather.gov/points/${lat.toFixed(4)},${lon.toFixed(4)}`);
    const props = (points.properties as Record<string, unknown>) || {};
    const forecastUrl = props.forecast as string | undefined;
    const forecastHourlyUrl = props.forecastHourly as string | undefined;
    let periods: unknown[] = [];
    let hourly: unknown[] = [];
    let hourly_grid_units = "us";
    if (forecastUrl) {
      try {
        const fc = await nwsFetch(forecastUrl);
        periods = (((fc.properties as Record<string, unknown>) || {}).periods as unknown[]) || [];
      } catch {
        /* ignore */
      }
    }
    if (forecastHourlyUrl) {
      try {
        const fh = await nwsFetch(forecastHourlyUrl);
        const fhProps = (fh.properties as Record<string, unknown>) || {};
        hourly = ((fhProps.periods as unknown[]) || []).slice(0, 72);
        hourly_grid_units = String(fhProps.units || "us");
      } catch {
        /* ignore */
      }
    }
    return { available: true, periods, hourly, hourly_grid_units };
  } catch {
    return { available: false, periods: [], hourly: [] };
  }
}

export async function weatherAlerts(
  lat: number,
  lon: number,
  env?: AccuEnv,
  db?: D1Database,
  precomputedLoc?: AccuLoc
): Promise<Record<string, unknown>> {
  if (accuEnabled(env)) {
    try {
      const loc = precomputedLoc || (await accuLocationKey(env || {}, db, lat, lon));
      // AccuWeather alerts endpoint availability is plan-dependent; this path supports configured plans.
      const rows = await accuFetchJson<Array<Record<string, unknown>>>(
        env || {},
        `/alerts/v1/${encodeURIComponent(loc.key)}`,
        { details: "true" },
        { db, metric: "accu.call.alerts" }
      );
      const alerts = (((rows as unknown[]) || []) as Array<Record<string, unknown>>).map((a, i) =>
        normalizeAccuAlertRow(a, loc.key, i)
      );
      return { available: true, source: "accuweather", attribution: "Weather alerts", raw: { location: loc, alerts: rows }, alerts };
    } catch {
      // Alerts are plan-dependent on AccuWeather. Fall through to NOAA/NWS when unavailable.
      await bumpUsageMetric(db, "accu.alerts.fallthrough_to_nws", 1);
    }
  }
  try {
    const r = await fetch(
      `https://api.weather.gov/alerts/active?point=${lat.toFixed(4)},${lon.toFixed(4)}`,
      { headers: { "User-Agent": NWS_USER_AGENT, Accept: "application/geo+json" } }
    );
    if (!r.ok) return { available: false, alerts: [] };
    const data = (await r.json()) as Record<string, unknown>;
    const features = (data.features as Array<Record<string, unknown>>) || [];
    const out = features.map((f) => {
      const p = (f.properties as Record<string, unknown>) || {};
      return {
        id: f.id,
        event: p.event,
        headline: p.headline,
        description: p.description,
        instruction: p.instruction,
        severity: p.severity,
        urgency: p.urgency,
        certainty: p.certainty,
        areaDesc: p.areaDesc,
        sent: p.sent,
        effective: p.effective,
        ends: p.ends || p.expires,
        senderName: p.senderName,
        provider: "noaa",
        detailUrl: nwsAlertDetailUrl(f, p),
      };
    });
    return { available: true, source: "noaa", attribution: "NOAA / NWS", alerts: out };
  } catch {
    return { available: false, alerts: [] };
  }
}

export async function canadaAlerts(lat: number, lon: number, radiusKm = 150): Promise<Record<string, unknown>> {
  const bboxLon = radiusKm / 80.0;
  const bboxLat = radiusKm / 110.0;
  const bbox = `${lon - bboxLon},${lat - bboxLat},${lon + bboxLon},${lat + bboxLat}`;
  const url = `https://geo.weather.gc.ca/geomet/features/collections/ALERTS/items?f=json&bbox=${bbox}&limit=50`;
  try {
    const r = await fetch(url, { headers: { "User-Agent": NWS_USER_AGENT } });
    if (!r.ok) return { available: false, alerts: [] };
    const data = (await r.json()) as Record<string, unknown>;
    const feats = (data.features as Array<Record<string, unknown>>) || [];
    const out = feats.map((f) => {
      const p = (f.properties as Record<string, unknown>) || {};
      const urlRaw = String(p.url ?? p.link ?? "").trim();
      return {
        id: f.id || p.identifier,
        event: p.headline || p.alert_type,
        headline: p.headline,
        description: p.descrip_en || p.description,
        severity: p.severity,
        urgency: p.urgency,
        areaDesc: p.area || p.location,
        sent: p.sent || p.effective,
        effective: p.effective,
        ends: p.expires,
        provider: "canada",
        detailUrl: urlRaw.startsWith("http") ? urlRaw : undefined,
      };
    });
    return { available: true, source: "canada", attribution: "Environment Canada", alerts: out };
  } catch {
    return { available: false, alerts: [] };
  }
}

export async function usgsEarthquakes(
  lat: number | null,
  lon: number | null,
  radiusMiles = 2000,
  period: "hour" | "day" | "week" | "month" = "day",
  minMagnitude = 0
): Promise<Record<string, unknown>> {
  const feedMap: Record<string, string> = {
    hour: "all_hour",
    day: "all_day",
    week: "all_week",
    month: "all_month",
  };
  const feed = feedMap[period] || "all_day";
  const url = `https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/${feed}.geojson`;
  try {
    const r = await fetch(url, { headers: { "User-Agent": NWS_USER_AGENT } });
    if (!r.ok) return { available: false, events: [] };
    const data = (await r.json()) as Record<string, unknown>;
    const feats = (data.features as Array<Record<string, unknown>>) || [];
    const out: Array<Record<string, unknown>> = [];
    for (const f of feats) {
      const p = (f.properties as Record<string, unknown>) || {};
      const coords = ((f.geometry as Record<string, unknown>) || {}).coordinates as number[] | undefined;
      const eLon = coords?.[0];
      const eLat = coords?.[1];
      const eDepth = coords && coords.length > 2 ? coords[2] : null;
      const mag = p.mag as number | undefined;
      if (mag === undefined || mag === null || mag < minMagnitude) continue;
      let distance: number | null = null;
      if (lat != null && lon != null && eLat != null && eLon != null) {
        distance = haversineMiles(lat, lon, eLat, eLon);
        if (distance > radiusMiles) continue;
      }
      out.push({
        id: f.id,
        magnitude: mag,
        place: p.place,
        time: p.time,
        updated: p.updated,
        url: p.url,
        tsunami: Boolean(p.tsunami),
        alert: p.alert,
        depth_km: eDepth,
        lat: eLat,
        lon: eLon,
        distance_miles: distance,
      });
    }
    out.sort((a, b) => Number(b.time) - Number(a.time));
    return { available: true, events: out };
  } catch {
    return { available: false, events: [] };
  }
}

export async function tsunamiBulletins(): Promise<Record<string, unknown>> {
  const url = "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/significant_week.geojson";
  try {
    const r = await fetch(url, { headers: { "User-Agent": NWS_USER_AGENT } });
    if (!r.ok) return { available: false, bulletins: [] };
    const data = (await r.json()) as Record<string, unknown>;
    const out: Array<Record<string, unknown>> = [];
    for (const f of (data.features as Array<Record<string, unknown>>) || []) {
      const p = (f.properties as Record<string, unknown>) || {};
      if (!p.tsunami) continue;
      out.push({
        id: f.id,
        title: p.title,
        place: p.place,
        magnitude: p.mag,
        time: p.time,
        url: p.url,
        alert: p.alert,
      });
    }
    return { available: true, bulletins: out };
  } catch {
    return { available: false, bulletins: [] };
  }
}

async function eonetEvents(category: string, days = 30): Promise<Array<Record<string, unknown>>> {
  const url = `https://eonet.gsfc.nasa.gov/api/v3/events?category=${category}&status=open&days=${days}`;
  try {
    const r = await fetch(url, { headers: { "User-Agent": NWS_USER_AGENT } });
    if (!r.ok) return [];
    const data = (await r.json()) as Record<string, unknown>;
    const out: Array<Record<string, unknown>> = [];
    for (const ev of (data.events as Array<Record<string, unknown>>) || []) {
      const geoms = (ev.geometry as Array<Record<string, unknown>>) || [];
      const last = geoms[geoms.length - 1] || {};
      const coords = (last.coordinates as number[]) || [null, null];
      out.push({
        id: ev.id,
        title: ev.title,
        description: ev.description,
        categories: ((ev.categories as Array<Record<string, unknown>>) || []).map((c) => c.title),
        sources: ((ev.sources as Array<Record<string, unknown>>) || []).map((s) => s.url),
        lat: coords.length > 1 ? coords[1] : null,
        lon: coords.length ? coords[0] : null,
        date: last.date,
        magnitudeValue: last.magnitudeValue,
        magnitudeUnit: last.magnitudeUnit,
      });
    }
    return out;
  } catch {
    return [];
  }
}

export async function eonetCyclones(): Promise<Record<string, unknown>> {
  return { available: true, events: await eonetEvents("severeStorms", 30) };
}

export async function eonetWildfires(): Promise<Record<string, unknown>> {
  return { available: true, events: await eonetEvents("wildfires", 30) };
}

/**
 * `Promise.allSettled` rejects can be `Error`, `undefined`, strings, or other non-objects.
 * Passing those through broke mobile renders (e.g. `forecast` becoming a string → odd shapes,
 * or API fields arriving as nested objects → "Objects are not valid as a React child").
 */
function safe<T>(v: unknown, d: T): T {
  if (v instanceof Error) return d;
  if (v === null || v === undefined) return d;
  if (typeof v !== "object") return d;
  return v as T;
}

export interface DashboardEnv {
  WEATHER_DATA_TTL_SEC?: string;
  ACCUWEATHER_API_KEY?: string;
  ACCUWEATHER_LANGUAGE?: string;
  ACCUWEATHER_REUSE_RADIUS_MILES?: string;
}

function weatherReuseRadiusMiles(env: DashboardEnv): number {
  const n = Number(env.ACCUWEATHER_REUSE_RADIUS_MILES ?? "25");
  return Number.isFinite(n) && n > 0 ? n : 25;
}

function bundleWeatherSource(bundle: Record<string, unknown>): string {
  const cur = (bundle.current as Record<string, unknown>) || {};
  const src = String(cur.source || "").trim().toLowerCase();
  return src || "unknown";
}

/** Kīlauea summit — USGS HVO bundle only fetched within this radius (miles). */
const KILAUEA_SUMMIT_LAT = 19.421;
const KILAUEA_SUMMIT_LON = -155.287;
const KILAUEA_VNUM = "332010";
const HVO_BUNDLE_RADIUS_MILES = 140;

function stripHtmlToText(html: string, maxLen: number): string {
  const t = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return t.length > maxLen ? `${t.slice(0, maxLen)}…` : t;
}

/** USGS HANS newest notice for Kīlauea (alert level + aviation color). */
async function usgsHvoKilaueaNotice(db?: D1Database): Promise<Record<string, unknown>> {
  const url = `https://volcanoes.usgs.gov/hans-public/api/volcano/newestForVolcano/${KILAUEA_VNUM}`;
  try {
    const ac = new AbortController();
    const to = setTimeout(() => ac.abort(), 14_000);
    const r = await fetch(url, {
      signal: ac.signal,
      headers: { "User-Agent": NWS_USER_AGENT, Accept: "application/json" },
    });
    clearTimeout(to);
    if (!r.ok) {
      await bumpUsageMetric(db, "usgs.hvo.http_error", 1);
      return { available: false, reason: `http_${r.status}` };
    }
    const j = (await r.json()) as Record<string, unknown>;
    await bumpUsageMetric(db, "usgs.hvo.ok", 1);
    const sections = (j.noticeSections as Array<Record<string, unknown>>) || [];
    const synHtmlParts: string[] = [];
    for (const sec of sections) {
      const raw = typeof sec.synopsis === "string" ? sec.synopsis : "";
      if (raw.trim()) synHtmlParts.push(raw.trim());
    }
    const combinedSyn = synHtmlParts.join("<br/><br/>");
    return {
      available: true,
      source: "usgs_hans",
      volcano_name: "Kīlauea",
      vnum: KILAUEA_VNUM,
      alert_level: j.noticeHighestAlertLevel ?? null,
      aviation_color_code: j.noticeHighestColorCode ?? null,
      notice_title: typeof j.noticeTitle === "string" ? j.noticeTitle : null,
      notice_type: typeof j.noticeType === "string" ? j.noticeType : null,
      notice_url: typeof j.noticeUrl === "string" ? j.noticeUrl : null,
      sent_utc: typeof j.sentUtc === "string" ? j.sentUtc : null,
      synopsis_plain: combinedSyn ? stripHtmlToText(combinedSyn, 20_000) : null,
    };
  } catch {
    await bumpUsageMetric(db, "usgs.hvo.fetch_fail", 1);
    return { available: false, reason: "hvo_fetch_failed" };
  }
}

async function sharedRecentBundle(
  db: D1Database,
  lat: number,
  lon: number,
  ttlSec: number,
  radiusMiles: number,
  opts: { requireSource?: string }
): Promise<Record<string, unknown> | null> {
  const latPad = radiusMiles / 69.0;
  const lonPad = radiusMiles / Math.max(8, 69.0 * Math.cos((lat * Math.PI) / 180));
  const cutoffIso = new Date(Date.now() - ttlSec * 1000).toISOString();
  const rows = await db
    .prepare(
      `SELECT lat, lon, fetched_at, bundle_json
       FROM weather_data
       WHERE fetched_at >= ?
         AND lat BETWEEN ? AND ?
         AND lon BETWEEN ? AND ?
       ORDER BY fetched_at DESC
       LIMIT 40`
    )
    .bind(cutoffIso, lat - latPad, lat + latPad, lon - lonPad, lon + lonPad)
    .all<{ lat: number; lon: number; fetched_at: string; bundle_json: string }>();
  const list = (rows.results || []) as Array<{ lat: number; lon: number; fetched_at: string; bundle_json: string }>;
  let best: { dist: number; bundle: Record<string, unknown> } | null = null;
  for (const row of list) {
    const dist = haversineMiles(lat, lon, Number(row.lat), Number(row.lon));
    if (!Number.isFinite(dist) || dist > radiusMiles) continue;
    try {
      const bundle = JSON.parse(row.bundle_json) as Record<string, unknown>;
      const age = isoAgeSeconds(String(bundle.fetched_at || row.fetched_at || ""));
      if (age == null || age < 0 || age >= ttlSec) continue;
      if (opts.requireSource) {
        if (bundleWeatherSource(bundle) !== opts.requireSource.toLowerCase()) continue;
      }
      if (!best || dist < best.dist) best = { dist, bundle };
    } catch {
      /* ignore bad cache rows */
    }
  }
  return best?.bundle || null;
}

export async function dashboardBundle(
  db: D1Database,
  env: DashboardEnv,
  userId: string,
  lat: number,
  lon: number,
  opts: { refresh: boolean; locationId: string | null }
): Promise<Record<string, unknown>> {
  const gridKey = weatherGridKey(lat, lon);
  const ttlSec = weatherDataTtlSec(env);
  const reuseRadiusMiles = weatherReuseRadiusMiles(env);
  const useAccu = accuEnabled(env);
  let accuLoc: AccuLoc | null = null;

  if (!opts.refresh) {
    // Cross-user cache: read the most-recent bundle for this grid_key from ANY user. A Kilauea
    // user and a Weather Manager user at the same lat/lon now share the same row in D1, instead
    // of independently re-keying by user_id. Writes still record `userId` for attribution.
    const row = await db
      .prepare(
        `SELECT bundle_json, fetched_at FROM weather_data
         WHERE grid_key = ?
         ORDER BY fetched_at DESC LIMIT 1`
      )
      .bind(gridKey)
      .first<{ bundle_json: string; fetched_at: string }>();
    if (row?.bundle_json && row.fetched_at) {
      const age = isoAgeSeconds(row.fetched_at);
      if (age != null && age >= 0 && age < ttlSec) {
        try {
          await bumpUsageMetric(db, "cache.hit.grid", 1);
          return JSON.parse(row.bundle_json) as Record<string, unknown>;
        } catch {
          /* fetch fresh */
        }
      }
    }
    const shared = await sharedRecentBundle(db, lat, lon, ttlSec, reuseRadiusMiles, {
      requireSource: useAccu ? "accuweather" : undefined,
    });
    if (shared) {
      await bumpUsageMetric(db, "cache.hit.radius", 1);
      // Persist the reused bundle for this user/grid so `bundle_json` always reflects what we served.
      try {
        const fetchedAt = String(shared.fetched_at || new Date().toISOString());
        await db
          .prepare(
            `INSERT INTO weather_data (user_id, location_id, grid_key, lat, lon, fetched_at, bundle_json)
             VALUES (?, ?, ?, ?, ?, ?, ?)`
          )
          .bind(userId, opts.locationId, gridKey, lat, lon, fetchedAt, JSON.stringify(shared))
          .run();
      } catch {
        /* ignore */
      }
      return shared;
    }
  }

  await bumpUsageMetric(db, "cache.miss.dashboard", 1);

  // Free-tier daily cap: limit outside-data fetches (AccuWeather / Open-Meteo / NWS network)
  // to FREE_DAILY_FRESH_FETCH_CAP per UTC day for non-Pro accounts. When the cap is hit we
  // serve the most recent grid row regardless of age and annotate the bundle so clients can
  // show an upgrade nudge. Pro/Lifetime users are never capped.
  const today = utcDayKey();
  const proFlags = await loadProFlags(db, userId);
  if (!proFlags.pro) {
    const used = await freeFreshFetchesToday(db, userId, today);
    if (used >= FREE_DAILY_FRESH_FETCH_CAP) {
      await bumpUsageMetric(db, "free_tier.cap_blocked", 1);
      const stale = await staleAnyAgeBundle(db, gridKey);
      if (stale) {
        stale.free_daily_limit_reached = true;
        stale.free_daily_limit = FREE_DAILY_FRESH_FETCH_CAP;
        return stale;
      }
      return {
        current: { available: false, reason: "free_daily_limit" },
        alerts: { available: false, alerts: [] },
        canada_alerts: { available: false, alerts: [] },
        usgs: { available: false, events: [] },
        forecast: { available: false, periods: [], hourly: [] },
        kilauea_hvo: { available: false },
        fetched_at: new Date().toISOString(),
        free_daily_limit_reached: true,
        free_daily_limit: FREE_DAILY_FRESH_FETCH_CAP,
      };
    }
  }

  // Shared location lookup must not throw: Accu quota/401/503 would otherwise bypass
  // Promise.allSettled and surface as HTTP 500 from the Worker.
  const weatherEnv: DashboardEnv = { ...env };
  if (useAccu) {
    try {
      accuLoc = await accuLocationKey(env, db, lat, lon);
    } catch {
      accuLoc = null;
      weatherEnv.ACCUWEATHER_API_KEY = "";
    }
  }

  const nearKilauea =
    haversineMiles(lat, lon, KILAUEA_SUMMIT_LAT, KILAUEA_SUMMIT_LON) <= HVO_BUNDLE_RADIUS_MILES;
  const settled = await Promise.allSettled([
    weatherCurrent(lat, lon, weatherEnv, db, accuLoc || undefined),
    weatherAlerts(lat, lon, weatherEnv, db, accuLoc || undefined),
    useAccu ? Promise.resolve({ available: false, alerts: [], source: "disabled_under_accuweather_tos" }) : canadaAlerts(lat, lon),
    usgsEarthquakes(lat, lon, nearKilauea ? 420 : 300, "day", nearKilauea ? 1.2 : 2.5),
    weatherForecast(lat, lon, weatherEnv, db, accuLoc || undefined),
    nearKilauea ? usgsHvoKilaueaNotice(db) : Promise.resolve({ available: false, reason: "outside_hvo_region" }),
  ]);
  const vals = settled.map((s) => (s.status === "fulfilled" ? s.value : s.reason));
  const [current, alerts, canada, usgs, forecast, hvo] = vals;

  const bundle: Record<string, unknown> = {
    current: safe(current, { available: false }),
    alerts: safe(alerts, { available: false, alerts: [] }),
    canada_alerts: safe(canada, { available: false, alerts: [] }),
    usgs: safe(usgs, { available: false, events: [] }),
    forecast: safe(forecast, { available: false, periods: [], hourly: [] }),
    kilauea_hvo: safe(hvo, { available: false }),
    fetched_at: new Date().toISOString(),
  };

  const fetchedAt = bundle.fetched_at as string;
  try {
    await db
      .prepare(
        `INSERT INTO weather_data (user_id, location_id, grid_key, lat, lon, fetched_at, bundle_json)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        userId,
        opts.locationId,
        gridKey,
        lat,
        lon,
        fetchedAt,
        JSON.stringify(bundle)
      )
      .run();
  } catch {
    /* D1 insert failure should not block response */
  }

  if (!proFlags.pro) {
    await bumpFreeFreshFetch(db, userId, today);
  }

  return bundle;
}
