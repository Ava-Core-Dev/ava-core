/**
 * Periodic finance review — errors, stale totals, missing categories.
 * Suggests updates to Alex via Telegram (not Discord spam).
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { loadEnv, telegramBotToken } from "./config.mjs";
import { storePaths } from "./store.mjs";
import { appendAction } from "./fullLog.mjs";
import {
  refreshStripeSnapshot,
  formatStripeIncomePlain,
  stripeConfigured,
  formatUsd,
  financeDir,
  explainStripeBalance,
} from "./stripeFinance.mjs";

/** Finance-review codes that mean Ava tooling is broken (not Stripe account state). */
const SELF_FIX_SUGGESTION_CODES = new Set(["stripe_unreadable"]);
import {
  loadOpsLedger,
  saveOpsLedger,
  summarizeOpsLedger,
} from "./opsFinanceLedger.mjs";

/** Default ~12h. Override AVA_FINANCE_REVIEW_MS. */
export function financeReviewIntervalMs() {
  const n = Number(process.env.AVA_FINANCE_REVIEW_MS || 12 * 60 * 60 * 1000);
  return Number.isFinite(n) && n >= 60 * 60 * 1000 ? n : 12 * 60 * 60 * 1000;
}

export function financeReviewBootDelayMs() {
  const n = Number(process.env.AVA_FINANCE_REVIEW_BOOT_MS || 90_000);
  return Number.isFinite(n) && n >= 10_000 ? n : 90_000;
}

function statePath() {
  return path.join(storePaths().dir, "finance-review.json");
}

function loadState() {
  try {
    if (!fs.existsSync(statePath())) {
      return { lastRunAt: 0, lastFingerprint: "", lastText: "" };
    }
    return JSON.parse(fs.readFileSync(statePath(), "utf8"));
  } catch {
    return { lastRunAt: 0, lastFingerprint: "", lastText: "" };
  }
}

function saveState(state) {
  fs.writeFileSync(statePath(), JSON.stringify(state, null, 2), "utf8");
}

function operatorChatId(env = {}) {
  return String(
    process.env.AVA_TELEGRAM_OPERATOR_CHAT_ID ||
      env.AVA_TELEGRAM_OPERATOR_CHAT_ID ||
      process.env.AVA_TELEGRAM_ALEX_CHAT_ID ||
      "6644482344",
  ).trim();
}

async function telegramSend(token, chatId, text) {
  const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text: String(text || "").slice(0, 3900),
      disable_web_page_preview: true,
    }),
  });
  const data = await res.json();
  if (!data.ok) throw new Error(data.description || "telegram_send_failed");
  return data.result;
}

const EXPECTED_EXPENSE_CATS = [
  { id: "exp-shockbyte", label: "Shockbyte hosting", category: "ops" },
  { id: "exp-domains", label: "Domains", category: "ops" },
  { id: "exp-cloudflare", label: "Cloudflare / Workers", category: "dev" },
  { id: "exp-power", label: "Power / home lab (OptiPlex)", category: "ops" },
  { id: "exp-apple-google", label: "App store / Google Play fees", category: "growth" },
];

/**
 * Build suggestion list from Stripe + ledger health.
 */
