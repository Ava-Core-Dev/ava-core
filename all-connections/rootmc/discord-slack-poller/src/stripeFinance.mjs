/**
 * Read-only Stripe finance for Ava (RootMC Pro / membership income).
 * Secrets from RootMC .env via loadEnv — never log raw keys or dump to Discord public.
 */
import fs from "node:fs";
import path from "node:path";
import { storePaths } from "./store.mjs";
import { appendAction } from "./fullLog.mjs";

const STRIPE_API = "https://api.stripe.com/v1";

function financeDir() {
  const dir = path.join(storePaths().dir, "finance");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function snapshotPath() {
  return path.join(financeDir(), "stripe-snapshot.json");
}

export function stripeSecretKey(env = {}) {
  return String(
    process.env.STRIPE_SECRET_KEY || env.STRIPE_SECRET_KEY || "",
  ).trim();
}

export function stripeConfigured(env = {}) {
  return Boolean(stripeSecretKey(env));
}

async function stripeGet(env, route, params = {}) {
  const key = stripeSecretKey(env);
  if (!key) throw new Error("stripe_secret_missing");
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v == null || v === "") continue;
    qs.set(k, String(v));
  }
  const url = `${STRIPE_API}${route}${qs.toString() ? `?${qs}` : ""}`;
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${key}`,
      "Stripe-Version": "2024-11-20.acacia",
    },
  });
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`stripe_bad_json_${res.status}`);
  }
  if (!res.ok) {
    const msg = data?.error?.message || `stripe_http_${res.status}`;
    throw new Error(msg);
  }
  return data;
}

function centsToUsd(cents) {
  const n = Number(cents) || 0;
  return Math.round(n) / 100;
}

function formatUsd(n) {
  const v = Number(n) || 0;
  return `$${v.toFixed(2)}`;
}

/**
 * Pull Balance + recent balance_transactions; cache snapshot locally.
 */
export async function refreshStripeSnapshot(env = {}, { force = false } = {}) {
  if (!stripeConfigured(env)) {
    return { ok: false, reason: "stripe_not_configured" };
  }

  let prev = null;
  try {
    if (fs.existsSync(snapshotPath())) {
      prev = JSON.parse(fs.readFileSync(snapshotPath(), "utf8"));
    }
  } catch {
    prev = null;
  }

  const maxAgeMs = Number(process.env.AVA_STRIPE_CACHE_MS || 15 * 60 * 1000);
  if (
    !force &&
    prev?.ok &&
    prev.fetchedAt &&
    Date.now() - prev.fetchedAt < maxAgeMs
  ) {
    return prev;
  }

  try {
    const [balance, txs] = await Promise.all([
      stripeGet(env, "/balance"),
      stripeGet(env, "/balance_transactions", {
        limit: "40",
      }),
    ]);

    const available = (balance.available || []).map((b) => ({
      currency: b.currency,
      amount: centsToUsd(b.amount),
    }));
    const pending = (balance.pending || []).map((b) => ({
      currency: b.currency,
      amount: centsToUsd(b.amount),
    }));

    const usdAvail = available
      .filter((b) => b.currency === "usd")
      .reduce((s, b) => s + b.amount, 0);
    const usdPending = pending
      .filter((b) => b.currency === "usd")
      .reduce((s, b) => s + b.amount, 0);

    let income30d = 0;
    let fee30d = 0;
    let payout30d = 0;
    const cutoff = Date.now() / 1000 - 30 * 86400;
    const recent = [];
    for (const t of txs.data || []) {
      const created = Number(t.created) || 0;
      const amt = centsToUsd(t.amount);
      const fee = centsToUsd(t.fee);
      if (created >= cutoff) {
        if (t.type === "charge" || t.type === "payment" || t.net > 0) {
          if (amt > 0) income30d += amt;
        }
        if (t.type === "payout") payout30d += Math.abs(amt);
        fee30d += Math.abs(fee);
      }
      recent.push({
        id: t.id,
        type: t.type,
        amount: amt,
        fee,
        net: centsToUsd(t.net),
        currency: t.currency,
        created: created * 1000,
        description: String(t.description || "").slice(0, 120),
      });
    }

    const snap = {
      ok: true,
      fetchedAt: Date.now(),
      available,
      pending,
      usdAvailable: usdAvail,
      usdPending: usdPending,
      income30dUsd: Math.round(income30d * 100) / 100,
      fees30dUsd: Math.round(fee30d * 100) / 100,
      payouts30dUsd: Math.round(payout30d * 100) / 100,
      recent: recent.slice(0, 25),
      source: "stripe_balance_api",
    };
    fs.writeFileSync(snapshotPath(), JSON.stringify(snap, null, 2), "utf8");
    appendAction("stripeFinance.refresh", {
      usdAvailable: snap.usdAvailable,
      income30dUsd: snap.income30dUsd,
    });
    return snap;
  } catch (err) {
    const fail = {
      ok: false,
      reason: err.message || "stripe_error",
      fetchedAt: Date.now(),
      previous: prev?.ok ? { usdAvailable: prev.usdAvailable, income30dUsd: prev.income30dUsd } : null,
    };
    appendAction("stripeFinance.error", { reason: fail.reason });
    return fail;
  }
}

export function loadStripeSnapshot() {
  try {
    if (!fs.existsSync(snapshotPath())) return null;
    return JSON.parse(fs.readFileSync(snapshotPath(), "utf8"));
  } catch {
    return null;
  }
}

const DISPUTE_TYPES = new Set([
  "dispute",
  "dispute_reversal",
  "payment_refund",
  "refund",
]);

/**
 * Context for negative/tight Stripe balances (account state — not Ava tooling).
 */
export function explainStripeBalance(snap) {
  if (!snap?.ok) return null;
  const avail = Number(snap.usdAvailable) || 0;
  const pending = Number(snap.usdPending) || 0;
  const recent = Array.isArray(snap.recent) ? snap.recent : [];

  let feesInRecent = 0;
  let disputeCount = 0;
  let lastPayout = null;
  for (const t of recent) {
    const type = String(t.type || "");
    const amt = Math.abs(Number(t.amount) || 0);
    if (type === "stripe_fee") feesInRecent += amt;
    if (DISPUTE_TYPES.has(type) || /dispute|chargeback/i.test(t.description || "")) {
      disputeCount += 1;
    }
    if (type === "payout" && !lastPayout) lastPayout = t;
  }

  const deficit = avail < 0 ? Math.abs(avail) : 0;
  const feesRounded = Math.round(feesInRecent * 100) / 100;
  const pendingCoversDeficit = avail < 0 && pending >= deficit;
  const isTrivialNegative = avail < 0 && deficit <= 1;
  return {
    avail,
    pending,
    deficit,
    feesInRecent: feesRounded,
    disputeCount,
    lastPayoutAmount: lastPayout ? Number(lastPayout.amount) || 0 : null,
    pendingCoversDeficit,
    isTrivialNegative,
    isFeeTiming:
      avail < 0 && pendingCoversDeficit && (isTrivialNegative || deficit <= feesRounded),
    healthyTiming: isTrivialNegative && pendingCoversDeficit && disputeCount === 0,
  };
}

/** Human-readable summary for operator asks (Telegram / Slack / DM). */
export function formatStripeIncomePlain(snap) {
  if (!snap?.ok) {
    return snap?.reason
      ? `Stripe read unavailable (${snap.reason}).`
      : "Stripe not configured yet.";
  }
  const ageMin = Math.round((Date.now() - (snap.fetchedAt || 0)) / 60000);
  const lines = [
    `Stripe available: ${formatUsd(snap.usdAvailable)} (pending ${formatUsd(snap.usdPending)})`,
    `~30d gross credits: ${formatUsd(snap.income30dUsd)} · fees ~${formatUsd(snap.fees30dUsd)} · payouts ~${formatUsd(snap.payouts30dUsd)}`,
    `Snapshot age: ${ageMin}m`,
  ];
  const bal = explainStripeBalance(snap);
  if (bal?.healthyTiming) {
    lines.push(
      "Fee/payout timing — pending covers the penny deficit; healthy, not a tooling error.",
    );
  }
  return lines.join("\n");
}

export { formatUsd, centsToUsd, financeDir };
