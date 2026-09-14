import type { D1Database } from "@cloudflare/workers-types";

import {
  clearProPaidUntil,
  extendProPaidUntil,
  upsertUserAccountFromLicense,
} from "./accounts";
import { applyStripeBillingPatch } from "../../shared/apply-stripe-billing";
import {
  PRO_VOUCHER_ITEM_LIFE,
  PRO_VOUCHER_ITEM_MONTH,
  queueProVoucherToVault,
  resolveBeneficiaryByMinecraftUsername,
  voidOrRevokeVouchersForStripeObject,
  type ProVoucherTier,
} from "../../shared/rootmc-pro-billing";

export {
  PRO_VOUCHER_ITEM_LIFE,
  PRO_VOUCHER_ITEM_MONTH,
  queueProVoucherToVault,
  resolveBeneficiaryByMinecraftUsername,
  voidOrRevokeVouchersForStripeObject,
};
export type { ProVoucherTier };

export const PRO_VOUCHER_ONE_MONTH_DAYS = 30;

export function tierFromItemKey(itemKey: string): ProVoucherTier | null {
  const k = itemKey.trim().toUpperCase();
  if (k === PRO_VOUCHER_ITEM_LIFE) return "lifetime";
  if (k === PRO_VOUCHER_ITEM_MONTH) return "one_month";
  return null;
}

export async function markProVoucherClaimed(db: D1Database, voucherId: string): Promise<void> {
  const now = new Date().toISOString();
  await db
    .prepare(
      `UPDATE rootmc_pro_vouchers SET status = 'claimed', claimed_at = ?
       WHERE id = ? AND status = 'pending_vault'`,
    )
    .bind(now, voucherId)
    .run();
}

export async function redeemProVoucher(
  db: D1Database,
  input: { voucherId: string; accountId: string; email: string },
): Promise<{ ok: true; tier: ProVoucherTier; pro_paid_until?: string | null } | { ok: false; detail: string }> {
  const id = input.voucherId.trim();
  if (!id) return { ok: false, detail: "voucher_id required" };

  const row = await db
    .prepare(
      `SELECT id, tier, account_id, email, status FROM rootmc_pro_vouchers WHERE id = ? LIMIT 1`,
    )
    .bind(id)
    .first<{
      id: string;
      tier: string;
      account_id: string;
      email: string | null;
      status: string;
    }>();

  if (!row) return { ok: false, detail: "voucher not found" };
  if (row.status === "redeemed") return { ok: false, detail: "already redeemed" };
  if (row.status === "voided") return { ok: false, detail: "voucher voided" };
  if (row.status !== "claimed" && row.status !== "pending_vault") {
    return { ok: false, detail: `invalid status ${row.status}` };
  }

  const tier = (row.tier === "lifetime" ? "lifetime" : "one_month") as ProVoucherTier;
  const email = input.email.trim().toLowerCase();
  if (!email) return { ok: false, detail: "no account email" };

  const now = new Date().toISOString();

  if (tier === "lifetime") {
    await applyStripeBillingPatch(db, {
      email,
      account_id: input.accountId,
      stripe_customer_id: null,
      stripe_subscription_id: null,
      subscription_status: "none",
      pro_unlocked: true,
      life_member: true,
    });
  } else {
    await upsertUserAccountFromLicense(db, {
      email,
      account_id: input.accountId,
      pro_unlocked: false,
      life_member: false,
      extra: { source: "pro_voucher_redeem" },
    });
    const until = await extendProPaidUntil(db, email, PRO_VOUCHER_ONE_MONTH_DAYS);
    await db
      .prepare(
        `UPDATE rootmc_pro_vouchers
         SET status = 'redeemed', redeemed_at = ?, account_id = ?, email = ?
         WHERE id = ?`,
      )
      .bind(now, input.accountId, email, id)
      .run();
    return { ok: true, tier, pro_paid_until: until };
  }

  await db
    .prepare(
      `UPDATE rootmc_pro_vouchers
       SET status = 'redeemed', redeemed_at = ?, account_id = ?, email = ?
       WHERE id = ?`,
    )
    .bind(now, input.accountId, email, id)
    .run();

  return { ok: true, tier, pro_paid_until: null };
}

/** Clear paid window helper for dispute paths that already used shared void. */
export { clearProPaidUntil };
