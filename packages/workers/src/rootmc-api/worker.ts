/**
 * rootmc-api Worker — rootmc.info / api.rootmc.info
 *
 * Awake: proxy to the home origin (Ava).
 * Offline: serve the D1 Minecraft cache the host keeps synced.
 * Hyperdrive (LIVE_DB) is bound for live SQL when workers need it.
 */

import { avaIsAwake } from "../shared/heartbeat";
import { fetchFrontend, proxyToOrigin } from "../shared/proxy";
import { statusJson, statusPage } from "../shared/statusPage";
import type { AvaEnv, ScheduledEvent } from "../shared/types";

const ORIGIN = "https://ava-origin.rootmc.net";
const SITE_FRONTEND = "https://rootmc-web-egm.pages.dev";
const API_PREFIXES = ["/api/", "/ava/"];

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

export default {
  async fetch(request: Request, env: AvaEnv): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    if (path === "/status.json" || path === "/api/status.json") {
      return statusJson(env);
    }
    if (path === "/status" || path === "/ava/status") {
      return statusPage(env);
    }
    if (path.startsWith("/api/edge/")) {
      return d1Cache(env, path.slice("/api/edge/".length).replace(/\/$/, "") || "meta");
    }

    const host = url.hostname;
    const isApiHost = host === "api.rootmc.net" || API_PREFIXES.some((p) => path.startsWith(p));
    if (isApiHost) {
      return proxyToOrigin(request, {
        originUrl: ORIGIN,
        path: path.startsWith("/ava/") ? path.slice("/ava".length) : undefined,
        offlineFallback: async () => {
          if (path.startsWith("/api/minecraft") || path.startsWith("/api/edge")) {
            return d1Cache(env, "status");
          }
          return statusPage(env, { degraded: true });
        },
      });
    }

    return fetchFrontend(request, SITE_FRONTEND);
  },

  async scheduled(_event: ScheduledEvent, env: AvaEnv): Promise<void> {
    if (await avaIsAwake(env)) return;
    // Host is offline — edge keeps serving D1 cache. Host will catch up on boot.
  },
};
