import type { D1Database } from "@cloudflare/workers-types";

/** RootMc shard: no Solana RPC  -  stub keeps primary-auth import graph minimal. */
export type CustodialCacheRpcEnv = {
  DB: D1Database;
  SOLANA_RPC_URL?: string;
  RRTT_MINT_BASE58?: string;
  RRTT_DECIMALS?: string;
  CUSTODIAL_RPC_REFRESH_BUDGET_MS?: string;
};

export async function refreshCustodialOnchainCacheFromRpc(
  _env: CustodialCacheRpcEnv,
  _accountId: string,
): Promise<void> {}
