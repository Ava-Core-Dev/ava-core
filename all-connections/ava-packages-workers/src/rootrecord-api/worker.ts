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
const VERCEL_FRONTEND = "https://rootrecord-online-git-master-root-record.vercel.app";

const CANONICAL_HOST = "rootrecord.online";
const LEGACY_HOSTS = new Set(["rootrecord.info", "www.rootrecord.info", "www.rootrecord.online"]);
const PROXIED_PREFIXES = ["/api/", "/obs/", "/health"];

export default {
  async fetch(request: Request, env: AvaEnv): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    if (LEGACY_HOSTS.has(url.hostname)) {
      const target = new URL(url);
      target.hostname = CANONICAL_HOST;
      return Response.redirect(target.toString(), 301);
    }

    if (path === "/ava/status" || path === "/ava" || path === "/ava/") {
      return statusPage(env);
    }
    if (path === "/ava/status.json") {
      return statusJson(env);
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
