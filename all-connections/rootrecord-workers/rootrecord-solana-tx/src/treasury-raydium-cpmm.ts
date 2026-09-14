import BN from "bn.js";
import {
  CREATE_CPMM_POOL_PROGRAM,
  DEVNET_PROGRAM_ID,
  Percent,
  Raydium,
  TxVersion,
  type ApiV3PoolInfoItem,
  type ApiV3PoolInfoStandardItemCpmm,
} from "@raydium-io/raydium-sdk-v2";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
  getMint,
} from "@solana/spl-token";
import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  VersionedTransaction,
} from "@solana/web3.js";

import { confirmSignedTxWithPoll } from "./solana-confirm";

const CPMM_PROGRAM_IDS = new Set([
  CREATE_CPMM_POOL_PROGRAM.toBase58(),
  DEVNET_PROGRAM_ID.CREATE_CPMM_POOL_PROGRAM.toBase58(),
]);

/** Same normalization as the Solana Tools site (`lib/raydiumCpmmLaunch.ts`). */
export function coerceRaydiumPoolByIdList(raw: unknown): ApiV3PoolInfoItem[] {
  if (raw == null) return [];
  if (Array.isArray(raw)) return raw as ApiV3PoolInfoItem[];
  if (typeof raw === "object" && "data" in (raw as object)) {
    const inner = (raw as { data: unknown }).data;
    return Array.isArray(inner) ? (inner as ApiV3PoolInfoItem[]) : [];
  }
  return [];
}

export function isCpmmPoolItem(pool: ApiV3PoolInfoItem): pool is ApiV3PoolInfoStandardItemCpmm {
  if (pool.programId && CPMM_PROGRAM_IDS.has(pool.programId)) return true;
  const ext = pool as ApiV3PoolInfoItem & { pooltype?: unknown };
  if (
    pool.type === "Standard" &&
    Array.isArray(ext.pooltype) &&
    ext.pooltype.some((x) => String(x).toLowerCase() === "cpmm")
  ) {
    return true;
  }
  return false;
}

async function loadRaydiumForTreasury(
  connection: Connection,
  cluster: "mainnet" | "devnet",
  owner: Keypair,
) {
  const signAllTransactions = async <T extends Transaction | VersionedTransaction>(txs: T[]): Promise<T[]> => {
    for (const tx of txs) {
      if (tx instanceof VersionedTransaction) {
        tx.sign([owner]);
      } else {
        tx.partialSign(owner);
      }
    }
    return txs;
  };
  return Raydium.load({
    connection,
    cluster,
    owner: owner.publicKey,
    signAllTransactions,
    disableLoadToken: true,
  });
}

function ceilDiv(a: bigint, b: bigint): bigint {
  if (b <= 0n) return 0n;
  return (a + b - 1n) / b;
}

export function raydiumClusterFromRpcUrl(url: string): "mainnet" | "devnet" {
  return /devnet/i.test(url) ? "devnet" : "mainnet";
}

/**
 * Raydium CPMM **LP mint** addresses that `withdrawTreasuryCpmmLpForWsolDeficit` and
 * `withdrawTreasuryCpmmLpForDeficits` must never touch (returns `{ ok: true, skipped: true }`).
 * Add mints here for pools whose LP should stay locked regardless of Worker env.
 */
const TREASURY_AUTOMATION_PROTECTED_LP_MINTS = new Set<string>([
  "CkCzCgonPsN5vFiux4tsdfQakakE125stAfQdPRUxR1k",
]);

export function isProtectedTreasuryLpMint(lpMintAddress: string): boolean {
  return TREASURY_AUTOMATION_PROTECTED_LP_MINTS.has(lpMintAddress.trim());
}

const WSOL_MINT = "So11111111111111111111111111111111111111112";

/**
 * Burns treasury LP on a Raydium CPMM **WSOL + RRESERVE** pool so the treasury receives wrapped SOL,
 * then unwraps to native SOL (`closeWsol: true`). Estimates LP burn from WSOL vault deficit vs LP supply.
 */
