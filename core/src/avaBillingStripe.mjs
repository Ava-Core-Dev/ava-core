/**
 * Stripe rail for Ava prepaid credits (separate from RootMC Pro membership).
 * Framework: Checkout Session with price_data — no new live products until enabled.
 *
 * Env:
 *   STRIPE_SECRET_KEY (existing)
 *   AVA_STRIPE_CREDITS_ENABLED=1
 *   AVA_STRIPE_CREDIT_SUCCESS_URL / AVA_STRIPE_CREDIT_CANCEL_URL
 *   AVA_STRIPE_CREDIT_PACK_PAYMENT_LINK  (optional prebuilt Payment Link)
 */
import { creditAccount } from "./avaCredits.mjs";

const STRIPE_API = "https://api.stripe.com/v1";

function envTrim(...keys) {
  for (const k of keys) {
    const v = String(process.env[k] || "").trim();
    if (v) return v;
  }
  return "";
}

export function avaStripeCreditsEnabled() {
  const v = String(process.env.AVA_STRIPE_CREDITS_ENABLED || "").trim();
  return v === "1" || /^true$/i.test(v);
}

export function stripeCreditsConfigured() {
  return Boolean(envTrim("STRIPE_SECRET_KEY"));
}

async function stripeForm(route, fields = {}) {
  const key = envTrim("STRIPE_SECRET_KEY");
  if (!key) throw new Error("stripe_secret_missing");
  const body = new URLSearchParams();
  for (const [k, v] of Object.entries(fields)) {
    if (v == null || v === "") continue;
    body.set(k, String(v));
  }
  const res = await fetch(`${STRIPE_API}${route}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/x-www-form-urlencoded",
      "Stripe-Version": "2024-11-20.acacia",
    },
    body,
    signal: AbortSignal.timeout(25_000),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data?.error?.message || `stripe_http_${res.status}`);
  }
  return data;
}

/** Static Payment Link if you pre-create one in Stripe Dashboard. */
export function stripeCreditPackLink() {
  return envTrim("AVA_STRIPE_CREDIT_PACK_PAYMENT_LINK");
}

/**
 * Create a Checkout Session for Ava credits (USD).
 * @returns {Promise<{ ok: boolean, url?: string, sessionId?: string, reason?: string }>}
 */
export async function createAvaCreditsCheckout({
  accountId = "",
  amountUsd = 5,
  customerEmail = "",
} = {}) {
  if (!avaStripeCreditsEnabled()) {
    return { ok: false, reason: "stripe_credits_disabled" };
  }
  if (!stripeCreditsConfigured()) {
    return { ok: false, reason: "stripe_not_configured" };
  }
  const packLink = stripeCreditPackLink();
  if (packLink) {
    return { ok: true, url: packLink, sessionId: null, mode: "payment_link" };
  }

  const usd = Math.max(1, Math.min(500, Number(amountUsd) || 5));
  const cents = Math.round(usd * 100);
  const success =
    envTrim("AVA_STRIPE_CREDIT_SUCCESS_URL") ||
    "https://rootmc.net/pro/?ava_credits=ok";
  const cancel =
    envTrim("AVA_STRIPE_CREDIT_CANCEL_URL") ||
    "https://rootmc.net/pro/?ava_credits=cancel";

  try {
    const session = await stripeForm("/checkout/sessions", {
      mode: "payment",
      success_url: success,
      cancel_url: cancel,
      client_reference_id: String(accountId || "").slice(0, 200),
      "metadata[ava_credits]": "1",
      "metadata[account_id]": String(accountId || "").slice(0, 120),
      "metadata[credits_usd]": String(usd),
      "line_items[0][quantity]": "1",
      "line_items[0][price_data][currency]": "usd",
      "line_items[0][price_data][unit_amount]": String(cents),
      "line_items[0][price_data][product_data][name]": `Ava usage credits ($${usd})`,
      ...(customerEmail
        ? { customer_email: String(customerEmail).slice(0, 200) }
        : {}),
    });
    return {
      ok: true,
      url: session.url,
      sessionId: session.id,
      mode: "checkout_session",
      amountUsd: usd,
    };
  } catch (err) {
    return { ok: false, reason: err?.message || "stripe_checkout_failed" };
  }
}

/**
 * Apply a verified Stripe payment into the ledger (webhook / ops).
 * Call only after Stripe signature verification upstream.
 */
export function applyStripeCreditTopup({
  accountId,
  amountUsd,
  sessionId = "",
  paymentIntent = "",
} = {}) {
  return creditAccount({
    accountId,
    amountUsd,
    reason: "stripe_topup",
    provider: "stripe",
    externalId: sessionId || paymentIntent || "",
    meta: { sessionId, paymentIntent },
  });
}
