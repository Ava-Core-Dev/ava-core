/**
 * ava-api Worker — serves avaivy.cloud
 * Routes:
 *   /          → Ava public identity site (Vercel)
 *   /api/*     → proxy to local Ava origin (avaivy.cloud/api/*)
 *   /obs/*     → proxy to local Ava origin
 *   /status    → proxy to local Ava origin
 *   /context   → proxy to local Ava origin
 *   Offline    → self-contained offline page (CF static)
 *
 * Cloudflare is proxy + fallback only. All intelligence runs on device.
 */

import { avaIsAwake } from "../shared/heartbeat";
import { proxyToOrigin } from "../shared/proxy";
import type { AvaEnv } from "../shared/types";

const ORIGIN = "https://ava-origin.rootmc.net";
const VERCEL_FRONTEND = "https://avaivy-cloud.vercel.app"; // update when deployed

const PROXIED_PREFIXES = ["/api/", "/obs/", "/status", "/context", "/solar", "/goals", "/health"];

export default {
  async fetch(request: Request, env: AvaEnv): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    // Proxy dynamic paths to local origin
    const shouldProxy = PROXIED_PREFIXES.some(p => path.startsWith(p));
    if (shouldProxy) {
      return proxyToOrigin(request, {
        originUrl: ORIGIN,
        offlineFallback: () => offlinePage(),
        timeoutMs: 8000,
      });
    }

    // Fallthrough to Vercel frontend for public site
    return fetch(VERCEL_FRONTEND + path + url.search, { headers: request.headers });
  },

  async scheduled(event: ScheduledEvent, env: AvaEnv): Promise<void> {
    // All scheduling runs on device. CF crons stand down when Ava is awake.
    if (await avaIsAwake(env)) return;
    // Ava is offline — CF can handle fallback jobs here if needed
  },
};

function offlinePage(): Response {
  return new Response(
    `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8">
    <title>Ava Ivy — Offline</title>
    <style>body{font-family:system-ui;max-width:600px;margin:4rem auto;padding:1rem}
    .badge{display:inline-block;background:#f59e0b;color:#000;padding:2px 8px;border-radius:4px}</style>
    </head><body>
    <h1>Ava Ivy <span class="badge">Offline</span></h1>
    <p>The Root Server (HI Pacific Solar) is powered down for the evening.</p>
    <p>Expected return: next solar morning (~6–8 AM HST).</p>
    <p>Static pages, economy board, and public wiki remain available.</p>
    <p><a href="https://rootrecord.info">rootrecord.info</a> · <a href="https://rootmc.net">rootmc.net</a></p>
    </body></html>`,
    { status: 503, headers: { "Content-Type": "text/html; charset=utf-8", "Retry-After": "3600" } }
  );
}
