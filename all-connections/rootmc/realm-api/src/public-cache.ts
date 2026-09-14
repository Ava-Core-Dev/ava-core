/**
 * Cache foundations for public read-only GETs (site JSON, future peer mesh).
 * Auth / writes / heartbeats must remain uncacheable (no-store).
 */

const PUBLIC_GET_TTL: Array<{ re: RegExp; ttl: number }> = [
  { re: /^\/api\/rootmc\/server\/config\/?$/, ttl: 30 },
  { re: /^\/api\/rootmc\/server\/featured\/?$/, ttl: 30 },
  { re: /^\/api\/rootmc\/list\/?$/, ttl: 60 },
  { re: /^\/api\/rootmc\/stock-market(\/items)?\/?$/, ttl: 30 },
  { re: /^\/api\/rootmc\/stock-market\/items\/.+\/history\/?$/, ttl: 60 },
  { re: /^\/api\/rootmc\/treasury\/[^/]+\/reserve\/?$/, ttl: 30 },
  { re: /^\/api\/rootmc\/daily-report\/?$/, ttl: 120 },
  { re: /^\/api\/rootmc\/weekly-activity\/highlights\/?$/, ttl: 60 },
  { re: /^\/api\/rootmc\/time\//, ttl: 30 },
  { re: /^\/api\/rootmc\/activity\/timezones\/?$/, ttl: 60 },
  { re: /^\/api\/rootmc\/connection-preference\/?$/, ttl: 5 },
  { re: /^\/api\/v2\/health\/?$/, ttl: 10 },
  { re: /^\/api\/health\/?$/, ttl: 10 },
  { re: /^\/health\/?$/, ttl: 10 },
];

const UNCACHEABLE_PREFIXES = [
  "/api/account/",
  "/api/developer/",
  "/v1/discord/",
  "/api/rootmc/server/heartbeat",
  "/api/realm/minecraft/",
  "/api/mobile/",
];

export function publicGetCacheTtlSeconds(pathname: string, method: string): number | null {
  if (method !== "GET" && method !== "HEAD") return null;
  const path = pathname.replace(/\/+$/, "") || "/";
  for (const p of UNCACHEABLE_PREFIXES) {
    if (path === p.replace(/\/$/, "") || path.startsWith(p)) return null;
  }
  // POST-style write paths under realm that look like GET — still no.
  if (path.includes("/sync") || path.includes("/heartbeat")) return null;
  for (const { re, ttl } of PUBLIC_GET_TTL) {
    if (re.test(pathname) || re.test(path)) return ttl;
  }
  return null;
}

/** SHA-256 hex of body text for ETag (Workers Web Crypto). */
export async function etagForBody(body: string): Promise<string> {
  const data = new TextEncoder().encode(body);
  const digest = await crypto.subtle.digest("SHA-256", data);
  const hex = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
  return `"${hex.slice(0, 32)}"`;
}

export function cacheControlPublic(ttlSeconds: number): string {
  const ttl = Math.max(1, Math.floor(ttlSeconds));
  return `public, max-age=${ttl}, s-maxage=${ttl}, stale-while-revalidate=${Math.min(300, ttl * 2)}`;
}

export async function withPublicCacheHeaders(
  request: Request,
  response: Response,
  pathname: string,
): Promise<Response> {
  const ttl = publicGetCacheTtlSeconds(pathname, request.method);
  if (ttl == null) {
    if (request.method === "GET" || request.method === "HEAD") {
      const headers = new Headers(response.headers);
      if (!headers.has("Cache-Control")) headers.set("Cache-Control", "no-store");
      return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
    }
    return response;
  }
  if (response.status !== 200) return response;

  const headers = new Headers(response.headers);
  headers.set("Cache-Control", cacheControlPublic(ttl));
  headers.set("X-RootMC-Cacheable", "1");

  const ct = headers.get("content-type") || "";
  if (ct.includes("application/json") && request.method === "GET") {
    const body = await response.clone().text();
    const etag = await etagForBody(body);
    headers.set("ETag", etag);
    const inm = request.headers.get("If-None-Match");
    if (inm && inm === etag) {
      return new Response(null, { status: 304, headers });
    }
    return new Response(body, { status: response.status, statusText: response.statusText, headers });
  }

  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}
