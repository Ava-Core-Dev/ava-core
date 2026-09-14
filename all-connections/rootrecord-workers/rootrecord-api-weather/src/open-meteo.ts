// Open-Meteo current-conditions provider.
// Free, no API key, no per-day quota for reasonable use (Open-Meteo asks for fewer than
// 10K req/day per IP — Workers Cache API + the 30-min TTL below keep us well under that).
//
// Used by weather.ts as a real-data backfill when AccuWeather is unavailable (quota /
// transient error / not configured). Returns `observation` and `hourly_now` in the same
// shape weather.ts already emits so the merge is mechanical.
//
// Note: Open-Meteo does not provide every AccuWeather field (UV index lives on the daily
// endpoint, not the current one in older API versions). We only return fields we trust.

import type { D1Database } from "@cloudflare/workers-types";
import { bumpUsageMetric } from "./usage";

const OPEN_METEO_BASE = "https://api.open-meteo.com/v1/forecast";

/** Variables we want from the `current` block. Open-Meteo will silently omit any it doesn't recognise. */
const CURRENT_VARS = [
  "temperature_2m",
  "relative_humidity_2m",
  "apparent_temperature",
  "wet_bulb_temperature_2m",
  "dew_point_2m",
  "wind_speed_10m",
  "wind_gusts_10m",
  "wind_direction_10m",
  "pressure_msl",
  "cloud_cover",
  "precipitation",
  "visibility",
  "weather_code",
  "is_day",
].join(",");

export interface OpenMeteoBackfill {
  /** Partial NWS-shaped observation (envelope `{ unitCode, value }` for scalars). */
  observation: Record<string, unknown>;
  /** Partial NWS-shaped hourly_now (bare scalars / strings; matches AccuWeather branch). */
  hourly_now: Record<string, unknown>;
  source: "open-meteo";
  attribution: "Open-Meteo";
  fetched_at: string;
}

function isFiniteNumber(n: unknown): n is number {
  return typeof n === "number" && Number.isFinite(n);
}

/**
 * Fetch Open-Meteo current conditions for the given coordinates. Caches per-DC via the
 * Workers Cache API for [ttlSec] (default 30 minutes). Returns null on any network /
 * parse failure so callers can keep their original payload.
 */
