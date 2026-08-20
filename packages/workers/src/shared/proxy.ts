/**
 * Origin proxy with offline fallback.
 * Tries to reach the local Ava server via cloudflared tunnel.
 * If unreachable (502, 522-524, network error), returns the offline page.
 */

export interface ProxyOptions {
  originUrl: string;         // e.g. https://ava-origin.rootmc.net
  offlineFallback?: () => Response | Promise<Response>;
  timeoutMs?: number;
  /** Override the origin path. Used to strip public prefixes like /ava. */
  path?: string;
}

function outboundHeaders(request: Request): Headers {
  const headers = new Headers(request.headers);
  // Visitor Host (avaivy.cloud) on a fetch to ava-origin.rootmc.net is a
  // cross-zone mismatch: 403, or a loop back into this Worker → timeout →
  // Vercel sleep stub for /solar.
  for (const name of [
    "host",
    "cf-connecting-ip",
    "cf-ipcountry",
    "cf-ray",
    "cf-visitor",
    "cf-ew-via",
    "cf-worker",
    "x-forwarded-for",
    "x-forwarded-proto",
    "x-real-ip",
    "connection",
    "content-length",
  ]) {
    headers.delete(name);
  }
  return headers;
}

/** Fetch a Vercel/Pages frontend without forwarding the visitor Host header. */
export async function fetchFrontend(
  request: Request,
  frontendBase: string,
): Promise<Response> {
  const url = new URL(request.url);
  const target = frontendBase.replace(/\/$/, "") + url.pathname + url.search;
  return fetch(target, {
    method: request.method,
    headers: outboundHeaders(request),
    body: request.method !== "GET" && request.method !== "HEAD" ? request.body : undefined,
    redirect: "follow",
  });
}

export async function proxyToOrigin(
  request: Request,
  opts: ProxyOptions
): Promise<Response> {
  const { originUrl, offlineFallback, timeoutMs = 8000, path } = opts;
  const url = new URL(request.url);
  const target = originUrl.replace(/\/$/, "") + (path ?? url.pathname) + url.search;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(target, {
      method: request.method,
      headers: outboundHeaders(request),
      body: request.method !== "GET" && request.method !== "HEAD"
        ? request.body : undefined,
      signal: controller.signal,
      redirect: "manual",
    });
    clearTimeout(timer);

    if ([502, 503, 522, 523, 524].includes(res.status)) {
      return (await offlineFallback?.()) ?? offlineResponse();
    }
    return res;
  } catch {
    clearTimeout(timer);
    return (await offlineFallback?.()) ?? offlineResponse();
  }
}

function offlineResponse(): Response {
  return new Response(
    `<!DOCTYPE html><html><body>
    <h1>Ava Ivy — Offline</h1>
    <p>The Root Server is powered down. Expected return: next solar morning.</p>
    <p><a href="https://rootrecord.info/ava/status">Check status</a></p>
    </body></html>`,
    { status: 503, headers: { "Content-Type": "text/html", "Retry-After": "3600" } }
  );
}
