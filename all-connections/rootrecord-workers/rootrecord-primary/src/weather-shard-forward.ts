/**
 * Backwards-compat shim: weather / dashboard / hazard routes have been moved off
 * `rootrecord-primary` to `rootrecord-api-weather`. APKs still in the field with
 * `REACT_APP_BACKEND_URL = https://api.rootrecord.info` would otherwise 404 on
 * `/api/dashboard`, `/api/weather/*`, `/api/canada/*`, `/api/usgs/*`, `/api/eonet/*`.
 *
 * Reverse-proxies those paths to the weather shard, preserving the Authorization
 * header (Bearer token validates against the same `license_accounts` / D1 the
 * primary used to serve, so authed dashboard calls keep working).
 *
 * Configure base URL with [vars] ROOTRECORD_API_WEATHER_BASE in wrangler.toml.
 * Falls back to the workers.dev origin if unset so legacy installs stay alive
 * even without a redeploy that includes the [vars] block.
 */

// Use the Custom Domain, not the workers.dev URL. The weather shard has
// `workers_dev` disabled (returns Cloudflare error 1042 / HTML 404).
const DEFAULT_WEATHER_SHARD_BASE = "https://api-weather.rootrecord.info";

function stripHopByHopHeaders(incoming: Headers): Headers {
  const out = new Headers();
  for (const [k, v] of incoming.entries()) {
    const lk = k.toLowerCase();
    if (
      lk === "host" ||
      lk === "connection" ||
      lk === "content-length" ||
      lk === "cf-connecting-ip" ||
      lk === "cf-ray" ||
      lk === "cf-visitor"
    ) {
      continue;
    }
    out.set(k, v);
  }
  return out;
}

function apiSubpath(pathname: string): string {
  if (!pathname.startsWith("/api")) return pathname;
  const rest = pathname.slice(4);
  return rest === "" ? "/" : rest;
}

function isMovedToWeatherShard(sub: string): boolean {
  if (sub === "/dashboard") return true;
  if (sub.startsWith("/weather/")) return true;
  if (sub.startsWith("/canada/")) return true;
  if (sub.startsWith("/usgs/")) return true;
  if (sub.startsWith("/eonet/")) return true;
  return false;
}

export type WeatherShardForwardEnv = {
  ROOTRECORD_API_WEATHER_BASE?: string;
};

export async function maybeForwardWeatherShard(
  request: Request,
  env: WeatherShardForwardEnv,
  pathname: string,
  method: string,
): Promise<Response | null> {
  if (!pathname.startsWith("/api")) return null;
  const sub = apiSubpath(pathname);
  if (!isMovedToWeatherShard(sub)) return null;

  let base = String(env.ROOTRECORD_API_WEATHER_BASE || "").trim().replace(/\/+$/, "");
  if (!base) base = DEFAULT_WEATHER_SHARD_BASE;
  if (!/^https?:\/\//i.test(base)) base = `https://${base}`;

  const url = new URL(request.url);
  const dest = `${base}${pathname}${url.search}`;

  const headers = stripHopByHopHeaders(request.headers);
  let body: ArrayBuffer | undefined;
  if (method !== "GET" && method !== "HEAD") {
    try {
      body = await request.arrayBuffer();
    } catch {
      body = undefined;
    }
  }

  try {
    return await fetch(dest, {
      method,
      headers,
      body: method === "GET" || method === "HEAD" ? undefined : body,
      redirect: "manual",
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "weather_shard_forward_failed";
    return new Response(JSON.stringify({ ok: false, detail: msg }), {
      status: 502,
      headers: { "content-type": "application/json; charset=utf-8" },
    });
  }
}
