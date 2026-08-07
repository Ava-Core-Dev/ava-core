/**
 * Per-player finance — opt-in, profile-isolated, multi-account (income + debts).
 * Never mixes with in-game Gold (G) or ops Stripe ledgers.
 */
import { loadPlayerProfile, savePlayerProfileMut } from "./playerProfiles.mjs";
import { personByAuthorId, personByDiscordId, personByTelegramId } from "./people.mjs";
import { formatUsd } from "./stripeFinance.mjs";
import {
  addOpsAccount,
  formatOpsLedgerPlain,
  upsertOpsDebt,
  upsertOpsExpense,
  upsertOpsIncome,
  parsePeriod,
} from "./opsFinanceLedger.mjs";
import {
  ensureAccount,
  formatAccountsPlain,
  migrateFlatToAccounts,
  summarizeAccounts,
  syncLegacyFlatFromAccounts,
  upsertLineOnAccount,
  setAccountBalance,
  emptyAccount,
} from "./financeAccounts.mjs";
import { appendAction } from "./fullLog.mjs";

function emptyFinance() {
  return {
    optIn: false,
    optInAt: null,
    optOutAt: null,
    currency: "USD",
    accounts: [emptyAccount({ id: "acct-default", name: "Default", kind: "cash" })],
    // legacy mirrors
    income: [],
    expenses: [],
    debts: [],
    notes: [],
    lastReviewAt: null,
  };
}

export function normalizePlayerFinance(raw) {
  const base = { ...emptyFinance(), ...(raw || {}) };
  const migrated = migrateFlatToAccounts(base);
  syncLegacyFlatFromAccounts(migrated);
  return migrated;
}

export function getPlayerFinance(discordId) {
  const p = loadPlayerProfile(discordId);
  if (!p?.finance) return emptyFinance();
  return normalizePlayerFinance(p.finance);
}

export function setPlayerFinanceOptIn(discordId, optIn, { username } = {}) {
  const id = String(discordId || "");
  if (!id) return null;
  return savePlayerProfileMut(id, (p) => {
    if (username) p.username = username;
    const fin = normalizePlayerFinance(p.finance || emptyFinance());
    fin.optIn = Boolean(optIn);
    if (optIn) {
      fin.optInAt = Date.now();
      fin.optOutAt = null;
      if (!fin.accounts?.length) {
        fin.accounts = [
          emptyAccount({ id: "acct-default", name: "Default", kind: "cash" }),
        ];
      }
    } else {
      fin.optOutAt = Date.now();
    }
    p.finance = fin;
    return p;
  });
}

export function summarizePlayerFinance(fin) {
  const n = normalizePlayerFinance(fin);
  return summarizeAccounts(n.accounts || []);
}

export function upsertPlayerLine(
  discordId,
  kind,
  { label, amountUsd, period = "month", note = "", account = "default" } = {},
) {
  const id = String(discordId || "");
  if (!id) return { ok: false, reason: "no_id" };
  const profile = savePlayerProfileMut(id, (p) => {
    const fin = normalizePlayerFinance(p.finance || emptyFinance());
    if (!fin.optIn) {
      p._financeErr = "not_opted_in";
      return p;
    }
    const ens = ensureAccount(fin.accounts, account, {
      kind: kind === "debt" ? "debt" : "cash",
      create: true,
    });
    fin.accounts = ens.accounts;
    upsertLineOnAccount(ens.account, kind, {
      label,
      amountUsd,
      period,
      note,
    });
    syncLegacyFlatFromAccounts(fin);
    p.finance = fin;
    delete p._financeErr;
    return p;
  });
  if (profile?._financeErr) {
    return { ok: false, reason: profile._financeErr };
  }
  appendAction("playerFinance.upsert", {
    discordId: id,
    kind,
    account,
    label,
    amountUsd: Number(amountUsd) || 0,
  });
  return { ok: true, finance: profile.finance };
}

