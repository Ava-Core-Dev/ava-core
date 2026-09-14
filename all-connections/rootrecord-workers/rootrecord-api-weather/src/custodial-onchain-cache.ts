import type { D1Database } from "@cloudflare/workers-types";
import { Connection, PublicKey } from "@solana/web3.js";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";

export type CustodialCacheRpcEnv = {
  DB: D1Database;
  SOLANA_RPC_URL?: string;
  RRTT_MINT_BASE58?: string;
  RRTT_DECIMALS?: string;
  CUSTODIAL_RPC_REFRESH_BUDGET_MS?: string;
};

/** Skip writing D1 if `cache_updated_at` is this fresh (reads still hit RPC every request). */
const D1_WRITE_MIN_INTERVAL_MS = 12_000;

/**
 * Solana RPC can stall indefinitely (edge rate limits, TCP half-open). `/auth/me` and `/earn/summary`
 * await this path — must return so mobile apps exit the global Loading gate and rewards UI.
 * `CUSTODIAL_RPC_REFRESH_BUDGET_MS` in wrangler [vars] (default 10000).
 */
const RPC_REFRESH_BUDGET_DEFAULT_MS = 10_000;
const RPC_REFRESH_BUDGET_MIN_MS = 2_000;
const RPC_REFRESH_BUDGET_MAX_MS = 30_000;

function custodialRpcRefreshBudgetMs(env: CustodialCacheRpcEnv): number {
  const n = Math.floor(Number(String(env.CUSTODIAL_RPC_REFRESH_BUDGET_MS || "").trim()));
  if (!Number.isFinite(n) || n <= 0) return RPC_REFRESH_BUDGET_DEFAULT_MS;
  return Math.min(RPC_REFRESH_BUDGET_MAX_MS, Math.max(RPC_REFRESH_BUDGET_MIN_MS, n));
}

async function withTimeout<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<T>((resolve) => {
    timer = setTimeout(() => resolve(fallback), ms);
  });
  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function isLikelyInfraRpcError(e: unknown): boolean {
  const s = e instanceof Error ? e.message : String(e);
  return /429|503|504|408|ECONNRESET|ETIMEDOUT|fetch failed|Too many|rate limit|socket hang|network/i.test(s);
}

function envDecimals(env: CustodialCacheRpcEnv): number {
  return Math.min(9, Math.max(0, Math.floor(Number(String(env.RRTT_DECIMALS || "9").trim()) || 9) || 0));
}

/** Try primary RPC first, then public fallbacks (Worker ↔ single host rate limits). */
function rpcUrlCandidates(env: CustodialCacheRpcEnv): string[] {
  const primary = String(env.SOLANA_RPC_URL || "").trim();
  const fallbacks = [
    "https://api.mainnet-beta.solana.com",
    "https://solana-rpc.publicnode.com",
    "https://rpc.ankr.com/solana",
  ];
  const out: string[] = [];
  for (const u of [primary, ...fallbacks]) {
    if (u && !out.includes(u)) out.push(u);
  }
  return out;
}

/**
 * Sum SPL raw amounts for `mint` across classic + Token-2022 program namespaces (matches sweep / cron discovery).
 */
async function sumMintRawForOwner(
  connection: Connection,
  mint: PublicKey,
  owner: PublicKey,
): Promise<{ totalRaw: bigint; ok: boolean }> {
  let totalRaw = 0n;
  let anyRpcSuccess = false;
  let infraFailures = 0;
  for (const programId of [TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID]) {
    try {
      const { value } = await connection.getParsedTokenAccountsByOwner(owner, { programId });
      anyRpcSuccess = true;
      for (const row of value || []) {
        const raw = row.account.data;
        if (typeof raw !== "object" || raw === null || !("parsed" in raw)) continue;
        const parsed = (raw as { parsed?: { type?: string; info?: Record<string, unknown> } }).parsed;
        if (!parsed || parsed.type !== "account" || !parsed.info) continue;
        const info = parsed.info as {
          mint?: string;
          owner?: string;
          tokenAmount?: { amount?: string };
        };
        const mintStr = String(info.mint || "").trim();
        const ownerStr = String(info.owner || "").trim();
        if (!mintStr || !ownerStr) continue;
        let accMint: PublicKey;
        let accOwner: PublicKey;
        try {
          accMint = new PublicKey(mintStr);
          accOwner = new PublicKey(ownerStr);
        } catch {
          continue;
        }
        if (!accMint.equals(mint) || !accOwner.equals(owner)) continue;
        totalRaw += BigInt(String(info.tokenAmount?.amount ?? "0"));
      }
    } catch (e) {
      if (isLikelyInfraRpcError(e)) infraFailures += 1;
    }
  }
  if (!anyRpcSuccess && infraFailures > 0) return { totalRaw: 0n, ok: false };
  return { totalRaw, ok: anyRpcSuccess };
}

