/**
 * Goal share tokens (devnet first): 100 tokens = 100% of the USD target.
 * Mint account is created on the first deposit, then mint-to-donor on every credit.
 */
import {
  ComputeBudgetProgram,
  Connection,
  Keypair,
  PublicKey,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountIdempotentInstruction,
  createMintToCheckedInstruction,
  getAssociatedTokenAddressSync,
  getMint,
  getMinimumBalanceForRentExemptAccount,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import bs58 from "bs58";
import type { D1Database } from "@cloudflare/workers-types";

import { loadGoalDonateKeypair } from "./goal-funding";
import { mintGoalToken } from "./goal-token-mint";
import {
  accountIdForEmail,
  provisionCustodialWalletIfMissing,
  type CustodialEnv,
} from "./member-custodial";
import { clusterRpcCandidates, resolveIssueCluster, withCluster } from "./solana-cluster";

export const GOAL_SHARE_TOKENS = 100;
export const GOAL_TOKEN_DECIMALS = 0;
export const DEFAULT_GOAL_TOKEN_CLUSTER = "devnet";
export const DEFAULT_GOAL_TOKEN_RPC = "https://api.devnet.solana.com";

export const REFUND_WARNING =
  "If you cancel this goal, donors get back what is still in the goal wallet after ATA rent and Root Record transaction fees. Card donations refund through the card network minus processing. You can cancel anytime before you withdraw. After the goal is met you may withdraw or cancel — not both, and not after withdraw.";

type ShareEnv = CustodialEnv & {
  DB: D1Database;
  SITE_URL?: string;
  GOAL_TOKEN_RPC_URL?: string;
  GOAL_TOKEN_CLUSTER?: string;
};

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

export async function goalTokenCluster(env: { GOAL_TOKEN_CLUSTER?: string; SOLANA_CLUSTER?: string }): Promise<string> {
  return resolveIssueCluster(env);
}

export function goalTokenRpcUrl(env: { GOAL_TOKEN_RPC_URL?: string }): string {
  return str(env.GOAL_TOKEN_RPC_URL) || DEFAULT_GOAL_TOKEN_RPC;
}

export function goalTokenExplorerMint(mint: string, cluster: string): string {
  const m = encodeURIComponent(mint);
  return cluster === "mainnet-beta" || cluster === "mainnet"
    ? `https://solscan.io/token/${m}`
    : `https://solscan.io/token/${m}?cluster=${encodeURIComponent(cluster || "devnet")}`;
}

export function goalTokenExplorerTx(sig: string, cluster: string): string {
  const s = encodeURIComponent(sig);
  return cluster === "mainnet-beta" || cluster === "mainnet"
    ? `https://solscan.io/tx/${s}`
    : `https://solscan.io/tx/${s}?cluster=${encodeURIComponent(cluster || "devnet")}`;
}

/** Whole tokens: $1 toward a $100 goal → 1 token. Over 100% still mints. */
export function shareTokensFromLanded(goalCents: number, landedCents: number, ataCostCents: number): number {
  const goal = Math.max(0, Math.floor(Number(goalCents) || 0));
  const share = Math.max(0, Math.floor(Number(landedCents) || 0) - Math.max(0, Math.floor(Number(ataCostCents) || 0)));
  if (goal < 1 || share < 1) return 0;
  return Math.floor((share * GOAL_SHARE_TOKENS) / goal);
}

export function fundingStatusOf(row: Record<string, unknown>): "open" | "withdrawn" | "refunded" {
  const s = str(row.funding_status).toLowerCase();
  if (s === "withdrawn" || s === "refunded") return s;
  return "open";
}

export function goalIsMet(row: Record<string, unknown>): boolean {
  const target = Math.max(0, Math.floor(Number(row.estimated_cost_cents) || 0));
  const raised = Math.max(0, Math.floor(Number(row.raised_cents) || 0));
  return target > 0 && raised >= target;
}

let solUsdCache = { usd: 0, at: 0 };

export async function solUsdPrice(): Promise<number> {
  const now = Date.now();
  if (solUsdCache.usd > 0 && now - solUsdCache.at < 60_000) return solUsdCache.usd;
  const urls = [
    "https://lite-api.jup.ag/price/v2?ids=So11111111111111111111111111111111111111112",
    "https://api.jup.ag/price/v2?ids=So11111111111111111111111111111111111111112",
  ];
  for (const url of urls) {
    try {
      const res = await fetch(url, { headers: { accept: "application/json" } });
      if (!res.ok) continue;
      const data = (await res.json()) as { data?: Record<string, { price?: string | number }> };
      const p = Number(data.data?.So11111111111111111111111111111111111111112?.price);
      if (p > 0) {
        solUsdCache = { usd: p, at: now };
        return p;
      }
    } catch {
      /* next */
    }
  }
  return solUsdCache.usd || 0;
}

export async function solUsdCents(lamports: number): Promise<number> {
  const n = Math.max(0, Math.floor(Number(lamports) || 0));
  if (n < 1) return 0;
  const usd = await solUsdPrice();
  if (usd <= 0) return 0;
  return Math.max(0, Math.round((n / 1e9) * usd * 100));
}

function treasuryKeypair(env: ShareEnv): Keypair | null {
  const raw = str(env.RRTT_TREASURY_SECRET_KEY_B58);
  if (!raw) return null;
  try {
    return Keypair.fromSecretKey(bs58.decode(raw));
  } catch {
    return null;
  }
}

async function pickGoalTokenConnection(env: ShareEnv, cluster: string): Promise<Connection | null> {
  const urls = clusterRpcCandidates(withCluster(env, cluster));
  for (const url of urls) {
    if (!url) continue;
    try {
      const c = new Connection(url, "confirmed");
      await c.getLatestBlockhash("confirmed");
      return c;
    } catch {
      /* next */
    }
  }
  return null;
}

async function ensureShareMint(
  env: ShareEnv,
  row: Record<string, unknown>,
  ownerUserId: string,
): Promise<{ mint: string; cluster: string } | { error: string }> {
  void ownerUserId;
  const existing = str(row.token_mint);
  const cluster = str(row.token_cluster) || (await resolveIssueCluster(env));
  if (existing) return { mint: existing, cluster };
  const donate = await loadGoalDonateKeypair(env, str(row.id));
  if ("error" in donate) return { error: donate.error };
  const minted = await mintGoalToken({
    rpcUrl: clusterRpcCandidates(withCluster(env, cluster))[0],
    treasurySecretB58: env.RRTT_TREASURY_SECRET_KEY_B58,
    payerSecret: null,
    donateSecret: donate.secret,
    name: str(row.token_name) || str(row.title) || "Goal",
    symbol: (str(row.token_symbol) || "GOAL").slice(0, 8),
    uri: str(row.metadata_uri) || `https://api-goals.rootrecord.info/public/g/${str(row.id)}/metadata.json`,
    decimals: GOAL_TOKEN_DECIMALS,
  });
  const now = new Date().toISOString();
  if (!minted.ok) {
    const msg = minted.message || "mint_fail";
    const lower = msg.toLowerCase();
    const status =
      lower.includes("prior credit") || lower.includes("insufficient funds") || lower.includes("attempt to debit")
        ? "failed:treasury_unfunded"
        : `failed:${msg}`.slice(0, 180);
    await env.DB.prepare(`UPDATE rg_goals SET token_status = ?, updated_at = ? WHERE id = ?`)
      .bind(status, now, str(row.id))
      .run();
    return { error: msg };
  }
  await env.DB.prepare(
    `UPDATE rg_goals SET token_mint = ?, token_signature = ?, token_status = 'minted', token_cluster = ?, updated_at = ? WHERE id = ?`,
  )
    .bind(minted.mint, minted.signature, cluster, now, str(row.id))
    .run();
  return { mint: minted.mint, cluster };
}

async function mintToDonorAta(
  env: ShareEnv,
  params: {
    mint: string;
    cluster: string;
    donateSecret: Uint8Array;
    destPubkey: string;
    tokens: number;
  },
): Promise<{ ok: true; signature: string; ataCostLamports: number } | { ok: false; message: string }> {
  const tokens = Math.max(0, Math.floor(params.tokens));
  if (tokens < 1) return { ok: true, signature: "", ataCostLamports: 0 };
  const treasury = treasuryKeypair(env);
  if (!treasury) return { ok: false, message: "treasury_not_configured" };
  const conn = await pickGoalTokenConnection(env, params.cluster);
  if (!conn) return { ok: false, message: "goal_token_rpc_unavailable" };
  let mintPk: PublicKey;
  let dest: PublicKey;
  try {
    mintPk = new PublicKey(params.mint);
    dest = new PublicKey(params.destPubkey);
  } catch {
    return { ok: false, message: "bad_pubkey" };
  }
  const donate = Keypair.fromSecretKey(params.donateSecret);
  let decimals = GOAL_TOKEN_DECIMALS;
  try {
    decimals = (await getMint(conn, mintPk, "confirmed", TOKEN_PROGRAM_ID)).decimals;
  } catch {
    decimals = GOAL_TOKEN_DECIMALS;
  }
  const ata = getAssociatedTokenAddressSync(mintPk, dest, false, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID);
  let ataExists = false;
  try {
    const bal = await conn.getTokenAccountBalance(ata, "confirmed");
    ataExists = Number(bal.value.amount) >= 0;
  } catch {
    ataExists = false;
  }
  let ataCostLamports = 0;
  if (!ataExists) {
    try {
      ataCostLamports = await getMinimumBalanceForRentExemptAccount(conn);
    } catch {
      ataCostLamports = 2_039_280;
    }
  }
  const atomic = tokens * 10 ** decimals;
  try {
    const latest = await conn.getLatestBlockhash("confirmed");
    const msg = new TransactionMessage({
      payerKey: treasury.publicKey,
      recentBlockhash: latest.blockhash,
      instructions: [
        ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 }),
        ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 0 }),
        createAssociatedTokenAccountIdempotentInstruction(
          treasury.publicKey,
          ata,
          dest,
          mintPk,
          TOKEN_PROGRAM_ID,
          ASSOCIATED_TOKEN_PROGRAM_ID,
        ),
        createMintToCheckedInstruction(mintPk, ata, donate.publicKey, atomic, decimals, [], TOKEN_PROGRAM_ID),
      ],
    });
    const tx = new VersionedTransaction(msg.compileToV0Message());
    tx.sign([treasury, donate]);
    const sig = await conn.sendRawTransaction(tx.serialize(), { skipPreflight: false, maxRetries: 3 });
    await conn.confirmTransaction(
      { signature: sig, blockhash: latest.blockhash, lastValidBlockHeight: latest.lastValidBlockHeight },
      "confirmed",
    );
    return { ok: true, signature: sig, ataCostLamports };
  } catch (e) {
    const m = e instanceof Error ? e.message : String(e);
    return { ok: false, message: m.slice(0, 220) };
  }
}

