/**
 * Always-on front door for https://ava.rootmc.net
 * Relays to Ava origin (tunnel); caches last-good status/solar/HTML + return ETA in KV.
 * When origin is down: offline page with last-known return timer (avg start + 1h, not sunrise).
 */
export interface Env {
  AVA_ORIGIN?: string;
  AVA_CACHE?: KVNamespace;
  ROOTMC_API_BASE?: string;
}

const DEFAULT_ORIGIN = "https://ava-origin.rootmc.net";
const STATUS_URL = "https://rootrecord.online/ava/status";

const HOP_BY_HOP = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailers",
  "transfer-encoding",
  "upgrade",
  "host",
  "cf-connecting-ip",
  "cf-ray",
  "cf-visitor",
  "x-forwarded-proto",
  "x-real-ip",
  "content-length",
]);

function originBase(env: Env): string {
  return String(env.AVA_ORIGIN || DEFAULT_ORIGIN).replace(/\/$/, "");
}

async function kvGet(env: Env, key: string): Promise<string | null> {
  if (!env.AVA_CACHE) return null;
  try {
    return await env.AVA_CACHE.get(key);
  } catch {
    return null;
  }
}

async function kvPut(env: Env, key: string, value: string, ttl = 86400 * 14): Promise<void> {
  if (!env.AVA_CACHE) return;
  try {
    await env.AVA_CACHE.put(key, value, { expirationTtl: ttl });
  } catch {
    /* ignore */
  }
}

function offlineHtml(eta: Record<string, unknown> | null): string {
  const atMs = eta && typeof eta.atMs === "number" ? eta.atMs : null;
  const label = String(eta?.label || "—");
  const note = String(
    eta?.note ||
      "Return ETA = average daytime start + 1 hour wiggle (not sunrise).",
  );
  const avg = eta?.averageLabel ? String(eta.averageLabel) : "";
  const samples = eta?.sampleDays != null ? String(eta.sampleDays) : "";
  return `<!DOCTYPE html>
<html lang="en"><head>
<meta charset="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/>
<meta http-equiv="refresh" content="60"/>
<title>Ava Ivy — offline</title>
<style>
:root{--bg0:#000d1a;--bg1:#001428;--ink:#ffffff;--muted:#7a92a8;--accent:#00e5ff;--accent-glow:rgba(0,229,255,.28);--warn:#ffb020;--line:rgba(0,229,255,.18);--ava-portrait:url("https://rootrecord.online/ava/assets/ava-wave-hello-still.png")}
*{box-sizing:border-box}
body{margin:0;min-height:100vh;color:var(--ink);font-family:"IBM Plex Sans",Segoe UI,sans-serif;position:relative;isolation:isolate;
background:radial-gradient(1000px 500px at 15% -10%,#00334d 0%,transparent 55%),radial-gradient(800px 420px at 100% 10%,#001a33 0%,transparent 50%),linear-gradient(165deg,var(--bg0),var(--bg1));
display:flex;align-items:center;justify-content:center;padding:24px}
body::before{content:"";position:fixed;right:max(-2vw,-24px);bottom:0;width:min(46vw,560px);height:min(78vh,760px);z-index:0;pointer-events:none;
background:var(--ava-portrait) no-repeat right bottom/contain;opacity:.32;filter:drop-shadow(0 0 48px rgba(0,229,255,.35));
-webkit-mask-image:linear-gradient(90deg,transparent 0%,#000 18%,#000 100%);mask-image:linear-gradient(90deg,transparent 0%,#000 18%,#000 100%)}
main{max-width:560px;width:100%;text-align:center;position:relative;z-index:1}
.pill{display:inline-block;padding:6px 12px;border-radius:999px;border:1px solid rgba(255,176,32,.45);color:var(--warn);font-size:.75rem;letter-spacing:.06em;text-transform:uppercase;margin-bottom:18px}
h1{font-family:"IBM Plex Serif",Georgia,serif;font-weight:600;font-size:clamp(1.8rem,5vw,2.4rem);margin:0 0 8px;letter-spacing:-.02em}
.sub{color:var(--muted);margin:0 0 28px;line-height:1.45}
.countdown{font-variant-numeric:tabular-nums;font-size:clamp(2.6rem,12vw,4.2rem);font-weight:700;color:var(--accent);letter-spacing:.04em;margin:8px 0 6px;text-shadow:0 0 36px var(--accent-glow)}
.eta-label{font-size:1.15rem;margin:0 0 8px}
.meta{color:var(--muted);font-size:.9rem;margin:0 0 28px;line-height:1.5}
.row{display:flex;flex-wrap:wrap;gap:10px;justify-content:center;margin-bottom:12px}
a.btn{display:inline-block;padding:10px 16px;border-radius:6px;border:1px solid var(--line);color:var(--ink);text-decoration:none;background:rgba(255,255,255,.04)}
a.btn:hover{border-color:var(--accent);box-shadow:0 0 18px rgba(0,229,255,.12)}
a.btn.primary{border-color:var(--accent);background:rgba(0,229,255,.14);color:var(--accent)}
a.btn.nav{font-size:.92rem}
</style></head><body>
<main>
<div class="pill">Host offline</div>
<h1>Ava Ivy</h1>
<p class="sub">Solar Root Server is powered down or unreachable. She’ll be back around the return window below.</p>
<div class="countdown" id="cd">—</div>
<p class="eta-label">Expected return · <strong>${label.replace(/</g, "")}</strong></p>
<p class="meta">${note.replace(/</g, "")}${avg ? `<br/>Raw average start ${avg.replace(/</g, "")}${samples ? ` (${samples} days)` : ""}` : ""}</p>
<div class="row">
<a class="btn primary" href="${STATUS_URL}" id="retry">Check if online</a>
<a class="btn" href="${STATUS_URL}">Status board</a>
</div>
<div class="row">
<a class="btn nav" href="https://rootmc.net">RootMC</a>
<a class="btn nav" href="https://rootrecord.online/ava/">Ava docs</a>
<a class="btn nav" href="https://rootrecord.online/">RootRecord</a>
</div>
</main>
<script>
const atMs=${atMs == null ? "null" : String(atMs)};
const statusUrl=${JSON.stringify(STATUS_URL)};
function pad(n){return String(n).padStart(2,"0")}
function fmt(ms){let s=Math.max(0,Math.floor(ms/1000));const h=Math.floor(s/3600);s%=3600;const m=Math.floor(s/60);const sec=s%60;return pad(h)+":"+pad(m)+":"+pad(sec)}
function tick(){const el=document.getElementById("cd");if(!el)return;if(atMs==null){el.textContent="—";return}el.textContent=fmt(atMs-Date.now())}
tick();setInterval(tick,1000);
async function probe(){try{for(const u of["https://ava.rootmc.net/health","https://ava-origin.rootmc.net/health"]){try{const r=await fetch(u,{cache:"no-store",mode:"cors"});if(r.ok){location.replace(statusUrl);return}}catch(e){}}}catch(e){}}
probe();setInterval(probe,30000);
</script>
</body></html>`;
}

