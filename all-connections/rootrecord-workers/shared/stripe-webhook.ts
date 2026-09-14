import type { BillingD1 } from "./billing-state";

import { applyStripeBillingPatch } from "./apply-stripe-billing";
import { creditStripeShardPurchase } from "./ava-shards";
import { CARD_FEE_BPS, feeFromBps } from "./platform-fees";
import { ROOTS_ATOMIC_PER_WHOLE } from "./roots-units";
import {
  activateVisitingHawaiiListing,
  expireVisitingHawaiiListingBySubscription,
  isVisitingHawaiiSponsoredCheckout,
  listingIdFromCheckoutSession,
  refreshVisitingHawaiiListingPeriod,
} from "./visiting-hawaii-sponsored";

export type StripeWebhookEnv = {
  DB: BillingD1;
  STRIPE_SECRET_KEY?: string;
  STRIPE_WEBHOOK_SECRET?: string;
};

const ROOTS_CREDIT_PACK_AMOUNT_TOTAL = 300; // $3.00 USD in Stripe's smallest unit.
const ROOTS_CREDIT_PACK_UNITS = 100 * ROOTS_ATOMIC_PER_WHOLE;

function whJson(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let x = 0;
  for (let i = 0; i < a.length; i++) x |= a[i]! ^ b[i]!;
  return x === 0;
}

function bytesToHex(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i++) out += bytes[i]!.toString(16).padStart(2, "0");
  return out;
}

async function verifyStripeSignature(
  payload: string,
  sigHeader: string,
  whsec: string,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  if (!sigHeader.trim()) return { ok: false, reason: "missing_stripe_signature" };

  const secret = whsec.trim().replace(/\r/g, "").replace(/^["']|["']$/g, "");
  if (!secret.startsWith("whsec_")) return { ok: false, reason: "missing_whsec" };

  const parts = sigHeader.split(",").map((s) => s.trim());
  let t = "";
  const v1s: string[] = [];
  for (const p of parts) {
    if (p.startsWith("t=")) t = p.slice(2);
    else if (p.startsWith("v1=")) v1s.push(p.slice(3));
  }
  if (!t || !v1s.length) return { ok: false, reason: "malformed_stripe_signature" };

  const ts = Number(t) * 1000;
  // Allow delayed retries / clock skew (Stripe may resend over hours).
  if (!Number.isFinite(ts) || Math.abs(Date.now() - ts) > 72 * 60 * 60 * 1000) {
    return { ok: false, reason: "stripe_timestamp_outside_tolerance" };
  }

  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signed = `${t}.${payload}`;
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(signed)));
  const macHex = bytesToHex(mac);
  const macBytes = enc.encode(macHex);
  for (const v1 of v1s) {
    const expectedHex = v1.toLowerCase();
    if (!expectedHex || expectedHex.length !== macHex.length) continue;
    if (timingSafeEqual(macBytes, enc.encode(expectedHex))) return { ok: true };
  }
  return { ok: false, reason: "stripe_hmac_mismatch" };
}

async function stripeGet(secret: string, path: string): Promise<Record<string, unknown> | null> {
  const res = await fetch(`https://api.stripe.com/v1${path}`, {
    headers: { Authorization: `Bearer ${secret.trim()}` },
  });
  const data = (await res.json()) as Record<string, unknown>;
  if (!res.ok) return null;
  return data;
}

async function resolvePortalUserByCustomerEmail(
  db: BillingD1,
  secret: string,
  customerId: string
): Promise<{ accountId: string; email: string } | null> {
  if (!secret.trim().startsWith("sk_")) return null;
  if (!customerId.trim().startsWith("cus_")) return null;
  const c = await stripeGet(secret, `/customers/${encodeURIComponent(customerId)}`);
  const em = typeof c?.email === "string" ? c.email.trim().toLowerCase() : "";
  if (!em) return null;
  const row = await db
    .prepare("SELECT id, email FROM license_accounts WHERE email = ?")
    .bind(em)
    .first<{ id: string; email: string }>();
  if (!row?.email) return null;
  return { accountId: row.id, email: row.email.trim().toLowerCase() };
}