export function buildFinanceSuggestions({ snap, ledger } = {}) {
  const suggestions = [];
  const sum = summarizeOpsLedger(ledger || loadOpsLedger());

  if (!snap?.ok) {
    suggestions.push({
      severity: "warn",
      code: "stripe_unreadable",
      text: `Stripe snapshot failed or missing (${snap?.reason || "none"}). Check STRIPE_SECRET_KEY / API access.`,
      selfFixable: true,
    });
  } else {
    if ((snap.usdAvailable || 0) < 0) {
      const bal = explainStripeBalance(snap);
      // Penny-level fee timing with pending cover — healthy Stripe state; skip review noise.
      if (bal?.isTrivialNegative && bal?.pendingCoversDeficit) {
        /* no suggestion — not a tooling error, not operator action */
      } else {
        let severity = "warn";
        let text = `Stripe available ${formatUsd(snap.usdAvailable)} (pending ${formatUsd(snap.usdPending)}).`;

        if (bal?.pendingCoversDeficit) {
          severity = "warn";
          text = `Stripe available ${formatUsd(snap.usdAvailable)} — pending ${formatUsd(snap.usdPending)} covers it (fee/payout timing; not a tooling error).`;
          if (bal.feesInRecent > 0) {
            text += ` Recent Stripe fees ~${formatUsd(bal.feesInRecent)} in snapshot.`;
          }
        } else {
          text += " Review payouts/disputes in Stripe.";
          if (bal?.disputeCount) {
            text += ` ${bal.disputeCount} dispute/refund-like tx in recent window.`;
          }
          if (bal?.lastPayoutAmount) {
            text += ` Last payout ${formatUsd(bal.lastPayoutAmount)}.`;
          }
        }

        suggestions.push({
          severity,
          code: "negative_balance",
          text,
          selfFixable: false,
        });
      }
    }
    if ((snap.income30dUsd || 0) === 0) {
      suggestions.push({
        severity: "info",
        code: "zero_income_30d",
        text: "No Stripe credits seen in ~30d — confirm Pro funnel / webhook still live, or update if off-season.",
      });
    }
  }

  for (const id of sum.staleIds || []) {
    suggestions.push({
      severity: "info",
      code: `stale_${id}`,
      text: `Update amount/total for ledger row “${id}” (never set or older than ~45d).`,
    });
  }

  const expenses = ledger?.expenses || [];
  for (const expect of EXPECTED_EXPENSE_CATS) {
    const row = expenses.find((e) => e.id === expect.id);
    if (!row) {
      suggestions.push({
        severity: "info",
        code: `missing_${expect.id}`,
        text: `Consider adding expense “${expect.label}” (${expect.category}). Say: add ops expense ${expect.label} <amount>/mo`,
      });
    } else if (!row.amountUsd) {
      suggestions.push({
        severity: "info",
        code: `zero_${expect.id}`,
        text: `“${expect.label}” is still $0 — set the real monthly/annual total when you know it.`,
      });
    }
  }

  const other = ledger?.otherIncome || [];
  const generic = other.find((i) => i.id === "inc-other");
  if (generic && !generic.amountUsd) {
    suggestions.push({
      severity: "info",
      code: "other_income_blank",
      text: "Other non-Stripe income is $0 — add sponsors/ads/one-offs or remove the placeholder.",
    });
  }

  // Ava slice sanity vs routing doc (10–15% of 30d stripe income as soft check)
  if (snap?.ok && snap.income30dUsd > 0) {
    const sliceLo = snap.income30dUsd * 0.1;
    const sliceHi = snap.income30dUsd * 0.15;
    suggestions.push({
      severity: "info",
      code: "ava_slice_band",
      text: `Ava allocation band on ~30d Stripe credits: ${formatUsd(sliceLo)}–${formatUsd(sliceHi)} (10–15%). Confirm routing still matches AVA-FINANCE-ROUTING-v1.`,
    });
  }

  return suggestions.slice(0, 12);
}

function fingerprintSuggestions(list) {
  const raw = list.map((s) => `${s.severity}:${s.code}`).sort().join("|");
  return crypto.createHash("sha256").update(raw).digest("hex").slice(0, 24);
}

function formatReviewMessage({ snap, suggestions, sum }) {
  const lines = [
    "Ava — finance review",
    new Date().toISOString(),
    "",
    formatStripeIncomePlain(snap),
    "",
    `Ops expenses ~${formatUsd(sum.expensesMonthlyUsd)}/mo · other income ~${formatUsd(sum.otherIncomeMonthlyUsd)}/mo`,
    "",
    "Suggestions:",
  ];
  if (!suggestions.length) {
    lines.push("- All quiet — no new errors/improvements flagged.");
  } else {
    for (const s of suggestions) {
      lines.push(`- [${s.severity}] ${s.text}`);
    }
  }
  lines.push("");
  lines.push(
    "Reply: add ops expense <label> <amt>/mo · add ops income <label> <amt>/mo",
  );
  lines.push("— Ava");
  return lines.join("\n");
}