export function addPlayerAccount(
  discordId,
  { name, kind = "cash", balanceUsd = 0, note = "" } = {},
) {
  const id = String(discordId || "");
  if (!id) return { ok: false, reason: "no_id" };
  const profile = savePlayerProfileMut(id, (p) => {
    const fin = normalizePlayerFinance(p.finance || emptyFinance());
    if (!fin.optIn) {
      p._financeErr = "not_opted_in";
      return p;
    }
    const ens = ensureAccount(fin.accounts, name, { kind, create: true });
    fin.accounts = ens.accounts;
    setAccountBalance(ens.account, balanceUsd, { note });
    ens.account.kind = kind;
    syncLegacyFlatFromAccounts(fin);
    p.finance = fin;
    delete p._financeErr;
    return p;
  });
  if (profile?._financeErr) {
    return { ok: false, reason: profile._financeErr };
  }
  appendAction("playerFinance.accountAdd", {
    discordId: id,
    name,
    kind,
  });
  return { ok: true, finance: profile.finance };
}

export function formatPlayerFinancePlain(discordId) {
  const fin = getPlayerFinance(discordId);
  if (!fin.optIn) {
    return "Personal finance tracking is off for you. Say “track my finances” to opt in (isolated to your profile — not shared). Multiple accounts OK (checking, PayPal, debts…).";
  }
  const sum = summarizePlayerFinance(fin);
  return [
    "Your tracked finances (private · multi-account):",
    formatAccountsPlain(fin.accounts || [], { title: "Your accounts" }),
    `Totals · bal ${formatUsd(sum.balanceUsd)} · debts ${formatUsd(sum.debtBalanceUsd)} · net flow ~${formatUsd(sum.netMonthlyUsd)}/mo`,
    "Hints: add account PayPal · add income job 2500/mo on checking · add debt student-loan 12000 on debts · add expense rent 1200/mo",
  ].join("\n");
}

export function isOperatorAuthor(authorId, authorName) {
  const p =
    personByAuthorId(authorId, authorName) ||
    personByDiscordId(authorId) ||
    personByTelegramId(authorId);
  return Boolean(p?.roles?.includes("owner") || p?.id === "alexrs94");
}

/**
 * Structured finance commands — returns reply text or null.
 */
