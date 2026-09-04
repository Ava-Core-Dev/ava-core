/**
 * Same-origin entry for the Home page iOS waitlist form.
 * Forwards to the dedicated `rootrecord-app-build` Worker so Discord bot secrets stay off Pages.
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
  headers.set("Content-Type", ct || "application/json");

  const ip =
    incoming.headers.get("CF-Connecting-IP") ||
    incoming.headers.get("X-Forwarded-For")?.split(",")[0]?.trim() ||
    "";
  if (ip) headers.set("X-Rootrecord-Client-IP", ip);
  const ua = incoming.headers.get("User-Agent");
  if (ua) headers.set("X-Rootrecord-Client-UA", ua);
  const ref = incoming.headers.get("Referer");
  if (ref) headers.set("X-Rootrecord-Client-Referer", ref);

  const upstream = await fetch(`${base}/ios-waitlist`, {
    method: "POST",
    headers,
    body: await incoming.arrayBuffer(),
    redirect: "manual",
  });

  const outHeaders = new Headers(upstream.headers);
  Object.entries(corsHeaders()).forEach(([k, v]) => {
    if (typeof v === "string") outHeaders.set(k, v);
  });

  return new Response(upstream.body, { status: upstream.status, statusText: upstream.statusText, headers: outHeaders });
};
