/**
 * rootrecord-api Worker — serves rootrecord.online
 * Marketing + account HTML from CF Pages; /api/* proxies to Ava origin when awake.
 */

import { avaIsAwake } from "../shared/heartbeat";
import { fetchFrontend, proxyToOrigin } from "../shared/proxy";
import { statusJson, statusPage } from "../shared/statusPage";
import type { AvaEnv, ScheduledEvent } from "../shared/types";

const ORIGIN = "https://ava-origin.rootmc.net";
/** CF Pages production for rootrecord.online (static marketing + account). */
const PAGES_FRONTEND = "https://rootrecord-online.pages.dev";

const PROXIED_PREFIXES = ["/api/", "/obs/", "/health"];

export default {
  async fetch(request: Request, env: AvaEnv): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

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

    return fetchFrontend(request, PAGES_FRONTEND);
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