/** Fallback: single ATA balance (classic then Token-2022 derivation). */
async function tokenBalanceViaAta(
  connection: Connection,
  mint: PublicKey,
  custodialPk: PublicKey,
  decimals: number,
): Promise<{ whole: number | null; ok: boolean }> {
  for (const programId of [TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID]) {
    try {
      const ata = getAssociatedTokenAddressSync(mint, custodialPk, false, programId, ASSOCIATED_TOKEN_PROGRAM_ID);
      const bal = await connection.getTokenAccountBalance(ata);
      if (!bal?.value) continue;
      const ui = bal.value.uiAmount;
      if (ui != null && Number.isFinite(ui)) {
        return { whole: Math.max(0, Math.floor(ui)), ok: true };
      }
      if (bal.value.amount != null) {
        const raw = BigInt(String(bal.value.amount));
        const div = BigInt(10) ** BigInt(decimals);
        const whole = div > 0n ? raw / div : raw;
        return { whole: Math.max(0, Number(whole)), ok: true };
      }
    } catch (e) {
      if (isLikelyInfraRpcError(e)) return { whole: null, ok: false };
    }
  }
  return { whole: 0, ok: true };
}

function rawToWholeUnits(totalRaw: bigint, decimals: number): number {
  const d = Math.min(9, Math.max(0, decimals));
  const div = BigInt(10) ** BigInt(d);
  if (div <= 0n) return Math.max(0, Number(totalRaw));
  const whole = totalRaw / div;
  if (whole > BigInt(Number.MAX_SAFE_INTEGER)) return Number.MAX_SAFE_INTEGER;
  return Math.max(0, Number(whole));
}

export type CustodialCacheRefreshResult = {
  /** Best value for API/UI: live RPC when that leg succeeded, else previous D1. */
  custodial_rrtt_onchain: number | null;
  sol_balance_lamports_cached: number;
  /** True if at least one of SOL or RRTT was read successfully from RPC this call. */
  rpc_ok: boolean;
  /** True only when SPL balance for RRTT mint was read successfully (not SOL-only). */
  token_rpc_ok: boolean;
  /** True if D1 row was updated from RPC. */
  refreshed: boolean;
};

async function readLiveOnce(
  rpcUrl: string,
  mintStr: string,
  pkStr: string,
  decimals: number,
): Promise<{
  rrtt: number | null;
  sol: number;
  solOk: boolean;
  tokenOk: boolean;
}> {
  const connection = new Connection(rpcUrl, "confirmed");
  const mint = new PublicKey(mintStr);
  const custodialPk = new PublicKey(pkStr);

  let sol = 0;
  let solOk = false;
  try {
    sol = await connection.getBalance(custodialPk, "confirmed");
    solOk = true;
  } catch (e) {
    if (!isLikelyInfraRpcError(e)) throw e;
  }

  let rrtt: number | null = null;
  const scan = await sumMintRawForOwner(connection, mint, custodialPk);
  let tokenOk = scan.ok;
  if (tokenOk) {
    rrtt = rawToWholeUnits(scan.totalRaw, decimals);
  } else {
    const fb = await tokenBalanceViaAta(connection, mint, custodialPk, decimals);
    tokenOk = fb.ok;
    if (fb.ok && fb.whole != null) rrtt = fb.whole;
  }

  return { rrtt, sol, solOk, tokenOk };
}

async function readLiveFromRpc(
  env: CustodialCacheRpcEnv,
  mintStr: string,
  pkStr: string,
): Promise<{
  rrtt: number | null;
  sol: number;
  solOk: boolean;
  tokenOk: boolean;
}> {
  const decimals = envDecimals(env);
  /** Do not return on SOL-only success — the next RPC may return SPL while this host rate-limits token methods. */
  let merged: { rrtt: number | null; sol: number; solOk: boolean; tokenOk: boolean } = {
    rrtt: null,
    sol: 0,
    solOk: false,
    tokenOk: false,
  };
  for (const rpcUrl of rpcUrlCandidates(env)) {
    try {
      const r = await readLiveOnce(rpcUrl, mintStr, pkStr, decimals);
      if (r.solOk) {
        merged.sol = r.sol;
        merged.solOk = true;
      }
      if (r.tokenOk) {
        merged.rrtt = r.rrtt;
        merged.tokenOk = true;
        return merged;
      }
    } catch {
      /* try next RPC */
    }
  }
  return merged;
}

