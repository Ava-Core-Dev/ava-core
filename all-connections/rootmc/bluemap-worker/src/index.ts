/**
 * Public BlueMap front door for map.rootmc.net
 * - R2 (rootmc-bluemap) for static tiles / webapp
 * - Optional live proxy to BlueMap webserver on the game host
 */
export interface Env {
  BLUEMAP_ASSETS: R2Bucket;
  BLUEMAP_ORIGIN: string;
  BLUEMAP_LIVE_PROXY_PATH: string;
  MAP_PUBLIC_HOST: string;
  MAP_SERVE_MODE: string; // hybrid | r2 | origin
}

const HOP_BY_HOP = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailers",
  "transfer-encoding",
  "upgrade",
]);

const LIVE_PROXY_DEFAULT = "/__bluemap-live";

function originBase(env: Env): string {
  return String(env.BLUEMAP_ORIGIN || "http://play.rootmc.net:22784").replace(/\/$/, "");
}

function publicHost(env: Env): string {
  return String(env.MAP_PUBLIC_HOST || "map.rootmc.net").trim().toLowerCase();
}

function serveMode(env: Env): "hybrid" | "r2" | "origin" {
  const raw = String(env.MAP_SERVE_MODE || "hybrid").trim().toLowerCase();
  if (raw === "origin" || raw === "r2") return raw;
  return "hybrid";
}

function liveProxyPrefix(env: Env): string {
  const p = String(env.BLUEMAP_LIVE_PROXY_PATH || LIVE_PROXY_DEFAULT).replace(/\/$/, "");
  return p.startsWith("/") ? p : `/${p}`;
}

function filterRequestHeaders(headers: Headers, env: Env, publicHostname: string): Headers {
  const out = new Headers();
  for (const [key, value] of headers.entries()) {
    const lower = key.toLowerCase();
    if (lower === "host") {
      out.set("host", new URL(originBase(env)).host);
      continue;
    }
    if (lower.startsWith("cf-") || lower === "cdn-loop") continue;
    if (HOP_BY_HOP.has(lower)) continue;
    out.set(key, value);
  }
  out.set("X-Forwarded-Host", publicHostname);
  out.set("X-Forwarded-Proto", "https");
  return out;
}

function frameAncestorCsp(env: Env): string {
  const hosts = new Set<string>(["'self'"]);
  const pub = publicHost(env);
  const parts = pub.split(".");
  if (parts.length >= 2) {
    const apex = parts.slice(-2).join(".");
    hosts.add(`https://${apex}`);
    hosts.add(`https://*.${apex}`);
  }
  hosts.add("https://rootmc.net");
  hosts.add("https://*.rootmc.net");
  return `frame-ancestors ${[...hosts].join(" ")}`;
}

function sanitizeResponseHeaders(
  headers: Headers,
  env: Env,
  publicHostname: string,
  cacheSeconds: number,
): Headers {
  const out = new Headers(headers);
  out.delete("content-security-policy");
  out.delete("x-frame-options");
  out.set("Content-Security-Policy", frameAncestorCsp(env));
  out.set("Access-Control-Allow-Origin", "*");
  out.append("Vary", "Origin");
  out.set("Cache-Control", `public, max-age=${cacheSeconds}`);
  out.delete("set-cookie");
  void publicHostname;
  return out;
}

