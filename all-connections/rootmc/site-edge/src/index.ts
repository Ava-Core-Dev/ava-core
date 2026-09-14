/**
 * rootmc.net front door: Ava site origin first, KV last-known when Ava is down.
 * /api/* still proxies to api.rootmc.net (same as former Pages Functions).
 */
export interface Env {
  SITE_ORIGIN?: string;
  SITE_CACHE?: KVNamespace;
  ROOTMC_API_BASE?: string;
  ROOTMC_API_G2_BASE?: string;
  ROOTRECORD_API_ACCOUNT_BASE?: string;
  /** Optional Pages backup when Ava has never warmed KV */
  PAGES_FALLBACK?: string;
}

const DEFAULT_ORIGIN = "https://rootmc-web.pages.dev";
const DEFAULT_API = "https://api.rootmc.net";
const DEFAULT_PAGES = "https://rootmc-web.pages.dev";

const HOP = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailers",
  "transfer-encoding",
  "upgrade",
  "host",
  "cf-connecting-ip",
  "cf-ray",
  "cf-visitor",
  "x-forwarded-proto",
  "x-real-ip",
  "content-length",
]);

type CacheMeta = { contentType: string; status: number };

function originBase(env: Env): string {
  return String(env.SITE_ORIGIN || DEFAULT_ORIGIN).replace(/\/$/, "");
}

function cacheKey(pathWithQuery: string): string {
  return `site:v1:${pathWithQuery}`;
}

async function kvGet(
  env: Env,
  key: string,
): Promise<{ body: ArrayBuffer; meta: CacheMeta } | null> {
  if (!env.SITE_CACHE) return null;
  try {
    const got = await env.SITE_CACHE.getWithMetadata<CacheMeta>(key, "arrayBuffer");
    if (!got?.value || !got.metadata?.contentType) return null;
    return { body: got.value, meta: got.metadata };
  } catch {
    return null;
  }
}

async function kvPut(
  env: Env,
  key: string,
  body: ArrayBuffer,
  meta: CacheMeta,
  ttl = 86400 * 14,
): Promise<void> {
  if (!env.SITE_CACHE) return;
  try {
    // KV value limit ~25 MiB — skip huge binaries
    if (body.byteLength > 20 * 1024 * 1024) return;
    await env.SITE_CACHE.put(key, body, { expirationTtl: ttl, metadata: meta });
  } catch {
    /* ignore */
  }
}

function copyReqHeaders(request: Request): Headers {
  const headers = new Headers();
  request.headers.forEach((value, key) => {
    if (!HOP.has(key.toLowerCase())) headers.set(key, value);
  });
  headers.set("User-Agent", "RootMC-Site-Edge/1.0");
  return headers;
}

function withEdgeHeaders(headers: Headers, via: string): Headers {
  const out = new Headers(headers);
  out.set("X-RootMC-Site-Edge", via);
  out.set("Access-Control-Allow-Origin", "*");
  return out;
}

const DISRUPT_SCRIPT =
  '<script src="/scripts/disruption-banner.js" defer></script>';

function withDisruptionScript(buf: ArrayBuffer, ct: string): ArrayBuffer {
  if (!String(ct || "").includes("text/html")) return buf;
  let html = new TextDecoder().decode(buf);
  if (html.includes("disruption-banner.js")) return buf;
  if (/<\/body>/i.test(html)) html = html.replace(/<\/body>/i, `${DISRUPT_SCRIPT}</body>`);
  else html += DISRUPT_SCRIPT;
  const out = new TextEncoder().encode(html);
  return out.buffer.slice(out.byteOffset, out.byteOffset + out.byteLength);
}

async function fetchOrigin(
  request: Request,
  env: Env,
  pathWithQuery: string,
): Promise<Response> {
  const target = originBase(env) + pathWithQuery;
  return fetch(target, {
    method: request.method,
    headers: copyReqHeaders(request),
    redirect: "manual",
    cf: { cacheTtl: 0, cacheEverything: false },
  } as RequestInit);
}

async function fetchPagesFallback(
  request: Request,
  env: Env,
  pathWithQuery: string,
): Promise<Response | null> {
  const base = String(env.PAGES_FALLBACK || DEFAULT_PAGES).replace(/\/$/, "");
  try {
    return await fetch(base + pathWithQuery, {
      method: "GET",
      headers: copyReqHeaders(request),
      redirect: "manual",
      cf: { cacheTtl: 0, cacheEverything: false },
    } as RequestInit);
  } catch {
    return null;
  }
}

