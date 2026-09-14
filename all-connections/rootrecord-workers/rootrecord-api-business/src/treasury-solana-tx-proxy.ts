import { json } from "./cors";

const TREASURY_PATHS = new Set([
  "/internal/run-treasury-liquidity-check",
  "/internal/run-treasury-sol-lp-check",
]);

export type TreasurySolanaTxProxyEnv = { ROOTRECORD_SOLANA_TX_URL?: string };

/**
 * Forwards treasury maintenance POSTs to Worker `rootrecord-solana-tx` so api.rootrecord.info URLs stay stable.
 */
export async function proxyTreasurySolanaTxRoutes(
  request: Request,
  env: TreasurySolanaTxProxyEnv,
  sub: string,
  method: string,
): Promise<Response | null> {
  if (method !== "POST" || !TREASURY_PATHS.has(sub)) return null;
  const base = String(env.ROOTRECORD_SOLANA_TX_URL || "").trim().replace(/\/+$/, "");
  if (!base) {
    return json(
      {
        ok: false,
        detail:
          "Treasury automation runs on Worker `rootrecord-solana-tx`. Set `ROOTRECORD_SOLANA_TX_URL` on rootrecord-primary (e.g. https://rootrecord-solana-tx.rootrecord.workers.dev).",
      },
      503,
    );
  }
  const target = `${base}/api${sub}`;
  const buf = await request.arrayBuffer();
  return fetch(
    new Request(target, {
      method: "POST",
      headers: request.headers,
      body: buf.byteLength ? buf : undefined,
    }),
  );
}
