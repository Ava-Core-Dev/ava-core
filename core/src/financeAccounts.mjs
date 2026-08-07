/**
 * Shared multi-account finance model for players + projects (Ava, RootMC ops, …).
 * Each owner can hold many accounts: cash/income streams, debts, credit, Stripe, etc.
 */
import { formatUsd } from "./stripeFinance.mjs";

export function slugId(prefix, label) {
  const s = String(label || "item")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
  return `${prefix}-${s || "item"}`;
}

export function emptyAccount({
  id,
  name = "Default",
  kind = "cash",
  currency = "USD",
  note = "",
} = {}) {
  return {
    id: id || slugId("acct", name),
    name,
    kind, // cash | bank | stripe | income | debt | credit | project | other
    currency,
    balanceUsd: 0,
    income: [],
    expenses: [],
    debts: [], // { id, label, balanceUsd, apr, minimumUsd, period, note, updatedAt }
    note,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

export function emptyProject({ id, name, note = "" } = {}) {
  return {
    id: id || slugId("proj", name || "project"),
    name: name || id || "Project",
    note,
    accounts: [emptyAccount({ id: "acct-default", name: "Default", kind: "cash" })],
    updatedAt: Date.now(),
  };
}

function monthlyize(amountUsd, period) {
  const a = Number(amountUsd) || 0;
  switch (String(period || "month")) {
    case "year":
      return a / 12;
    case "week":
      return (a * 52) / 12;
    case "once":
      return 0;
    default:
      return a;
  }
}

export function summarizeAccount(acct) {
  const incomeM = (acct.income || []).reduce(
    (s, r) => s + monthlyize(r.amountUsd, r.period),
    0,
  );
  const expenseM = (acct.expenses || []).reduce(
    (s, r) => s + monthlyize(r.amountUsd, r.period),
    0,
  );
  const debtBal = (acct.debts || []).reduce(
    (s, r) => s + (Number(r.balanceUsd) || 0),
    0,
  );
  // Debt-kind account: balanceUsd itself is owed
  const kindDebt =
    acct.kind === "debt" || acct.kind === "credit"
      ? Number(acct.balanceUsd) || 0
      : 0;
  return {
    incomeMonthlyUsd: Math.round(incomeM * 100) / 100,
    expensesMonthlyUsd: Math.round(expenseM * 100) / 100,
    netMonthlyUsd: Math.round((incomeM - expenseM) * 100) / 100,
    balanceUsd: Number(acct.balanceUsd) || 0,
    debtBalanceUsd: Math.round((debtBal + kindDebt) * 100) / 100,
  };
}

export function summarizeAccounts(accounts = []) {
  let incomeM = 0;
  let expenseM = 0;
  let balance = 0;
  let debt = 0;
  for (const a of accounts) {
    const s = summarizeAccount(a);
    incomeM += s.incomeMonthlyUsd;
    expenseM += s.expensesMonthlyUsd;
    if (a.kind === "debt" || a.kind === "credit") debt += s.balanceUsd;
    else balance += s.balanceUsd;
    debt += (a.debts || []).reduce((x, d) => x + (Number(d.balanceUsd) || 0), 0);
  }
  return {
    accountCount: accounts.length,
    incomeMonthlyUsd: Math.round(incomeM * 100) / 100,
    expensesMonthlyUsd: Math.round(expenseM * 100) / 100,
    netMonthlyUsd: Math.round((incomeM - expenseM) * 100) / 100,
    balanceUsd: Math.round(balance * 100) / 100,
    debtBalanceUsd: Math.round(debt * 100) / 100,
  };
}

export function findAccount(accounts, nameOrId) {
  const key = String(nameOrId || "")
    .trim()
    .toLowerCase();
  if (!key) return null;
  return (
    (accounts || []).find(
      (a) =>
        a.id === key ||
        a.id === `acct-${key}` ||
        String(a.name || "").toLowerCase() === key,
    ) || null
  );
}

export function ensureAccount(accounts, nameOrId, { kind = "cash", create = true } = {}) {
  const list = Array.isArray(accounts) ? [...accounts] : [];
  let acct = findAccount(list, nameOrId);
  if (acct) return { accounts: list, account: acct, created: false };
  if (!create) return { accounts: list, account: null, created: false };
  const name = String(nameOrId || "Default").trim() || "Default";
  acct = emptyAccount({ name, kind });
  list.push(acct);
  return { accounts: list, account: acct, created: true };
}

export function upsertLineOnAccount(account, kind, { label, amountUsd, period = "month", note = "" } = {}) {
  const listKey =
    kind === "income" ? "income" : kind === "debt" ? "debts" : "expenses";
  const rows = Array.isArray(account[listKey]) ? [...account[listKey]] : [];
  const rid = slugId(kind === "debt" ? "debt" : kind.slice(0, 3), label);
  const idx = rows.findIndex((r) => r.id === rid || r.label === label);
  const row =
    kind === "debt"
      ? {
          id: rid,
          label: label || rid,
          balanceUsd: Number(amountUsd) || 0,
          apr: null,
          minimumUsd: null,
          period: period || "once",
          note: note || "",
          updatedAt: Date.now(),
        }
      : {
          id: rid,
          label: label || rid,
          amountUsd: Number(amountUsd) || 0,
          period,
          note: note || "",
          updatedAt: Date.now(),
        };
  if (idx >= 0) rows[idx] = { ...rows[idx], ...row };
  else rows.push(row);
  account[listKey] = rows;
  account.updatedAt = Date.now();
  return row;
}

export function setAccountBalance(account, balanceUsd, { note } = {}) {
  account.balanceUsd = Number(balanceUsd) || 0;
  if (note != null) account.note = note;
  account.updatedAt = Date.now();
  return account;
}

/** Migrate flat income/expenses (+ optional debts) into accounts[]. */
export function migrateFlatToAccounts(fin) {
  const next = { ...fin };
  if (Array.isArray(next.accounts) && next.accounts.length) {
    return next;
  }
  const acct = emptyAccount({
    id: "acct-default",
    name: "Default",
    kind: "cash",
  });
  if (Array.isArray(next.income) && next.income.length) {
    acct.income = next.income;
  }
  if (Array.isArray(next.expenses) && next.expenses.length) {
    acct.expenses = next.expenses;
  }
  if (Array.isArray(next.debts) && next.debts.length) {
    acct.debts = next.debts;
  }
  next.accounts = [acct];
  // keep legacy arrays as mirrors of default for older readers
  next.income = acct.income;
  next.expenses = acct.expenses;
  next.debts = acct.debts;
  return next;
}

export function syncLegacyFlatFromAccounts(fin) {
  const accounts = fin.accounts || [];
  const def =
    findAccount(accounts, "default") ||
    findAccount(accounts, "acct-default") ||
    accounts[0];
  if (!def) {
    fin.income = fin.income || [];
    fin.expenses = fin.expenses || [];
    fin.debts = fin.debts || [];
    return fin;
  }
  fin.income = def.income || [];
  fin.expenses = def.expenses || [];
  fin.debts = def.debts || [];
  return fin;
}

export function formatAccountsPlain(accounts, { title = "Accounts" } = {}) {
  const sum = summarizeAccounts(accounts);
  const lines = [
    `${title} — ${sum.accountCount} account(s) · bal ${formatUsd(sum.balanceUsd)} · debts ${formatUsd(sum.debtBalanceUsd)} · ~income ${formatUsd(sum.incomeMonthlyUsd)}/mo · ~exp ${formatUsd(sum.expensesMonthlyUsd)}/mo · net ${formatUsd(sum.netMonthlyUsd)}/mo`,
  ];
  for (const a of accounts || []) {
    const s = summarizeAccount(a);
    lines.push(
      `• [${a.kind}] ${a.name} (${a.id}): bal ${formatUsd(s.balanceUsd)} · debt ${formatUsd(s.debtBalanceUsd)} · inc ${formatUsd(s.incomeMonthlyUsd)}/mo · exp ${formatUsd(s.expensesMonthlyUsd)}/mo`,
    );
    for (const d of (a.debts || []).slice(0, 6)) {
      lines.push(`    - debt ${d.label}: ${formatUsd(d.balanceUsd)}`);
    }
    for (const r of (a.income || []).slice(0, 4)) {
      lines.push(
        `    - income ${r.label}: ${formatUsd(r.amountUsd)}/${r.period || "mo"}`,
      );
    }
    for (const r of (a.expenses || []).slice(0, 4)) {
      lines.push(
        `    - expense ${r.label}: ${formatUsd(r.amountUsd)}/${r.period || "mo"}`,
      );
    }
  }
  return lines.join("\n");
}

export function parsePeriod(raw) {
  const periodRaw = String(raw || "month").toLowerCase();
  if (periodRaw.startsWith("y")) return "year";
  if (periodRaw.startsWith("w")) return "week";
  if (periodRaw === "once") return "once";
  return "month";
}
