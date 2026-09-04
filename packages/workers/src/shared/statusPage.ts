/**
 * Host status page, rendered from Ava's D1 heartbeat.
 *
 * The origin proxy can fail while Ava is perfectly healthy (tunnel restart,
 * DNS propagation, brief network drop). Reading the heartbeat lets the page
 * distinguish "the host is powered down" from "the host is up but the edge
 * cannot reach it right now", instead of always claiming the former.
 */

import { getHeartbeat, type Heartbeat, type HeartbeatEnv } from "./heartbeat";

function relative(ageMs: number): string {
  const s = Math.max(0, Math.round(ageMs / 1000));
  if (s < 90) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 90) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 36) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

/** JSON view of host presence — safe for dashboards and uptime checks. */
export async function statusJson(env: HeartbeatEnv): Promise<Response> {
  const hb = await getHeartbeat(env);
  const body = {
    host: "ava-core",
    online: hb?.fresh ?? false,
    last_seen: hb?.ts ?? null,
    age_seconds: hb ? Math.round(hb.ageMs / 1000) : null,
    reason: hb === null ? "no_heartbeat" : hb.fresh ? "ok" : "heartbeat_stale",
  };
  return new Response(JSON.stringify(body, null, 2), {
    status: body.online ? 200 : 503,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

/**
 * HTML status page.
 *
 * `degraded` marks the case where this page is standing in for a failed origin
 * proxy. A fresh heartbeat then means "host up, edge could not reach it" rather
 * than "host down" — without that distinction the copy contradicts the badge.
 */
export async function statusPage(
  env: HeartbeatEnv,
  opts: { degraded?: boolean } = {}
): Promise<Response> {
  const hb = await getHeartbeat(env);
  const online = hb?.fresh ?? false;
  return new Response(render(hb, opts.degraded ?? false), {
    status: online && !opts.degraded ? 200 : online ? 502 : 503,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "Retry-After": online ? "30" : "1800",
      "X-Ava-Host": online ? "online" : "offline",
    },
  });
}

function render(hb: Heartbeat | null, degraded: boolean): string {
  const online = hb?.fresh ?? false;
  const state = !online ? "offline" : degraded ? "degraded" : "online";
  const badge = { online: "HOST ONLINE", degraded: "REACHING HOST", offline: "HOST OFFLINE" }[state];
  const accent = state === "online" ? "#22c55e" : state === "degraded" ? "#22d3ee" : "#f59e0b";
  const lastSeen = hb ? `${relative(hb.ageMs)} · ${hb.ts}` : "no heartbeat recorded";

  const blurb = {
    online: `Solar Root Server is powered on and reporting in.`,
    degraded: `Ava is powered on and reporting in, but the edge could not reach
       the origin for this request. This is usually a tunnel restart and clears
       on its own within a minute.`,
    offline: hb === null
      ? `No heartbeat has ever been recorded for this host.`
      : `Solar Root Server is powered down or unreachable.`,
  }[state];

  return `<!DOCTYPE html><html lang="en"><head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Ava Ivy — ${state}</title>
<style>
  :root { color-scheme: dark; }
  body { margin:0; min-height:100vh; display:flex; align-items:center;
         justify-content:center; background:#0b1220; color:#e2e8f0;
         font-family:system-ui,-apple-system,Segoe UI,sans-serif; padding:2rem; }
  .card { max-width:34rem; text-align:center; }
  .badge { display:inline-block; border:1px solid ${accent}; color:${accent};
           border-radius:999px; padding:.25rem .9rem; font-size:.72rem;
           letter-spacing:.14em; font-weight:600; }
  h1 { margin:1.1rem 0 .4rem; font-size:2.1rem; }
  p { color:#94a3b8; line-height:1.6; margin:.5rem 0; }
  .rule { width:4rem; height:3px; background:${accent}; border-radius:2px; margin:1.8rem auto; }
  .meta { font-size:.8rem; color:#64748b; font-variant-numeric:tabular-nums; }
  .links { margin-top:1.8rem; display:flex; gap:.6rem; flex-wrap:wrap; justify-content:center; }
  a { display:inline-block; padding:.55rem 1rem; border-radius:.5rem; text-decoration:none;
      border:1px solid #1e293b; color:#cbd5e1; font-size:.88rem; }
  a:hover { border-color:${accent}; color:${accent}; }
</style></head><body><div class="card">
  <span class="badge">${badge}</span>
  <h1>Ava Ivy</h1>

  <p>${blurb}</p>
  <div class="rule"></div>
  <p class="meta">Last heartbeat: ${lastSeen}</p>
  <div class="links">
    <a href="">Retry</a>
    <a href="https://avaivy.cloud/status">Full status desk</a>
    <a href="https://avaivy.cloud/solar">Solar</a>
    <a href="/ava/status.json">Status JSON</a>
    <a href="https://rootmc.net">RootMC</a>
    <a href="https://rootrecord.cloud">Root Record</a>
    <a href="https://alexrs94.site">alexrs94</a>
  </div>
</div></body></html>`;
}
