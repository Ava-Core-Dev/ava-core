/**
 * rootrecord-api — Pages frontend + /v1 account proxy + Ava /api proxy
 */
import { avaIsAwake } from "../shared/heartbeat";
import { fetchFrontend, proxyToOrigin } from "../shared/proxy";
import { statusJson } from "../shared/statusPage";
import { goalsHiddenPage, maintenancePage } from "../shared/maintenancePage";
import type { AvaEnv, ScheduledEvent } from "../shared/types";

const ORIGIN = "https://origin.avaivy.cloud";
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
    origin === "https://rootrecord.cloud" ||
    origin === "https://www.rootrecord.cloud" ||
    origin.endsWith(".rootrecord.info") ||
    origin.endsWith(".rootrecord.online") ||
    origin.endsWith(".rootrecord.cloud") ||
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
    const origin = env.AVA_ORIGIN_URL || ORIGIN;
    const path = url.pathname;

    if (
      path === "/ops" ||
      path.startsWith("/ops/") ||
      path.startsWith("/api/ops") ||
      path === "/ava/ops" ||
      path.startsWith("/ava/ops/") ||
      path === "/api/business" ||
      path.startsWith("/api/business/")
    ) {
      return new Response(null, { status: 404 });
    }

    if (
      path === "/goals" ||
      path.startsWith("/goals/") ||
      path.startsWith("/api/goals")
    ) {
      return goalsHiddenPage();
    }

    // Hold public account dashboards until inventory is sorted.
    const accountApiPaths =
      path === "/api/me" ||
      path.startsWith("/api/me/") ||
      path === "/api/locations" ||
      path.startsWith("/api/locations/") ||
      path === "/api/auth" ||
      path.startsWith("/api/auth/");
    if (accountApiPaths) {
      if (request.method === "OPTIONS") {
        return withCredentialCors(request, new Response(null, { status: 204 }));
      }
      const accept = request.headers.get("Accept") || "";
      if (accept.includes("application/json")) {
        return withCredentialCors(
          request,
          new Response(JSON.stringify({ error: "dashboards_held", detail: "Account dashboards are hidden until inventory is verified." }), {
            status: 503,
            headers: { "Content-Type": "application/json" },
          }),
        );
      }
      return maintenancePage();
    }

    // Account API proxy (same-origin when called as rootrecord.info/v1/*)
    if (path === "/v1" || path.startsWith("/v1/")) {
      if (request.method === "OPTIONS") {
        return withCredentialCors(request, new Response(null, { status: 204 }));
      }
      return withCredentialCors(
        request,
        new Response(JSON.stringify({ error: "dashboards_held" }), {
          status: 503,
          headers: { "Content-Type": "application/json" },
        }),
      );
    }

    if (path === "/ava/status.json") return statusJson(env);

    if (
      path === "/status" || path === "/status/" ||
      path === "/ava/status" || path === "/ava/status/" ||
      path === "/ava" || path === "/ava/"
    ) {
      return proxyToOrigin(request, {
        originUrl: origin,
        path: "/status",
        timeoutMs: 8000,
        offlineFallback: () => maintenancePage(),
      });
    }

    if (PROXIED_PREFIXES.some((p) => path.startsWith(p))) {
      return proxyToOrigin(request, {
        originUrl: origin,
        path: path.startsWith("/ava/") ? path.slice("/ava".length) : undefined,
        offlineFallback: () => maintenancePage(),
      });
    }

    if (path === "/api/site-config" || path === "/api/site-config.json") {
      try {
        return await fetchFrontend(request, PAGES_FRONTEND);
      } catch {
        return maintenancePage();
      }
    }

    try {
      return await fetchFrontend(request, PAGES_FRONTEND);
    } catch {
      return maintenancePage();
    }
  },

  async scheduled(_event: ScheduledEvent, env: AvaEnv): Promise<void> {
    const { probeOrigin } = await import("../shared/uptime");
    if (await probeOrigin(env, env.AVA_ORIGIN_URL || ORIGIN)) return;
    if (await avaIsAwake(env)) return;
  },
};