export async function creditGoalShareForDonation(
  env: ShareEnv,
  params: {
    goalId: string;
    donationId: string;
    accountId: string | null;
    landedCents: number;
  },
): Promise<{ tokens: number; mint: string | null; error?: string }> {
  const goalId = str(params.goalId);
  const row = await env.DB.prepare(`SELECT * FROM rg_goals WHERE id = ?`)
    .bind(goalId)
    .first<Record<string, unknown>>();
  if (!row) return { tokens: 0, mint: null, error: "goal_missing" };
  const goalCents = Math.max(0, Math.floor(Number(row.estimated_cost_cents) || 0));
  if (goalCents < 1) {
    return { tokens: 0, mint: null };
  }
  const ownerUserId = str(row.user_id);
  const ensured = await ensureShareMint(env, row, ownerUserId);
  if ("error" in ensured) return { tokens: 0, mint: null, error: ensured.error };
  const donate = await loadGoalDonateKeypair(env, goalId);
  if ("error" in donate) return { tokens: 0, mint: ensured.mint, error: donate.error };

  let destPubkey = "";
  if (params.accountId) {
    const w = await provisionCustodialWalletIfMissing(env, params.accountId);
    if (!("error" in w)) destPubkey = w.pubkey;
  }
  if (!destPubkey) {
    await env.DB.prepare(`UPDATE rg_goal_donations SET share_cents = ? WHERE id = ?`)
      .bind(Math.max(0, Math.floor(params.landedCents)), params.donationId)
      .run();
    return { tokens: 0, mint: ensured.mint };
  }

  const conn = await pickGoalTokenConnection(env, ensured.cluster);
  let ataCostLamports = 0;
  if (conn) {
    try {
      const mintPk = new PublicKey(ensured.mint);
      const dest = new PublicKey(destPubkey);
      const ata = getAssociatedTokenAddressSync(mintPk, dest, false, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID);
      await conn.getTokenAccountBalance(ata, "confirmed");
    } catch {
      ataCostLamports = 2_039_280;
    }
  }
  const ataCostCents = await solUsdCents(ataCostLamports);
  const tokens = shareTokensFromLanded(goalCents, params.landedCents, ataCostCents);
  const shareCents = Math.max(0, Math.floor(params.landedCents) - ataCostCents);
  if (tokens < 1) {
    await env.DB.prepare(
      `UPDATE rg_goal_donations SET share_cents = ?, ata_cost_cents = ?, tokens_minted = 0 WHERE id = ?`,
    )
      .bind(shareCents, ataCostCents, params.donationId)
      .run();
    return { tokens: 0, mint: ensured.mint };
  }
  const sent = await mintToDonorAta(env, {
    mint: ensured.mint,
    cluster: ensured.cluster,
    donateSecret: donate.secret,
    destPubkey,
    tokens,
  });
  const now = new Date().toISOString();
  if (!sent.ok) {
    await env.DB.prepare(`UPDATE rg_goal_donations SET share_cents = ?, ata_cost_cents = ? WHERE id = ?`)
      .bind(shareCents, ataCostCents, params.donationId)
      .run();
    return { tokens: 0, mint: ensured.mint, error: sent.message };
  }
  const ataCents = sent.ataCostLamports ? await solUsdCents(sent.ataCostLamports) : ataCostCents;
  await env.DB.prepare(
    `UPDATE rg_goal_donations SET share_cents = ?, ata_cost_cents = ?, tokens_minted = ? WHERE id = ?`,
  )
    .bind(shareCents, ataCents, tokens, params.donationId)
    .run();
  await env.DB.prepare(
    `UPDATE rg_goals SET tokens_minted = COALESCE(tokens_minted, 0) + ?, updated_at = ? WHERE id = ?`,
  )
    .bind(tokens, now, goalId)
    .run();
  return { tokens, mint: ensured.mint };
}

