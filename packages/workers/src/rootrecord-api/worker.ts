/**
 * rootrecord-api Worker — serves rootrecord.online
 * Real-world ops API: Kīlauea, NWS weather, USGS earthquakes, hourly reports.
 *
 * HTML/blog falls through to the Vercel Next.js site.
 * /api/* proxies to the local Ava origin when awake.
 */

import { avaIsAwake } from "../shared/heartbeat";
import { fetchFrontend, proxyToOrigin } from "../shared/proxy";
import { statusJson, statusPage } from "../shared/statusPage";
import type { AvaEnv, ScheduledEvent } from "../shared/types";

const ORIGIN = "https://ava-origin.rootmc.net";
const VERCEL_FRONTEND = "https://rootrecord-online.pages.dev";

const CANONICAL_HOST = "rootrecord.info";
const ONLINE_HOSTS = new Set(["rootrecord.online", "www.rootrecord.online"]);
const PROXIED_PREFIXES = ["/api/", "/obs/", "/health"];

export default {
  async fetch(request: Request, env: AvaEnv): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    // Marketing site consolidated on rootrecord.info; keep API on .online.
    if (ONLINE_HOSTS.has(url.hostname)) {
      const keepOnOnline = PROXIED_PREFIXES.some((p) => path === p.slice(0, -1) || path.startsWith(p));
      if (!keepOnOnline) {
        const target = new URL(url);
        target.hostname = CANONICAL_HOST;
        return Response.redirect(target.toString(), 301);
      }
    }

    if (path === "/ava/status.json") {
      return statusJson(env);
    }
    if (
      path === "/status" ||
      path === "/status/" ||
      path === "/ava/status" ||
      path === "/ava/status/" ||
      path === "/ava" ||
      path === "/ava/"
    ) {
      return proxyToOrigin(request, {
        originUrl: ORIGIN,
        path: "/status",
        timeoutMs: 8000,
        offlineFallback: () => statusPage(env, { degraded: true }),
      });
    }

    const shouldProxy = PROXIED_PREFIXES.some((p) => path.startsWith(p));
    if (shouldProxy) {
      return proxyToOrigin(request, {
        originUrl: ORIGIN,
        path: path.startsWith("/ava/") ? path.slice("/ava".length) : undefined,
        offlineFallback: () => new Response(
          JSON.stringify({ error: "ava_offline", path }),
          { status: 503, headers: { "Content-Type": "application/json" } },
        ),
      });
    }

    return fetchFrontend(request, VERCEL_FRONTEND);
  },

  async scheduled(_event: ScheduledEvent, env: AvaEnv): Promise<void> {
    if (await avaIsAwake(env)) return;
    await runKilaueaFallback(env);
    await runNoaaFallback(env);
  },
};

async function runKilaueaFallback(_env: AvaEnv): Promise<void> {
  // TODO: port kilauea CF worker logic here for when Ava is offline
}

async function runNoaaFallback(_env: AvaEnv): Promise<void> {
  // TODO: port NWS CF worker logic here for when Ava is offline
}
