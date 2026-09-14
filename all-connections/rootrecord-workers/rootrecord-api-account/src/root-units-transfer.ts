import type { D1Database } from "@cloudflare/workers-types";

import { json } from "./cors";
import type { AuthEnv } from "./primary-auth";
import { sessionFromRequest } from "./primary-auth";

export type RootUnitsTransferEnv = AuthEnv & { DB: D1Database };

/** Matches Discord `/send` cap (`discord-root-units.ts`). */
import { MAX_ROOT_UNITS_PER_TRANSFER } from "../../shared/earn-program-constants";
import { formatRootsAtomicLocale, rootsWholeToAtomic } from "../../shared/roots-units";

async function ensureBalanceRow(db: D1Database, userId: string, nowIso: string): Promise<void> {
  await db
    .prepare("INSERT OR IGNORE INTO rr_earn_balance (user_id, balance, updated_at) VALUES (?, 0, ?)")
    .bind(userId, nowIso)
    .run();
}

async function getEarnBalance(db: D1Database, userId: string): Promise<number> {
  const row = await db
    .prepare("SELECT balance FROM rr_earn_balance WHERE user_id = ?")
    .bind(userId)
    .first<{ balance: number }>();
  if (!row) return 0;
  return Math.max(0, Math.floor(Number(row.balance) || 0));
}

/**
 * POST `/v1/me/root-units/transfer`
 * Body JSON: exactly one of `recipient_email` or `recipient_account_id`, plus `amount` (whole Roots, ≥ 0.00000001).
 */
export async function handleRootUnitsTransferV1(request: Request, env: RootUnitsTransferEnv): Promise<Response> {
  if (request.method !== "POST") {
    return json({ ok: false, detail: "Method not allowed" }, 405);
  }
  if (!env.JWT_SECRET) {
    return json({ ok: false, detail: "Not configured" }, 503);
  }

  const sess = await sessionFromRequest(env, request);
  if (!sess) {
    return json({ ok: false, detail: "Sign in required." }, 401);
  }

  let body: { recipient_email?: string; recipient_account_id?: string; amount?: number };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return json({ ok: false, detail: "Invalid JSON" }, 400);
  }

  const emailRaw = String(body.recipient_email || "").trim();
  const aidRaw = String(body.recipient_account_id || "").trim();
  const hasEmail = emailRaw.length > 0 && emailRaw.includes("@");
  const hasAid = aidRaw.length > 0;
  if (hasEmail === hasAid) {
    return json(
      { ok: false, detail: "Provide exactly one of recipient_email or recipient_account_id (UUID)." },
      400,
    );
  }

  const amountWhole = Number(body.amount);
  const amount = rootsWholeToAtomic(amountWhole);
  if (!Number.isFinite(amountWhole) || amount < rootsWholeToAtomic(0.00000001)) {
    return json({ ok: false, detail: "amount must be at least 0.00000001 Roots." }, 400);
  }
  if (amount > MAX_ROOT_UNITS_PER_TRANSFER) {
    return json(
      { ok: false, detail: `amount cannot exceed ${formatRootsAtomicLocale(MAX_ROOT_UNITS_PER_TRANSFER)} Roots per transfer.` },
      400,
    );
  }

  let toAccountId: string;
  let toEmailLower: string;
  if (hasEmail) {
    const row = await env.DB
      .prepare("SELECT id, lower(trim(email)) AS e FROM license_accounts WHERE lower(email) = lower(?)")
      .bind(emailRaw)
      .first<{ id: string; e: string }>();
    if (!row?.id || !row.e) {
      return json({ ok: false, detail: "Recipient account not found for that email." }, 404);
    }
    toAccountId = String(row.id).trim();
    toEmailLower = String(row.e).trim().toLowerCase();
  } else {
    const row = await env.DB
      .prepare("SELECT id, lower(trim(email)) AS e FROM license_accounts WHERE id = ?")
      .bind(aidRaw)
      .first<{ id: string; e: string }>();
    if (!row?.id || !row.e) {
      return json({ ok: false, detail: "Recipient account not found for that account id." }, 404);
    }
    toAccountId = String(row.id).trim();
    toEmailLower = String(row.e).trim().toLowerCase();
  }

  const fromEmailLower = sess.email.trim().toLowerCase();
  if (toEmailLower === fromEmailLower) {
    return json({ ok: false, detail: "Cannot send Root Units to yourself." }, 400);
  }

  const fromUid = `user:${fromEmailLower}`;
  const toUid = `user:${toEmailLower}`;
  const now = new Date().toISOString();

  await ensureBalanceRow(env.DB, fromUid, now);
  await ensureBalanceRow(env.DB, toUid, now);

  const debit = await env.DB
    .prepare(
      "UPDATE rr_earn_balance SET balance = balance - ?, updated_at = ? WHERE user_id = ? AND balance >= ?",
    )
    .bind(amount, now, fromUid, amount)
    .run();
  if ((debit.meta?.changes ?? 0) !== 1) {
    const have = await getEarnBalance(env.DB, fromUid);
    return json(
      {
        ok: false,
        detail: "Insufficient Root Units.",
        balance: have,
      },
      409,
    );
  }

  const transferId = crypto.randomUUID();
  try {
    await env.DB.batch([
      env.DB
        .prepare("UPDATE rr_earn_balance SET balance = balance + ?, updated_at = ? WHERE user_id = ?")
        .bind(amount, now, toUid),
      env.DB
        .prepare(
          `INSERT INTO rr_earn_internal_transfer (
             id, from_user_id, to_user_id, units, from_account_id, to_account_id, created_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(transferId, fromUid, toUid, amount, sess.accountId, toAccountId, now),
    ]);
  } catch (e) {
    const msg = String(e && typeof e === "object" && "message" in e ? (e as Error).message : e);
    console.error("root_units_transfer_batch", transferId, msg.slice(0, 300));
    await env.DB
      .prepare("UPDATE rr_earn_balance SET balance = balance + ?, updated_at = ? WHERE user_id = ?")
      .bind(amount, now, fromUid)
      .run()
      .catch(() => {});
    return json({ ok: false, detail: "Transfer could not be completed. Your balance was restored. Try again." }, 503);
  }

  const newBalance = await getEarnBalance(env.DB, fromUid);
  return json(
    {
      ok: true,
      transfer_id: transferId,
      units: amount,
      from_user_id: fromUid,
      to_user_id: toUid,
      recipient_account_id: toAccountId,
      new_balance: newBalance,
    },
    200,
  );
}