function objectKey(pathname: string): string {
  let key = pathname.replace(/^\//, "");
  if (!key) return "index.html";
  if (key.endsWith("/")) return `${key}index.html`;
  return key;
}

function guessContentType(key: string): string | undefined {
  const base = key.endsWith(".gz") ? key.slice(0, -3) : key;
  if (base.endsWith(".html")) return "text/html; charset=utf-8";
  if (base.endsWith(".js")) return "application/javascript; charset=utf-8";
  if (base.endsWith(".css")) return "text/css; charset=utf-8";
  if (base.endsWith(".json")) return "application/json; charset=utf-8";
  if (base.endsWith(".png")) return "image/png";
  if (base.endsWith(".svg")) return "image/svg+xml";
  if (base.endsWith(".woff2")) return "font/woff2";
  if (base.endsWith(".prbm")) return "application/octet-stream";
  if (key.endsWith(".gz")) return "application/gzip";
  return undefined;
}

function cacheSecondsForKey(key: string): number {
  if (key === "settings.json" || key === "settings.json.gz") return 60;
  if (key.startsWith("maps/")) return 300;
  if (key.startsWith("assets/")) return 3600;
  return 60;
}

function isRemovedMapPath(pathname: string): boolean {
  return /^\/maps\/world_the_(nether|end)(\/|$)/.test(pathname);
}

async function patchSettingsJson(body: string, env: Env): Promise<string> {
  try {
    const parsed = JSON.parse(body) as Record<string, unknown>;
    const host = publicHost(env);
    parsed.maps = ["world", "gen2"];
    parsed.liveDataRoot = `https://${host}${liveProxyPrefix(env)}`;
    parsed.defaultToFlatView = true;
    return JSON.stringify(parsed);
  } catch {
    return body;
  }
}

/** True when R2 body is gzip (`.gz` key, BlueMap S3 Content-Encoding metadata, or magic bytes). */
function isGzipStored(object: R2Object, storedKey: string): boolean {
  if (storedKey.endsWith(".gz")) return true;
  const enc = String(object.httpMetadata?.contentEncoding || "").toLowerCase();
  return enc === "gzip" || enc === "x-gzip";
}

/** BlueMap S3 often uploads gzip bytes under the logical name with no Content-Encoding metadata. */
function shouldSniffGzip(key: string): boolean {
  const base = key.endsWith(".gz") ? key.slice(0, -3) : key;
  return base.endsWith(".json") || base.endsWith(".prbm") || base.endsWith(".png");
}

async function sniffGzipMagic(bucket: R2Bucket, key: string): Promise<boolean> {
  const head = await bucket.get(key, { range: { offset: 0, length: 2 } });
  if (!head) return false;
  const buf = new Uint8Array(await head.arrayBuffer());
  return buf.length >= 2 && buf[0] === 0x1f && buf[1] === 0x8b;
}

/** BlueMap S3 storage writes gzip as name.gz and/or Content-Encoding: gzip on name. */
async function getR2Object(bucket: R2Bucket, key: string): Promise<{
  object: R2ObjectBody;
  key: string;
  gzip: boolean;
} | null> {
  const direct = await bucket.get(key);
  if (direct) {
    let gzip = isGzipStored(direct, key);
    if (!gzip && shouldSniffGzip(key) && (await sniffGzipMagic(bucket, key))) {
      gzip = true;
    }
    return { object: direct, key, gzip };
  }

  if (!key.endsWith(".gz")) {
    const gzKey = `${key}.gz`;
    const gz = await bucket.get(gzKey);
    if (gz) return { object: gz, key: gzKey, gzip: true };
  }
  return null;
}

async function serveFromR2(request: Request, env: Env): Promise<Response | null> {
  if (!env.BLUEMAP_ASSETS) return null;
  if (request.method !== "GET" && request.method !== "HEAD") return null;
  const url = new URL(request.url);
  let key = objectKey(url.pathname);
  let hit = await getR2Object(env.BLUEMAP_ASSETS, key);
  if (!hit && !url.pathname.endsWith("/") && !key.includes(".")) {
    key = `${key}/index.html`;
    hit = await getR2Object(env.BLUEMAP_ASSETS, key);
  }
  if (!hit) return null;

  const headers = new Headers();
  hit.object.writeHttpMetadata(headers);
  const serveCompressed = hit.gzip && !url.pathname.endsWith(".gz");
  const guessed = guessContentType(serveCompressed ? key : hit.key);
  // Logical URL is uncompressed; body is still gzip — must keep encoding + encodeBody:manual
  // or the Workers runtime strips Content-Encoding and BlueMap fails to parse tiles/JSON.
  if (serveCompressed) {
    headers.set("Content-Encoding", "gzip");
    headers.delete("Content-Length");
    const logicalType = guessContentType(key);
    if (logicalType) headers.set("Content-Type", logicalType);
  } else if (guessed && !headers.has("Content-Type")) {
    headers.set("Content-Type", guessed);
  }
  headers.set("etag", hit.object.httpEtag);
  sanitizeResponseHeaders(headers, env, publicHost(env), cacheSecondsForKey(hit.key));

  if ((key === "settings.json" || hit.key === "settings.json" || hit.key === "settings.json.gz")
      && request.method === "GET") {
    // Always patch plain JSON; decompress when R2 body is gzip.
    let raw: string;
    if (hit.gzip) {
      const ds = new DecompressionStream("gzip");
      raw = await new Response(hit.object.body.pipeThrough(ds)).text();
      headers.delete("Content-Encoding");
    } else {
      raw = await hit.object.text();
    }
    const patched = await patchSettingsJson(raw, env);
    headers.delete("etag");
    headers.set("Content-Type", "application/json; charset=utf-8");
    return new Response(patched, { status: 200, headers });
  }

  // Re-assert after sanitize — CF strips this unless encodeBody is manual.
  if (serveCompressed) {
    headers.set("Content-Encoding", "gzip");
    headers.delete("Content-Length");
  }

  return new Response(request.method === "HEAD" ? null : hit.object.body, {
    status: 200,
    headers,
    // Pass through pre-gzipped R2 bodies without the runtime re-encoding/stripping.
    ...(serveCompressed ? { encodeBody: "manual" as const } : {}),
  });
}

async function mapDataReady(env: Env): Promise<boolean> {
  if (serveMode(env) !== "origin" && env.BLUEMAP_ASSETS) {
    const obj = await env.BLUEMAP_ASSETS.get("maps/world/settings.json");
    if (obj) return true;
    const gz = await env.BLUEMAP_ASSETS.get("maps/world/settings.json.gz");
    if (gz) return true;
  }
  try {
    const probe = await fetch(`${originBase(env)}/maps/world/settings.json`, {
      method: "HEAD",
      cf: { cacheTtl: 30 },
    });
    return probe.ok;
  } catch {
    return false;
  }
}

function mapMaintenanceHtml(host: string): string {
  return `<!DOCTYPE html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Map unavailable — ${host}</title>
<style>
  body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;
    background:#0a140a;color:#e8f0e8;font-family:system-ui,sans-serif;padding:1.5rem}
  main{max-width:32rem;text-align:center}
  h1{font-size:1.5rem;margin:0 0 .75rem}
  p{color:#9cb09c;line-height:1.55;margin:.5rem 0}
  a{color:#7ecf7e}
</style></head><body>
<main>
  <h1>Live map is offline</h1>
  <p>Map tiles are not available yet. The game server needs BlueMap running, or tiles must be synced to storage.</p>
  <p>This is not a browser or WebGL issue.</p>
  <p><a href="https://play.rootmc.net">play.rootmc.net</a> · <a href="https://rootmc.net">rootmc.net</a> · <a href="https://discord.gg/rFFQYrNaqS">Discord</a></p>
</main></body></html>`;
}

function isMapHomePath(pathname: string): boolean {
  return pathname === "/" || pathname === "/index.html";
}

function isLiveDataPath(pathname: string): boolean {
  return /^\/maps\/[^/]+\/live(\/|$)/.test(pathname);
}

function isStaticMapPath(pathname: string): boolean {
  return pathname === "/settings.json"
    || pathname.startsWith("/assets/")
    || pathname.startsWith("/maps/");
}

function originUnreachableResponse(env: Env, detail: string): Response {
  return new Response(
    `BlueMap origin unreachable (${originBase(env)}).\n${detail}`,
    { status: 502, headers: { "Content-Type": "text/plain; charset=utf-8" } },
  );
}

async function proxyOrigin(
  request: Request,
  env: Env,
  publicHostname: string,
  pathnameOverride?: string,
): Promise<Response> {
  const url = new URL(request.url);
  const path = pathnameOverride ?? `${url.pathname}${url.search}`;
  const target = `${originBase(env)}${path.startsWith("/") ? path : `/${path}`}`;
  const headers = filterRequestHeaders(request.headers, env, publicHostname);
  const init: RequestInit = {
    method: request.method,
    headers,
    redirect: "manual",
  };
  if (request.method !== "GET" && request.method !== "HEAD") {
    init.body = request.body;
  }
  const live = isLiveDataPath(pathnameOverride ?? url.pathname);
  try {
    const upstream = await fetch(target, init);
    // Cloudflare may return 52x Response objects instead of throwing when origin is down.
    if (upstream.status === 521 || upstream.status === 522 || upstream.status === 523) {
      return originUnreachableResponse(env, `upstream ${upstream.status}`);
    }
    return new Response(upstream.body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers: sanitizeResponseHeaders(upstream.headers, env, publicHostname, live ? 0 : 30),
    });
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    return originUnreachableResponse(env, detail);
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const hostname = url.hostname.toLowerCase();
    const expected = publicHost(env);
    if (hostname !== expected && !hostname.endsWith(".workers.dev")) {
      return new Response("Wrong host", { status: 421 });
    }
    const mode = serveMode(env);
    const livePrefix = liveProxyPrefix(env);

    if (request.headers.get("Upgrade")?.toLowerCase() === "websocket") {
      return proxyOrigin(request, env, expected);
    }
    if (url.pathname === livePrefix || url.pathname.startsWith(`${livePrefix}/`)) {
      const rest = url.pathname.slice(livePrefix.length) || "/";
      const originPath = `/maps${rest}${url.search}`;
      const proxied = await proxyOrigin(request, env, expected, originPath);
      if (proxied.status >= 500 && mode !== "origin") {
        // Shockbyte :22784 often closed externally — serve last R2 live snapshot.
        const r2Path = originPath.split("?")[0] || "/";
        const fake = new Request(new URL(r2Path, url.origin).toString(), { method: "GET" });
        const r2 = await serveFromR2(fake, env);
        if (r2) return r2;
      }
      return proxied;
    }
    if (isLiveDataPath(url.pathname)) {
      const proxied = await proxyOrigin(request, env, expected);
      if (proxied.status >= 500 && mode !== "origin") {
        const r2 = await serveFromR2(request, env);
        if (r2) return r2;
      }
      return proxied;
    }
    if (isRemovedMapPath(url.pathname)) {
      return new Response("Map not available", { status: 404 });
    }
    if (request.method === "GET" && isMapHomePath(url.pathname)) {
      const ready = await mapDataReady(env);
      if (!ready) {
        return new Response(mapMaintenanceHtml(expected), {
          status: 503,
          headers: {
            "Content-Type": "text/html; charset=utf-8",
            "Cache-Control": "public, max-age=60",
          },
        });
      }
    }
    if (mode !== "origin") {
      const r2 = await serveFromR2(request, env);
      if (r2) return r2;
      if (mode === "r2" || isStaticMapPath(url.pathname)) {
        // Do not fall through to unreachable Shockbyte :22784 for missing tile keys —
        // that used to surface as Cloudflare 521 and blank the map UI.
        return new Response("Not found in map storage", { status: 404 });
      }
    }
    return proxyOrigin(request, env, expected);
  },
};
