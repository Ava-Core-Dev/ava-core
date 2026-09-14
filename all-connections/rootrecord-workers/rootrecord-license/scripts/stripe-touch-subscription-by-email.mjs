/**
 * Touch the most recent subscription for a given customer email (metadata update),
 * forcing a `customer.subscription.updated` event, with no charge.
 *
 * Usage:
 *   node scripts/stripe-touch-subscription-by-email.mjs --email you@example.com
 *
 * Reads STRIPE_SECRET_KEY from repo-root credentials.env.
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
  console.error("Usage: node scripts/stripe-touch-subscription-by-email.mjs --email you@example.com");
  process.exit(1);
}

const credPath = process.env.CREDENTIALS_ENV || "C:/Users/rrdeveloper/MonoRepo/credentials.env";
const env = readEnvFile(credPath);
const sk = String(env.STRIPE_SECRET_KEY || "").trim();
if (!sk.startsWith("sk_")) {
  console.error("Missing STRIPE_SECRET_KEY in credentials.env");
  process.exit(1);
}

const customers = await stripeGet(sk, "/customers", { email, limit: "1" });
const cust = customers?.data?.[0];
if (!cust?.id) {
  console.error(`No Stripe customer found for ${email}`);
  process.exit(1);
}

const subs = await stripeGet(sk, "/subscriptions", { customer: cust.id, status: "all", limit: "1" });
const sub = subs?.data?.[0];
if (!sub?.id) {
  console.error(`No Stripe subscription found for customer ${cust.id} (${email})`);
  process.exit(1);
}

const ts = Math.floor(Date.now() / 1000);
const body = new URLSearchParams();
body.set("metadata[rr_webhook_ping]", String(ts));
body.set("metadata[rr_webhook_ping_email]", email);

const updated = await stripePost(sk, `/subscriptions/${encodeURIComponent(sub.id)}`, body);
console.log(JSON.stringify({ ok: true, email, customer: cust.id, subscription: updated.id, status: updated.status, ping: ts }));

