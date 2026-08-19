/**
 * rootmc-api Worker — serves rootmc.info
 * Minecraft API: player data, economy, RCON, server status.
 * Proxies to local origin when Ava is awake; uses CF fallback when offline.
 */

import { avaIsAwake } from "../shared/heartbeat";
import { proxyToOrigin } from "../shared/proxy";
import type { AvaEnv } from "../shared/types";

const ORIGIN = "https://ava-origin.rootmc.net";

export default {
  async fetch(request: Request, _env: AvaEnv): Promise<Response> {
    return proxyToOrigin(request, {
      originUrl: ORIGIN,
      offlineFallback: () => new Response(
        JSON.stringify({ error: "ava_offline", hint: "Minecraft API unavailable while server is off" }),
        { status: 503, headers: { "Content-Type": "application/json" } }
      ),
    });
  },

  async scheduled(_event: ScheduledEvent, env: AvaEnv): Promise<void> {
    if (await avaIsAwake(env)) return;
    // Offline fallback cron work (economy sync, membership, etc.)
  },
};
