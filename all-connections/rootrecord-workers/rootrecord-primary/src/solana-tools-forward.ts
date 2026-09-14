/**
 * When solana.rootrecord.info (or similar) points at this Worker, some `/api/ecosystem/*`
 * and `/api/solana-site/*` paths hit the Worker first. Next.js (Vercel) serves the app.
 * If `SOLANA_TOOLS_API_FORWARD_URL` is set to the Vercel origin
 * (no trailing slash), forward unmatched tooling API requests there.
 * POST `/api/solana-site/token-discord-notify` is handled on the Worker (same auth as `/api/solana-site/log`), not forwarded.
 */

function apiSubpath(pathname: string): string {
  if (!pathname.startsWith("/api")) return pathname;
  const rest = pathname.slice(4);
  return rest === "" ? "/" : rest;
}

function stripHopByHopHeaders(incoming: Headers): Headers {
  const out = new Headers();
  for (const [k, v] of incoming.entries()) {
    const lk = k.toLowerCase();
    if (
      lk === "host" ||
      lk === "connection" ||
      lk === "content-length" ||
      lk === "cf-connecting-ip" ||
      lk === "cf-ray" ||
      lk === "cf-visitor"
    ) {
      continue;
    }
    out.set(k, v);
  }
  return out;
}

export type SolanaToolsForwardEnv = {
  SOLANA_TOOLS_API_FORWARD_URL?: string;
};

export async function maybeForwardSolanaToolsApi(
  request: Request,
  env: SolanaToolsForwardEnv,
  pathname: string,
  method: string
): Promise<Response | null> {
  const base = String(env.SOLANA_TOOLS_API_FORWARD_URL || "")
    .trim()
    .replace(/\/+$/, "");
  if (!base) return null;

  const sub = apiSubpath(pathname);
  if (!sub.startsWith("/ecosystem/") && !sub.startsWith("/solana-site/") && !sub.startsWith("/pin/") && !sub.startsWith("/tools/")) {
    return null;
  }

  // Handled natively on this Worker (do not forward).
  if (sub === "/solana-site/log" && method === "POST") return null;
  if (sub === "/solana-site/token-discord-notify" && method === "POST") return null;

  const url = new URL(request.url);
  const dest = `${base}${pathname}${url.search}`;

  const headers = stripHopByHopHeaders(request.headers);
  let body: ArrayBuffer | undefined;
  if (method !== "GET" && method !== "HEAD") {
    try {
      body = await request.arrayBuffer();
    } catch {
      body = undefined;
    }
  }

  try {
    return await fetch(dest, {
      method,
      headers,
      body: method === "GET" || method === "HEAD" ? undefined : body,
      redirect: "manual",
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "forward_failed";
    return new Response(JSON.stringify({ ok: false, detail: msg }), {
      status: 502,
      headers: { "content-type": "application/json; charset=utf-8" },
    });
  }
}
