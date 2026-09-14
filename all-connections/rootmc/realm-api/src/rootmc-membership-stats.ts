/**
 * Paid membership counts for Ava development funding.
 * Source of truth: live Stripe recurring subscriptions (unique customer email)
 * plus D1 Lifetime. Weekly award / unpaid Pro never included.
 */
import type { D1Database } from "@cloudflare/workers-types";

import { isLifetimeMember } from "./rootmc-governance-voting";

export const PRO_MONTHLY_USD = 4.99;
export const MIN_DEV_USD = 40;
export const MIN_DEV_PRO = 8;
export const BEST_DEV_USD = 200;

/** Original Root Record $4.99/mo membership — still active on Stripe. */
export const LEGACY_RR_MONTHLY_PRICE_ID = "price_1TQIpzIaRpbMiAov5g5iTPh9";

const COUNTABLE_SUB_STATUS = new Set(["active", "trialing", "past_due"]);

export type PaidMembershipStats = {
  ok: true;
  paid_pro: number;
  lifetime: number;
  paid_members: number;
  mrr_usd: number;
  min_dev_pro: number;
  min_dev_usd: number;
  best_dev_usd: number;
  development_available: boolean;
  development_note: string;
  hardware_note: string;
  source: "stripe" | "d1";
};

export type MembershipStatsEnv = {
  STRIPE_SECRET_KEY?: string;
  STRIPE_ROOTMC_PRICE_MONTHLY?: string;
  STRIPE_ROOTMC_PRICE_MONTHLY_LEGACY?: string;
  STRIPE_PRICE_ID?: string;
};

export function monthlyProPriceIds(env: MembershipStatsEnv = {}): Set<string> {
  const ids = new Set<string>();
  for (const raw of [
    env.STRIPE_ROOTMC_PRICE_MONTHLY,
    env.STRIPE_ROOTMC_PRICE_MONTHLY_LEGACY,
    env.STRIPE_PRICE_ID,
    LEGACY_RR_MONTHLY_PRICE_ID,
  ]) {
    for (const p of String(raw || "").split(/[,\s]+/)) {
      if (p.startsWith("price_") && p.length >= 12) ids.add(p.trim());
    }
  }
  return ids;
}

type StripeCustomer = { id?: string; email?: string | null };
type StripePrice = { id?: string; unit_amount?: number | null };
type StripeSub = {
  id?: string;
  status?: string;
  customer?: string | StripeCustomer;
  items?: {
    data?: Array<{
      quantity?: number;
      price?: string | StripePrice;
    }>;
  };
};
type StripeSubList = { data?: StripeSub[]; has_more?: boolean };