async function serveSite(
  request: Request,
  env: Env,
  pathWithQuery: string,
): Promise<Response> {
  const key = cacheKey(pathWithQuery.split("?")[0] || "/");

  try {
    const upstream = await fetchOrigin(request, env, pathWithQuery);
    // Pass through client/auth errors; only treat network/5xx as origin-down.
    if (upstream.status >= 400 && upstream.status < 500) {
      const buf = await upstream.arrayBuffer();
      const out = withEdgeHeaders(new Headers(upstream.headers), "origin");
      return new Response(buf, { status: upstream.status, headers: out });
    }
    if (upstream.ok || upstream.status === 304) {
      if (upstream.status === 304) {
        return new Response(null, {
          status: 304,
          headers: withEdgeHeaders(new Headers(upstream.headers), "origin"),
        });
      }
      const raw = await upstream.arrayBuffer();
      const ct =
        upstream.headers.get("content-type") || "application/octet-stream";
      const buf = withDisruptionScript(raw, ct);
      await kvPut(env, key, buf, { contentType: ct, status: upstream.status });
      const out = withEdgeHeaders(new Headers(upstream.headers), "origin");
      out.set("Content-Type", ct);
      // Encourage CF to keep a stale copy at the CDN layer too
      if (!out.has("Cache-Control")) {
        out.set(
          "Cache-Control",
          ct.includes("text/html")
            ? "public, max-age=60, stale-if-error=86400"
            : "public, max-age=300, stale-if-error=604800",
        );
      }
      return new Response(buf, { status: upstream.status, headers: out });
    }
    throw new Error(`origin ${upstream.status}`);
  } catch (err) {
    // Origin down: prefer live Pages over a stale KV snapshot (KV can freeze /home.js for weeks).
    const pages = await fetchPagesFallback(request, env, pathWithQuery);
    if (pages && pages.ok) {
      const ct = pages.headers.get("content-type") || "application/octet-stream";
      const buf = withDisruptionScript(await pages.arrayBuffer(), ct);
      await kvPut(env, key, buf, { contentType: ct, status: pages.status });
      return new Response(buf, {
        status: pages.status,
        headers: withEdgeHeaders(
          new Headers({
            "Content-Type": ct,
            "Cache-Control": "public, max-age=60, stale-if-error=86400",
          }),
          "pages-fallback",
        ),
      });
    }

    const cached = await kvGet(env, key);
    if (cached) {
      const body = withDisruptionScript(cached.body, cached.meta.contentType);
      return new Response(body, {
        status: cached.meta.status || 200,
        headers: withEdgeHeaders(
          new Headers({
            "Content-Type": cached.meta.contentType,
            "Cache-Control": "public, max-age=30, stale-if-error=86400",
          }),
          "cache",
        ),
      });
    }

    const msg = err instanceof Error ? err.message : String(err);
    return new Response(
      `<!DOCTYPE html><html><head><meta charset="utf-8"/><title>RootMC — Ava offline</title>
<style>body{font-family:system-ui;background:#0a0f10;color:#e8efe9;padding:2rem;max-width:40rem;margin:auto}
a{color:#f0a83c}</style></head><body>
<h1>RootMC</h1>
<p>Ava site origin is unreachable (${msg}) and no last-known copy is cached for this path yet.</p>
<p><a href="/">Retry</a> · <a href="https://ava.rootmc.net/">Ava status</a></p>
</body></html>`,
      {
        status: 503,
        headers: withEdgeHeaders(
          new Headers({ "Content-Type": "text/html; charset=utf-8" }),
          "down",
        ),
      },
    );
  }
}

/**
 * RootRecord account shard only (billing / RR auth).
 * Player `/api/account/*` (Login/Register, My Stats) is RootMC — do not steal it.
 */
function isAccountShardApiTail(tail: string): boolean {
  const t = tail.replace(/^\/+/, "");
  if (t === "auth" || t.startsWith("auth/")) return true;
  if (t === "earn" || t.startsWith("earn/")) return true;
  if (t === "app-session" || t.startsWith("app-session/")) return true;
  if (t === "fcm" || t.startsWith("fcm/")) return true;
  if (t === "mobile" || t.startsWith("mobile/")) return true;
  return false;
}

/** Legacy BlockNotes paths → RootMC realm API. */
function rewriteLegacyBlocknotesApiTail(tail: string): string {
  const t = tail.replace(/^\/+/, "");
  if (t === "blocknotes") return "rootmc";
  if (t.startsWith("blocknotes/")) return `rootmc/${t.slice("blocknotes/".length)}`;
  return tail;
}

function isRootMcG2ApiTail(tail: string): boolean {
  return /^g2\b/i.test(tail);
}

