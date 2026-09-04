/**
 * GET /api/public/goals/* — proxy to Root Goals API Worker public endpoints.
 */
import { goalsApiBaseFromEnv } from "../../../_lib/goalsApiBase";

type Env = {
  ROOTRECORD_API_GOALS_BASE?: string;
};

function tailFromParams(path: string | string[] | undefined): string {
  if (path === undefined) return "";
  return Array.isArray(path) ? path.join("/") : String(path);
}

async function proxyGoalsPublic(context: {
  request: Request;
  env: Env;
  params: Record<string, string | string[] | undefined>;
}): Promise<Response> {
  const base = goalsApiBaseFromEnv(context.env);
  const tail = tailFromParams(context.params.path);
  const incoming = new URL(context.request.url);
  const upstream = new URL(`${base}/public/${tail}`);
  incoming.searchParams.forEach((v, k) => upstream.searchParams.set(k, v));

  let res: Response;
  try {
    res = await fetch(upstream.toString(), {
      headers: {
        Accept: "application/json",
        "User-Agent": "rootrecord-website/1 (goals-public-proxy)",
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
  headers.set("Content-Type", ct || "application/json; charset=utf-8");
  const cache = res.headers.get("Cache-Control");
  headers.set("Cache-Control", cache || "public, max-age=60");
  return new Response(body, { status: res.status, headers });
}

export const onRequestGet = proxyGoalsPublic;