async function insertWebhookEventOnce(db: BillingD1, id: string): Promise<boolean> {
  const now = new Date().toISOString();
  const r = await db.prepare("INSERT OR IGNORE INTO stripe_webhook_events (id, received_at) VALUES (?, ?)").bind(id, now).run();
  return (r.meta?.rows_written ?? 0) > 0;
}

async function resolvePortalUser(
  db: BillingD1,
  session: Record<string, unknown>
): Promise<{ accountId: string; email: string } | null> {
  const ref = String(session.client_reference_id || "").trim();
  const det = session.customer_details as Record<string, unknown> | undefined;
  const em = typeof det?.email === "string" ? det.email.trim().toLowerCase() : "";
  if (ref) {
    const row = await db
      .prepare("SELECT id, email FROM license_accounts WHERE id = ?")
      .bind(ref)
      .first<{ id: string; email: string }>();
    if (row?.email) return { accountId: row.id, email: row.email.trim().toLowerCase() };
  }
  if (em) {
    const row = await db
      .prepare("SELECT id, email FROM license_accounts WHERE email = ?")
      .bind(em)
      .first<{ id: string; email: string }>();
    if (row?.email) return { accountId: row.id, email: row.email.trim().toLowerCase() };
  }
  return null;
}

async function ensureRootsBalance(db: BillingD1, userId: string, nowIso: string): Promise<void> {
  await db
    .prepare("INSERT OR IGNORE INTO rr_earn_balance (user_id, balance, updated_at) VALUES (?, 0, ?)")
    .bind(userId, nowIso)
    .run();
}

async function creditRootsPack(db: BillingD1, user: { email: string }): Promise<void> {
  const email = user.email.trim().toLowerCase();
  if (!email) return;
  const userId = `user:${email}`;
  const nowIso = new Date().toISOString();
  await ensureRootsBalance(db, userId, nowIso);
  await db
    .prepare("UPDATE rr_earn_balance SET balance = balance + ?, updated_at = ? WHERE user_id = ?")
    .bind(ROOTS_CREDIT_PACK_UNITS, nowIso, userId)
    .run();
}

function isRootsCreditPackCheckout(session: Record<string, unknown>): boolean {
  const mode = String(session.mode || "");
  const currency = String(session.currency || "").toLowerCase();
  const amountTotal = Math.floor(Number(session.amount_total) || 0);
  const paymentStatus = String(session.payment_status || "").toLowerCase();
  return mode === "payment" && currency === "usd" && amountTotal === ROOTS_CREDIT_PACK_AMOUNT_TOTAL && paymentStatus === "paid";
}

async function resolvePortalUserByCustomer(
  db: BillingD1,
  customerId: string
): Promise<{ accountId: string; email: string } | null> {
  const row = await db
    .prepare("SELECT account_id, email FROM user_accounts WHERE stripe_customer_id = ?")
    .bind(customerId)
    .first<{ account_id: string | null; email: string }>();
  if (!row?.email) return null;
  const aid = String(row.account_id || "").trim();
  if (!aid) return null;
  return { accountId: aid, email: row.email.trim().toLowerCase() };
}

async function resolvePortalUserBySubscription(
  db: BillingD1,
  subscriptionId: string
): Promise<{ accountId: string; email: string } | null> {
  const row = await db
    .prepare("SELECT account_id, email FROM user_accounts WHERE stripe_subscription_id = ?")
    .bind(subscriptionId)
    .first<{ account_id: string | null; email: string }>();
  if (!row?.email) return null;
  const aid = String(row.account_id || "").trim();
  if (!aid) return null;
  return { accountId: aid, email: row.email.trim().toLowerCase() };
}

function paidSubscriptionStatuses(): Set<string> {
  return new Set(["active", "trialing"]);
}

function stripeCustomerId(raw: unknown): string {
  if (typeof raw === "string") return raw;
  if (raw && typeof raw === "object" && typeof (raw as { id?: unknown }).id === "string") {
    return (raw as { id: string }).id;
  }
  return "";
}

function subscriptionPeriodEndIso(sub: Record<string, unknown> | null): string | null {
  if (!sub) return null;
  const end = Number(sub.current_period_end);
  if (!Number.isFinite(end) || end <= 0) return null;
  return new Date(end * 1000).toISOString();
}

