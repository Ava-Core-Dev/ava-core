/**
 * Creator withdraw (only after the USD target is met) and refund+close (anytime before withdraw).
 */
import type { D1Database } from "@cloudflare/workers-types";
import {
  ComputeBudgetProgram,
  Keypair,
  PublicKey,
  SystemProgram,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountIdempotentInstruction,
  createTransferCheckedInstruction,
  getAssociatedTokenAddressSync,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";

import { transferShards } from "../../shared/ava-shards";
import { json } from "./cors";
import { emailFromUserId } from "./goal-constants";
import { loadGoalDonateKeypair } from "./goal-funding";
import { fundingStatusOf, goalIsMet, REFUND_WARNING } from "./goal-share";
import { clusterForGoal, usdcMint, withCluster } from "./solana-cluster";
import {
  accountIdForEmail,
  accountIdForUserId,
  pickConnection,
  provisionCustodialWalletIfMissing,
  seedCustodialToLamports,
  type CustodialEnv,
} from "./member-custodial";

const USDC_DECIMALS = 6;
const SOL_RENT_KEEP = 890_880;
const FEE_BUFFER = 20_000;
const TRANSFER_CU = 200_000;

type PayoutEnv = CustodialEnv & {
  DB: D1Database;
  STRIPE_SECRET_KEY?: string;
};

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

async function ownerRow(env: PayoutEnv, userId: string, goalId: string) {
  return env.DB.prepare(`SELECT * FROM rg_goals WHERE id = ? AND user_id = ? AND deleted_at IS NULL`)
    .bind(goalId, userId)
    .first<Record<string, unknown>>();
}

async function sendSol(
  env: PayoutEnv,
  from: Keypair,
  toB58: string,
  lamports: number,
  cluster?: string,
): Promise<{ ok: true; signature: string } | { ok: false; message: string }> {
  const send = Math.floor(lamports);
  if (send < 1) return { ok: true, signature: "" };
  let dest: PublicKey;
  try {
    dest = new PublicKey(toB58);
  } catch {
    return { ok: false, message: "bad_dest" };
  }
  const conn = await pickConnection(env, cluster);
  if (!conn) return { ok: false, message: "rpc_unavailable" };
  try {
    const latest = await conn.getLatestBlockhash("confirmed");
    const msg = new TransactionMessage({
      payerKey: from.publicKey,
      recentBlockhash: latest.blockhash,
      instructions: [
        ComputeBudgetProgram.setComputeUnitLimit({ units: TRANSFER_CU }),
        ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 0 }),
        SystemProgram.transfer({ fromPubkey: from.publicKey, toPubkey: dest, lamports: send }),
      ],
    });
    const tx = new VersionedTransaction(msg.compileToV0Message());
    tx.sign([from]);
    const sig = await conn.sendRawTransaction(tx.serialize(), { skipPreflight: false, maxRetries: 3 });
    await conn.confirmTransaction(
      { signature: sig, blockhash: latest.blockhash, lastValidBlockHeight: latest.lastValidBlockHeight },
      "confirmed",
    );
    return { ok: true, signature: sig };
  } catch (e) {
    return { ok: false, message: (e instanceof Error ? e.message : String(e)).slice(0, 220) };
  }
}

async function sendUsdc(
  env: PayoutEnv,
  from: Keypair,
  toB58: string,
  atomic: number,
  cluster?: string,
): Promise<{ ok: true; signature: string } | { ok: false; message: string }> {
  const raw = Math.floor(atomic);
  if (raw < 1) return { ok: true, signature: "" };
  let dest: PublicKey;
  try {
    dest = new PublicKey(toB58);
  } catch {
    return { ok: false, message: "bad_dest" };
  }
  const conn = await pickConnection(env, cluster);
  if (!conn) return { ok: false, message: "rpc_unavailable" };
  const mint = new PublicKey(usdcMint(withCluster(env, cluster || "devnet")));
  const fromAta = getAssociatedTokenAddressSync(mint, from.publicKey, false, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID);
  const toAta = getAssociatedTokenAddressSync(mint, dest, false, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID);
  try {
    const latest = await conn.getLatestBlockhash("confirmed");
    const msg = new TransactionMessage({
      payerKey: from.publicKey,
      recentBlockhash: latest.blockhash,
      instructions: [
        ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 }),
        ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 0 }),
        createAssociatedTokenAccountIdempotentInstruction(
          from.publicKey,
          toAta,
          dest,
          mint,
          TOKEN_PROGRAM_ID,
          ASSOCIATED_TOKEN_PROGRAM_ID,
        ),
        createTransferCheckedInstruction(fromAta, mint, toAta, from.publicKey, raw, USDC_DECIMALS, [], TOKEN_PROGRAM_ID),
      ],
    });
    const tx = new VersionedTransaction(msg.compileToV0Message());
    tx.sign([from]);
    const sig = await conn.sendRawTransaction(tx.serialize(), { skipPreflight: false, maxRetries: 3 });
    await conn.confirmTransaction(
      { signature: sig, blockhash: latest.blockhash, lastValidBlockHeight: latest.lastValidBlockHeight },
      "confirmed",
    );
    return { ok: true, signature: sig };
  } catch (e) {
    return { ok: false, message: (e instanceof Error ? e.message : String(e)).slice(0, 220) };
  }
}

