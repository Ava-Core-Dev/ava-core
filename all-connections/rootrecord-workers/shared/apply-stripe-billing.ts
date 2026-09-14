import type { BillingD1 } from "./billing-state";

/** Upsert billing fields from Stripe webhooks (same D1 as license + primary). */
export async function applyStripeBillingPatch(
  db: BillingD1,
  patch: {
    email: string;
    account_id: string;
    stripe_customer_id: string | null;
    stripe_subscription_id: string | null;
    subscription_status: string;
    pro_unlocked: boolean;
    life_member: boolean;
  }
): Promise<void> {
  const email = patch.email.trim().toLowerCase();
  const aid = patch.account_id.trim();
  if (!email || !aid) return;

  const now = new Date().toISOString();
  const existing = await db
    .prepare("SELECT id, created_at, life_member FROM user_accounts WHERE email = ?")
    .bind(email)
    .first<{ id: string; created_at: string; life_member: number | null }>();

  const id = existing?.id ?? crypto.randomUUID();
  const created_at = existing?.created_at ?? now;
  const life = Math.max(existing?.life_member === 1 ? 1 : 0, patch.life_member ? 1 : 0);
  const pro = patch.pro_unlocked ? 1 : 0;
  const sub = String(patch.subscription_status || "none").trim() || "none";
  const cus = patch.stripe_customer_id?.trim() || null;
  const subId = patch.stripe_subscription_id?.trim() || null;

  await db
    .prepare(
      `INSERT INTO user_accounts (
         id, email, account_id, created_at, updated_at, pro_unlocked, life_member, extra_json,
         stripe_customer_id, stripe_subscription_id, subscription_status
       )
       VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?)
       ON CONFLICT(email) DO UPDATE SET
         account_id = COALESCE(excluded.account_id, user_accounts.account_id),
         updated_at = excluded.updated_at,
         pro_unlocked = excluded.pro_unlocked,
         subscription_status = excluded.subscription_status,
         stripe_customer_id = COALESCE(excluded.stripe_customer_id, user_accounts.stripe_customer_id),
         stripe_subscription_id = excluded.stripe_subscription_id,
         life_member = MAX(user_accounts.life_member, excluded.life_member)`
    )
    .bind(id, email, aid, created_at, now, pro, life, cus, subId, sub)
    .run();
}