async function stripeGetJson<T>(secret: string, path: string): Promise<T | null> {
  try {
    const res = await fetch(`https://api.stripe.com/v1${path}`, {
      headers: {
        Authorization: `Bearer ${secret}`,
        "Stripe-Version": "2024-11-20.acacia",
      },
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

function subMatchesMonthly(sub: StripeSub, monthlyIds: Set<string>): { match: boolean; cents: number } {
  let match = false;
  let cents = 0;
  for (const it of sub.items?.data || []) {
    const price = it.price;
    const pid = typeof price === "string" ? price : String(price?.id || "");
    if (!monthlyIds.has(pid)) continue;
    match = true;
    const unit = typeof price === "object" && price ? Number(price.unit_amount) || 0 : 0;
    cents += unit * Math.max(1, Number(it.quantity) || 1);
  }
  return { match, cents };
}

function customerKey(sub: StripeSub): string {
  const c = sub.customer;
  if (c && typeof c === "object") {
    const email = String(c.email || "").trim().toLowerCase();
    if (email.includes("@")) return `email:${email}`;
    if (c.id) return `cus:${c.id}`;
  }
  if (typeof c === "string" && c.trim()) return `cus:${c.trim()}`;
  return sub.id ? `sub:${sub.id}` : "";
}

async function countStripeRecurringPro(
  env: MembershipStatsEnv,
): Promise<{ paidPro: number; mrrCents: number; keys: string[] } | null> {
  const secret = String(env.STRIPE_SECRET_KEY || "").trim();
  if (!secret.startsWith("sk_") || secret.length < 20) return null;
  const monthlyIds = monthlyProPriceIds(env);
  if (!monthlyIds.size) return null;

  const payerKeys = new Set<string>();
  let mrrCents = 0;
  let startingAfter = "";
  for (let page = 0; page < 20; page++) {
    const qs = new URLSearchParams({ limit: "100", status: "all" });
    qs.append("expand[]", "data.customer");
    if (startingAfter) qs.set("starting_after", startingAfter);
    const body = await stripeGetJson<StripeSubList>(secret, `/subscriptions?${qs.toString()}`);
    if (!body) return page === 0 ? null : { paidPro: payerKeys.size, mrrCents, keys: [...payerKeys] };
    const rows = body.data || [];
    for (const sub of rows) {
      if (!COUNTABLE_SUB_STATUS.has(String(sub.status || ""))) continue;
      const hit = subMatchesMonthly(sub, monthlyIds);
      if (!hit.match) continue;
      mrrCents += hit.cents || Math.round(PRO_MONTHLY_USD * 100);
      const key = customerKey(sub);
      if (key) payerKeys.add(key);
    }
    if (!body.has_more || !rows.length) break;
    startingAfter = String(rows[rows.length - 1]?.id || "");
    if (!startingAfter) break;
  }
  return { paidPro: payerKeys.size, mrrCents, keys: [...payerKeys] };
}

async function d1LifetimeEmails(db: D1Database): Promise<string[]> {
  try {
    const { results } = await db
      .prepare(
        `SELECT email, life_member FROM user_accounts WHERE life_member = 1`,
      )
      .all<{ email?: string | null; life_member?: number | boolean | null }>();
    const out: string[] = [];
    for (const row of results || []) {
      if (!isLifetimeMember(row)) continue;
      const email = String(row.email || "").trim().toLowerCase();
      if (email.includes("@")) out.push(`email:${email}`);
    }
    return out;
  } catch {
    return [];
  }
}

async function countD1Fallback(
  db: D1Database,
  nowMs: number,
): Promise<{ paidPro: number; lifetime: number; keys: string[] }> {
  let paidPro = 0;
  let lifetime = 0;
  const keys = new Set<string>();
  try {
    const { results } = await db
      .prepare(
        `SELECT email, pro_unlocked, life_member, pro_paid_until, subscription_status
         FROM user_accounts`,
      )
      .all<{
        email?: string | null;
        pro_unlocked?: number | boolean | null;
        life_member?: number | boolean | null;
        pro_paid_until?: string | null;
        subscription_status?: string | null;
      }>();
    for (const row of results || []) {
      const email = String(row.email || "").trim().toLowerCase();
      const key = email.includes("@") ? `email:${email}` : "";
      if (isLifetimeMember(row)) {
        lifetime += 1;
        if (key) keys.add(key);
      }
      const status = String(row.subscription_status || "").toLowerCase();
      const paidUntil = row.pro_paid_until ? Date.parse(String(row.pro_paid_until)) : NaN;
      const recurring =
        COUNTABLE_SUB_STATUS.has(status) || (Number.isFinite(paidUntil) && paidUntil > nowMs);
      if (recurring) {
        paidPro += 1;
        if (key) keys.add(key);
      }
    }
  } catch {
    /* table / columns may be missing */
  }
  return { paidPro, lifetime, keys: [...keys] };
}

export async function computePaidMembershipStats(
  db: D1Database,
  env: MembershipStatsEnv = {},
  nowMs = Date.now(),
): Promise<PaidMembershipStats> {
  const stripe = await countStripeRecurringPro(env);
  const d1 = await countD1Fallback(db, nowMs);
  const lifetimeKeys = await d1LifetimeEmails(db);
  const recurringKeys = stripe ? stripe.keys : d1.keys;
  const paidPro = stripe ? stripe.paidPro : d1.paidPro;
  const lifetime = Math.max(d1.lifetime, lifetimeKeys.length);
  const overlap = overlapEstimate(recurringKeys, lifetimeKeys);
  const memberKeys = new Set<string>([...recurringKeys, ...lifetimeKeys]);
  const seats = Math.max(memberKeys.size, paidPro + lifetime - overlap);
  const mrr = stripe
    ? Math.round(stripe.mrrCents) / 100
    : Math.round(paidPro * PRO_MONTHLY_USD * 100) / 100;
  const developmentAvailable = seats >= MIN_DEV_PRO || mrr + 1e-9 >= MIN_DEV_USD;
  return {
    ok: true,
    paid_pro: paidPro,
    lifetime,
    paid_members: seats,
    mrr_usd: mrr,
    min_dev_pro: MIN_DEV_PRO,
    min_dev_usd: MIN_DEV_USD,
    best_dev_usd: BEST_DEV_USD,
    development_available: developmentAvailable,
    development_note: developmentAvailable
      ? `${seats} paid members (${paidPro} Pro · ${lifetime} Lifetime) · $${mrr.toFixed(2)}/mo funds Ava development. Best case $${BEST_DEV_USD}/mo also covers hardware.`
      : `${seats} paid members (${paidPro} Pro · ${lifetime} Lifetime) · $${mrr.toFixed(2)}/mo. Need ${MIN_DEV_PRO} paid members or $${MIN_DEV_USD}/mo. Award/unpaid Pro does not count.`,
    hardware_note:
      "Surplus toward $" +
      BEST_DEV_USD +
      "/mo helps Ava fund hardware upgrades for the solar host.",
    source: stripe ? "stripe" : "d1",
  };
}

function overlapEstimate(stripeKeys: string[], lifetimeKeys: string[]): number {
  const s = new Set(stripeKeys.filter((k) => k.startsWith("email:")));
  let n = 0;
  for (const k of lifetimeKeys) if (s.has(k)) n += 1;
  return n;
}
