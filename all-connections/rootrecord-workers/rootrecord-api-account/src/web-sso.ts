/** Cross-subdomain web SSO: HttpOnly session cookie with `Domain=.rootrecord.info` when the API hostname is under `*.rootrecord.info`. */

export const RR_WEB_SESSION_COOKIE = "rr_web_session";

const JWT_TTL_SEC = 30 * 24 * 60 * 60;

export function allowedWebCredentialOrigin(origin: string | null): string | null {
  if (!origin || typeof origin !== "string") return null;
  const o = origin.trim();
  if (!/^https:\/\//i.test(o)) {
    if (/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(o)) return o;
    return null;
  }
  try {
    const u = new URL(o);
    const host = u.hostname.toLowerCase();
    if (host === "rootrecord.info" || host === "www.rootrecord.info") return o;
    if (host === "rootrecord.cloud" || host === "www.rootrecord.cloud") return o;
    if (host === "rootrecord.online" || host === "www.rootrecord.online") return o;
    if (host.endsWith(".rootrecord.info")) return o;
    if (host.endsWith(".rootrecord.cloud")) return o;
    if (host.endsWith(".rootrecord.online")) return o;
    if (host.endsWith(".pages.dev")) return o;
  } catch {
    return null;
  }
  return null;
}

/**
 * When the API is served on a hostname under `rootrecord.info` (e.g. `api.rootrecord.info`,
 * `api-weather.rootrecord.info`, per-shard custom domains), set cookies visible to all `*.rootrecord.info` sites.
 * `*.workers.dev` cannot set `Domain=.rootrecord.info` (different site) — use a `*.rootrecord.info` route on the shard.
 */
export function ssoCookieDomainForApiHost(apiHost: string): string | null {
  const h = apiHost.split(":")[0]?.toLowerCase() || "";
  if (h === "rootrecord.info" || h === "rootrecord.cloud" || h === "rootrecord.online") return null;
  if (h.endsWith(".rootrecord.info")) return ".rootrecord.info";
  if (h.endsWith(".rootrecord.cloud")) return ".rootrecord.cloud";
  if (h.endsWith(".rootrecord.online")) return ".rootrecord.online";
  return null;
}

export function buildSessionCookieHeader(token: string, domain: string): string {
  const enc = encodeURIComponent(token);
  return `${RR_WEB_SESSION_COOKIE}=${enc}; Domain=${domain}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${JWT_TTL_SEC}`;
}

export function buildClearSessionCookieHeader(domain: string): string {
  return `${RR_WEB_SESSION_COOKIE}=; Domain=${domain}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}

export function parseSessionCookie(request: Request): string | null {
  const raw = request.headers.get("Cookie") || "";
  const needle = `${RR_WEB_SESSION_COOKIE}=`;
  const idx = raw.indexOf(needle);
  if (idx < 0) return null;
  let rest = raw.slice(idx + needle.length);
  const semi = rest.indexOf(";");
  if (semi >= 0) rest = rest.slice(0, semi);
  const v = decodeURIComponent(rest.trim());
  return v || null;
}
