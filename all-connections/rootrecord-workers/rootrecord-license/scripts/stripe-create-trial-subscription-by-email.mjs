/**
 * Create a real Stripe customer + subscription for an email, without charging,
 * by using a free trial window. This is NOT a fake event generator; it uses Stripe's API.
 *
 * Notes:
 * - This does not go through Stripe Checkout UI.
 * - Status should become `trialing` when the account allows trials without payment method.
 * - Requires STRIPE_SECRET_KEY + STRIPE_PRICE_ID in repo-root credentials.env.
 *
 * Usage:
 *   node scripts/stripe-create-trial-subscription-by-email.mjs --email you@example.com
 */
import fs from "node:fs";

function readEnvFile(p) {
  const out = {};
  const text = fs.readFileSync(p, "utf8");
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const i = line.indexOf("=");
    if (i <= 0) continue;
    const k = line.slice(0, i).trim();
    const v = line.slice(i + 1).trim();
    if (k) out[k] = v;
  }
  return out;
}

function arg(name) {
  const idx = process.argv.indexOf(name);
  if (idx === -1) return "";
  return String(process.argv[idx + 1] || "").trim();
}

async function stripeGet(sk, path, params) {
  const qs = params ? `?${new URLSearchParams(params).toString()}` : "";
  const res = await fetch(`https://api.stripe.com/v1${path}${qs}`, {
    headers: { Authorization: `Bearer ${sk}` },
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Stripe GET ${path} HTTP ${res.status}: ${JSON.stringify(j)}`);
  return j;
}

async function stripePost(sk, path, body) {
  const res = await fetch(`https://api.stripe.com/v1${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${sk}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Stripe POST ${path} HTTP ${res.status}: ${JSON.stringify(j)}`);
  return j;
}

const email = (arg("--email") || "").toLowerCase();
if (!email || !email.includes("@")) {
  console.error("Usage: node scripts/stripe-create-trial-subscription-by-email.mjs --email you@example.com");
  process.exit(1);
}

const credPath = process.env.CREDENTIALS_ENV || "C:/Users/rrdeveloper/MonoRepo/credentials.env";
const env = readEnvFile(credPath);
const sk = String(env.STRIPE_SECRET_KEY || "").trim();
const priceId = String(env.STRIPE_PRICE_ID || "").trim() || "price_1TQIpzIaRpbMiAov5g5iTPh9";
if (!sk.startsWith("sk_")) {
  console.error("Missing STRIPE_SECRET_KEY in credentials.env");
  process.exit(1);
}
if (!priceId.startsWith("price_")) {
  console.error("Missing STRIPE_PRICE_ID (and default fallback is not a price_ id).");
  process.exit(1);
}

// 1) Get or create customer
const customers = await stripeGet(sk, "/customers", { email, limit: "1" });
let cust = customers?.data?.[0] || null;
if (!cust?.id) {
  const body = new URLSearchParams();
  body.set("email", email);
  cust = await stripePost(sk, "/customers", body);
}

// 2) Create a subscription with a trial window (no immediate charge)
const trialDays = 32;
const subBody = new URLSearchParams();
subBody.set("customer", cust.id);
subBody.set("items[0][price]", priceId);
subBody.set("trial_period_days", String(trialDays));
// Create the subscription even if payment method is missing; exact state depends on account settings.
subBody.set("payment_behavior", "default_incomplete");
subBody.set("collection_method", "charge_automatically");
subBody.set("metadata[rr_created_by]", "script_trial_by_email");
subBody.set("metadata[rr_email]", email);

const sub = await stripePost(sk, "/subscriptions", subBody);
console.log(
  JSON.stringify({
    ok: true,
    email,
    customer: cust.id,
    subscription: sub.id,
    status: sub.status,
    trial_end: sub.trial_end ?? null,
  }),
);

