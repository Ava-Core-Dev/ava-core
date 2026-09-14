import { PublicKey } from "@solana/web3.js";

import { json } from "./cors";
import { sessionFromRequest } from "./primary-auth";
import type { AuthEnv } from "./primary-auth";
import { verifyWorkerOpsAdmin } from "./push";
import {
  insertWithdrawalIntentDraft,
  listSettlementLegs,
  listWithdrawalIntentsForAccount,
  withdrawalIntentStatusCounts,
  withdrawalSettlementFrameworkDescriptor,
} from "./withdrawal-settlement-framework";

export type WithdrawalSettlementRouteEnv = AuthEnv & { DB: import("@cloudflare/workers-types").D1Database; RR_PUSH_ADMIN_SECRET?: string };

const MAX_LEDGER_WHOLE = 1_000_000_000_000;

function isLikelySolanaPubkey(s: string): boolean {
  const t = String(s || "").trim();
  if (t.length < 32 || t.length > 48) return false;
  try {
    new PublicKey(t);
    return true;
  } catch {
    return false;
  }
}

function extractAuthTokenHint(request: Request): string {
  const a = request.headers.get("Authorization") || "";
  return a.toLowerCase().startsWith("bearer ") || (request.headers.get("Cookie") || "").includes("session")
    ? "Unauthorized."
    : "Missing token.";
}

/** GET `/v1/me/withdrawal-settlement/framework` — static pipeline descriptor. */
export async function handleWithdrawalSettlementFrameworkGet(): Promise<Response> {
  return json({ ok: true, ...withdrawalSettlementFrameworkDescriptor() }, 200, {
    "Cache-Control": "public, max-age=300",
  });
}

/** GET `/v1/me/withdrawal-intents` */
export async function handleWithdrawalIntentsList(request: Request, env: WithdrawalSettlementRouteEnv): Promise<Response> {
  if (!env.JWT_SECRET) return json({ detail: "Not configured." }, 503);
  const sess = await sessionFromRequest(env, request);
  if (!sess) return json({ detail: extractAuthTokenHint(request) }, 401);
  const rows = await listWithdrawalIntentsForAccount(env.DB, sess.accountId, 80);
  return json({ ok: true, intents: rows }, 200);
}

/** POST `/v1/me/withdrawal-intents` — draft intent (ledger-capped amount). */
export async function handleWithdrawalIntentCreate(request: Request, env: WithdrawalSettlementRouteEnv): Promise<Response> {
  if (request.method !== "POST") return json({ detail: "Method not allowed" }, 405);
  if (!env.JWT_SECRET) return json({ detail: "Not configured." }, 503);
  const sess = await sessionFromRequest(env, request);
  if (!sess) return json({ detail: extractAuthTokenHint(request) }, 401);

  let body: { mint_base58?: string; amount_ledger_whole?: number; destination_pubkey?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return json({ detail: "Invalid JSON" }, 400);
  }

  const mint = String(body.mint_base58 || "").trim();
  const dest = String(body.destination_pubkey || "").trim();
  const amt = Math.floor(Number(body.amount_ledger_whole));

  if (!mint || mint.length > 64) {
    return json({ detail: "mint_base58 is required (SPL mint or `native` for SOL)." }, 400);
  }
  if (!Number.isFinite(amt) || amt < 1 || amt > MAX_LEDGER_WHOLE) {
    return json({ detail: `amount_ledger_whole must be 1..${MAX_LEDGER_WHOLE.toLocaleString()} (ledger units).` }, 400);
  }
  if (!isLikelySolanaPubkey(dest)) {
    return json({ detail: "destination_pubkey must be a valid Solana address." }, 400);
  }

  const { id } = await insertWithdrawalIntentDraft(env.DB, {
    accountId: sess.accountId,
    mintBase58: mint,
    amountLedgerWhole: amt,
    destinationPubkey: dest,
  });

  return json(
    {
      ok: true,
      id,
      status: "draft",
      note: "Draft stored. Custodial→treasury→treasury payout executors attach legs when those stages go live.",
    },
    201,
  );
}

/** GET `/v1/me/withdrawal-intents/:id/legs` */
export async function handleWithdrawalIntentLegs(
  request: Request,
  env: WithdrawalSettlementRouteEnv,
  intentId: string,
): Promise<Response> {
  if (!env.JWT_SECRET) return json({ detail: "Not configured." }, 503);
  const sess = await sessionFromRequest(env, request);
  if (!sess) return json({ detail: extractAuthTokenHint(request) }, 401);
  const id = String(intentId || "").trim();
  if (!id) return json({ detail: "Missing intent id." }, 400);
  const intents = await listWithdrawalIntentsForAccount(env.DB, sess.accountId, 200);
  if (!intents.some((r) => r.id === id)) return json({ detail: "Not found." }, 404);
  const legs = await listSettlementLegs(env.DB, id);
  return json({ ok: true, intent_id: id, legs }, 200);
}

/** GET `/internal/withdrawal-settlement/summary` — ops dashboard. */
export async function handleWithdrawalSettlementInternalSummary(
  request: Request,
  env: WithdrawalSettlementRouteEnv,
): Promise<Response> {
  const secret = String(env.RR_PUSH_ADMIN_SECRET || "").trim();
  if (!secret) return json({ detail: "RR_PUSH_ADMIN_SECRET is not set on this Worker." }, 503);
  const adminOk = await verifyWorkerOpsAdmin(request, env);
  if (!adminOk) {
    const has = Boolean(request.headers.get("X-RR-Push-Admin-Key"));
    return json({ detail: has ? "Invalid admin key." : "Missing X-RR-Push-Admin-Key header." }, 401);
  }
  const counts = await withdrawalIntentStatusCounts(env.DB);
  return json({ ok: true, intent_status_counts: counts, framework: withdrawalSettlementFrameworkDescriptor() }, 200);
}
