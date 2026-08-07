/**
 * Solana rail for Ava prepaid credits (framework — live verify later).
 *
 * Env:
 *   AVA_SOLANA_CREDITS_ENABLED=1
 *   AVA_SOLANA_CREDITS_TREASURY   (pubkey that receives SOL/USDC)
 *   SOLANA_RPC_URL               (existing)
 *   ROOTRECORD_SOLANA_TX_URL     (existing worker — optional helper)
 *   AVA_SOLANA_CREDIT_USD_PER_SOL  (fallback price if oracle down)
 */
import { creditAccount } from "./avaCredits.mjs";

function envTrim(...keys) {
  for (const k of keys) {
    const v = String(process.env[k] || "").trim();
    if (v) return v;
  }
  return "";
}

export function avaSolanaCreditsEnabled() {
  const v = String(process.env.AVA_SOLANA_CREDITS_ENABLED || "").trim();
  return v === "1" || /^true$/i.test(v);
}

export function solanaCreditsConfigured() {
  return Boolean(
    envTrim("AVA_SOLANA_CREDITS_TREASURY") && envTrim("SOLANA_RPC_URL"),
  );
}

export function solanaCreditsTreasury() {
  return envTrim("AVA_SOLANA_CREDITS_TREASURY");
}

/** Memo / deep-link instructions until full pay UI ships. */
export function solanaTopupBrief({ accountId = "", usdHint = 5 } = {}) {
  const treasury = solanaCreditsTreasury() || "(set AVA_SOLANA_CREDITS_TREASURY)";
  const enabled = avaSolanaCreditsEnabled();
  return [
    `Solana credits: ${enabled ? "ENABLED" : "framework (off)"}`,
    `treasury: ${treasury}`,
    `tag/memo: ava-credits:${String(accountId || "you").slice(0, 64)}`,
    `hint amount: ~$${Number(usdHint) || 5} (USDC preferred when wired)`,
    `rpc: ${envTrim("SOLANA_RPC_URL") ? "configured" : "missing"}`,
    `worker: ${envTrim("ROOTRECORD_SOLANA_TX_URL") ? "configured" : "—"}`,
  ].join("\n");
}

/**
 * Placeholder verifier — returns not_implemented until signature parse lands.
 * Later: fetch tx from SOLANA_RPC_URL, confirm transfer to treasury, credit USD.
 */
export async function verifySolanaCreditTx({
  signature = "",
  accountId = "",
  expectedUsd = 0,
} = {}) {
  if (!avaSolanaCreditsEnabled()) {
    return { ok: false, reason: "solana_credits_disabled" };
  }
  if (!solanaCreditsConfigured()) {
    return { ok: false, reason: "solana_not_configured" };
  }
  if (!String(signature || "").trim()) {
    return { ok: false, reason: "missing_signature" };
  }
  // Framework stub — do not credit until real verify exists.
  return {
    ok: false,
    reason: "solana_verify_not_implemented",
    signature: String(signature).slice(0, 88),
    accountId,
    expectedUsd: Number(expectedUsd) || 0,
    next: "wire getTransaction + USDC/SOL amount → applySolanaCreditTopup",
  };
}

export function applySolanaCreditTopup({
  accountId,
  amountUsd,
  signature = "",
} = {}) {
  return creditAccount({
    accountId,
    amountUsd,
    reason: "solana_topup",
    provider: "solana",
    externalId: String(signature || "").slice(0, 128),
    meta: { signature },
  });
}
