export const NWS_USER_AGENT = "RootRecordWeatherManagerMobile/1.0 (contact: root@rootrecord.info)";

import { allowedWebCredentialOrigin } from "./web-sso";

/** Per-request binding so `json()` / `cors()` pick up credentialed CORS without threading Request through every call site. */
let boundCorsRequest: Request | undefined;

export function bindCorsRequest(request: Request | undefined): void {
  boundCorsRequest = request;
}

export function cors(): Record<string, string> {
  const origin = boundCorsRequest ? allowedWebCredentialOrigin(boundCorsRequest.headers.get("Origin")) : null;
  if (origin) {
    return {
      "Access-Control-Allow-Origin": origin,
      "Access-Control-Allow-Credentials": "true",
      "Vary": "Origin",
      "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
      "Access-Control-Allow-Headers":
        "Authorization, Cookie, X-Guest-Id, Content-Type, Cache-Control, Pragma",
      "Access-Control-Max-Age": "86400",
    };
  }
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
    "Access-Control-Allow-Headers":
      "Authorization, Cookie, X-Guest-Id, Content-Type, Cache-Control, Pragma",
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
