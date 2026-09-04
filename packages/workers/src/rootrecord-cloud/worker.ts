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
import { fetchFrontend, proxyToOrigin } from "../shared/proxy";
import {
  isHiddenPath,
  isPrivatePath,
  isPublicData,
  isPublicPage,
  isPublicWrite,
  isReadMethod,
  htmlRedirectTarget,
  originHtmlPath,
  normalisePath,
} from "../shared/publicPaths";
import { storeOfflineFeedback } from "../shared/offlineInbox";
import { feedbackPage } from "../shared/feedbackPage";
import { probeOrigin, readUptime } from "../shared/uptime";
import type { AvaEnv, ScheduledEvent } from "../shared/types";

const ORIGIN = "https://origin.avaivy.cloud";
/** Static GEO/context pack (same files as avaivy Pages). Holding must not own these. */
const AVAIVY_PAGES = "https://avaivy-cloud.pages.dev";

/** Landing page. Product home. Status desk is /status. */
const HOME_PAGE = "/";

function gone(status: number): Response {
  return new Response(null, { status });
}

export default {
  async fetch(request: Request, env: AvaEnv): Promise<Response> {
    const url = new URL(request.url);
    const host = url.hostname.replace(/^www\./i, "").toLowerCase();
    // One public door. .info is an alias, not a second site — never the holding page.
    if (host === "rootrecord.info") {
      const dest = new URL(request.url);
      dest.protocol = "https:";
      dest.hostname = "rootrecord.cloud";
      dest.port = "";
      return Response.redirect(dest.toString(), 301);
    }

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
      return Response.redirect(url.origin + "/status", 301);
    }

    // One pattern for every HTML file: /about.html → /about (query kept).
    const prettyHtml = htmlRedirectTarget(path);
    if (prettyHtml != null) {
      const dest = new URL(request.url);
      dest.pathname = prettyHtml;
      return Response.redirect(dest.toString(), 301);
    }

    // Context / GEO stay on the static pack when origin flaps — not holding HTML.
    const geoPath =
      path === "/context" ||
      path === "/context.md" ||
      path === "/api/context" ||
      path === "/llms.txt" ||
      path === "/ai.txt" ||
      path === "/robots.txt" ||
      path.startsWith("/context/") ||
      path.startsWith("/docs/geo/");
    if (geoPath) {
      return proxyToOrigin(request, {
        originUrl: origin,
        path,
        timeoutMs: 15000,
        offlineFallback: async () => {
          if (path === "/api/context") {
            return Response.json(
              {
                ok: false,
                detail: "origin offline",
                hub: "https://avaivy.cloud/context",
              },
              { status: 503 },
            );
          }
          try {
            const pages = await fetchFrontend(request, AVAIVY_PAGES);
            if (pages.ok) return pages;
          } catch {
            /* miss */
          }
          if (path === "/context" || path.startsWith("/context/")) {
            return Response.redirect("https://avaivy.cloud" + path, 302);
          }
          return new Response("Context temporarily unavailable.\n", {
            status: 503,
            headers: { "content-type": "text/plain; charset=utf-8" },
          });
        },
      });
    }

    if (path === "/" || isPublicPage(path) || isPublicData(path)) {
      const originPath = originHtmlPath(path) ?? (path === "/" ? HOME_PAGE : path);
      return proxyToOrigin(request, {
        originUrl: origin,
        path: originPath,
        timeoutMs: 15000,
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
