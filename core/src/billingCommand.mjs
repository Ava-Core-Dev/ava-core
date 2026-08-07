/**
 * Operator + user billing commands:
 *   /cost
 *   /credits
 *   /credits add <accountId> <usd>
 *   /buy credits [usd]
 *   /solana credits
 */
import {
  accountIdForUser,
  formatCostReport,
  usageBillingEnabled,
} from "./avaUsageBilling.mjs";
import {
  creditAccount,
  getCreditBalance,
  recentCreditTxs,
} from "./avaCredits.mjs";
import {
  avaStripeCreditsEnabled,
  createAvaCreditsCheckout,
  stripeCreditPackLink,
  stripeCreditsConfigured,
} from "./avaBillingStripe.mjs";
import {
  avaSolanaCreditsEnabled,
  solanaTopupBrief,
} from "./avaBillingSolana.mjs";

export function isBillingCommand(text = "") {
  const t = String(text || "").trim();
  return (
    /^\/?cost(?:\s|$)/i.test(t) ||
    /^\/?credits\b/i.test(t) ||
    /^\/?buy\s+credits\b/i.test(t) ||
    /^\/?solana\s+credits\b/i.test(t)
  );
}

/**
 * @returns {Promise<null | { handled: true, reply: string }>}
 */
export async function tryHandleBillingCommand({
  text = "",
  isAlex = false,
  authorId = "",
  surface = "",
} = {}) {
  if (!isBillingCommand(text)) return null;
  const t = String(text || "").trim();
  const acct = accountIdForUser({
    authorId,
    surface,
    isOps: isAlex,
  });

  if (/^\/?cost(?:\s|$)/i.test(t)) {
    if (!isAlex) {
      return {
        handled: true,
        reply: "Cost report is operator-only.",
      };
    }
    return { handled: true, reply: formatCostReport() };
  }

  if (/^\/?solana\s+credits\b/i.test(t)) {
    return {
      handled: true,
      reply: solanaTopupBrief({ accountId: acct, usdHint: 5 }),
    };
  }

  if (/^\/?buy\s+credits\b/i.test(t)) {
    const m = t.match(/^\/?buy\s+credits(?:\s+(\d+(?:\.\d+)?))?/i);
    const usd = m?.[1] ? Number(m[1]) : 5;
    if (!avaStripeCreditsEnabled()) {
      const link = stripeCreditPackLink();
      return {
        handled: true,
        reply: [
          "Stripe Ava credits: framework ready, not enabled yet.",
          `Set AVA_STRIPE_CREDITS_ENABLED=1${link ? " (or use pack link)" : ""}.`,
          solanaTopupBrief({ accountId: acct, usdHint: usd }),
        ].join("\n"),
      };
    }
    const checkout = await createAvaCreditsCheckout({
      accountId: acct,
      amountUsd: usd,
    });
    if (!checkout.ok) {
      return {
        handled: true,
        reply: `Checkout failed: ${checkout.reason}`,
      };
    }
    return {
      handled: true,
      reply: `Ava credits · $${checkout.amountUsd || usd}\n${checkout.url}`,
    };
  }

  // /credits add <id> <usd>
  const add = t.match(/^\/?credits\s+add\s+(\S+)\s+(\d+(?:\.\d+)?)\s*$/i);
  if (add) {
    if (!isAlex) {
      return { handled: true, reply: "Credit top-up is operator-only." };
    }
    const r = creditAccount({
      accountId: add[1],
      amountUsd: Number(add[2]),
      reason: "ops_manual",
      provider: "ops",
    });
    if (!r.ok) return { handled: true, reply: `Add failed: ${r.reason}` };
    return {
      handled: true,
      reply: `Credited $${Number(add[2]).toFixed(2)} → ${r.accountId}\nbalance: $${r.balanceUsd.toFixed(6)}`,
    };
  }

  // /credits [account]
  if (/^\/?credits\b/i.test(t)) {
    const who = t.match(/^\/?credits\s+(\S+)\s*$/i)?.[1];
    const id = who && isAlex ? who : acct;
    if (who && !isAlex) {
      return { handled: true, reply: "You can only view your own credits." };
    }
    const bal = getCreditBalance(id);
    const txs = recentCreditTxs({ accountId: id, limit: 5 });
    const txLines = txs.length
      ? txs
          .map(
            (x) =>
              `· ${x.type} $${Number(x.amountUsd).toFixed(4)} (${x.reason}/${x.provider})`,
          )
          .join("\n")
      : "· (no txs yet)";
    return {
      handled: true,
      reply: [
        `Account: ${bal.accountId}`,
        `Balance: $${bal.balanceUsd.toFixed(6)}`,
        `Lifetime in/out: $${bal.lifetimeCreditedUsd.toFixed(4)} / $${bal.lifetimeDebitedUsd.toFixed(4)}`,
        `Usage billing: ${usageBillingEnabled() ? "ON" : "off (framework)"}`,
        `Stripe credits: ${avaStripeCreditsEnabled() ? "on" : "off"} · key ${stripeCreditsConfigured() ? "ok" : "missing"}`,
        `Solana credits: ${avaSolanaCreditsEnabled() ? "on" : "off"}`,
        "Recent:",
        txLines,
      ].join("\n"),
    };
  }

  return {
    handled: true,
    reply:
      "Usage: `/cost` · `/credits` · `/credits add <id> <usd>` · `/buy credits [usd]` · `/solana credits`",
  };
}
