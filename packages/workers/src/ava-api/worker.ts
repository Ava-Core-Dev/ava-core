/**
 * ava-api Worker — serves avaivy.cloud
 *
 *   /api/*  /obs/*  /health  → home origin (FastAPI)
 *   /ava    /ava/*           → D1 host heartbeat, or origin with /ava stripped
 *   everything else          → Vercel Next.js (status, goals, context, wallets, blog)
 *
 * Cloudflare is proxy + fallback only. All intelligence runs on device.
 */

import { avaIsAwake } from "../shared/heartbeat";
import { fetchFrontend, proxyToOrigin } from "../shared/proxy";
import { statusJson, statusPage } from "../shared/statusPage";
import {
  pollAndStoreEcoflow,
  readStoredEcoflow,
  solarDeskFromStored,
} from "../shared/ecoflow";
import type { AvaEnv, ScheduledEvent } from "../shared/types";

const ORIGIN = "https://ava-origin.rootmc.net";
// Preview alias until Vercel Production is promoted (avaivy-cloud.vercel.app is stale).
const VERCEL_FRONTEND =
  "https://avaivy-cloud-git-master-root-record.vercel.app";

function isOriginApi(path: string): boolean {
  return (
    path === "/health" ||
    path.startsWith("/health/") ||
    path.startsWith("/api/") ||
    path.startsWith("/obs/")
  );
}

export default {
  async fetch(request: Request, env: AvaEnv): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    if (path === "/ava/status.json") {
      return statusJson(env);
    }
    if (path === "/ava/status" || path === "/ava" || path === "/ava/") {
      return statusPage(env);
    }

    const origin = env.AVA_ORIGIN_URL || ORIGIN;

    if (path.startsWith("/ava/")) {
      return proxyToOrigin(request, {
        originUrl: origin,
        path: path.slice("/ava".length),
        offlineFallback: () => statusPage(env, { degraded: true }),
        timeoutMs: 8000,
      });
    }

    if (path === "/solar" || path === "/solar/") {
      return proxyToOrigin(request, {
        originUrl: origin,
        timeoutMs: 8000,
        offlineFallback: () => fetchFrontend(request, VERCEL_FRONTEND),
      });
    }

    if (isOriginApi(path)) {
      return proxyToOrigin(request, {
        originUrl: origin,
        timeoutMs: 8000,
        offlineFallback: async () => {
          if (path.startsWith("/api/obs/solar-desk") || path.startsWith("/api/obs/solar")) {
            const stored = await readStoredEcoflow(env);
            if (!stored && env.AVA_ECOFLOW_ACCESS_KEY) {
              const fresh = await pollAndStoreEcoflow(env);
              return solarDeskFromStored(fresh);
            }
            return solarDeskFromStored(stored);
          }
          return statusPage(env, { degraded: true });
        },
      });
    }

    return fetchFrontend(request, VERCEL_FRONTEND);
  },

  async scheduled(_event: ScheduledEvent, env: AvaEnv): Promise<void> {
    if (await avaIsAwake(env)) return;
    await pollAndStoreEcoflow(env);
  },
};
