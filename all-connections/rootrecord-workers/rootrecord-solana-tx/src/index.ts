import { cors, json } from "./cors";
import type { SolanaTxEnv } from "./env";
import { handleMintRootsRoute } from "./roots-mint";
import { handleRunTreasuryLiquidityCheckRoute } from "./treasury-liquidity-cron";
import { handleRunTreasurySolLpCheckRoute } from "./treasury-sol-lp-cron";

function normalizePathname(pathname: string): string {
  return pathname.replace(/\/+/g, "/").replace(/\/+$/, "") || "/";
}

function apiSubpath(pathname: string): string {
  let p = normalizePathname(pathname);
  if (!p.startsWith("/api")) return p;
  p = p.slice(4) || "/";
  if (p.startsWith("/api")) return apiSubpath(`/api${p}`);
  return p;
}

export default {
  async fetch(request: Request, env: SolanaTxEnv): Promise<Response> {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: cors() });
    }
    const url = new URL(request.url);
    const sub = apiSubpath(url.pathname);
    const method = request.method;

    if (method === "GET" && sub === "/") {
      return json({ ok: true, service: "rootrecord-solana-tx", hint: "POST /api/internal/run-treasury-* with X-RR-Push-Admin-Key" });
    }

    const sol = await handleRunTreasurySolLpCheckRoute(request, env, sub, method);
    if (sol) return sol;
    const liq = await handleRunTreasuryLiquidityCheckRoute(request, env, sub, method);
    if (liq) return liq;
    const mint = await handleMintRootsRoute(request, env, sub, method);
    if (mint) return mint;

    return json({ detail: "Not found" }, 404);
  },

};