/**
 * Every call: reads mainnet RPC for custodial SOL + RRTT mint balance (direct Solana JSON-RPC).
 * Throttles **writes** to D1 (12s) unless `bypassWriteThrottle` — so normal `/auth/me` waitUntil runs
 * do not spam D1, while `/earn/summary` can force a row update when the app opens rewards.
 */
export async function refreshCustodialOnchainCacheFromRpc(
  env: CustodialCacheRpcEnv,
  accountId: string,
  opts?: {
    /** Override env `CUSTODIAL_RPC_REFRESH_BUDGET_MS` for this call (e.g. `/earn/summary`). */
    rpcBudgetMs?: number;
    /** When true, always persist RPC results to D1 if Solana responded (skip 12s write throttle). */
    bypassWriteThrottle?: boolean;
  },
): Promise<CustodialCacheRefreshResult | null> {
  const mintStr = String(env.RRTT_MINT_BASE58 || "").trim();
  if (!mintStr) return null;
  const aid = String(accountId || "").trim();
  if (!aid) return null;

  const row = await env.DB
    .prepare("SELECT pubkey FROM internal_solana_wallets WHERE account_id = ?")
    .bind(aid)
    .first<{ pubkey: string }>();
  const pkStr = String(row?.pubkey || "").trim();
  if (!pkStr) return null;

  const prev = await env.DB
    .prepare(
      "SELECT custodial_rrtt_onchain, sol_balance_lamports_cached, cache_updated_at FROM rr_earn_custodial_state WHERE account_id = ?",
    )
    .bind(aid)
    .first<{ custodial_rrtt_onchain: number | null; sol_balance_lamports_cached: number | null; cache_updated_at: string | null }>();

  const prevRrtt =
    prev?.custodial_rrtt_onchain != null ? Math.max(0, Math.floor(Number(prev.custodial_rrtt_onchain) || 0)) : null;
  const prevSol = prev?.sol_balance_lamports_cached != null ? Math.max(0, Math.floor(Number(prev.sol_balance_lamports_cached) || 0)) : 0;

  const rpcTimeoutFallback = { rrtt: null as number | null, sol: 0, solOk: false, tokenOk: false };
  const budgetMs =
    opts?.rpcBudgetMs != null && Number.isFinite(Number(opts.rpcBudgetMs))
      ? Math.min(
          RPC_REFRESH_BUDGET_MAX_MS,
          Math.max(RPC_REFRESH_BUDGET_MIN_MS, Math.floor(Number(opts.rpcBudgetMs))),
        )
      : custodialRpcRefreshBudgetMs(env);
  const live = await withTimeout(readLiveFromRpc(env, mintStr, pkStr), budgetMs, rpcTimeoutFallback).catch(
    () => rpcTimeoutFallback,
  );
  const rpc_ok = live.solOk || live.tokenOk;

  const rrttOut = live.tokenOk ? live.rrtt : prevRrtt;
  const solOut = live.solOk ? live.sol : prevSol;

  const ts = prev?.cache_updated_at ? Date.parse(String(prev.cache_updated_at)) : NaN;
  const skipD1Write =
    !opts?.bypassWriteThrottle && Number.isFinite(ts) && Date.now() - ts < D1_WRITE_MIN_INTERVAL_MS;

  if (!live.solOk && !live.tokenOk) {
    return {
      custodial_rrtt_onchain: rrttOut,
      sol_balance_lamports_cached: solOut,
      rpc_ok: false,
      token_rpc_ok: false,
      refreshed: false,
    };
  }

  if (skipD1Write) {
    return {
      custodial_rrtt_onchain: rrttOut,
      sol_balance_lamports_cached: solOut,
      rpc_ok,
      token_rpc_ok: live.tokenOk,
      refreshed: false,
    };
  }

  const nextOnchain = live.tokenOk ? live.rrtt : prevRrtt;
  const nextSol = live.solOk ? live.sol : prevSol;
  const nowIso = new Date().toISOString();
  await env.DB.prepare("INSERT OR IGNORE INTO rr_earn_custodial_state (account_id) VALUES (?)").bind(aid).run();

  await env.DB
    .prepare(
      `UPDATE rr_earn_custodial_state SET custodial_rrtt_onchain = ?, sol_balance_lamports_cached = ?, cache_updated_at = ? WHERE account_id = ?`,
    )
    .bind(
      live.tokenOk ? nextOnchain : prev?.custodial_rrtt_onchain ?? nextOnchain,
      live.solOk ? nextSol : prev?.sol_balance_lamports_cached ?? nextSol,
      nowIso,
      aid,
    )
    .run();

  return {
    custodial_rrtt_onchain: rrttOut,
    sol_balance_lamports_cached: solOut,
    rpc_ok,
    token_rpc_ok: live.tokenOk,
    refreshed: true,
  };
}
