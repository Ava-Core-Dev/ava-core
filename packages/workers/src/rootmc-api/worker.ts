/**
 * rootmc-api Worker — zone rootmc.net.
 * api.rootmc.net is Minecraft only. Never proxy Ava FastAPI or /ops.
 */

import { avaIsAwake } from "../shared/heartbeat";
import { fetchFrontend, proxyToOrigin } from "../shared/proxy";
import { statusJson } from "../shared/statusPage";
import type { AvaEnv, ScheduledEvent } from "../shared/types";

const SITE_FRONTEND = "https://rootmc-web-egm.pages.dev";
/** Production RootMC Worker (old account). Zone transfer did not move D1. */
const ROOTMC_API = "https://rootmc-api.root-337.workers.dev";

async function d1Cache(env: AvaEnv, table: string): Promise<Response> {
  if (!env.ROOTMC_LIVE_DB) {
    return Response.json({ ok: false, detail: "ROOTMC_LIVE_DB unbound" }, { status: 503 });
  }
  const allowed: Record<string, string> = {
    balances: "SELECT uuid, name, balance, updated_at FROM player_balances ORDER BY balance DESC LIMIT 500",
    status: "SELECT id, online, players, max_players, motd, updated_at, detail FROM server_status",
    meta: "SELECT name, updated_at, row_count, ok, detail FROM sync_meta",
  };
  const sql = allowed[table];
  if (!sql) {
    return Response.json({ ok: false, detail: "unknown table" }, { status: 404 });
  }
  const { results } = await env.ROOTMC_LIVE_DB.prepare(sql).all();
  return Response.json({ ok: true, source: "d1", table, results });
}

function apiUnavailable(): Response {
  return Response.json(
    { ok: false, error: "upstream_unavailable", detail: "RootMC API worker unreachable" },
    { status: 502 },
  );
}

export default {
  async fetch(request: Request, env: AvaEnv): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;
    const host = url.hostname;

    if (path === "/status.json" || path === "/api/status.json") {
      return statusJson(env);
    }
    if (path === "/api/edge/hyperdrive" || path === "/api/edge/hyperdrive/") {
      const hd = env.LIVE_DB;
      if (!hd) {
        return Response.json({ ok: false, bound: false, detail: "LIVE_DB unbound" }, { status: 503 });
      }
      return Response.json({
        ok: true,
        bound: true,
        host: hd.host,
        database: hd.database,
        port: hd.port,
        scheme: "mysql",
      });
    }
    if (path.startsWith("/api/edge/")) {
      return d1Cache(env, path.slice("/api/edge/".length).replace(/\/$/, "") || "meta");
    }

    if (path === "/feedback" || path === "/feedback/") {
      return Response.redirect("https://rootrecord.cloud/feedback", 302);
    }
    if (host === "api.rootmc.net") {
      return proxyToOrigin(request, {
        originUrl: ROOTMC_API,
        timeoutMs: 30000,
        offlineFallback: apiUnavailable,
      });
    }
    if (path.startsWith("/ava/") || path === "/ops" || path.startsWith("/ops/") || path.startsWith("/api/ops")) {
      return new Response(null, { status: 404 });
    }

    return fetchFrontend(request, SITE_FRONTEND);
  },

  async scheduled(_event: ScheduledEvent, env: AvaEnv): Promise<void> {
    // Minecraft API Worker: no Ava EcoFlow jobs. Stand down when origin is up.
    if (await avaIsAwake(env)) return;
  },
};