async function proxyApi(request: Request, env: Env, tail: string): Promise<Response> {
  const useG2 = isRootMcG2ApiTail(tail);
  const useAccount = !useG2 && isAccountShardApiTail(tail);
  const base = (
    useG2
      ? env.ROOTMC_API_G2_BASE || "https://api2.rootmc.net"
      : useAccount
        ? env.ROOTRECORD_API_ACCOUNT_BASE || "https://api.rootrecord.info"
        : env.ROOTMC_API_BASE || DEFAULT_API
  ).replace(/\/$/, "");
  const url = new URL(request.url);
  const upstreamPath = tail ? `/api/${tail}` : "/api";
  const target = `${base}${upstreamPath}${url.search}`;
  const headers = copyReqHeaders(request);
  const method = request.method;
  const hasBody = method !== "GET" && method !== "HEAD" && method !== "OPTIONS";
  try {
    const upstream = await fetch(target, {
      method,
      headers,
      body: hasBody ? await request.arrayBuffer() : undefined,
      redirect: "manual",
      cf: { cacheTtl: 0, cacheEverything: false },
    } as RequestInit);
    const out = withEdgeHeaders(new Headers(upstream.headers), "api");
    out.set("Cache-Control", "no-store");
    out.set("X-RootMC-Api-Upstream", new URL(target).origin);
    return new Response(upstream.body, { status: upstream.status, headers: out });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return new Response(JSON.stringify({ detail: `API proxy failed: ${msg}` }), {
      status: 502,
      headers: withEdgeHeaders(
        new Headers({ "Content-Type": "application/json" }),
        "api-down",
      ),
    });
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    if (request.method === "OPTIONS") {
      return new Response(null, {
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, HEAD, POST, PUT, PATCH, DELETE, OPTIONS",
          "Access-Control-Allow-Headers": "*",
          "Access-Control-Max-Age": "86400",
          "X-RootMC-Site-Edge": "options",
        },
      });
    }

    // Root Record Radio — live from Ava origin (not Pages).
    const radioNorm = path.replace(/\/+$/, "") || "/";
    if (
      radioNorm === "/radio" ||
      radioNorm === "/radio/listen" ||
      path.startsWith("/radio/") ||
      radioNorm === "/api/radio/now" ||
      radioNorm === "/api/radio/steering" ||
      radioNorm === "/api/radio/wake" ||
      radioNorm === "/api/radio/vote"
    ) {
      const ava = "https://origin.avaivy.cloud";
      const outPath =
        radioNorm === "/radio" ||
        radioNorm === "/radio/listen" ||
        radioNorm === "/api/radio/now" ||
        radioNorm === "/api/radio/steering" ||
        radioNorm === "/api/radio/wake" ||
        radioNorm === "/api/radio/vote"
          ? radioNorm
          : path;
      const target = ava + outPath + url.search;
      const method = request.method;
      const hasBody = method !== "GET" && method !== "HEAD" && method !== "OPTIONS";
      try {
        const upstream = await fetch(target, {
          method,
          headers: copyReqHeaders(request),
          body: hasBody ? await request.arrayBuffer() : undefined,
          redirect: "manual",
          cf: { cacheTtl: 0, cacheEverything: false },
        } as RequestInit);
        const out = withEdgeHeaders(new Headers(upstream.headers), "ava-radio");
        out.set("Cache-Control", "no-store");
        return new Response(upstream.body, { status: upstream.status, headers: out });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return new Response(
          `<!DOCTYPE html><html><head><meta charset="utf-8"/><title>RootMC Radio</title>
<style>body{font-family:system-ui;background:#0a0f10;color:#e8efe9;padding:2rem;max-width:36rem;margin:auto}
a{color:#f0a83c}</style></head><body>
<h1>RootMC Radio</h1>
<p>Live radio is quiet right now (${msg}).</p>
<p><a href="/">Home</a> · <a href="https://rootrecord.cloud/radio">Try Root Record Radio</a></p>
</body></html>`,
          {
            status: 503,
            headers: withEdgeHeaders(
              new Headers({ "Content-Type": "text/html; charset=utf-8" }),
              "radio-down",
            ),
          },
        );
      }
    }

    if (path === "/api" || path.startsWith("/api/")) {
      const tail = rewriteLegacyBlocknotesApiTail(path.replace(/^\/api\/?/, ""));
      return proxyApi(request, env, tail);
    }

    if (request.method !== "GET" && request.method !== "HEAD") {
      return new Response("Method not allowed", { status: 405 });
    }

    return serveSite(request, env, path + url.search);
  },
};
