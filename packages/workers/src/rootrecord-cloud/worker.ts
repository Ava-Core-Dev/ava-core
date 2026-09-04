/**
 * rootrecord-cloud Worker — serves rootrecord.cloud, the public home.
 *
 * This is the public domain for the whole system. Pages come from the origin
 * through the tunnel; when the desk is dark the holding page answers with the
 * last-seen time and the measured return countdown.
 *
 * Reads only, by name. See src/shared/publicPaths.ts for why.
 */

import { maintenancePage } from "../shared/maintenancePage";
import { proxyToOrigin } from "../shared/proxy";
import {
  isHiddenPath,
  isPrivatePath,
  isPublicData,
  isPublicPage,
  isPublicWrite,
  isReadMethod,
  normalisePath,
} from "../shared/publicPaths";
import { storeOfflineFeedback } from "../shared/offlineInbox";
import { feedbackPage } from "../shared/feedbackPage";
import { probeOrigin, readUptime } from "../shared/uptime";
import type { AvaEnv, ScheduledEvent } from "../shared/types";

const ORIGIN = "https://origin.avaivy.cloud";

/** Landing page. The desk is the home page. */
const HOME_PAGE = "/status";

function gone(status: number): Response {
  return new Response(null, { status });
}

export default {
  async fetch(request: Request, env: AvaEnv): Promise<Response> {
    const url = new URL(request.url);
    const path = normalisePath(url.pathname);
    const origin = env.AVA_ORIGIN_URL || ORIGIN;

    // Only read the up/down log when the page actually needs it.
    const holding = async (status = 503) => {
      const page = maintenancePage(await readUptime(env));
      return new Response(page.body, { status, headers: page.headers });
    };

    if (isPrivatePath(path)) return gone(404);
    if (isHiddenPath(path)) return holding(404);

    if (isPublicWrite(request.method, path)) {
      let snapshot: Record<string, unknown> = {};
      try {
        snapshot = (await request.clone().json()) || {};
      } catch {
        snapshot = {};
      }
      return proxyToOrigin(request, {
        originUrl: origin,
        path,
        timeoutMs: 8000,
        offlineFallback: async () => {
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

    if (!isReadMethod(request.method)) return gone(405);

    // The solar board and the status board were the same page.
    if (path === "/solar") {
      return Response.redirect(url.origin + HOME_PAGE, 301);
    }

    if (path === "/" || isPublicPage(path) || isPublicData(path)) {
      return proxyToOrigin(request, {
        originUrl: origin,
        path: path === "/" ? HOME_PAGE : path,
        timeoutMs: 8000,
        offlineFallback: () => (path === "/feedback" ? feedbackPage() : holding()),
      });
    }

    return holding(404);
  },

  async scheduled(_event: ScheduledEvent, env: AvaEnv): Promise<void> {
    // Uptime log only — no EcoFlow work on this Worker.
    await probeOrigin(env, env.AVA_ORIGIN_URL || ORIGIN);
  },
};
