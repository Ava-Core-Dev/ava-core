import type { D1Database } from "@cloudflare/workers-types";

import { transferShards, usdCentsFromShards } from "../../shared/ava-shards";
import { CHAIN_FEE_BPS, feeFromBps } from "../../shared/platform-fees";
import { json } from "./cors";
import { emailFromUserId } from "./goal-constants";
import { clusterForGoal, clusterPublicFields, explorerTx, withCluster } from "./solana-cluster";
import {
  accountIdForUserId,
  provisionCustodialWalletIfMissing,
  transferSolFromMember,
  transferUsdcFromMember,
  type CustodialEnv,
} from "./member-custodial";
import { creditGoalShareForDonation, fundingStatusOf, solUsdCents } from "./goal-share";

const MIN_SOL = 0.001;
const MAX_SOL = 5;
const MIN_USDC = 0.01;
const MAX_USDC = 10_000;
const USDC_DECIMALS = 6;

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

function record(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

export async function handleCustodialDonate(
  request: Request,
  env: CustodialEnv & { DB: D1Database },
  userId: string,
  goalIdRaw: string,
): Promise<Response> {
  if (request.method !== "POST") return json({ detail: "Method not allowed" }, 405);
  if (!userId.startsWith("user:")) return json({ detail: "Sign in to donate from your hosted wallet." }, 401);
  const goalId = str(goalIdRaw);
  if (!goalId) return json({ detail: "Goal not found." }, 404);

  const goal = await env.DB.prepare(
    `SELECT id, title, donate_wallet_pubkey, public_enabled, deleted_at, funding_status, estimated_cost_cents, token_cluster FROM rg_goals WHERE id = ?`,
  )
    .bind(goalId)
    .first<Record<string, unknown>>();
  if (!goal || goal.deleted_at) return json({ detail: "Goal not found." }, 404);
  if (!goal.public_enabled) return json({ detail: "This goal is not public." }, 400);
  if (fundingStatusOf(goal) === "refunded") {
    return json({ detail: "This goal was canceled. Donations are closed." }, 409);
  }
  const dest = str(goal.donate_wallet_pubkey);
  if (!dest) return json({ detail: "This goal does not have a donate wallet yet." }, 409);

  const body = record(await request.json().catch(() => ({})));
  const asset = str(body.asset || body.currency || "sol").toLowerCase();
  const amount = Number(body.amount);
  if (!Number.isFinite(amount) || amount <= 0) return json({ detail: "amount must be a positive number." }, 400);

  const accountId = await accountIdForUserId(env.DB, userId);
  if (!accountId) return json({ detail: "Account not found." }, 404);
  const wallet = await provisionCustodialWalletIfMissing(env, accountId);
  if ("error" in wallet) return json({ detail: wallet.error }, 503);

  const email = emailFromUserId(userId);
  const now = new Date().toISOString();
  const donationId = crypto.randomUUID();
  const cluster = await clusterForGoal(env, goal);
  let source: string;
  let currency: string;
  let atomic: string;
  let cents: number | null = null;
  let sent: { ok: true; signature: string; fee?: number; net?: number } | { ok: false; message: string };
  let feeAtomic: string | null = null;
  let feeCents: number | null = null;
  let netCents: number | null = null;

  if (asset === "sol") {
    if (amount < MIN_SOL || amount > MAX_SOL) {
      return json({ detail: `SOL amount must be between ${MIN_SOL} and ${MAX_SOL}.` }, 400);
    }
    const lamports = Math.round(amount * 1e9);
    sent = await transferSolFromMember(env, accountId, dest, lamports, cluster);
    source = "custodial_sol";
    currency = "sol";
    atomic = String(lamports);
    if (sent.ok) {
      feeAtomic = String(sent.fee || 0);
      cents = await solUsdCents(lamports);
      feeCents = await solUsdCents(sent.fee || 0);
      netCents = await solUsdCents(sent.net || Math.max(0, lamports - (sent.fee || 0)));
    }
  } else if (asset === "usdc") {
    if (amount < MIN_USDC || amount > MAX_USDC) {
      return json({ detail: `USDC amount must be between ${MIN_USDC} and ${MAX_USDC}.` }, 400);
    }
    const raw = Math.round(amount * 10 ** USDC_DECIMALS);
    sent = await transferUsdcFromMember(env, accountId, dest, raw, cluster);
    source = "custodial_usdc";
    currency = "usdc";
    atomic = String(raw);
    cents = Math.round(amount * 100);
    const fee = feeFromBps(cents, CHAIN_FEE_BPS);
    feeCents = fee;
    netCents = Math.max(0, cents - fee);
    if (sent.ok) feeAtomic = String(sent.fee || 0);
  } else if (asset === "shards" || asset === "ava_shards") {
    const n = Math.floor(amount);
    if (n < 1 || n > 1_000_000) return json({ detail: "Shard amount must be at least 1." }, 400);
    const tip = await transferShards(env.DB, accountId, `goal:${goalId}`, n, "goal_tip", `tip:${goalId}:${crypto.randomUUID()}`);
    if (!tip.ok) {
      const msg =
        tip.reason === "insufficient"
          ? "Not enough Ava Shards. Buy more at /shards."
          : "Could not tip shards.";
      return json({ detail: msg }, 400);
    }
    source = "ava_shards";
    currency = "shards";
    atomic = String(n);
    cents = usdCentsFromShards(n);
    feeCents = 0;
    netCents = cents;
    sent = { ok: true, signature: `shards:${crypto.randomUUID()}` };
  } else {
    return json({ detail: "asset must be sol, usdc, or shards." }, 400);
  }

  if (!sent.ok) return json({ detail: sent.message }, 400);

  const credit = netCents && netCents > 0 ? netCents : 0;
  try {
    await env.DB.prepare(
      `INSERT INTO rg_goal_donations (id, goal_id, source, amount_cents, amount_atomic, currency, tx_ref, payer_email, created_at, fee_cents, fee_atomic, net_cents, payer_account_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        donationId,
        goalId,
        source,
        cents,
        atomic,
        currency,
        sent.signature,
        email || null,
        now,
        feeCents,
        feeAtomic,
        netCents,
        accountId,
      )
      .run();
    if (credit > 0) {
      await env.DB.prepare(
        `UPDATE rg_goals SET raised_cents = COALESCE(raised_cents, 0) + ?, updated_at = ? WHERE id = ?`,
      )
        .bind(credit, now, goalId)
        .run();
    } else {
      await env.DB.prepare(`UPDATE rg_goals SET updated_at = ? WHERE id = ?`).bind(now, goalId).run();
    }
  } catch (e) {
    console.error("custodial_donate_ledger", e instanceof Error ? e.message : String(e));
  }

  let share: { tokens: number; mint: string | null; error?: string } = { tokens: 0, mint: null };
  if (credit > 0) {
    share = await creditGoalShareForDonation(env, {
      goalId,
      donationId,
      accountId,
      landedCents: credit,
    });
  }

  return json({
    ok: true,
    signature: sent.signature,
    asset,
    amount,
    dest,
    ...clusterPublicFields(withCluster(env, cluster)),
    explorer: explorerTx(sent.signature, cluster),
    tokens_minted: share.tokens,
    token_mint: share.mint,
    share_error: share.error || null,
  });
}
