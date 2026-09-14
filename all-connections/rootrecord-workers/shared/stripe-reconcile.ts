import type { BillingD1 } from "./billing-state";

import { applyStripeBillingPatch } from "./apply-stripe-billing";

function paidSubscriptionStatuses(): Set<string> {
  return new Set(["active", "trialing"]);
}

async function stripeGet(secret: string, path: string): Promise<Record<string, unknown> | null> {
  const res = await fetch(`https://api.stripe.com/v1${path}`, {
    headers: { Authorization: `Bearer ${secret.trim()}` },
  });
  const data = (await res.json()) as Record<string, unknown>;
  if (!res.ok) return null;
  return data;
}

export async function reconcileStaleStripeSubscriptions(params: {
  db: BillingD1;
  stripeSecretKey: string;
  staleAfterDays: number;
  limit: number;
}): Promise<{ checked: number; updated: number }> {
  const sk = params.stripeSecretKey.trim();
  if (!sk.startsWith("sk_")) return { checked: 0, updated: 0 };

  const days = Math.max(1, Math.floor(params.staleAfterDays || 32));
  const limit = Math.max(1, Math.min(250, Math.floor(params.limit || 50)));
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

  const res = await params.db
    .prepare(
      `SELECT email, account_id, stripe_subscription_id, stripe_customer_id
         FROM user_accounts
         WHERE life_member = 0
           AND stripe_subscription_id IS NOT NULL
           AND stripe_subscription_id != ''
           AND updated_at < ?
         ORDER BY updated_at ASC
         LIMIT ?`,
    )
    .bind(cutoff, limit)
    .all<{
      email: string;
      account_id: string | null;
      stripe_subscription_id: string;
      stripe_customer_id: string | null;
    }>();
  const rows = res.results ?? [];

  let updated = 0;
  for (const r of rows) {
    const email = String(r.email || "").trim().toLowerCase();
    const account_id = String(r.account_id || "").trim();
    const subId = String(r.stripe_subscription_id || "").trim();
    const custId = String(r.stripe_customer_id || "").trim() || null;
    if (!email || !account_id || !subId) continue;

    const sub = await stripeGet(sk, `/subscriptions/${encodeURIComponent(subId)}`);
    if (!sub) continue;

    const st = typeof sub.status === "string" ? sub.status : "unknown";
    const pro = paidSubscriptionStatuses().has(st);
    await applyStripeBillingPatch(params.db, {
      email,
      account_id,
      stripe_customer_id: custId,
      stripe_subscription_id: subId,
      subscription_status: st,
      pro_unlocked: pro,
      life_member: false,
    });
    updated++;
  }

  return { checked: rows.length, updated };
}