async function liveDonate(env: PayoutEnv, pubkey: string, cluster?: string) {
  const conn = await pickConnection(env, cluster);
  const empty = { sol: 0, usdc: 0 };
  if (!conn || !pubkey) return empty;
  try {
    const owner = new PublicKey(pubkey);
    const sol = await conn.getBalance(owner, "confirmed");
    let usdc = 0;
    try {
      const ata = getAssociatedTokenAddressSync(
        new PublicKey(usdcMint(withCluster(env, cluster || "devnet"))),
        owner,
        false,
        TOKEN_PROGRAM_ID,
        ASSOCIATED_TOKEN_PROGRAM_ID,
      );
      const info = await conn.getTokenAccountBalance(ata, "confirmed");
      usdc = Math.max(0, Math.floor(Number(info.value.amount) || 0));
    } catch {
      usdc = 0;
    }
    return { sol: Math.max(0, sol), usdc };
  } catch {
    return empty;
  }
}

async function stripeRefund(secret: string, sessionId: string): Promise<{ ok: boolean; detail: string }> {
  const sk = String(secret || "").trim();
  if (!sk) return { ok: false, detail: "stripe_not_configured" };
  const auth = "Basic " + btoa(`${sk}:`);
  const sess = await fetch(`https://api.stripe.com/v1/checkout/sessions/${encodeURIComponent(sessionId)}`, {
    headers: { authorization: auth },
  });
  const body = (await sess.json().catch(() => ({}))) as Record<string, unknown>;
  const pi = str(body.payment_intent);
  if (!sess.ok || !pi) return { ok: false, detail: str(body.error && typeof body.error === "object" ? (body.error as { message?: string }).message : "") || "no_payment_intent" };
  const ref = await fetch("https://api.stripe.com/v1/refunds", {
    method: "POST",
    headers: { authorization: auth, "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ payment_intent: pi }).toString(),
  });
  const out = (await ref.json().catch(() => ({}))) as Record<string, unknown>;
  if (!ref.ok) {
    const msg = str((out.error as { message?: string } | undefined)?.message) || "stripe_refund_failed";
    if (msg.toLowerCase().includes("already been refunded")) return { ok: true, detail: "already_refunded" };
    return { ok: false, detail: msg.slice(0, 180) };
  }
  return { ok: true, detail: str(out.id) || "refunded" };
}

export function fundingFlags(row: Record<string, unknown>) {
  const status = fundingStatusOf(row);
  const met = goalIsMet(row);
  return {
    funding_status: status,
    goal_met: met,
    can_withdraw: status === "open" && met,
    can_refund: status === "open",
    refund_warning: REFUND_WARNING,
    withdraw_blocked:
      status === "withdrawn"
        ? "Already withdrawn."
        : status === "refunded"
          ? "This goal was canceled and refunded."
          : met
            ? null
            : "You can withdraw only after the USD target is met.",
  };
}

export async function handleGoalWithdraw(
  request: Request,
  env: PayoutEnv,
  userId: string,
  goalIdRaw: string,
): Promise<Response> {
  if (request.method !== "POST") return json({ detail: "Method not allowed" }, 405);
  if (!userId.startsWith("user:")) return json({ detail: "Sign in required." }, 401);
  const goalId = str(goalIdRaw);
  const row = await ownerRow(env, userId, goalId);
  if (!row) return json({ detail: "Goal not found." }, 404);
  const flags = fundingFlags(row);
  if (!flags.can_withdraw) {
    return json({ detail: flags.withdraw_blocked || "Cannot withdraw yet.", ...flags }, 409);
  }
  const destAccount = await accountIdForUserId(env.DB, userId);
  if (!destAccount) return json({ detail: "Account not found." }, 404);
  const destW = await provisionCustodialWalletIfMissing(env, destAccount);
  if ("error" in destW) return json({ detail: destW.error }, 503);
  const donate = await loadGoalDonateKeypair(env, goalId);
  if ("error" in donate) return json({ detail: donate.error }, 503);
  const cluster = await clusterForGoal(env, row);
  await seedCustodialToLamports(env, donate.pubkey, SOL_RENT_KEEP + FEE_BUFFER + 80_000, cluster);
  const from = Keypair.fromSecretKey(donate.secret);
  const live = await liveDonate(env, donate.pubkey, cluster);
  const solSend = Math.max(0, live.sol - SOL_RENT_KEEP - FEE_BUFFER);
  const errors: string[] = [];
  const sigs: string[] = [];
  if (live.usdc > 0) {
    const u = await sendUsdc(env, from, destW.pubkey, live.usdc, cluster);
    if (u.ok && u.signature) sigs.push(u.signature);
    else if (!u.ok) errors.push(u.message);
  }
  if (solSend > 0) {
    const s = await sendSol(env, from, destW.pubkey, solSend, cluster);
    if (s.ok && s.signature) sigs.push(s.signature);
    else if (!s.ok) errors.push(s.message);
  }
  if (errors.length && !sigs.length) return json({ detail: errors[0], errors }, 400);
  const now = new Date().toISOString();
  await env.DB.prepare(`UPDATE rg_goals SET funding_status = 'withdrawn', funding_closed_at = ?, updated_at = ? WHERE id = ?`)
    .bind(now, now, goalId)
    .run();
  return json({ ok: true, signatures: sigs, dest: destW.pubkey, errors, note: "Goal tokens can still be minted on later deposits." });
}

export async function handleGoalRefund(
  request: Request,
  env: PayoutEnv,
  userId: string,
  goalIdRaw: string,
): Promise<Response> {
  if (request.method !== "POST") return json({ detail: "Method not allowed" }, 405);
  if (!userId.startsWith("user:")) return json({ detail: "Sign in required." }, 401);
  const goalId = str(goalIdRaw);
  const row = await ownerRow(env, userId, goalId);
  if (!row) return json({ detail: "Goal not found." }, 404);
  const flags = fundingFlags(row);
  if (!flags.can_refund) {
    return json(
      {
        detail:
          flags.funding_status === "withdrawn"
            ? "Already withdrawn. Refunds are only available before you take the funds."
            : "This goal is already closed.",
        ...flags,
      },
      409,
    );
  }
  const donate = await loadGoalDonateKeypair(env, goalId);
  if ("error" in donate) return json({ detail: donate.error }, 503);
  const cluster = await clusterForGoal(env, row);
  await seedCustodialToLamports(env, donate.pubkey, SOL_RENT_KEEP + FEE_BUFFER * 8, cluster);
  const from = Keypair.fromSecretKey(donate.secret);
  const live = await liveDonate(env, donate.pubkey, cluster);

  const donations = await env.DB.prepare(
    `SELECT id, source, currency, net_cents, amount_cents, amount_atomic, tx_ref, payer_email, payer_account_id
     FROM rg_goal_donations WHERE goal_id = ? ORDER BY created_at ASC`,
  )
    .bind(goalId)
    .all<{
      id: string;
      source: string;
      currency: string;
      net_cents: number | null;
      amount_cents: number | null;
      amount_atomic: string | null;
      tx_ref: string | null;
      payer_email: string | null;
      payer_account_id: string | null;
    }>();
  const list = donations.results || [];
  const results: Record<string, unknown>[] = [];

  const pubkeyFor = async (d: (typeof list)[0]): Promise<string | null> => {
    let aid = str(d.payer_account_id);
    if (!aid && d.payer_email) aid = (await accountIdForEmail(env.DB, d.payer_email)) || "";
    if (!aid) return null;
    const w = await provisionCustodialWalletIfMissing(env, aid);
    return "error" in w ? null : w.pubkey;
  };

  const usdcDonors = list.filter((d) => d.currency === "usdc" || d.source === "custodial_usdc");
  const solDonors = list.filter((d) => d.currency === "sol" || d.source === "custodial_sol");
  const usdcWeights = usdcDonors.map((d) => Math.max(0, Math.floor(Number(d.net_cents ?? d.amount_cents) || 0)));
  const usdcTotal = usdcWeights.reduce((a, b) => a + b, 0) || 1;
  let usdcLeft = live.usdc;
  for (let i = 0; i < usdcDonors.length; i++) {
    const d = usdcDonors[i]!;
    const dest = await pubkeyFor(d);
    const slice = i === usdcDonors.length - 1 ? usdcLeft : Math.floor((live.usdc * usdcWeights[i]!) / usdcTotal);
    usdcLeft = Math.max(0, usdcLeft - slice);
    if (!dest || slice < 1) {
      results.push({ id: d.id, kind: "usdc", skipped: !dest ? "no_wallet" : "dust" });
      continue;
    }
    const sent = await sendUsdc(env, from, dest, slice, cluster);
    results.push({ id: d.id, kind: "usdc", ...sent, amount: slice });
  }

  const solWeights = await Promise.all(
    solDonors.map(async (d) => {
      const lamports = Math.max(0, Math.floor(Number(d.amount_atomic) || 0));
      return lamports;
    }),
  );
  const solWeightSum = solWeights.reduce((a, b) => a + b, 0) || 1;
  const spendable = Math.max(0, live.sol - SOL_RENT_KEEP - FEE_BUFFER * Math.max(1, solDonors.length));
  let solLeft = spendable;
  for (let i = 0; i < solDonors.length; i++) {
    const d = solDonors[i]!;
    const dest = await pubkeyFor(d);
    const slice = i === solDonors.length - 1 ? solLeft : Math.floor((spendable * solWeights[i]!) / solWeightSum);
    solLeft = Math.max(0, solLeft - slice);
    if (!dest || slice < 1) {
      results.push({ id: d.id, kind: "sol", skipped: !dest ? "no_wallet" : "dust" });
      continue;
    }
    const sent = await sendSol(env, from, dest, slice, cluster);
    results.push({ id: d.id, kind: "sol", ...sent, amount: slice });
  }

  for (const d of list.filter((x) => x.source === "stripe")) {
    const tx = str(d.tx_ref);
    if (!tx) continue;
    const r = await stripeRefund(str(env.STRIPE_SECRET_KEY), tx);
    results.push({ id: d.id, kind: "stripe", ok: r.ok, detail: r.detail });
  }

  for (const d of list.filter((x) => x.currency === "shards" || x.source === "ava_shards")) {
    let aid = str(d.payer_account_id);
    if (!aid && d.payer_email) aid = (await accountIdForEmail(env.DB, d.payer_email)) || "";
    const n = Math.max(0, Math.floor(Number(d.amount_atomic || d.net_cents) || 0));
    if (!aid || n < 1) {
      results.push({ id: d.id, kind: "shards", skipped: "no_account" });
      continue;
    }
    const tip = await transferShards(env.DB, `goal:${goalId}`, aid, n, "goal_refund", `refund:${d.id}`);
    results.push({ id: d.id, kind: "shards", ok: tip.ok, detail: tip.ok ? "returned" : tip.reason });
  }

  const now = new Date().toISOString();
  await env.DB.prepare(`UPDATE rg_goals SET funding_status = 'refunded', funding_closed_at = ?, updated_at = ? WHERE id = ?`)
    .bind(now, now, goalId)
    .run();
  return json({
    ok: true,
    warning: REFUND_WARNING,
    results,
    note: "Refunds are net of ATA rent already paid and Root Record / network transaction fees. The remainder of what was still in the goal wallet is what donors receive.",
  });
}

export async function handleGoalClaimTokens(
  request: Request,
  env: PayoutEnv,
  userId: string,
  goalIdRaw: string,
): Promise<Response> {
  if (request.method !== "POST") return json({ detail: "Method not allowed" }, 405);
  if (!userId.startsWith("user:")) return json({ detail: "Sign in to claim goal tokens." }, 401);
  const accountId = await accountIdForUserId(env.DB, userId);
  if (!accountId) return json({ detail: "Account not found." }, 404);
  const out = await claimPendingShareTokens(env, str(goalIdRaw), accountId, emailFromUserId(userId));
  return json({ ok: true, ...out });
}
