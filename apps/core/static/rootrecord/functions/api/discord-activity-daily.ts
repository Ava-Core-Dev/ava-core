/**
 * GET /api/discord-activity-daily?days=14 — proxy to account Worker (Pages secret).
 */
import { accountApiBaseFromEnv } from "../_lib/accountApiBase";

type Env = {
  ROOTRECORD_API_ACCOUNT_BASE?: string;
  RR_PUSH_ADMIN_SECRET?: string;
};

export const onRequestGet = async (context: { request: Request; env: Env }): Promise<Response> => {
  const secret = String(context.env.RR_PUSH_ADMIN_SECRET || "").trim();
  if (!secret) {
    return new Response(JSON.stringify({ ok: false, detail: "RR_PUSH_ADMIN_SECRET is not set on Pages." }), {
      status: 503,
      headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
    });
  }
  const base = accountApiBaseFromEnv(context.env);
  const incoming = new URL(context.request.url);
  const upstream = new URL(`${base}/api/internal/discord-activity-daily`);
  incoming.searchParams.forEach((v, k) => upstream.searchParams.set(k, v));

  let res: Response;
  try {
    res = await fetch(upstream.toString(), {
      headers: {
        "X-RR-Push-Admin-Key": secret,
        "User-Agent": "rootrecord-website/1 (discord-activity-daily)",
      },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return new Response(JSON.stringify({ ok: false, detail: `Upstream fetch failed: ${msg}` }), {
      status: 502,
      headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
    });
  }
  const body = await res.arrayBuffer();
  const headers = new Headers();
  const ct = res.headers.get("Content-Type");
  if (ct) headers.set("Content-Type", ct);
  else headers.set("Content-Type", "application/json; charset=utf-8");
  headers.set("Cache-Control", "no-store");
  return new Response(body, { status: res.status, headers });
};
