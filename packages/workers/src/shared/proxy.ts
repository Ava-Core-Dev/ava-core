/**
 * Origin proxy with offline fallback.
 * Tries to reach the local Ava server via cloudflared tunnel.
 * If unreachable (502, 522-524, 530, network error), returns the maintenance page.
 */

import { maintenancePage } from "./maintenancePage";

export interface ProxyOptions {
  originUrl: string;         // e.g. https://origin.avaivy.cloud
  offlineFallback?: () => Response | Promise<Response>;
  timeoutMs?: number;
  /** Override the origin path. Used to strip public prefixes like /ava. */
  path?: string;
}

function outboundHeaders(request: Request, keepClientIp = false): Headers {
  // Capture the real visitor before we strip CF hop headers. Without this,
  // origin sees one shared Worker egress IP and burns the 3 free live talks
  // for everyone on the first three public chats of the day.
  const visitorIp =
    request.headers.get("cf-connecting-ip") ||
    (request.headers.get("x-forwarded-for") || "").split(",")[0].trim() ||
    "";
  const headers = new Headers(request.headers);
  // Visitor Host (avaivy.cloud) on a fetch to origin.avaivy.cloud is a
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
  if (keepClientIp && visitorIp) {
    headers.set("cf-connecting-ip", visitorIp);
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
      headers: outboundHeaders(request, true),
      body: request.method !== "GET" && request.method !== "HEAD"
        ? request.body : undefined,
      signal: controller.signal,
      redirect: "manual",
    });
    clearTimeout(timer);

    if ([502, 503, 522, 523, 524, 530].includes(res.status)) {
      return (await offlineFallback?.()) ?? offlineResponse();
    }
    return res;
  } catch {
    clearTimeout(timer);
    return (await offlineFallback?.()) ?? offlineResponse();
  }
}

function offlineResponse(): Response {
  return maintenancePage();
}
