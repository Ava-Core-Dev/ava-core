/**
 * rootrecord-api Worker — serves rootrecord.online
 * Real-world ops API: Kīlauea, NWS weather, USGS earthquakes, hourly reports.
 *
 * When Ava is awake, these routes proxy to the local origin.
 * When Ava is offline, CF handles the fallback with cached data.
 */

import { avaIsAwake } from "../shared/heartbeat";
import { proxyToOrigin } from "../shared/proxy";
import type { AvaEnv } from "../shared/types";

const ORIGIN = "https://ava-origin.rootmc.net";

export default {
  async fetch(request: Request, env: AvaEnv): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    // Always proxy to origin — if offline, fallback handles it
    return proxyToOrigin(request, {
      originUrl: ORIGIN,
      offlineFallback: () => new Response(
        JSON.stringify({ error: "ava_offline", path }),
        { status: 503, headers: { "Content-Type": "application/json" } }
      ),
    });
  },

  async scheduled(event: ScheduledEvent, env: AvaEnv): Promise<void> {
    if (await avaIsAwake(env)) return; // Ava owns NOAA + Kilauea when awake
    // Offline fallback — trigger CF-owned weather/kilauea jobs
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