export async function fetchOpenMeteoCurrent(
  lat: number,
  lon: number,
  opts?: { db?: D1Database; ttlSec?: number }
): Promise<OpenMeteoBackfill | null> {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  const ttlSec = Math.max(60, opts?.ttlSec ?? 1800);
  const u = new URL(OPEN_METEO_BASE);
  // Round to 3 decimals (~110 m grid) so the cache key is shared across users near the same spot.
  u.searchParams.set("latitude", lat.toFixed(3));
  u.searchParams.set("longitude", lon.toFixed(3));
  u.searchParams.set("current", CURRENT_VARS);
  u.searchParams.set("wind_speed_unit", "kmh");
  u.searchParams.set("precipitation_unit", "mm");
  u.searchParams.set("temperature_unit", "celsius");
  u.searchParams.set("timezone", "auto");

  const cacheKey = new Request(u.toString());
  const cache = (caches as unknown as { default?: Cache }).default || null;
  let body: string | null = null;
  if (cache && ttlSec > 0) {
    try {
      const hit = await cache.match(cacheKey);
      if (hit && hit.ok) {
        await bumpUsageMetric(opts?.db, "open-meteo.cache.hit", 1);
        body = await hit.text();
      }
    } catch {
      /* cache miss → network */
    }
  }
  if (!body) {
    try {
      const r = await fetch(u.toString(), { headers: { Accept: "application/json" } });
      if (!r.ok) {
        await bumpUsageMetric(opts?.db, "open-meteo.call.error", 1);
        return null;
      }
      await bumpUsageMetric(opts?.db, "open-meteo.call.current", 1);
      body = await r.text();
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
          /* best-effort */
        }
      }
    } catch {
      await bumpUsageMetric(opts?.db, "open-meteo.call.error", 1);
      return null;
    }
  }

  try {
    const j = JSON.parse(body) as Record<string, unknown>;
    const cur = (j.current as Record<string, unknown> | undefined) || undefined;
    if (!cur) return null;
    const tempC = cur.temperature_2m;
    const feelsC = cur.apparent_temperature;
    const wetBulbC = cur.wet_bulb_temperature_2m;
    const dewC = cur.dew_point_2m;
    const rh = cur.relative_humidity_2m;
    const windKmh = cur.wind_speed_10m;
    const gustKmh = cur.wind_gusts_10m;
    const windDeg = cur.wind_direction_10m;
    const pressureHPa = cur.pressure_msl;
    const cloudPct = cur.cloud_cover;
    const precipMm = cur.precipitation;
    const visibilityM = cur.visibility;

    const observation: Record<string, unknown> = {};
    if (isFiniteNumber(tempC)) observation.temperature = { unitCode: "wmoUnit:degC", value: tempC };
    if (isFiniteNumber(feelsC)) observation.feelsLike = { unitCode: "wmoUnit:degC", value: feelsC };
    if (isFiniteNumber(dewC)) observation.dewpoint = { unitCode: "wmoUnit:degC", value: dewC };
    if (isFiniteNumber(wetBulbC)) observation.wetBulbTemperature = { unitCode: "wmoUnit:degC", value: wetBulbC };
    if (isFiniteNumber(rh)) observation.relativeHumidity = { unitCode: "wmoUnit:percent", value: rh };
    if (isFiniteNumber(windKmh)) observation.windSpeed = { unitCode: "wmoUnit:km_h-1", value: windKmh };
    if (isFiniteNumber(gustKmh)) observation.windGust = { unitCode: "wmoUnit:km_h-1", value: gustKmh };
    if (isFiniteNumber(windDeg)) observation.windDirection = { unitCode: "wmoUnit:degree_(angle)", value: windDeg };
    if (isFiniteNumber(pressureHPa)) {
      // Match the AccuWeather/NWS shape which stores Pascals.
      observation.barometricPressure = { unitCode: "wmoUnit:Pa", value: pressureHPa * 100 };
    }
    if (isFiniteNumber(cloudPct)) observation.cloudCover = { unitCode: "wmoUnit:percent", value: cloudPct };
    if (isFiniteNumber(precipMm)) observation.precip1h = { unitCode: "wmoUnit:mm", value: precipMm };
    if (isFiniteNumber(visibilityM)) observation.visibility = { unitCode: "wmoUnit:m", value: visibilityM };

    const hourly_now: Record<string, unknown> = {};
    if (isFiniteNumber(tempC)) {
      hourly_now.temperature = tempC;
      hourly_now.temperatureUnit = "C";
    }
    if (isFiniteNumber(feelsC)) hourly_now.feelsLike = feelsC;
    if (isFiniteNumber(dewC)) hourly_now.dewPoint = dewC;
    if (isFiniteNumber(wetBulbC)) hourly_now.wetBulb = wetBulbC;
    if (isFiniteNumber(rh)) hourly_now.relativeHumidity = { unitCode: "wmoUnit:percent", value: rh };
    if (isFiniteNumber(windKmh)) hourly_now.windSpeed = `${Math.round(windKmh)} km/h`;
    if (isFiniteNumber(gustKmh)) hourly_now.windGust = `${Math.round(gustKmh)} km/h`;
    if (isFiniteNumber(cloudPct)) hourly_now.cloudCover = `${Math.round(cloudPct)}%`;
    if (isFiniteNumber(precipMm)) hourly_now.precip1h = `${precipMm.toFixed(1)} mm`;

    return {
      observation,
      hourly_now,
      source: "open-meteo",
      attribution: "Open-Meteo",
      fetched_at: String((cur.time as string | undefined) || new Date().toISOString()),
    };
  } catch {
    return null;
  }
}
