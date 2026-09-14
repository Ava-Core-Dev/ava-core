/**
 * rootmc-api Worker — zone rootmc.net on account d2daf263.
 *
 * api.rootmc.net is the Minecraft plugin / site JSON API. The D1 + license
 * Worker still lives on the previous RootMC account (workers.dev). This
 * hostname must never be sent to Ava FastAPI (ava-origin / :8787).
 *
 * Apex / www: Pages frontend, with /api/edge D1 cache and Ava origin only
 * for leftover /ava paths.
 */

import { avaIsAwake } from "../shared/heartbeat";
import { fetchFrontend, proxyToOrigin } from "../shared/proxy";
import { statusJson, statusPage } from "../shared/statusPage";
import type { AvaEnv, ScheduledEvent } from "../shared/types";

const ORIGIN = "https://ava-origin.rootmc.net";
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

    if (host === "api.rootmc.net") {
      return proxyToOrigin(request, {
        originUrl: ROOTMC_API,
        timeoutMs: 30000,
        offlineFallback: apiUnavailable,
      });
    }

    if (path === "/status.json" || path === "/api/status.json") {
      return statusJson(env);
    }
    if (path === "/status" || path === "/ava/status") {
      return statusPage(env);
    }
    if (path.startsWith("/api/edge/")) {
      return d1Cache(env, path.slice("/api/edge/".length).replace(/\/$/, "") || "meta");
    }

    if (path.startsWith("/ava/")) {
      return proxyToOrigin(request, {
        originUrl: ORIGIN,
        path: path.slice("/ava".length),
        timeoutMs: 8000,
        offlineFallback: () => statusPage(env, { degraded: true }),
      });
    }

    return fetchFrontend(request, SITE_FRONTEND);
  },

  async scheduled(_event: ScheduledEvent, env: AvaEnv): Promise<void> {
    if (await avaIsAwake(env)) return;
  },
};
