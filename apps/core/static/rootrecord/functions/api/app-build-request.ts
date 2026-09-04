/**
 * Same-origin entry for the marketing form: forwards to the dedicated Worker
 * `rootrecord-app-build` so Discord webhook secrets and logic live off Pages.
 * Optional override: APP_BUILD_WORKER_URL (Pages env).
 */
type Env = {
  APP_BUILD_WORKER_URL?: string;
};

const DEFAULT_WORKER = "https://rootrecord-app-build.rootrecord.workers.dev";

function corsHeaders(): HeadersInit {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Max-Age": "86400",
  };
}

export const onRequestOptions = async () => {
  return new Response(null, {
    status: 204,
    headers: corsHeaders(),
  });
};

export const onRequestPost = async (context: { request: Request; env: Env }): Promise<Response> => {
  const base = String(context.env.APP_BUILD_WORKER_URL || DEFAULT_WORKER)
    .trim()
    .replace(/\/+$/, "");
  const incoming = context.request;

  const headers = new Headers();
  const ct = incoming.headers.get("Content-Type");
  if (ct) headers.set("Content-Type", ct);
  else headers.set("Content-Type", "application/json");

  const ip =
    incoming.headers.get("CF-Connecting-IP") ||
    incoming.headers.get("X-Forwarded-For")?.split(",")[0]?.trim() ||
    "";
  if (ip) headers.set("X-Rootrecord-Client-IP", ip);
  const ua = incoming.headers.get("User-Agent");
  if (ua) headers.set("X-Rootrecord-Client-UA", ua);
  const ref = incoming.headers.get("Referer");
  if (ref) headers.set("X-Rootrecord-Client-Referer", ref);

  const bodyBuf = await incoming.arrayBuffer();

  const upstream = await fetch(`${base}/`, {
    method: "POST",
    headers,
    body: bodyBuf,
    redirect: "manual",
  });

  const outHeaders = new Headers(upstream.headers);
  Object.entries(corsHeaders()).forEach(([k, v]) => {
    if (typeof v === "string") outHeaders.set(k, v);
  });

  return new Response(upstream.body, { status: upstream.status, statusText: upstream.statusText, headers: outHeaders });
};
