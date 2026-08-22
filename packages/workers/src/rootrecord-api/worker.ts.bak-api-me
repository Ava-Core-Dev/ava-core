/**
 * rootrecord-api — Pages frontend + /v1 account proxy + Ava /api proxy
 */
import { avaIsAwake } from "../shared/heartbeat";
import { fetchFrontend, proxyToOrigin } from "../shared/proxy";
import { statusJson, statusPage } from "../shared/statusPage";
import type { AvaEnv, ScheduledEvent } from "../shared/types";

const ORIGIN = "https://ava-origin.rootmc.net";
const ACCOUNT_API = "https://rootrecord-api-account.rootrecord.workers.dev";
const PAGES_FRONTEND = "https://rootrecord-info.pages.dev";
const PROXIED_PREFIXES = ["/api/", "/obs/", "/health"];

function withCredentialCors(request: Request, res: Response): Response {
  const origin = request.headers.get("Origin") || "";
  const headers = new Headers(res.headers);
  headers.delete("content-encoding");
  if (
    origin === "https://rootrecord.info" ||
    origin === "https://www.rootrecord.info" ||
    origin === "https://rootrecord.online" ||
    origin.endsWith(".rootrecord.info") ||
    origin.endsWith(".rootrecord.online") ||
    origin.endsWith(".pages.dev")
  ) {
    headers.set("Access-Control-Allow-Origin", origin);
    headers.set("Access-Control-Allow-Credentials", "true");
    headers.set("Vary", "Origin");
    headers.set(
      "Access-Control-Allow-Headers",
      "Accept, Authorization, Cookie, X-Guest-Id, X-RR-App-Id, Content-Type, Cache-Control, Pragma",
    );
    headers.set("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS");
    headers.set("Access-Control-Max-Age", "86400");
  }
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
}

export default {
  async fetch(request: Request, env: AvaEnv): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    if (path === "/api/site-config" || path === "/api/site-config.json") {
      return fetchFrontend(request, PAGES_FRONTEND);
    }

    // Account API proxy (same-origin when called as rootrecord.info/v1/*)
    if (path === "/v1" || path.startsWith("/v1/")) {
      if (request.method === "OPTIONS") {
        return withCredentialCors(
          request,
          new Response(null, { status: 204 }),
        );
      }
      const target = new URL(path + url.search, ACCOUNT_API);
      const headers = new Headers(request.headers);
      headers.delete("host");
      // Ensure account Worker sees the browser Origin
      const browserOrigin = request.headers.get("Origin");
      if (browserOrigin) headers.set("Origin", browserOrigin);
      try {
        const res = await fetch(target.toString(), {
          method: request.method,
          headers,
          body: request.method === "GET" || request.method === "HEAD" ? undefined : request.body,
          redirect: "manual",
        });
        return withCredentialCors(request, res);
      } catch {
        return withCredentialCors(
          request,
          new Response(JSON.stringify({ detail: "account_api_unreachable" }), {
            status: 502,
            headers: { "Content-Type": "application/json" },
          }),
        );
      }
    }

    if (path === "/ava/status.json") return statusJson(env);

    if (
      path === "/status" || path === "/status/" ||
      path === "/ava/status" || path === "/ava/status/" ||
      path === "/ava" || path === "/ava/"
    ) {
      return proxyToOrigin(request, {
        originUrl: ORIGIN,
        path: "/status",
        timeoutMs: 8000,
        offlineFallback: () => statusPage(env, { degraded: true }),
      });
    }

    if (PROXIED_PREFIXES.some((p) => path.startsWith(p))) {
      return proxyToOrigin(request, {
        originUrl: ORIGIN,
        path: path.startsWith("/ava/") ? path.slice("/ava".length) : undefined,
        offlineFallback: () =>
          new Response(JSON.stringify({ error: "ava_offline", path }), {
            status: 503,
            headers: { "Content-Type": "application/json" },
          }),
      });
    }

    return fetchFrontend(request, PAGES_FRONTEND);
  },

  async scheduled(_event: ScheduledEvent, env: AvaEnv): Promise<void> {
    if (await avaIsAwake(env)) return;
  },
};
