/**
 * Gate + charge Ava LLM usage against prepaid credits.
 *
 * Env:
 *   AVA_USAGE_BILLING=1          enforce/charge credits (default off — framework only)
 *   AVA_BILLING_OPS_BYPASS=1     Alex/ops never blocked (default on)
 *   AVA_BILLING_SOFT_MODE=1      log charge but never block (default on until launch)
 */
import { debitAccount, getCreditBalance, normalizeAccountId } from "./avaCredits.mjs";
import { estimateLlmCost, monthLlmCostBrief, recordLlmCost } from "./llmCost.mjs";

function envOn(key, defaultOn = false) {
  const v = String(process.env[key] ?? (defaultOn ? "1" : "0")).trim();
  if (v === "1" || /^true$/i.test(v) || /^on$/i.test(v)) return true;
  if (v === "0" || /^false$/i.test(v) || /^off$/i.test(v)) return false;
  return defaultOn;
}

export function usageBillingEnabled() {
  return envOn("AVA_USAGE_BILLING", false);
}

export function billingOpsBypass() {
  return envOn("AVA_BILLING_OPS_BYPASS", true);
}

export function billingSoftMode() {
  return envOn("AVA_BILLING_SOFT_MODE", true);
}

export function accountIdForUser({
  authorId = "",
  surface = "",
  isOps = false,
} = {}) {
  if (isOps) return "ops:alex";
  const surf = String(surface || "unknown").toLowerCase().slice(0, 24);
  return normalizeAccountId(`${surf}:${authorId || "anon"}`);
}

/**
 * Pre-check before an LLM call. Soft mode never blocks.
 * @returns {{ ok: boolean, reason?: string, balanceUsd?: number, needUsd?: number }}
 */
export function canAffordUsage({
  accountId,
  sellUsd = 0,
  isOps = false,
} = {}) {
  if (!usageBillingEnabled()) return { ok: true, reason: "billing_off" };
  if (isOps && billingOpsBypass()) return { ok: true, reason: "ops_bypass" };
  if (billingSoftMode()) return { ok: true, reason: "soft_mode" };
  const need = Number(sellUsd || 0) || estimateLlmCost({}).sellUsd;
  const bal = getCreditBalance(accountId);
  if (bal.balanceUsd + 1e-9 >= need) {
    return { ok: true, balanceUsd: bal.balanceUsd, needUsd: need };
  }
  return {
    ok: false,
    reason: "insufficient_credits",
    balanceUsd: bal.balanceUsd,
    needUsd: need,
  };
}

/**
 * Record cost meter + optional credit debit after a successful LLM turn.
 */
export function settleLlmUsage({
  accountId = "anon",
  provider = "",
  model = "",
  surface = "",
  systemChars = 0,
  userChars = 0,
  replyChars = 0,
  usage = null,
  isOps = false,
} = {}) {
  const cost = estimateLlmCost({
    provider,
    model,
    systemChars,
    userChars,
    replyChars,
    usage,
  });
  recordLlmCost({
    provider,
    model,
    surface,
    accountId,
    ...cost,
  });

  let debit = { ok: true, reason: "skipped", skipped: true };
  if (usageBillingEnabled() && !(isOps && billingOpsBypass())) {
    debit = debitAccount({
      accountId,
      amountUsd: cost.sellUsd,
      reason: "llm_usage",
      provider: String(provider || "ava"),
      allowNegative: billingSoftMode(),
      meta: {
        model,
        surface,
        costUsd: cost.costUsd,
        sellUsd: cost.sellUsd,
        soft: billingSoftMode(),
      },
    });
  }

  return { cost, debit, month: monthLlmCostBrief() };
}

export function formatCostReport() {
  const m = monthLlmCostBrief();
  const lines = [
    `Ava LLM · ${m.month}`,
    `calls: ${m.calls}`,
    `cost: $${m.costUsd.toFixed(6)}`,
    `sell (2× target): $${m.sellUsd.toFixed(6)}`,
    `profit: $${m.profitUsd.toFixed(6)}`,
    `margin mult: ${m.marginMult}×`,
    `billing: ${usageBillingEnabled() ? "ON" : "off"} · soft: ${billingSoftMode() ? "yes" : "no"} · ops bypass: ${billingOpsBypass() ? "yes" : "no"}`,
    `rails: Stripe + Solana (framework)`,
  ];
  return lines.join("\n");
}