export async function claimPendingShareTokens(
  env: ShareEnv,
  goalIdRaw: string,
  accountId: string,
  email: string,
): Promise<{ claimed: number; tokens: number }> {
  const goalId = str(goalIdRaw);
  const aid = str(accountId);
  if (!goalId || !aid) return { claimed: 0, tokens: 0 };
  const rows = await env.DB.prepare(
    `SELECT id, net_cents, amount_cents, payer_account_id, payer_email, tokens_minted
     FROM rg_goal_donations WHERE goal_id = ? AND COALESCE(tokens_minted, 0) = 0
       AND (payer_account_id = ? OR lower(payer_email) = lower(?))
     ORDER BY created_at ASC LIMIT 20`,
  )
    .bind(goalId, aid, email || "")
    .all<{
      id: string;
      net_cents: number | null;
      amount_cents: number | null;
      payer_account_id: string | null;
      payer_email: string | null;
      tokens_minted: number | null;
    }>();
  let claimed = 0;
  let tokens = 0;
  for (const d of rows.results || []) {
    const landed = Math.max(0, Math.floor(Number(d.net_cents ?? d.amount_cents) || 0));
    if (landed < 1) continue;
    if (!d.payer_account_id) {
      await env.DB.prepare(`UPDATE rg_goal_donations SET payer_account_id = ? WHERE id = ?`).bind(aid, d.id).run();
    }
    const out = await creditGoalShareForDonation(env, {
      goalId,
      donationId: d.id,
      accountId: aid,
      landedCents: landed,
    });
    if (out.tokens > 0) {
      claimed += 1;
      tokens += out.tokens;
    }
  }
  return { claimed, tokens };
}

export async function resolvePayerAccountId(db: D1Database, email: string): Promise<string | null> {
  return accountIdForEmail(db, email);
}
