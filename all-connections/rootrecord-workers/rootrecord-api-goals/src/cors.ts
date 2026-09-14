export const NWS_USER_AGENT = "RootRecordWeatherManagerMobile/1.0 (contact: root@rootrecord.info)";

import { AsyncLocalStorage } from "node:async_hooks";
import { allowedWebCredentialOrigin } from "./web-sso";

/** Per-request CORS origin. Must not be a module global — concurrent Worker requests share an isolate. */
const corsRequest = new AsyncLocalStorage<Request>();

export function bindCorsRequest(request: Request | undefined): void {
  /* kept for call sites; real isolation is runWithCors / corsRequest.getStore() */
  if (request) corsRequest.enterWith(request);
}

export function runWithCors<T>(request: Request, fn: () => T): T {
  return corsRequest.run(request, fn);
}

export function cors(): Record<string, string> {
  const req = corsRequest.getStore();
  const origin = req ? allowedWebCredentialOrigin(req.headers.get("Origin")) : null;
  if (origin) {
    return {
      "Access-Control-Allow-Origin": origin,
      "Access-Control-Allow-Credentials": "true",
      "Vary": "Origin",
      "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
      "Access-Control-Allow-Headers":
        "Accept, Authorization, Cookie, X-Guest-Id, X-RR-App-Id, Content-Type, Cache-Control, Pragma",
      "Access-Control-Max-Age": "86400",
    };
  }
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
    "Access-Control-Allow-Headers":
      "Accept, Authorization, Cookie, X-Guest-Id, X-RR-App-Id, Content-Type, Cache-Control, Pragma",
    "Access-Control-Max-Age": "86400",
  };
}

export function json(
  data: unknown,
  status = 200,
  extra?: Record<string, string>,
  setCookieLines?: string | string[]
): Response {
  let body: string;
  let st = status;
  try {
    body = JSON.stringify(data, (_k, v) => (typeof v === "bigint" ? v.toString() : v));
  } catch (e) {
    const msg = String(e && typeof e === "object" && "message" in e ? (e as Error).message : e);
    console.error("json stringify failed", msg);
    body = JSON.stringify({ detail: "Could not serialize response." });
    st = 500;
  }
  const headers = new Headers();
  headers.set("content-type", "application/json; charset=utf-8");
  const base = cors();
  for (const [k, v] of Object.entries(base)) {
    headers.set(k, v);
  }
  if (extra) {
    for (const [k, v] of Object.entries(extra)) {
      headers.set(k, v);
    }
  }
  if (setCookieLines) {
    const arr = Array.isArray(setCookieLines) ? setCookieLines : [setCookieLines];
    for (const line of arr) {
      if (line) headers.append("Set-Cookie", line);
    }
  }
  return new Response(body, { status: st, headers });
}
