import { json } from "./cors";

/** Narrow env slice — avoids circular import with `router.ts`. */
export interface AirNowEnv {
  AIRNOW_API_KEY?: string;
}

/**
 * Proxies EPA AirNow **current** observations (near real-time; updates ~hourly).
 *
 * @see https://docs.airnowapi.org/ (Current Observations by Lat/Lon)
 *
 * `AIRNOW_API_KEY` from https://docs.airnowapi.org/account/request/ — never ship in the mobile app.
 */

const AIRNOW_BASE = "https://www.airnowapi.org/aq/observation/latLong/current/";
/** Default: Volcano Village / HVNP (matches BigIslandLocation.VolcanoVillage in the Android app). */
const DEFAULT_LAT = 19.4194;
const DEFAULT_LON = -155.2888;

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

export async function handleAirNowCurrent(request: Request, env: AirNowEnv): Promise<Response> {
  const apiKey = String(env.AIRNOW_API_KEY || "").trim();
  if (!apiKey) {
    return json(
      {
        detail: "airnow_api_key_not_configured",
        hint: "Request an AirNow API key → wrangler secret put AIRNOW_API_KEY (see https://docs.airnowapi.org/).",
      },
      503,
    );
  }

  const url = new URL(request.url);
  let lat = Number(url.searchParams.get("lat"));
  let lon = Number(url.searchParams.get("lon"));
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    lat = DEFAULT_LAT;
    lon = DEFAULT_LON;
  }
  // Rough Hawaiʻi Island bounding box — reject absurd coordinates.
  lat = clamp(lat, 18.85, 20.35);
  lon = clamp(lon, -156.12, -154.75);

  let distance = Number(url.searchParams.get("distance"));
  if (!Number.isFinite(distance)) distance = 50;
  distance = Math.round(clamp(distance, 5, 100));

  const u = new URL(AIRNOW_BASE);
  u.searchParams.set("format", "application/json");
  u.searchParams.set("latitude", String(lat));
  u.searchParams.set("longitude", String(lon));
  u.searchParams.set("distance", String(distance));
  u.searchParams.set("API_KEY", apiKey);

  let upstream: Response;
  try {
    upstream = await fetch(u.toString(), { headers: { Accept: "application/json" } });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return json({ detail: "airnow_upstream_fetch_failed", message: msg.slice(0, 200) }, 502);
  }

  const text = await upstream.text();
  if (!upstream.ok) {
    return json(
      {
        detail: "airnow_upstream_error",
        upstream_status: upstream.status,
        body: text.slice(0, 400),
      },
      502,
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch {
    return json(
      {
        detail: "airnow_upstream_invalid_json",
        upstream_status: upstream.status,
        snippet: text.slice(0, 160),
      },
      502,
    );
  }

  const observations = Array.isArray(parsed) ? parsed : [];

  const payload = {
    schema: "rootrecord.kilauea.airnow_current.v1",
    documentation: "https://docs.airnowapi.org/",
    observed_at_note:
      "AirNow reports current conditions from nearby monitors; values update about once per hour and may be preliminary.",
    query: { lat, lon, distance_miles: distance },
    observations,
  };

  return json(payload, 200, {
    "Cache-Control": "public, max-age=2700",
  });
}