async function onVisitingHawaiiSponsoredCheckout(
  db: BillingD1,
  secret: string,
  session: Record<string, unknown>,
): Promise<void> {
  const listingId = listingIdFromCheckoutSession(session);
  if (!listingId) return;

  const cust = stripeCustomerId(session.customer) || null;
  const subscription = typeof session.subscription === "string" ? session.subscription : null;
  const sessionId = typeof session.id === "string" ? session.id : null;
  let paidThrough: string | null = null;
  if (subscription) {
    const sub = await stripeGet(secret, `/subscriptions/${encodeURIComponent(subscription)}`);
    paidThrough = subscriptionPeriodEndIso(sub);
  }
  if (!paidThrough) {
    const d = new Date();
    d.setUTCFullYear(d.getUTCFullYear() + 1);
    paidThrough = d.toISOString();
  }

  await activateVisitingHawaiiListing(db, listingId, {
    stripeCustomerId: cust,
    stripeSubscriptionId: subscription,
    stripeCheckoutSessionId: sessionId,
    paidThroughIso: paidThrough,
  });
}

function stripeMeta(obj: Record<string, unknown>): Record<string, unknown> {
  const m = obj.metadata;
  return m && typeof m === "object" && !Array.isArray(m) ? (m as Record<string, unknown>) : {};
}

async function tryRecordGoalDonation(
  db: BillingD1,
  session: Record<string, unknown>,
): Promise<boolean> {
  const meta = stripeMeta(session);
  if (String(meta.kind || "") !== "goal_donation") return false;
  const goalId = String(meta.goal_id || "").trim();
  if (!goalId) return true;
  const paid = String(session.payment_status || "").toLowerCase();
  if (paid && paid !== "paid" && paid !== "no_payment_required") return true;
  const cents = Math.max(0, Math.round(Number(session.amount_total) || 0));
  const txRef = String(session.id || "").trim();
  if (!txRef || cents <= 0) return true;
  const fee = feeFromBps(cents, CARD_FEE_BPS);
  const net = Math.max(0, cents - fee);
  const email =
    typeof session.customer_details === "object" && session.customer_details
      ? String((session.customer_details as { email?: string }).email || "")
      : String(session.customer_email || "");
  const now = new Date().toISOString();
  let payerAccountId: string | null = null;
  if (email) {
    try {
      const la = await db
        .prepare("SELECT id FROM license_accounts WHERE email = ? LIMIT 1")
        .bind(email.toLowerCase())
        .first<{ id: string }>();
      payerAccountId = String(la?.id || "").trim() || null;
    } catch {
      payerAccountId = null;
    }
  }
  try {
    const closed = await db
      .prepare(`SELECT funding_status FROM rg_goals WHERE id = ?`)
      .bind(goalId)
      .first<{ funding_status: string | null }>();
    if (String(closed?.funding_status || "open").toLowerCase() === "refunded") return true;
    const ins = await db
      .prepare(
        `INSERT OR IGNORE INTO rg_goal_donations (id, goal_id, source, amount_cents, currency, tx_ref, payer_email, created_at, fee_cents, net_cents, payer_account_id)
         VALUES (?, ?, 'stripe', ?, 'usd', ?, ?, ?, ?, ?, ?)`,
      )
      .bind(crypto.randomUUID(), goalId, cents, txRef, email || null, now, fee, net, payerAccountId)
      .run();
    const changed = Number((ins as { meta?: { changes?: number } })?.meta?.changes || 0);
    if (changed > 0) {
      await db
        .prepare(`UPDATE rg_goals SET raised_cents = COALESCE(raised_cents, 0) + ?, updated_at = ? WHERE id = ?`)
        .bind(net, now, goalId)
        .run();
    }
  } catch (e) {
    console.error(
      "goal donation record",
      String(e && typeof e === "object" && "message" in e ? (e as Error).message : e),
    );
  }
  return true;
}

