/**
 * ava-api Worker — serves avaivy.cloud
 *
 * Public DNS must hit this Worker, never a raw tunnel CNAME.
 * Tunnel down → maintenance holding page (not CF 1033 / HOST OFFLINE).
 * /goals and wallets stay hidden until the operator un-hides them.
 */

import { avaIsAwake } from "../shared/heartbeat";
import { fetchFrontend, proxyToOrigin } from "../shared/proxy";
import { statusJson } from "../shared/statusPage";
import { goalsHiddenPage, maintenancePage } from "../shared/maintenancePage";
import { isPrivatePath, isPublicData, isPublicWrite, isReadMethod } from "../shared/publicPaths";
import { storeOfflineFeedback } from "../shared/offlineInbox";
import { feedbackPage } from "../shared/feedbackPage";
import { probeOrigin, readUptime } from "../shared/uptime";
import {
  pollAndStoreEcoflow,
  readStoredEcoflow,
  solarDeskFromStored,
} from "../shared/ecoflow";
import type { AvaEnv, ScheduledEvent } from "../shared/types";

const ORIGIN = "https://origin.avaivy.cloud";
const VERCEL_FRONTEND = "https://avaivy-cloud.pages.dev";

function isOpsPath(path: string): boolean {
  // Exact /api/ops and /api/ops/* only. Do not match /api/ops-schedule-banner.
  return (
    path === "/ops" ||
    path.startsWith("/ops/") ||
    path === "/api/ops" ||
    path.startsWith("/api/ops/")
  );
}

function isOriginApi(path: string): boolean {
  if (isOpsPath(path)) return false;
  // Named reads only. `/api/*` also carries operator routes such as
  // /api/finance and /api/biz — see src/shared/publicPaths.ts.
  return isPublicData(path);
}

function isGoalsPath(path: string): boolean {
  return (
    path === "/goals" ||
    path.startsWith("/goals/") ||
    path === "/wallets" ||
    path.startsWith("/wallets/") ||
    path === "/status/goals" ||
    path.startsWith("/status/goals")
  );
}

export default {
  async fetch(request: Request, env: AvaEnv): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    if (isOpsPath(path) || path === "/ava/ops" || path.startsWith("/ava/ops") || isPrivatePath(path)) {
      return new Response(null, { status: 404 });
    }

    const origin = env.AVA_ORIGIN_URL || ORIGIN;
    const urlPath = new URL(request.url).pathname.replace(/\/+$/, "") || "/";
    if (isPublicWrite(request.method, urlPath === "/feedback" ? "/feedback" : urlPath)) {
      const chat = urlPath === "/api/chat";
      let snapshot: Record<string, unknown> = {};
      try {
        snapshot = (await request.clone().json()) || {};
      } catch {
        snapshot = {};
      }
      return proxyToOrigin(request, {
        originUrl: origin,
        timeoutMs: chat ? 60000 : 8000,
        offlineFallback: async () => {
          if (chat) {
            return Response.json({
              reply: "I am offline on the Root Server. Try again when the desk is up.",
              brain: "offline",
            });
          }
          try {
            const stored = await storeOfflineFeedback(env, snapshot);
            return Response.json({ ok: true, stored: "offline", id: stored.id });
          } catch (err) {
            return Response.json(
              { ok: false, detail: err instanceof Error ? err.message : "inbox" },
              { status: 400 },
            );
          }
        },
      });
    }

    // No write ever reaches the origin from the public web.
    if (!isReadMethod(request.method) && (path.startsWith("/api/") || path.startsWith("/obs/"))) {
      return new Response(null, { status: 405 });
    }

    if (isGoalsPath(path) || path.startsWith("/api/goals")) {
      return goalsHiddenPage();
    }

    if (path === "/ava/status.json") {
      return statusJson(env);
    }

    // Only read the up/down log when the desk is actually dark.
    const holdingPage = async () => maintenancePage(await readUptime(env));

    // The solar board and the status board were the same page.
    if (path === "/solar" || path === "/solar/") {
      return Response.redirect(url.origin + "/status", 301);
    }

    // Product pages live on rootrecord.cloud, not on the Ava Ivy frontend.
    if (path === "/kilauea" || path === "/kilauea/" || path === "/weather" || path === "/weather/" || path === "/rootmc" || path === "/rootmc/") {
      return Response.redirect("https://rootrecord.cloud" + path.replace(/\/$/, ""), 301);
    }

    if (
      path === "/status" ||
      path === "/status/" ||
      path === "/ava/status" ||
      path === "/ava/status/" ||
      path === "/ava" ||
      path === "/ava/" ||
      path === "/feedback" ||
      path === "/feedback/"
    ) {
      return proxyToOrigin(request, {
        originUrl: origin,
        path: path.startsWith("/ava") ? "/status" : path.replace(/\/+$/, "") || "/status",
        timeoutMs: 8000,
        offlineFallback: path.replace(/\/+$/, "") === "/feedback" ? () => feedbackPage() : holdingPage,
      });
    }

    // Chat lives on the home screen only.
    if (path === "/chat" || path === "/chat/") {
      return Response.redirect(url.origin + "/#talk", 302);
    }

    // GET / is the Pages frontend. POST /api/chat still proxies to origin above.

    if (path.startsWith("/ava/")) {
      return proxyToOrigin(request, {
        originUrl: origin,
        path: path.slice("/ava".length),
        offlineFallback: holdingPage,
        timeoutMs: 8000,
      });
    }

    if (isOriginApi(path)) {
      const slowDesk =
        path.startsWith("/api/obs/solar-desk") ||
        path.startsWith("/api/obs/solar") ||
        path === "/api/solar";
      return proxyToOrigin(request, {
        originUrl: origin,
        timeoutMs: slowDesk ? 20000 : 8000,
        offlineFallback: async () => {
          if (path.startsWith("/api/obs/solar-desk") || path.startsWith("/api/obs/solar")) {
            const stored = await readStoredEcoflow(env);
            if (!stored && env.AVA_ECOFLOW_ACCESS_KEY) {
              const fresh = await pollAndStoreEcoflow(env);
              return solarDeskFromStored(fresh);
            }
            return solarDeskFromStored(stored);
          }
          return holdingPage();
        },
      });
    }

    try {
      return await fetchFrontend(request, VERCEL_FRONTEND);
    } catch {
      return holdingPage();
    }
  },

  async scheduled(_event: ScheduledEvent, env: AvaEnv): Promise<void> {
    // Probe first. If the Root Server is up, Ava owns EcoFlow — stand down.
    if (await probeOrigin(env, env.AVA_ORIGIN_URL || ORIGIN)) return;
    if (await avaIsAwake(env)) return;
    await pollAndStoreEcoflow(env);
  },
};