async function loadCachedEta(env: Env): Promise<Record<string, unknown> | null> {
  const raw = await kvGet(env, "api:return-eta");
  if (!raw) {
    // Fall back to nested field from last status/solar cache
    for (const key of ["api:status", "api:solar"]) {
      const body = await kvGet(env, key);
      if (!body) continue;
      try {
        const j = JSON.parse(body);
        if (j?.returnEta?.ok) return j.returnEta;
        if (j?.nightMode?.returnEta?.ok) return j.nightMode.returnEta;
        if (j?.projectedStart?.ok) {
          return {
            ok: true,
            atMs: j.projectedStart.atMs,
            label: j.projectedStart.label,
            note: j.projectedStart.note,
            averageLabel: j.projectedStart.averageLabel,
            sampleDays: j.projectedStart.sampleDays,
          };
        }
      } catch {
        /* soft */
      }
    }
    return null;
  }
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function offlineResponse(env: Env, detail = "origin unreachable"): Promise<Response> {
  const eta = await loadCachedEta(env);
  return new Response(offlineHtml(eta), {
    status: 503,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "X-RootMC-Ava-Edge": "offline-page",
      "X-RootMC-Ava-Detail": String(detail).slice(0, 120),
    },
  });
}

async function relay(
  request: Request,
  env: Env,
  pathWithQuery: string,
  cacheKey: string | null,
  asJson = false,
  method: string = "GET",
): Promise<Response> {
  const target = originBase(env) + pathWithQuery;
  const headers = new Headers();
  request.headers.forEach((value, key) => {
    if (!HOP_BY_HOP.has(key.toLowerCase())) headers.set(key, value);
  });
  headers.set("User-Agent", "RootMC-Ava-Edge/1.1");

  const init: RequestInit = {
    method,
    headers,
    redirect: "manual",
    cf: { cacheTtl: 0, cacheEverything: false },
  } as RequestInit;
  if (method !== "GET" && method !== "HEAD") {
    init.body = await request.arrayBuffer();
  }

  try {
    const upstream = await fetch(target, init);
    if (upstream.ok) {
      const body = await upstream.text();
      if (cacheKey) await kvPut(env, cacheKey, body);
      // Also harvest return ETA from status/solar payloads
      if (asJson && (cacheKey === "api:status" || cacheKey === "api:solar")) {
        try {
          const j = JSON.parse(body);
          const eta = j?.returnEta || j?.nightMode?.returnEta || j?.projectedStart;
          if (eta?.atMs) await kvPut(env, "api:return-eta", JSON.stringify(eta));
        } catch {
          /* soft */
        }
      }
      if (cacheKey === "api:return-eta") {
        await kvPut(env, "api:return-eta", body);
      }
      const out = new Headers(upstream.headers);
      out.set("X-RootMC-Ava-Edge", "origin");
      out.set("Access-Control-Allow-Origin", "*");
      if (asJson) out.set("Content-Type", "application/json; charset=utf-8");
      return new Response(body, { status: upstream.status, headers: out });
    }
    throw new Error(`origin ${upstream.status}`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (asJson) {
      const cached = cacheKey ? await kvGet(env, cacheKey) : null;
      if (cached) {
        try {
          const data = JSON.parse(cached);
          data.fromCache = true;
          data.originOffline = true;
          data.cacheDetail = msg;
          return new Response(JSON.stringify(data), {
            status: 200,
            headers: {
              "Content-Type": "application/json; charset=utf-8",
              "X-RootMC-Ava-Edge": "cache",
              "Access-Control-Allow-Origin": "*",
            },
          });
        } catch {
          /* fall through */
        }
      }
      const eta = await loadCachedEta(env);
      return new Response(
        JSON.stringify({
          ok: false,
          originOffline: true,
          detail: msg,
          service: "ava-ivy-edge",
          returnEta: eta,
        }),
        {
          status: 503,
          headers: {
            "Content-Type": "application/json; charset=utf-8",
            "X-RootMC-Ava-Edge": "down",
            "Access-Control-Allow-Origin": "*",
          },
        },
      );
    }
    // HTML pages → dedicated offline board (not a stale dashboard dump)
    return offlineResponse(env, msg);
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    if (request.method === "OPTIONS") {
      return new Response(null, {
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, HEAD, POST, OPTIONS",
          "Access-Control-Allow-Headers": "*",
          "Access-Control-Max-Age": "86400",
        },
      });
    }

    if (path === "/api/public-chat" || path === "/api/ava-chat") {
      return new Response(
        JSON.stringify({
          ok: false,
          error: "public_chat_retired",
          message: "Homepage chat is off. Catch Ava on Discord or in-game.",
        }),
        {
          status: 410,
          headers: {
            "Content-Type": "application/json; charset=utf-8",
            "Access-Control-Allow-Origin": "*",
            "Cache-Control": "no-store",
            "X-RootMC-Ava-Edge": "public-chat-retired",
          },
        },
      );
    }

    if (request.method !== "GET" && request.method !== "HEAD") {
      return new Response("Method not allowed", { status: 405 });
    }

    // Explicit offline board (also used when origin is down)
    if (path === "/offline" || path === "/offline/") {
      // Prefer live origin if up → bounce to status
      try {
        const health = await fetch(originBase(env) + "/health", {
          cf: { cacheTtl: 0, cacheEverything: false },
        } as RequestInit);
        if (health.ok) {
          return new Response(null, {
            status: 302,
            headers: {
              Location: STATUS_URL,
              "X-RootMC-Ava-Edge": "offline-redirect-online",
            },
          });
        }
      } catch {
        /* show offline */
      }
      return offlineResponse(env, "explicit /offline");
    }

    // HTML home → canonical status when online; offline page when origin down
    if (path === "/" || path === "") {
      const accept = request.headers.get("Accept") || "text/html";
      if (!accept.includes("application/json")) {
        try {
          const health = await fetch(originBase(env) + "/health", {
            cf: { cacheTtl: 0, cacheEverything: false },
          } as RequestInit);
          if (health.ok) {
            return new Response(null, {
              status: 302,
              headers: {
                Location: STATUS_URL,
                "X-RootMC-Ava-Edge": "redirect-status",
              },
            });
          }
        } catch {
          /* fall through */
        }
        return offlineResponse(env, "home origin down");
      }
    }

    if (path === "/api/return-eta") {
      return relay(request, env, path + url.search, "api:return-eta", true);
    }
    if (path === "/api/status") {
      return relay(request, env, path + url.search, "api:status", true);
    }
    if (path === "/api/solar") {
      return relay(request, env, path + url.search, "api:solar", true);
    }
    if (path === "/api/ava-hours") {
      return relay(request, env, path + url.search, "api:ava-hours", true);
    }
    if (path === "/health") {
      return relay(request, env, path + url.search, "api:health", true);
    }
    if (path === "/status" || path === "/status/") {
      return relay(request, env, "/status" + url.search, "html:status", false);
    }
    if (path === "/connections" || path === "/status/connections" || path === "/status/connections/") {
      const upstreamPath = path.startsWith("/status/") ? path : "/connections";
      return relay(request, env, upstreamPath + url.search, "html:connections", false);
    }
    if (path === "/solar" || path === "/power") {
      return relay(request, env, "/solar" + url.search, "html:solar", false);
    }
    if (path === "/api/connections") {
      return relay(request, env, path + url.search, "api:connections", true);
    }

    return relay(request, env, path + url.search, null, false);
  },
};