/**
 * @param {{ force?: boolean, env?: object, notify?: boolean }} opts
 */
export async function runFinanceReview(opts = {}) {
  try {
    const { isLockoutActive } = await import("./lockoutMode.mjs");
    // Lockout = uninterrupted 1:1 — still compute locally, never Telegram-notify.
    if (isLockoutActive() && opts.notify !== true) {
      opts = { ...opts, notify: false };
    }
  } catch {
    /* ignore */
  }
  const env = opts.env || (await loadEnv());
  const force = Boolean(opts.force);
  const notify = opts.notify !== false;

  const state = loadState();
  if (!force && state.lastRunAt && Date.now() - state.lastRunAt < financeReviewIntervalMs() * 0.5) {
    return { ok: true, skipped: true, reason: "too_soon" };
  }

  ensureFinanceReadme();

  const snap = stripeConfigured(env)
    ? await refreshStripeSnapshot(env, { force: true })
    : { ok: false, reason: "stripe_not_configured" };

  try {
    const { cancelStaleFinanceSelfFixes } = await import("./selfFix.mjs");
    cancelStaleFinanceSelfFixes(snap);
  } catch {
    /* non-fatal */
  }

  const ledger = loadOpsLedger();
  const sum = summarizeOpsLedger(ledger);
  const suggestions = buildFinanceSuggestions({ snap, ledger });
  const fp = fingerprintSuggestions(suggestions);

  ledger.lastSuggestionAt = Date.now();
  ledger.lastSuggestions = suggestions;
  saveOpsLedger(ledger);

  // Tooling errors only — never self-fix normal Stripe account states (fees/payouts).
  try {
    const { enqueueSelfFix } = await import("./selfFix.mjs");
    for (const s of suggestions) {
      if (s.selfFixable === false) continue;
      if (!SELF_FIX_SUGGESTION_CODES.has(s.code)) continue;
      enqueueSelfFix({
        brief: `Finance review tooling error — investigate and fix Ava-owned code if needed: ${s.text}`,
        source: "finance_review",
        priority: "high",
      });
    }
  } catch {
    /* non-fatal */
  }

  const text = formatReviewMessage({ snap, suggestions, sum });
  fs.writeFileSync(
    path.join(financeDir(), "last-review.txt"),
    text,
    "utf8",
  );

  let sent = false;
  let reason = "ok";
  if (notify && suggestions.length && fp !== state.lastFingerprint) {
    const token = telegramBotToken(env);
    const chatId = operatorChatId(env);
    if (token && chatId) {
      try {
        await telegramSend(token, chatId, text);
        sent = true;
        reason = "telegram_sent";
      } catch (err) {
        reason = err.message || "telegram_failed";
      }
    } else {
      reason = "telegram_not_configured";
    }
  } else if (!suggestions.length) {
    reason = "quiet";
  } else if (fp === state.lastFingerprint) {
    reason = "unchanged";
  }

  saveState({
    lastRunAt: Date.now(),
    lastFingerprint: fp,
    lastText: text.slice(0, 2000),
    lastReason: reason,
    sent,
  });

  appendAction("financeReview", {
    sent,
    reason,
    suggestionCount: suggestions.length,
    stripeOk: Boolean(snap?.ok),
  });

  return {
    ok: true,
    sent,
    reason,
    suggestions,
    snap,
    sum,
  };
}

function ensureFinanceReadme() {
  const readme = path.join(financeDir(), "README.txt");
  if (fs.existsSync(readme)) return;
  fs.writeFileSync(
    readme,
    [
      "Ava finance buckets",
      "stripe-snapshot.json — cached Stripe balance + recent txs",
      "ops-ledger.json — expenses + other income (manual)",
      "last-review.txt — latest periodic review text",
      "",
      "Player personal finance lives on data/players/<discordId>.json → finance{}",
      "Never commit .env / Stripe secrets.",
    ].join("\n"),
    "utf8",
  );
}