export async function withdrawTreasuryCpmmLpForWsolDeficit(opts: {
  connection: Connection;
  cluster: "mainnet" | "devnet";
  treasury: Keypair;
  poolId: string;
  rreserveMintStr: string;
  /** WSOL raw amount needed (1 WSOL raw = 1 lamport). */
  deficitWsolRaw: bigint;
  withdrawSlippageBps?: number;
  lpSafetyBps?: number;
}): Promise<
  | { ok: true; skipped: true }
  | { ok: true; signature: string; lp_burned_raw: string }
  | { ok: false; error: string }
> {
  if (opts.deficitWsolRaw <= 0n) {
    return { ok: true, skipped: true };
  }

  const trimmed = opts.poolId.trim();
  if (!trimmed) return { ok: false, error: "TREASURY_SOL_CP_POOL_ID is empty" };

  const wsol = WSOL_MINT;
  const res = opts.rreserveMintStr.trim();
  if (!res) return { ok: false, error: "RRESERVE mint is empty" };

  const raydium = await loadRaydiumForTreasury(opts.connection, opts.cluster, opts.treasury);
  const list = coerceRaydiumPoolByIdList(await raydium.api.fetchPoolById({ ids: trimmed }));
  const poolInfo = list.find(isCpmmPoolItem);
  if (!poolInfo) {
    return { ok: false, error: "Pool not found or not Raydium CPMM for this cluster" };
  }

  const addrA = poolInfo.mintA.address;
  const addrB = poolInfo.mintB.address;
  const hasWsol = addrA === wsol || addrB === wsol;
  const hasRes = addrA === res || addrB === res;
  if (!hasWsol) return { ok: false, error: "Pool mintA/mintB does not include wrapped SOL (WSOL)" };
  if (!hasRes) return { ok: false, error: "Pool mintA/mintB does not include RRESERVE mint" };

  if (isProtectedTreasuryLpMint(poolInfo.lpMint.address)) {
    return { ok: true, skipped: true };
  }

  let rpcPool;
  try {
    rpcPool = await raydium.cpmm.getRpcPoolInfo(trimmed);
  } catch (e) {
    const m = String(e && typeof e === "object" && "message" in e ? (e as Error).message : e);
    return { ok: false, error: `getRpcPoolInfo failed: ${m}` };
  }

  const reserveA = BigInt(rpcPool.vaultAAmount.toString());
  const reserveB = BigInt(rpcPool.vaultBAmount.toString());
  const wsolReserve = addrA === wsol ? reserveA : reserveB;

  const lpMintPk = new PublicKey(poolInfo.lpMint.address);
  const lpMintAcct = await opts.connection.getAccountInfo(lpMintPk, "confirmed");
  if (!lpMintAcct) return { ok: false, error: "LP mint account missing on-chain" };
  const lpProgram = lpMintAcct.owner;
  const lpMintInfo = await getMint(opts.connection, lpMintPk, "confirmed", lpProgram);
  const lpSupply = lpMintInfo.supply;
  if (lpSupply <= 0n) return { ok: false, error: "LP supply is zero" };
  if (wsolReserve <= 0n) return { ok: false, error: "WSOL vault reserve is zero" };

  const treasuryLpAta = getAssociatedTokenAddressSync(
    lpMintPk,
    opts.treasury.publicKey,
    false,
    lpProgram,
    ASSOCIATED_TOKEN_PROGRAM_ID,
  );
  let treasuryLpRaw = 0n;
  try {
    const b = await opts.connection.getTokenAccountBalance(treasuryLpAta, "confirmed");
    treasuryLpRaw = BigInt(b.value.amount);
  } catch {
    return {
      ok: false,
      error: `No SPL account for pool LP mint ${lpMintPk.toBase58()} on treasury (pool ${trimmed}) — wrong treasury key or wrong TREASURY_SOL_CP_POOL_ID.`,
    };
  }
  if (treasuryLpRaw <= 0n) {
    return {
      ok: false,
      error:
        `Treasury holds 0 of LP mint ${lpMintPk.toBase58()} (pool ${trimmed}). ` +
          `SOL deficit was WSOL_raw=${opts.deficitWsolRaw.toString()}. ` +
          `Set TREASURY_SOL_CP_POOL_ID to the pool whose LP mint matches your Phantom LP row.`,
    };
  }

  let lpNeeded = ceilDiv(opts.deficitWsolRaw * lpSupply, wsolReserve);
  const safetyBps = Math.min(5_000, Math.max(0, opts.lpSafetyBps ?? 300));
  lpNeeded = (lpNeeded * BigInt(10_000 + safetyBps)) / 10_000n;

  const lpBurn = treasuryLpRaw < lpNeeded ? treasuryLpRaw : lpNeeded;
  if (lpBurn <= 0n) {
    return { ok: false, error: "Computed LP burn is zero" };
  }

  const slipBps = Math.min(5_000, Math.max(50, opts.withdrawSlippageBps ?? 150));
  const slippage = new Percent(new BN(slipBps), new BN(10_000));

  const built = await raydium.cpmm.withdrawLiquidity({
    poolInfo,
    lpAmount: new BN(lpBurn.toString()),
    slippage,
    txVersion: TxVersion.V0,
    closeWsol: true,
  });

  const latest = await opts.connection.getLatestBlockhash("confirmed");
  const { txId } = await built.execute({ sendAndConfirm: true });
  if (!txId) return { ok: false, error: "Raydium withdraw execute returned no tx id" };
  await confirmSignedTxWithPoll(opts.connection, txId, latest);

  return { ok: true, signature: txId, lp_burned_raw: lpBurn.toString() };
}

