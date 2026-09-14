export function cors(): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Authorization, Content-Type, X-RR-Push-Admin-Key",
    "Access-Control-Max-Age": "86400",
  };
}

export function json(data: unknown, status = 200, extra?: Record<string, string>): Response {
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
  return new Response(body, {
    status: st,
    headers: { "content-type": "application/json; charset=utf-8", ...cors(), ...extra },
  });
}