export function tryHandleFinanceCommand({
  text = "",
  authorId,
  authorName,
  surface = "discord",
} = {}) {
  const q = String(text || "").trim();
  if (!q) return null;
  const lower = q.toLowerCase();

  if (
    /\b(track\s+my\s+finances?|start\s+tracking\s+my\s+(money|finances?|expenses?)|opt\s*in\s+(to\s+)?finance)\b/i.test(
      lower,
    )
  ) {
    setPlayerFinanceOptIn(authorId, true, { username: authorName });
    return {
      handled: true,
      reply:
        "Got it — multi-account finance on your profile only (income, expenses, debts). Not shared, not mixed with server Gold. Say “my finances”, “add account PayPal”, “add income job 2500/mo on checking”, “add debt car-loan 5000”, or “stop tracking my finances”.",
    };
  }
  if (
    /\b(stop\s+tracking\s+my\s+finances?|opt\s*out\s+(of\s+)?finance|don'?t\s+track\s+my\s+(money|finances?))\b/i.test(
      lower,
    )
  ) {
    setPlayerFinanceOptIn(authorId, false, { username: authorName });
    return {
      handled: true,
      reply:
        "Personal finance tracking off for you. Prior accounts stay on your profile but I won't update or brief them unless you opt back in.",
    };
  }
  if (
    /\b(my\s+finances?|show\s+my\s+(expenses?|income|finances?|accounts?|debts?)|what('?s|\s+is)\s+my\s+(burn|budget))\b/i.test(
      lower,
    )
  ) {
    return { handled: true, reply: formatPlayerFinancePlain(authorId) };
  }

  // add account <name> [kind] [balance]
  const addAcct = q.match(
    /^\s*(?:ava[,:]?\s*)?(?:please\s+)?add\s+account\s+(\S+)(?:\s+(cash|bank|debt|credit|income|paypal|stripe|other))?(?:\s+(\d+(?:\.\d+)?))?\s*$/i,
  );
  if (addAcct) {
    const name = addAcct[1];
    const kind = (addAcct[2] || "cash").toLowerCase();
    const balanceUsd = addAcct[3] != null ? Number(addAcct[3]) : 0;
    const r = addPlayerAccount(authorId, { name, kind, balanceUsd });
    if (!r.ok) {
      return {
        handled: true,
        reply: "Opt in first with “track my finances”.",
      };
    }
    return {
      handled: true,
      reply: `Account “${name}” ready (${kind}).\n${formatPlayerFinancePlain(authorId)}`,
    };
  }

  // add (expense|income|debt) <label> <amount> [/period] [on <account>]
  const addPlayer = q.match(
    /^\s*(?:ava[,:]?\s*)?(?:please\s+)?add\s+(expense|income|debt)\s+(.+?)\s+(\d+(?:\.\d+)?)(?:\s*(?:\/|\s+per\s+)(mo(?:nth)?|yr|year|week|once))?(?:\s+on\s+(\S+))?\s*$/i,
  );
  if (addPlayer) {
    const kind = addPlayer[1].toLowerCase();
    const label = addPlayer[2].trim();
    const amountUsd = Number(addPlayer[3]);
    const period = parsePeriod(addPlayer[4] || (kind === "debt" ? "once" : "month"));
    const account = addPlayer[5] || (kind === "debt" ? "debts" : "default");
    const r = upsertPlayerLine(authorId, kind, {
      label,
      amountUsd,
      period,
      account,
    });
    if (!r.ok) {
      return {
        handled: true,
        reply:
          "Opt in first with “track my finances” — then I can add that line on your private multi-account profile.",
      };
    }
    return {
      handled: true,
      reply: `Logged ${kind} “${label}” at ${formatUsd(amountUsd)}${kind === "debt" ? " owed" : `/${period}`} on account “${account}”.\n${formatPlayerFinancePlain(authorId)}`,
    };
  }

  // Operator project/account commands
  if (!isOperatorAuthor(authorId, authorName)) {
    void surface;
    return null;
  }

  // add project account <project> <name> [kind] [balance]
  const addProjAcct = q.match(
    /^\s*(?:ava[,:]?\s*)?(?:please\s+)?add\s+project\s+account\s+(\S+)\s+(\S+)(?:\s+(cash|bank|debt|credit|income|stripe|project|other))?(?:\s+(\d+(?:\.\d+)?))?\s*$/i,
  );
  if (addProjAcct) {
    const projectId = addProjAcct[1];
    const name = addProjAcct[2];
    const kind = (addProjAcct[3] || "cash").toLowerCase();
    const balanceUsd = addProjAcct[4] != null ? Number(addProjAcct[4]) : 0;
    addOpsAccount({ projectId, name, kind, balanceUsd });
    return {
      handled: true,
      reply: `Project account ${projectId}/${name} (${kind}) ready.\n${formatOpsLedgerPlain()}`,
    };
  }

  // add ops (expense|income|debt) ... [on <account>] [project <id>]
  const addOps = q.match(
    /^\s*(?:ava[,:]?\s*)?(?:please\s+)?(?:ops\s+)?add\s+ops\s+(expense|income|debt)\s+(.+?)\s+(\d+(?:\.\d+)?)(?:\s*(?:\/|\s+per\s+)(mo(?:nth)?|yr|year|week|once))?(?:\s+on\s+(\S+))?(?:\s+project\s+(\S+))?\s*$/i,
  );
  if (addOps) {
    const kind = addOps[1].toLowerCase();
    const label = addOps[2].trim();
    const amountUsd = Number(addOps[3]);
    const period = parsePeriod(addOps[4] || (kind === "debt" ? "once" : "month"));
    const account = addOps[5] || (kind === "debt" ? "debts" : "default");
    const projectId = addOps[6] || (kind === "debt" ? "ava" : "rootmc-ops");
    if (kind === "income") {
      upsertOpsIncome({ label, amountUsd, period, projectId, account });
    } else if (kind === "debt") {
      upsertOpsDebt({ label, balanceUsd: amountUsd, projectId, account });
    } else {
      upsertOpsExpense({ label, amountUsd, period, projectId, account });
    }
    return {
      handled: true,
      reply: `Ops ${kind} logged on ${projectId}/${account}.\n${formatOpsLedgerPlain()}`,
    };
  }

  if (/\b(ops\s+finances?|project\s+finances?|ava\s+accounts?)\b/i.test(lower)) {
    return { handled: true, reply: formatOpsLedgerPlain() };
  }

  void surface;
  return null;
}