/**
 * Burns treasury-held Raydium CPMM LP so the treasury receives underlying RRTT / RRESERVE.
 * Uses a proportional estimate (Uniswap-style share) plus extra `lpSafetyBps` on required burn.
 * No RootRecord platform fee (internal maintenance).
 */
export async function withdrawTreasuryCpmmLpForDeficits(opts: {
  connection: Connection;
  cluster: "mainnet" | "devnet";
  treasury: Keypair;
  poolId: string;
  rrttMintStr: string;
  rreserveMintStr: string;
  deficitRrttRaw: bigint;
  deficitReserveRaw: bigint;
  /** Raydium withdraw min-out slippage (default 150 = 1.5%). */
  withdrawSlippageBps?: number;
  /** Extra headroom on LP burn estimate (default 300 = 3%) — curve + fees. */
  lpSafetyBps?: number;
}): Promise<
  | { ok: true; skipped: true }
  | { ok: true; signature: string; lp_burned_raw: string }
  | { ok: false; error: string }
> {
  if (opts.deficitRrttRaw <= 0n && opts.deficitReserveRaw <= 0n) {
    return { ok: true, skipped: true };
  }

  const trimmed = opts.poolId.trim();
  if (!trimmed) return { ok: false, error: "TREASURY_CP_MM_POOL_ID is empty" };

  const raydium = await loadRaydiumForTreasury(opts.connection, opts.cluster, opts.treasury);
  const list = coerceRaydiumPoolByIdList(await raydium.api.fetchPoolById({ ids: trimmed }));
  const poolInfo = list.find(isCpmmPoolItem);
  if (!poolInfo) {
    return { ok: false, error: "Pool not found or not Raydium CPMM for this cluster" };
  }

  const addrA = poolInfo.mintA.address;
  const addrB = poolInfo.mintB.address;
  const rr = opts.rrttMintStr.trim();
  const res = opts.rreserveMintStr.trim();
  if (addrA !== rr && addrB !== rr) return { ok: false, error: "Pool mintA/mintB does not include RRTT mint" };
  if (addrA !== res && addrB !== res) return { ok: false, error: "Pool mintA/mintB does not include RRESERVE mint" };

  if (isProtectedTreasuryLpMint(poolInfo.lpMint.address)) {
    return { ok: true, skipped: true };
  }

  const deficitForMint = (mintAddr: string): bigint => {
    if (mintAddr === rr) return opts.deficitRrttRaw;
    if (mintAddr === res) return opts.deficitReserveRaw;
    return 0n;
  };

  const dA = deficitForMint(addrA);
  const dB = deficitForMint(addrB);

  let rpcPool;
  try {
    rpcPool = await raydium.cpmm.getRpcPoolInfo(trimmed);
  } catch (e) {
    const m = String(e && typeof e === "object" && "message" in e ? (e as Error).message : e);
    return { ok: false, error: `getRpcPoolInfo failed: ${m}` };
  }

  const reserveA = BigInt(rpcPool.vaultAAmount.toString());
  const reserveB = BigInt(rpcPool.vaultBAmount.toString());

  const lpMintPk = new PublicKey(poolInfo.lpMint.address);
  const lpMintAcct = await opts.connection.getAccountInfo(lpMintPk, "confirmed");
  if (!lpMintAcct) return { ok: false, error: "LP mint account missing on-chain" };
  const lpProgram = lpMintAcct.owner;
  const lpMintInfo = await getMint(opts.connection, lpMintPk, "confirmed", lpProgram);
  const lpSupply = lpMintInfo.supply;
  if (lpSupply <= 0n) return { ok: false, error: "LP supply is zero" };

  const treasuryLpAta = getAssociatedTokenAddressSync(
    lpMintPk,
    opts.treasury.publicKey,
    false,
    lpProgram,
    ASSOCIATED_TOKEN_PROGRAM_ID,
  );
  let treasuryLpRaw = 0n;
  try {
    const b = await opts.connection.getTokenAccountBalance(treasuryLpAta, "confirmed");
    treasuryLpRaw = BigInt(b.value.amount);
  } catch {
    return {
      ok: false,
      error: `No SPL account for this pool's LP mint ${lpMintPk.toBase58()} on treasury (pool ${trimmed}) — wrong treasury key or wrong TREASURY_CP_MM_POOL_ID.`,
    };
  }
  if (treasuryLpRaw <= 0n) {
    return {
      ok: false,
      error:
        `Treasury holds 0 of this pool's LP mint ${lpMintPk.toBase58()} (pool ${trimmed}). ` +
          `Loose-token deficit was RRTT_raw=${opts.deficitRrttRaw.toString()} RRESERVE_raw=${opts.deficitReserveRaw.toString()}. ` +
          `Set TREASURY_CP_MM_POOL_ID to the CPMM pool whose LP mint matches your wallet's RRTT/RRESERVE LP row (expected LP mint ${lpMintPk.toBase58()}).`,
    };
  }

  let lpNeeded = 0n;
  if (reserveA > 0n && dA > 0n) {
    const x = ceilDiv(dA * lpSupply, reserveA);
    lpNeeded = x > lpNeeded ? x : lpNeeded;
  }
  if (reserveB > 0n && dB > 0n) {
    const y = ceilDiv(dB * lpSupply, reserveB);
    lpNeeded = y > lpNeeded ? y : lpNeeded;
  }

  const safetyBps = Math.min(5_000, Math.max(0, opts.lpSafetyBps ?? 300));
  lpNeeded = (lpNeeded * BigInt(10_000 + safetyBps)) / 10_000n;

  const lpBurn = treasuryLpRaw < lpNeeded ? treasuryLpRaw : lpNeeded;
  if (lpBurn <= 0n) {
    return { ok: false, error: "Computed LP burn is zero" };
  }

  const slipBps = Math.min(5_000, Math.max(50, opts.withdrawSlippageBps ?? 150));
  const slippage = new Percent(new BN(slipBps), new BN(10_000));

  const built = await raydium.cpmm.withdrawLiquidity({
    poolInfo,
    lpAmount: new BN(lpBurn.toString()),
    slippage,
    txVersion: TxVersion.V0,
  });

  const latest = await opts.connection.getLatestBlockhash("confirmed");
  const { txId } = await built.execute({ sendAndConfirm: true });
  if (!txId) return { ok: false, error: "Raydium withdraw execute returned no tx id" };
  await confirmSignedTxWithPoll(opts.connection, txId, latest);

  return { ok: true, signature: txId, lp_burned_raw: lpBurn.toString() };
}
