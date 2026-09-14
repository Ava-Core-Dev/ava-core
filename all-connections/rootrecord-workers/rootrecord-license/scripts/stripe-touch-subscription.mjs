/**
 * Touch a subscription (metadata update) to force a `customer.subscription.updated` event.
 * Uses STRIPE_SECRET_KEY from the repo-root credentials.env.
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

const credPath = process.env.CREDENTIALS_ENV || "C:/Users/rrdeveloper/MonoRepo/credentials.env";
const env = readEnvFile(credPath);
const sk = String(env.STRIPE_SECRET_KEY || "").trim();
if (!sk.startsWith("sk_")) {
  console.error("Missing STRIPE_SECRET_KEY in credentials.env");
  process.exit(1);
}

const subId = (process.env.STRIPE_SUBSCRIPTION_ID || "").trim() || "sub_1TWSWdIaRpbMiAov2DRNwN6h";
const ts = Math.floor(Date.now() / 1000);
const body = new URLSearchParams();
body.set("metadata[rr_webhook_ping]", String(ts));

const res = await fetch(`https://api.stripe.com/v1/subscriptions/${encodeURIComponent(subId)}`, {
  method: "POST",
  headers: {
    Authorization: `Bearer ${sk}`,
    "Content-Type": "application/x-www-form-urlencoded",
  },
  body,
});

const j = await res.json().catch(() => ({}));
if (!res.ok) {
  console.error("Stripe HTTP", res.status, JSON.stringify(j));
  process.exit(1);
}
console.log(JSON.stringify({ ok: true, id: j.id, status: j.status, ping: ts }));