async function tryCreditAvaShards(db: BillingD1, session: Record<string, unknown>): Promise<boolean> {
  const meta = stripeMeta(session);
  if (String(meta.kind || "") !== "ava_shards") return false;
  const paid = String(session.payment_status || "").toLowerCase();
  if (paid && paid !== "paid" && paid !== "no_payment_required") return true;
  const cents = Math.max(0, Math.round(Number(session.amount_total) || 0));
  const txRef = String(session.id || "").trim();
  let accountId = String(meta.account_id || session.client_reference_id || "").trim();
  if (!accountId) {
    const user = await resolvePortalUser(db, session);
    accountId = user?.accountId || "";
  }
  if (!accountId || !txRef || cents <= 0) return true;
  await creditStripeShardPurchase(db, { accountId, usdCents: cents, txRef });
  return true;
}

async function onCheckoutSessionCompleted(
  db: BillingD1,
  secret: string,
  session: Record<string, unknown>
): Promise<void> {
  if (isVisitingHawaiiSponsoredCheckout(session)) {
    const paymentStatus = String(session.payment_status || "").toLowerCase();
    if (paymentStatus && paymentStatus !== "paid" && paymentStatus !== "no_payment_required") return;
    await onVisitingHawaiiSponsoredCheckout(db, secret, session);
    return;
  }

  if (await tryRecordGoalDonation(db, session)) return;

  if (await tryCreditAvaShards(db, session)) return;

  const user = await resolvePortalUser(db, session);
  if (!user) return;

  const mode = String(session.mode || "");
  const cust = stripeCustomerId(session.customer);
  const customer = cust || null;
  const subscription = typeof session.subscription === "string" ? session.subscription : null;

  if (mode === "payment") {
    if (isRootsCreditPackCheckout(session)) {
      await creditRootsPack(db, user);
      return;
    }
    await applyStripeBillingPatch(db, {
      email: user.email,
      account_id: user.accountId,
      stripe_customer_id: customer,
      stripe_subscription_id: null,
      subscription_status: "none",
      pro_unlocked: true,
      life_member: true,
    });
    return;
  }

  if (mode === "subscription" && subscription) {
    const sub = await stripeGet(secret, `/subscriptions/${encodeURIComponent(subscription)}`);
    const st = typeof sub?.status === "string" ? sub.status : "active";
    const pro = paidSubscriptionStatuses().has(st);
    await applyStripeBillingPatch(db, {
      email: user.email,
      account_id: user.accountId,
      stripe_customer_id: customer,
      stripe_subscription_id: subscription,
      subscription_status: st,
      pro_unlocked: pro,
      life_member: false,
    });
  }
}

async function onSubscriptionUpdated(
  db: BillingD1,
  secret: string,
  sub: Record<string, unknown>
): Promise<void> {
  const id = typeof sub.id === "string" ? sub.id : "";
  const customer = stripeCustomerId(sub.customer);
  if (!id) return;

  const meta = sub.metadata as Record<string, unknown> | undefined;
  if (String(meta?.product || "") === "visiting_hawaii_sponsored") {
    const paidThrough = subscriptionPeriodEndIso(sub);
    if (paidThrough && paidSubscriptionStatuses().has(String(sub.status || ""))) {
      await refreshVisitingHawaiiListingPeriod(db, id, paidThrough);
    }
    return;
  }

  let user = await resolvePortalUserBySubscription(db, id);
  if (!user && customer) user = await resolvePortalUserByCustomer(db, customer);
  if (!user && customer) user = await resolvePortalUserByCustomerEmail(db, secret, customer);
  if (!user) return;

  const st = typeof sub.status === "string" ? sub.status : "unknown";
  const pro = paidSubscriptionStatuses().has(st);
  await applyStripeBillingPatch(db, {
    email: user.email,
    account_id: user.accountId,
    stripe_customer_id: customer || null,
    stripe_subscription_id: id,
    subscription_status: st,
    pro_unlocked: pro,
    life_member: false,
  });
}

