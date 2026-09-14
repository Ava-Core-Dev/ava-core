/**
 * Signed POST to production /v1/billing/webhook (uses STRIPE_WEBHOOK_SECRET from env).
 * Event: customer.subscription.updated for an existing user_accounts.stripe_subscription_id row.
 */
import crypto from "crypto";

const url = process.env.WEBHOOK_URL || "https://rootrecord-license.rootrecord.workers.dev/v1/billing/webhook";
const whsec = (process.env.STRIPE_WEBHOOK_SECRET || "").trim();
if (!whsec.startsWith("whsec_")) {
  console.error("Set STRIPE_WEBHOOK_SECRET (whsec_…)");
  process.exit(1);
}

const subId = process.env.STRIPE_SMOKE_SUBSCRIPTION_ID || "sub_1TWSWdIaRpbMiAov2DRNwN6h";
const custId = process.env.STRIPE_SMOKE_CUSTOMER_ID || "cus_UVTOP3Wqcirnmo";

const payload = JSON.stringify({
  id: `evt_smoke_${Date.now()}`,
  object: "event",
  type: "customer.subscription.updated",
  data: {
    object: {
      id: subId,
      object: "subscription",
      customer: custId,
      status: "active",
    },
  },
});

const t = Math.floor(Date.now() / 1000);
const signed = `${t}.${payload}`;
const v1 = crypto.createHmac("sha256", whsec).update(signed, "utf8").digest("hex");
const sig = `t=${t},v1=${v1}`;

const res = await fetch(url, {
  method: "POST",
  headers: {
    "Content-Type": "application/json; charset=utf-8",
    "Stripe-Signature": sig,
  },
  body: payload,
});

const text = await res.text();
console.log(res.status, text);
