export interface Env {
  BLUEMAP_ORIGIN?: string;
  MAP_PUBLIC_HOST?: string;
  /** origin | hybrid | r2 — hybrid serves R2 when present, falls back to origin */
  MAP_SERVE_MODE?: string;
  /** Webapp live-data-root base path on this host (proxied to origin /maps/…) */
  BLUEMAP_LIVE_PROXY_PATH?: string;
  BLUEMAP_ASSETS?: R2Bucket;
}

interface R2Bucket {
  get(key: string): Promise<R2ObjectBody | null>;
}

interface R2ObjectBody {
  body: ReadableStream | null;
  httpEtag: string;
  writeHttpMetadata(headers: Headers): void;
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
  return String(env.BLUEMAP_ORIGIN || "http://play.rootrecord.info:22784").replace(/\/$/, "");
}

function publicHost(env: Env): string {
  return String(env.MAP_PUBLIC_HOST || "map.rootrecord.info").trim().toLowerCase();
}

function serveMode(env: Env): "origin" | "hybrid" | "r2" {
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

function sanitizeResponseHeaders(headers: Headers, env: Env, publicHostname: string, cacheSeconds: number): Headers {
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
  if (key.endsWith(".html")) return "text/html; charset=utf-8";
  if (key.endsWith(".js")) return "application/javascript; charset=utf-8";
  if (key.endsWith(".css")) return "text/css; charset=utf-8";
  if (key.endsWith(".json")) return "application/json; charset=utf-8";
  if (key.endsWith(".png")) return "image/png";
  if (key.endsWith(".svg")) return "image/svg+xml";
  if (key.endsWith(".woff2")) return "font/woff2";
  if (key.endsWith(".gz")) return "application/gzip";
  return undefined;
}

function cacheSecondsForKey(key: string): number {
  if (key === "settings.json") return 60;
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
    parsed.maps = ["world"];
    parsed.liveDataRoot = `https://${host}${liveProxyPrefix(env)}`;
    parsed.defaultToFlatView = true;
    return JSON.stringify(parsed);
  } catch {
    return body;
  }
}

async function serveFromR2(request: Request, env: Env): Promise<Response | null> {
  if (!env.BLUEMAP_ASSETS) return null;
  if (request.method !== "GET" && request.method !== "HEAD") return null;

  const url = new URL(request.url);
  const key = objectKey(url.pathname);
  let object = await env.BLUEMAP_ASSETS.get(key);
  if (!object && !url.pathname.endsWith("/") && !key.includes(".")) {
    object = await env.BLUEMAP_ASSETS.get(`${key}/index.html`);
  }
  if (!object) return null;

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  const guessed = guessContentType(key);
  if (guessed && !headers.has("Content-Type")) {
    headers.set("Content-Type", guessed);
  }
  headers.set("etag", object.httpEtag);
  sanitizeResponseHeaders(headers, env, publicHost(env), cacheSecondsForKey(key));

  if (key === "settings.json" && request.method === "GET") {
    const raw = await object.text();
    const patched = await patchSettingsJson(raw, env);
    headers.delete("etag");
    return new Response(patched, { status: 200, headers });
  }

  return new Response(request.method === "HEAD" ? null : object.body, {
    status: 200,
    headers,
  });
}

async function mapDataReady(env: Env): Promise<boolean> {
  if (serveMode(env) !== "origin" && env.BLUEMAP_ASSETS) {
    const obj = await env.BLUEMAP_ASSETS.get("maps/world/settings.json");
    if (obj) return true;
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

/** Live markers/players must never be served from R2 — always origin :22784. */
function isLiveDataPath(pathname: string): boolean {
  return /^\/maps\/[^/]+\/live(\/|$)/.test(pathname);
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
    return new Response(upstream.body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers: sanitizeResponseHeaders(upstream.headers, env, publicHostname, live ? 0 : 30),
    });
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    return new Response(
      `BlueMap origin unreachable (${originBase(env)}).\n${detail}`,
      { status: 502, headers: { "Content-Type": "text/plain; charset=utf-8" } },
    );
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
      return proxyOrigin(request, env, expected, originPath);
    }

    if (isLiveDataPath(url.pathname)) {
      return proxyOrigin(request, env, expected);
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
      if (mode === "r2") {
        return new Response("Not found in map storage", { status: 404 });
      }
    }

    return proxyOrigin(request, env, expected);
  },
};
