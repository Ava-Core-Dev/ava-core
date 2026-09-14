import { json } from "../cors";
import type { Env } from "../realm-router";
import { isG2Worker } from "./g2-db";
import {
  handleG2BondsSnapshot,
  handleG2CompatServerHeartbeat,
  handleG2EconomySnapshot,
  handleG2Heartbeat,
  handleG2StatsSnapshot,
} from "./g2-snapshot";
import { handleG2EconomyPublicRoutes } from "./g2-economy-public";
import { handleG2RealmStatus } from "./g2-status";
import { runG2LiveEconomyStatusPost } from "./g2-live-economy-status";

export async function handleG2Routes(
  request: Request,
  env: Env,
  sub: string,
  method: string,
): Promise<Response | null> {
  // Gen 1 must not run g2_* SQL (missing tables → HTTP 500 on /api/g2/*).
  if (!isG2Worker(env)) {
    if (sub.startsWith("/g2/") || sub.startsWith("/v2/")) {
      return json(
        {
          ok: false,
          error: "gen2_retired",
          detail: "Gen 2 API retired — Claims uses https://api.rootmc.info",
        },
        404,
      );
    }
    return null;
  }

  const publicRes = await handleG2EconomyPublicRoutes(request, env, sub, method);
  if (publicRes) return publicRes;

  // Existing RootMC jars POST Gen1 `/api/rootmc/server/heartbeat` even when cloud
  // api-base is api2 — accept that shape so Gen2 presence stays fresh.
  if (method === "POST" && sub === "/rootmc/server/heartbeat") {
    return handleG2CompatServerHeartbeat(request, env);
  }

  if (!sub.startsWith("/v2/")) {
    return null;
  }

  const url = new URL(request.url);
  const force = url.searchParams.get("force") === "1";

  if (method === "POST" && sub === "/v2/realm/snapshot/economy") {
    return handleG2EconomySnapshot(request, env, force);
  }
  if (method === "POST" && sub === "/v2/realm/snapshot/bonds") {
    return handleG2BondsSnapshot(request, env);
  }
  if (method === "POST" && sub === "/v2/realm/snapshot/stats") {
    return handleG2StatsSnapshot(request, env);
  }
  if (method === "POST" && sub === "/v2/realm/heartbeat") {
    return handleG2Heartbeat(request, env);
  }
  if (method === "GET" && sub === "/v2/realm/status") {
    return handleG2RealmStatus(request, env);
  }
  if (method === "GET" && sub === "/v2/health") {
    return json({ ok: true, generation: "gen2", worker: env.WORKER_SHARD || "rootmc-api-g2" });
  }

  // Triggered by Gen 1's hourly cron — returns Gen2 section text (no Discord post).
  // Gen 1 combines Gen1+Gen2 into one message on the hourly snapshots channel.
  if (method === "POST" && sub === "/v2/cron/hourly-discord") {
    const result = await runG2LiveEconomyStatusPost(env);
    return json(result, result.ok ? 200 : 500);
  }

  return json({ ok: false, error: "not_found" }, 404);
}
