import { json } from "./cors";

const AIR_QUALITY_BASE = "https://air-quality-api.open-meteo.com/v1/air-quality";

const CURRENT_VARS = [
  "us_aqi",
  "pm2_5",
  "pm10",
  "ozone",
  "sulphur_dioxide",
  "nitrogen_dioxide",
].join(",");

const DEFAULT_LAT = 19.4194;
const DEFAULT_LON = -155.2888;

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

function firstNum(arr: unknown): number | null {
  if (!Array.isArray(arr) || arr.length < 1) return null;
  const n = Number(arr[0]);
  return Number.isFinite(n) ? n : null;
}

function firstStr(arr: unknown): string | null {
  if (!Array.isArray(arr) || arr.length < 1) return null;
  const s = String(arr[0] ?? "").trim();
  return s || null;
}

/**
 * Near–real-time air quality for Volcano Village / Hawaiʻi Island via Open-Meteo (no API key).
 * @see https://open-meteo.com/en/docs/air-quality-api
 */
export async function handleAirQualityCurrent(request: Request): Promise<Response> {
  const url = new URL(request.url);
  let lat = Number(url.searchParams.get("lat"));
  let lon = Number(url.searchParams.get("lon"));
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    lat = DEFAULT_LAT;
    lon = DEFAULT_LON;
  }
  lat = clamp(lat, 18.85, 20.35);
  lon = clamp(lon, -156.12, -154.75);

  const u = new URL(AIR_QUALITY_BASE);
  u.searchParams.set("latitude", lat.toFixed(3));
  u.searchParams.set("longitude", lon.toFixed(3));
  u.searchParams.set("current", CURRENT_VARS);
  u.searchParams.set("timezone", "auto");

  const ttlSec = 30 * 60;
  const cacheKey = new Request(u.toString());
  const cache = (caches as unknown as { default?: Cache }).default || null;
  let body: string | null = null;

  if (cache) {
    try {
      const hit = await cache.match(cacheKey);
      if (hit?.ok) body = await hit.text();
    } catch {
      /* ignore */
    }
  }

  if (!body) {
    let res: Response;
    try {
      res = await fetch(u.toString(), {
        headers: { Accept: "application/json", "User-Agent": "RootRecord-Kilauea/1.0" },
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return json({ detail: "air_quality_fetch_failed", message: msg.slice(0, 200) }, 502);
    }
    body = await res.text();
    if (!res.ok) {
      return json(
        { detail: "air_quality_upstream_error", upstream_status: res.status, snippet: body.slice(0, 160) },
        502,
      );
    }
    if (cache && ttlSec > 0) {
      try {
        const cached = new Response(body, {
          headers: {
            "Content-Type": "application/json",
            "Cache-Control": `public, max-age=${ttlSec}`,
          },
        });
        await cache.put(cacheKey, cached);
      } catch {
        /* ignore */
      }
    }
  }

  let data: { current?: Record<string, unknown> };
  try {
    data = JSON.parse(body) as { current?: Record<string, unknown> };
  } catch {
    return json({ detail: "air_quality_invalid_json" }, 502);
  }

  const cur = data.current || {};
  const usAqi = firstNum(cur.us_aqi);
  const pm25 = firstNum(cur.pm2_5);
  const pm10 = firstNum(cur.pm10);
  const ozone = firstNum(cur.ozone);
  const so2 = firstNum(cur.sulphur_dioxide);
  const no2 = firstNum(cur.nitrogen_dioxide);
  const observedAt = firstStr(cur.time);

  if (usAqi == null && pm25 == null && pm10 == null) {
    return json({ detail: "air_quality_no_current_values" }, 502);
  }

  return json({
    schema: "rootrecord.kilauea.air_quality.v1",
    source: "open-meteo",
    attribution: "Open-Meteo",
    documentation: "https://open-meteo.com/en/docs/air-quality-api",
    fetched_at: new Date().toISOString(),
    location: { latitude: lat, longitude: lon },
    current: {
      us_aqi: usAqi,
      pm2_5_ug_m3: pm25,
      pm10_ug_m3: pm10,
      ozone_ug_m3: ozone,
      sulphur_dioxide_ug_m3: so2,
      nitrogen_dioxide_ug_m3: no2,
      observed_at: observedAt,
    },
    observed_at_note: observedAt
      ? `Model update ${observedAt} (Open-Meteo; not a ground monitor).`
      : "Open-Meteo air-quality model (not a ground monitor).",
  });
}
