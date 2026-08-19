/**
 * ava-api Worker — serves avaivy.cloud
 * Routes:
 *   /          → Ava public identity site (Vercel)
 *   /api/*     → proxy to local Ava origin (avaivy.cloud/api/*)
 *   /obs/*     → proxy to local Ava origin
 *   /status    → proxy to local Ava origin
 *   /context   → proxy to local Ava origin
 *   Offline    → self-contained offline page (CF static)
 *
 * Cloudflare is proxy + fallback only. All intelligence runs on device.
 */

import { avaIsAwake } from "../shared/heartbeat";
import { proxyToOrigin } from "../shared/proxy";
import { statusJson, statusPage } from "../shared/statusPage";
import type { AvaEnv } from "../shared/types";

const ORIGIN = "https://ava-origin.rootmc.net";
const VERCEL_FRONTEND = "https://avaivy-cloud.vercel.app"; // update when deployed

const PROXIED_PREFIXES = ["/api/", "/obs/", "/status", "/context", "/solar", "/goals", "/health"];

export default {
  async fetch(request: Request, env: AvaEnv): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    // Host presence, answered from D1 — works even when the origin is down.
    // The core has no /status route of its own, so serve it here rather than
    // proxying it into a 404.
    if (path === "/ava/status" || path === "/ava" || path === "/ava/" || path === "/status") {
      return statusPage(env);
    }
    if (path === "/ava/status.json" || path === "/status.json") {
      return statusJson(env);
    }

    // /ava/* is a public alias for the origin's own paths: strip the prefix.
    if (path.startsWith("/ava/")) {
      return proxyToOrigin(request, {
        originUrl: ORIGIN,
        path: path.slice("/ava".length),
        offlineFallback: () => statusPage(env, { degraded: true }),
        timeoutMs: 8000,
      });
    }

    // Proxy dynamic paths to local origin
    const shouldProxy = PROXIED_PREFIXES.some(p => path.startsWith(p));
    if (shouldProxy) {
      return proxyToOrigin(request, {
        originUrl: ORIGIN,
        offlineFallback: () => statusPage(env, { degraded: true }),
        timeoutMs: 8000,
      });
    }

    // Fallthrough to Vercel frontend for public site
    return fetch(VERCEL_FRONTEND + path + url.search, { headers: request.headers });
  },

  async scheduled(_event: ScheduledEvent, env: AvaEnv): Promise<void> {
    // All scheduling runs on device. CF crons stand down when Ava is awake.
    if (await avaIsAwake(env)) return;
    // Ava is offline — CF can handle fallback jobs here if needed
  },
};