async function onSubscriptionDeleted(db: BillingD1, sub: Record<string, unknown>): Promise<void> {
  const id = typeof sub.id === "string" ? sub.id : "";
  const customer = stripeCustomerId(sub.customer);
  if (!id) return;

  const meta = sub.metadata as Record<string, unknown> | undefined;
  if (String(meta?.product || "") === "visiting_hawaii_sponsored") {
    await expireVisitingHawaiiListingBySubscription(db, id);
    return;
  }

  let user = await resolvePortalUserBySubscription(db, id);
  if (!user && customer) user = await resolvePortalUserByCustomer(db, customer);
  if (!user) return;

  const cur = await db
    .prepare("SELECT life_member FROM user_accounts WHERE email = ?")
    .bind(user.email)
    .first<{ life_member: number | null }>();
  const life = cur?.life_member === 1;
  await applyStripeBillingPatch(db, {
    email: user.email,
    account_id: user.accountId,
    stripe_customer_id: customer || null,
    stripe_subscription_id: null,
    subscription_status: "canceled",
    pro_unlocked: life,
    life_member: life,
  });
}

async function onInvoiceEvent(
  db: BillingD1,
  secret: string,
  invoice: Record<string, unknown>,
  paid: boolean
): Promise<void> {
  const subId = typeof invoice.subscription === "string" ? invoice.subscription : "";
  if (!subId) return;
  let user = await resolvePortalUserBySubscription(db, subId);
  const customer = stripeCustomerId(invoice.customer);
  if (!user && customer) user = await resolvePortalUserByCustomer(db, customer);
  if (!user && customer) user = await resolvePortalUserByCustomerEmail(db, secret, customer);
  if (!user) return;

  const sub = await stripeGet(secret, `/subscriptions/${encodeURIComponent(subId)}`);
  const st = typeof sub?.status === "string" ? sub.status : paid ? "active" : "past_due";
  const pro = paidSubscriptionStatuses().has(st);
  await applyStripeBillingPatch(db, {
    email: user.email,
    account_id: user.accountId,
    stripe_customer_id: stripeCustomerId(invoice.customer) || null,
    stripe_subscription_id: subId,
    subscription_status: st,
    pro_unlocked: pro,
    life_member: false,
  });
}

export async function handleStripeWebhook(request: Request, env: StripeWebhookEnv): Promise<Response> {
  const whsec = (env.STRIPE_WEBHOOK_SECRET || "").trim();
  const sk = (env.STRIPE_SECRET_KEY || "").trim();
  if (!whsec.startsWith("whsec_")) {
    return whJson({ detail: "STRIPE_WEBHOOK_SECRET not configured." }, 503);
  }

  const sig = request.headers.get("Stripe-Signature") || "";
  const payload = await request.text();
  const v = await verifyStripeSignature(payload, sig, whsec);
  if (!v.ok) {
    return whJson({ detail: "Invalid signature.", reason: v.reason }, 400);
  }

  let evt: { id?: string; type?: string; data?: { object?: Record<string, unknown> } };
  try {
    evt = JSON.parse(payload) as typeof evt;
  } catch {
    return whJson({ detail: "Invalid JSON." }, 400);
  }

  const id = String(evt.id || "");
  const type = String(evt.type || "");
  if (!id || !type) return whJson({ detail: "Missing event id or type." }, 400);

  const inserted = await insertWebhookEventOnce(env.DB, id);
  if (!inserted) {
    return whJson({ received: true, duplicate: true }, 200);
  }

  const obj = evt.data?.object;
  if (!obj || typeof obj !== "object") {
    return whJson({ received: true }, 200);
  }

  try {
    if (type === "checkout.session.completed") {
      if (sk.startsWith("sk_")) await onCheckoutSessionCompleted(env.DB, sk, obj);
    } else if (type === "customer.subscription.updated") {
      await onSubscriptionUpdated(env.DB, sk, obj);
    } else if (type === "customer.subscription.deleted") {
      await onSubscriptionDeleted(env.DB, obj);
    } else if (type === "invoice.paid" && sk.startsWith("sk_")) {
      await onInvoiceEvent(env.DB, sk, obj, true);
    } else if (type === "invoice.payment_failed" && sk.startsWith("sk_")) {
      await onInvoiceEvent(env.DB, sk, obj, false);
    }
  } catch (e) {
    console.error("stripe webhook handler error", String(e && typeof e === "object" && "message" in e ? (e as Error).message : e));
    return whJson({ detail: "Webhook handler error." }, 500);
  }

  return whJson({ received: true }, 200);
}
