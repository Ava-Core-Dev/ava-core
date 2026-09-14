/**
 * Smoke: Stripe snapshot + finance review (no Discord spam).
 * Usage: node scripts/finance-smoke.mjs [--notify]
 */
import { loadEnv } from "../src/config.mjs";
import { refreshStripeSnapshot, formatStripeIncomePlain } from "../src/stripeFinance.mjs";
import { formatOpsLedgerPlain, loadOpsLedger } from "../src/opsFinanceLedger.mjs";
import { runFinanceReview, buildFinanceSuggestions } from "../src/financeReview.mjs";
import { explainStripeBalance } from "../src/stripeFinance.mjs";
import { tryHandleFinanceCommand } from "../src/playerFinance.mjs";
import {
  cancelStaleFinanceSelfFixes,
  isStaleFinanceNegativeBalanceBrief,
} from "../src/selfFix.mjs";

const env = await loadEnv();
const notify = process.argv.includes("--notify");

const snap = await refreshStripeSnapshot(env, { force: true });
console.log("--- Stripe ---");
console.log(formatStripeIncomePlain(snap));
console.log("--- Ops ledger ---");
console.log(formatOpsLedgerPlain(loadOpsLedger()));

const opt = tryHandleFinanceCommand({
  text: "track my finances",
  authorId: "finance-smoke-test",
  authorName: "smoke",
});
console.log("--- opt-in ---", opt?.reply?.slice(0, 120));
tryHandleFinanceCommand({
  text: "add expense rent 1000/mo",
  authorId: "finance-smoke-test",
  authorName: "smoke",
});
const show = tryHandleFinanceCommand({
  text: "my finances",
  authorId: "finance-smoke-test",
  authorName: "smoke",
});
console.log(show?.reply);
tryHandleFinanceCommand({
  text: "stop tracking my finances",
  authorId: "finance-smoke-test",
  authorName: "smoke",
});

const review = await runFinanceReview({ env, force: true, notify });
console.log("--- review ---", {
  sent: review.sent,
  reason: review.reason,
  suggestions: review.suggestions?.length,
});

// Unit-style guard: trivial negative + pending cover must not self-fix or warn-loop.
const mockSnap = {
  ok: true,
  usdAvailable: -0.02,
  usdPending: 13.49,
  income30dUsd: 20,
  recent: [
    { type: "stripe_fee", amount: -0.07, description: "Billing - Usage Fee" },
    { type: "payout", amount: -4.71, description: "" },
  ],
};
const bal = explainStripeBalance(mockSnap);
const mockSuggestions = buildFinanceSuggestions({ snap: mockSnap });
const neg = mockSuggestions.find((s) => s.code === "negative_balance");
console.log("--- balance explain ---", bal);
console.log("--- negative guard ---", {
  healthyTiming: bal?.healthyTiming,
  negativeSuggestion: neg?.text || null,
  selfFixable: neg?.selfFixable ?? null,
});
if (!bal?.healthyTiming) {
  console.error("FAIL: expected healthyTiming for -$0.02 / $13.49 pending");
  process.exitCode = 1;
}
if (neg) {
  console.error("FAIL: trivial negative should not produce a review suggestion");
  process.exitCode = 1;
}

const staleBrief =
  "Finance review tooling error — investigate and fix Ava-owned code if needed: Stripe available balance is negative ($-0.02). Investigate payouts/disputes.";
console.log("--- stale brief match ---", isStaleFinanceNegativeBalanceBrief(staleBrief));
const pruned = cancelStaleFinanceSelfFixes(mockSnap);
console.log("--- stale queue prune ---", pruned);
if (!isStaleFinanceNegativeBalanceBrief(staleBrief)) {
  console.error("FAIL: stale finance negative brief should match prune pattern");
  process.exitCode = 1;
}
