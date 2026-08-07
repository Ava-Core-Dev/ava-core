/**
 * Ava prepaid credit ledger — Stripe / Solana top-ups debit against LLM sellUsd.
 * File-backed for now; swap storage later without changing call sites.
 */
import fs from "node:fs";
import path from "node:path";
import { storePaths } from "./store.mjs";
import { randomBytes } from "node:crypto";

function billingDir() {
  const dir = path.join(storePaths().dir, "billing");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function ledgerPath() {
  return path.join(billingDir(), "credits-ledger.json");
}

function txsPath() {
  return path.join(billingDir(), "credit-txs.jsonl");
}

function round6(n) {
  return Math.round(Number(n) * 1e6) / 1e6;
}

function emptyLedger() {
  return {
    version: 1,
    currency: "USD",
    updatedAt: Date.now(),
    accounts: {},
  };
}

export function loadCreditsLedger() {
  try {
    const o = JSON.parse(fs.readFileSync(ledgerPath(), "utf8"));
    if (!o?.accounts || typeof o.accounts !== "object") return emptyLedger();
    return o;
  } catch {
    return emptyLedger();
  }
}

function saveLedger(ledger) {
  ledger.updatedAt = Date.now();
  fs.writeFileSync(ledgerPath(), `${JSON.stringify(ledger, null, 2)}\n`, "utf8");
}

function appendTx(row) {
  fs.appendFileSync(txsPath(), `${JSON.stringify(row)}\n`, "utf8");
}

export function normalizeAccountId(raw = "") {
  const s = String(raw || "").trim();
  if (!s) return "anon";
  return s.replace(/[^a-zA-Z0-9_.:@-]/g, "_").slice(0, 120);
}

export function getCreditBalance(accountId = "") {
  const id = normalizeAccountId(accountId);
  const ledger = loadCreditsLedger();
  const acct = ledger.accounts[id];
  return {
    accountId: id,
    balanceUsd: round6(Number(acct?.balanceUsd || 0)),
    lifetimeCreditedUsd: round6(Number(acct?.lifetimeCreditedUsd || 0)),
    lifetimeDebitedUsd: round6(Number(acct?.lifetimeDebitedUsd || 0)),
    updatedAt: acct?.updatedAt || null,
  };
}

/**
 * @param {{ accountId: string, amountUsd: number, reason?: string, provider?: string, externalId?: string, meta?: object }} p
 */
export function creditAccount({
  accountId,
  amountUsd,
  reason = "topup",
  provider = "manual",
  externalId = "",
  meta = {},
} = {}) {
  const amt = round6(Number(amountUsd || 0));
  if (!(amt > 0)) return { ok: false, reason: "bad_amount" };
  const id = normalizeAccountId(accountId);
  const ledger = loadCreditsLedger();
  const acct = ledger.accounts[id] || {
    balanceUsd: 0,
    lifetimeCreditedUsd: 0,
    lifetimeDebitedUsd: 0,
  };
  acct.balanceUsd = round6(Number(acct.balanceUsd || 0) + amt);
  acct.lifetimeCreditedUsd = round6(
    Number(acct.lifetimeCreditedUsd || 0) + amt,
  );
  acct.updatedAt = Date.now();
  ledger.accounts[id] = acct;
  saveLedger(ledger);
  const tx = {
    id: `ctx_${Date.now().toString(36)}_${randomBytes(3).toString("hex")}`,
    at: Date.now(),
    type: "credit",
    accountId: id,
    amountUsd: amt,
    balanceAfterUsd: acct.balanceUsd,
    reason,
    provider,
    externalId: String(externalId || ""),
    meta,
  };
  appendTx(tx);
  return { ok: true, ...getCreditBalance(id), tx };
}

/**
 * @param {{ accountId: string, amountUsd: number, reason?: string, provider?: string, allowNegative?: boolean, meta?: object }} p
 */
export function debitAccount({
  accountId,
  amountUsd,
  reason = "usage",
  provider = "ava",
  allowNegative = false,
  meta = {},
} = {}) {
  const amt = round6(Number(amountUsd || 0));
  if (!(amt > 0)) return { ok: false, reason: "bad_amount" };
  const id = normalizeAccountId(accountId);
  const ledger = loadCreditsLedger();
  const acct = ledger.accounts[id] || {
    balanceUsd: 0,
    lifetimeCreditedUsd: 0,
    lifetimeDebitedUsd: 0,
  };
  const bal = round6(Number(acct.balanceUsd || 0));
  if (!allowNegative && bal + 1e-9 < amt) {
    return {
      ok: false,
      reason: "insufficient_credits",
      balanceUsd: bal,
      needUsd: amt,
    };
  }
  acct.balanceUsd = round6(bal - amt);
  acct.lifetimeDebitedUsd = round6(Number(acct.lifetimeDebitedUsd || 0) + amt);
  acct.updatedAt = Date.now();
  ledger.accounts[id] = acct;
  saveLedger(ledger);
  const tx = {
    id: `dtx_${Date.now().toString(36)}_${randomBytes(3).toString("hex")}`,
    at: Date.now(),
    type: "debit",
    accountId: id,
    amountUsd: amt,
    balanceAfterUsd: acct.balanceUsd,
    reason,
    provider,
    meta,
  };
  appendTx(tx);
  return { ok: true, ...getCreditBalance(id), tx };
}

export function recentCreditTxs({ accountId = "", limit = 20 } = {}) {
  const id = accountId ? normalizeAccountId(accountId) : "";
  const lim = Math.max(1, Math.min(100, Number(limit) || 20));
  let lines = [];
  try {
    lines = fs.readFileSync(txsPath(), "utf8").split("\n").filter(Boolean);
  } catch {
    return [];
  }
  const out = [];
  for (let i = lines.length - 1; i >= 0 && out.length < lim; i--) {
    try {
      const o = JSON.parse(lines[i]);
      if (id && o.accountId !== id) continue;
      out.push(o);
    } catch {
      /* skip */
    }
  }
  return out;
}
