/**
 * Stripe Checkout Session for web billing (subscription).
 * Requires Worker secret STRIPE_SECRET_KEY and var STRIPE_PRICE_ID (recurring Price).
 */

function stripeConfigured(secret: string | undefined, priceId: string | undefined): boolean {
  const s = (secret || "").trim();
  const p = (priceId || "").trim();
  if (!s.startsWith("sk_") || s.length < 30 || !p.startsWith("price_") || p.length < 14) return false;
  if (/REPLACE|SETME|PENDING|placeholder/i.test(p)) return false;
  return true;
}

export function billingCheckoutAvailable(env: {
  STRIPE_SECRET_KEY?: string;
  STRIPE_PRICE_ID?: string;
}): boolean {
  return stripeConfigured(env.STRIPE_SECRET_KEY, env.STRIPE_PRICE_ID);
}

export async function createStripeSubscriptionCheckout(params: {
  secretKey: string;
  priceId: string;
  customerEmail: string;
  accountId: string;
  siteUrl: string;
}): Promise<{ ok: true; url: string } | { ok: false; message: string }> {
  const site = params.siteUrl.replace(/\/+$/, "");
  const successUrl = `${site}/billing.html?checkout=success`;
  const cancelUrl = `${site}/billing.html?checkout=cancel`;

  const body = new URLSearchParams();
  body.set("mode", "subscription");
  body.set("customer_email", params.customerEmail.trim().toLowerCase());
  body.set("client_reference_id", params.accountId);
  body.set("metadata[account_id]", params.accountId);
  body.set("metadata[portal]", "rootrecord.info");
  body.set("line_items[0][price]", params.priceId.trim());
  body.set("line_items[0][quantity]", "1");
  body.set("success_url", successUrl);
  body.set("cancel_url", cancelUrl);
  body.set("allow_promotion_codes", "true");

  const res = await fetch("https://api.stripe.com/v1/checkout/sessions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${params.secretKey.trim()}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });

  const data = (await res.json()) as { url?: string; error?: { message?: string } };
  if (!res.ok) {
    const msg = data.error?.message || `Stripe HTTP ${res.status}`;
    return { ok: false, message: msg };
  }
  if (!data.url) {
    return { ok: false, message: "Stripe did not return a checkout URL." };
  }
  return { ok: true, url: data.url };
}

export function visitingHawaiiSponsoredCheckoutAvailable(env: {
  STRIPE_SECRET_KEY?: string;
  STRIPE_VISITING_HAWAII_SPONSORED_PRICE_ID?: string;
}): boolean {
  return stripeConfigured(env.STRIPE_SECRET_KEY, env.STRIPE_VISITING_HAWAII_SPONSORED_PRICE_ID);
}

/** Annual sponsored listing — $100/year subscription (configure Price in Stripe Dashboard). */
export async function createVisitingHawaiiSponsoredCheckout(params: {
  secretKey: string;
  priceId: string;
  customerEmail: string;
  accountId: string;
  listingId: string;
  siteUrl: string;
}): Promise<{ ok: true; url: string; sessionId: string } | { ok: false; message: string }> {
  const site = params.siteUrl.replace(/\/+$/, "");
  const listingQ = encodeURIComponent(params.listingId);
  const successUrl = `${site}/visiting-hawaii-sponsor.html?checkout=success&listing_id=${listingQ}`;
  const cancelUrl = `${site}/visiting-hawaii-sponsor.html?checkout=cancel&listing_id=${listingQ}`;

  const body = new URLSearchParams();
  body.set("mode", "subscription");
  body.set("customer_email", params.customerEmail.trim().toLowerCase());
  body.set("client_reference_id", params.accountId);
  body.set("metadata[account_id]", params.accountId);
  body.set("metadata[product]", "visiting_hawaii_sponsored");
  body.set("metadata[listing_id]", params.listingId);
  body.set("metadata[portal]", "visiting_hawaii_sponsor");
  body.set("line_items[0][price]", params.priceId.trim());
  body.set("line_items[0][quantity]", "1");
  body.set("success_url", successUrl);
  body.set("cancel_url", cancelUrl);
  body.set("allow_promotion_codes", "true");
  body.set("subscription_data[metadata][product]", "visiting_hawaii_sponsored");
  body.set("subscription_data[metadata][listing_id]", params.listingId);
  body.set("subscription_data[metadata][account_id]", params.accountId);

  const res = await fetch("https://api.stripe.com/v1/checkout/sessions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${params.secretKey.trim()}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });

  const data = (await res.json()) as { id?: string; url?: string; error?: { message?: string } };
  if (!res.ok) {
    const msg = data.error?.message || `Stripe HTTP ${res.status}`;
    return { ok: false, message: msg };
  }
  if (!data.url || !data.id) {
    return { ok: false, message: "Stripe did not return a checkout URL." };
  }
  return { ok: true, url: data.url, sessionId: data.id };
}
