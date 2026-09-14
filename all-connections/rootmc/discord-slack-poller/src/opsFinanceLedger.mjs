/**
 * Project finance ledgers — Ava, RootMC ops, etc. Each project has multiple accounts
 * (cash, Stripe, debts, income streams). Isolated from player Gold (G).
 */
import fs from "node:fs";
import path from "node:path";
import { financeDir, formatUsd } from "./stripeFinance.mjs";
import { appendAction } from "./fullLog.mjs";
import {
  emptyAccount,
  emptyProject,
  ensureAccount,
  findAccount,
  formatAccountsPlain,
  migrateFlatToAccounts,
  parsePeriod,
  slugId,
  summarizeAccounts,
  syncLegacyFlatFromAccounts,
  upsertLineOnAccount,
  setAccountBalance,
} from "./financeAccounts.mjs";

function ledgerPath() {
  return path.join(financeDir(), "ops-ledger.json");
}

function seedProjects() {
  const rootmc = emptyProject({
    id: "rootmc-ops",
    name: "RootMC ops",
    note: "Hosting, domains, CF, Pro funnel costs",
  });
  const def = rootmc.accounts[0];
  def.expenses = [
    {
      id: "exp-shockbyte",
      label: "Shockbyte hosting (Claims+Towny)",
      amountUsd: 0,
      period: "month",
      category: "ops",
      updatedAt: null,
      note: "Set real monthly total when known",
    },
    {
      id: "exp-domains",
      label: "Domains (rootmc.net + related)",
      amountUsd: 0,
      period: "year",
      category: "ops",
      updatedAt: null,
      note: "Annual — convert to monthly when reviewing",
    },
    {
      id: "exp-cloudflare",
      label: "Cloudflare / Workers / Pages",
      amountUsd: 0,
      period: "month",
      category: "dev",
      updatedAt: null,
      note: "Include paid add-ons if any",
    },
  ];
  def.income = [
    {
      id: "inc-other",
      label: "Other (ads, sponsors, one-offs)",
      amountUsd: 0,
      period: "month",
      updatedAt: null,
      note: "Non-Stripe income — update when known",
    },
  ];
  rootmc.accounts.push(
    emptyAccount({
      id: "acct-stripe",
      name: "Stripe",
      kind: "stripe",
      note: "Mirrored from Stripe API snapshots — balance updates via review",
    }),
  );

  const ava = emptyProject({
    id: "ava",
    name: "Ava",
    note: "Ava allocation / hardware wishlist / experiments (10–15% slice)",
  });
  ava.accounts.push(
    emptyAccount({
      id: "acct-wishlist",
      name: "Hardware wishlist",
      kind: "project",
      note: "990 PRO, RTX laptop, etc.",
    }),
  );
  ava.accounts.push(
    emptyAccount({
      id: "acct-debts",
      name: "Debts",
      kind: "debt",
      note: "Ava/project debts owed",
    }),
  );

  return [rootmc, ava];
}

/** Normalize any on-disk shape → projects[] with accounts[]. */
export function normalizeOpsLedger(raw) {
  let ledger = raw && typeof raw === "object" ? { ...raw } : {};
  ledger.currency = ledger.currency || "USD";

  if (!Array.isArray(ledger.projects) || !ledger.projects.length) {
    // Migrate flat otherIncome/expenses into rootmc-ops
    const flat = migrateFlatToAccounts({
      income: ledger.otherIncome || [],
      expenses: ledger.expenses || [],
      debts: ledger.debts || [],
    });
    const rootmc = emptyProject({
      id: "rootmc-ops",
      name: "RootMC ops",
    });
    rootmc.accounts = flat.accounts;
    syncLegacyFlatFromAccounts(rootmc);
    const ava = emptyProject({ id: "ava", name: "Ava" });
    ava.accounts.push(
      emptyAccount({ id: "acct-wishlist", name: "Hardware wishlist", kind: "project" }),
    );
    ava.accounts.push(
      emptyAccount({ id: "acct-debts", name: "Debts", kind: "debt" }),
    );
    ledger.projects = [rootmc, ava];
  }

  ledger.projects = ledger.projects.map((p) => {
    const proj = {
      ...emptyProject({ id: p.id, name: p.name, note: p.note }),
      ...p,
    };
    const migrated = migrateFlatToAccounts({
      income: p.income || p.otherIncome || [],
      expenses: p.expenses || [],
      debts: p.debts || [],
      accounts: p.accounts,
    });
    proj.accounts = migrated.accounts;
    syncLegacyFlatFromAccounts(proj);
    return proj;
  });

  // Mirror first project default onto legacy top-level for old readers
  const primary =
    findProject(ledger.projects, "rootmc-ops") || ledger.projects[0];
  if (primary) {
    const def =
      findAccount(primary.accounts, "default") || primary.accounts[0];
    ledger.otherIncome = def?.income || [];
    ledger.expenses = def?.expenses || [];
    ledger.debts = def?.debts || [];
  }

  return ledger;
}

export function findProject(projects, nameOrId) {
  const key = String(nameOrId || "")
    .trim()
    .toLowerCase();
  if (!key) return null;
  return (
    (projects || []).find(
      (p) =>
        p.id === key ||
        p.id === `proj-${key}` ||
        String(p.name || "").toLowerCase() === key ||
        (key === "ops" && p.id === "rootmc-ops"),
    ) || null
  );
}

export function loadOpsLedger() {
  try {
    if (!fs.existsSync(ledgerPath())) {
      const seed = {
        updatedAt: Date.now(),
        currency: "USD",
        projects: seedProjects(),
        lastSuggestionAt: null,
        lastSuggestions: [],
      };
      const norm = normalizeOpsLedger(seed);
      saveOpsLedger(norm);
      return norm;
    }
    const raw = JSON.parse(fs.readFileSync(ledgerPath(), "utf8"));
    return normalizeOpsLedger(raw);
  } catch {
    return normalizeOpsLedger({
      projects: seedProjects(),
      otherIncome: [],
      expenses: [],
    });
  }
}

export function saveOpsLedger(ledger) {
  const next = normalizeOpsLedger({ ...ledger, updatedAt: Date.now() });
  fs.writeFileSync(ledgerPath(), JSON.stringify(next, null, 2), "utf8");
  return next;
}

export function ensureProject(projectId, { name } = {}) {
  const ledger = loadOpsLedger();
  let proj = findProject(ledger.projects, projectId);
  if (!proj) {
    proj = emptyProject({
      id: slugId("proj", projectId || name || "project").replace(/^proj-proj-/, "proj-"),
      name: name || projectId || "Project",
    });
    // fix id if slug doubled
    if (projectId && !projectId.startsWith("proj-")) {
      proj.id = String(projectId)
        .toLowerCase()
        .replace(/[^a-z0-9-]+/g, "-");
    }
    ledger.projects.push(proj);
    saveOpsLedger(ledger);
  }
  return { ledger: loadOpsLedger(), project: findProject(loadOpsLedger().projects, proj.id) };
}

export function summarizeOpsLedger(ledger = loadOpsLedger()) {
  const projects = ledger.projects || [];
  let incomeM = 0;
  let expenseM = 0;
  let debt = 0;
  let balance = 0;
  const stale = [];
  const staleMs = 45 * 86400 * 1000;

  for (const p of projects) {
    const s = summarizeAccounts(p.accounts || []);
    incomeM += s.incomeMonthlyUsd;
    expenseM += s.expensesMonthlyUsd;
    debt += s.debtBalanceUsd;
    balance += s.balanceUsd;
    for (const a of p.accounts || []) {
      for (const row of [
        ...(a.income || []),
        ...(a.expenses || []),
        ...(a.debts || []),
      ]) {
        if (!row.updatedAt || Date.now() - row.updatedAt > staleMs) {
          stale.push(`${p.id}/${a.id}/${row.id || row.label}`);
        }
      }
    }
  }

  return {
    otherIncomeMonthlyUsd: Math.round(incomeM * 100) / 100,
    expensesMonthlyUsd: Math.round(expenseM * 100) / 100,
    netOtherMonthlyUsd: Math.round((incomeM - expenseM) * 100) / 100,
    debtBalanceUsd: Math.round(debt * 100) / 100,
    balanceUsd: Math.round(balance * 100) / 100,
    projectCount: projects.length,
    accountCount: projects.reduce((n, p) => n + (p.accounts || []).length, 0),
    staleIds: stale,
    expenseCount: projects.reduce(
      (n, p) =>
        n +
        (p.accounts || []).reduce((m, a) => m + (a.expenses || []).length, 0),
      0,
    ),
    incomeCount: projects.reduce(
      (n, p) =>
        n +
        (p.accounts || []).reduce((m, a) => m + (a.income || []).length, 0),
      0,
    ),
  };
}

function mutateProjectAccount(projectId, accountName, mutator) {
  const ledger = loadOpsLedger();
  let proj = findProject(ledger.projects, projectId);
  if (!proj) {
    const created = emptyProject({
      id: String(projectId || "project")
        .toLowerCase()
        .replace(/[^a-z0-9-]+/g, "-"),
      name: projectId || "Project",
    });
    ledger.projects.push(created);
    proj = created;
  }
  const ens = ensureAccount(proj.accounts, accountName || "default", {
    kind: "cash",
    create: true,
  });
  proj.accounts = ens.accounts;
  const acct = ens.account;
  mutator(acct, proj);
  syncLegacyFlatFromAccounts(proj);
  const idx = ledger.projects.findIndex((p) => p.id === proj.id);
  ledger.projects[idx] = proj;
  saveOpsLedger(ledger);
  return { project: proj, account: acct };
}

/** @deprecated flat helper — writes to rootmc-ops / default account */
export function upsertOpsExpense({
  id,
  label,
  amountUsd,
  period = "month",
  category = "ops",
  note = "",
  projectId = "rootmc-ops",
  account = "default",
} = {}) {
  const { account: acct } = mutateProjectAccount(projectId, account, (a) => {
    const row = upsertLineOnAccount(a, "expense", {
      label: label || id,
      amountUsd,
      period,
      note,
    });
    if (category) {
      const list = a.expenses || [];
      const hit = list.find((r) => r.id === row.id);
      if (hit) hit.category = category;
    }
  });
  appendAction("opsFinance.expenseUpsert", {
    projectId,
    account: acct.id,
    label,
    amountUsd: Number(amountUsd) || 0,
  });
  return acct;
}

export function upsertOpsIncome({
  id,
  label,
  amountUsd,
  period = "month",
  note = "",
  projectId = "rootmc-ops",
  account = "default",
} = {}) {
  const { account: acct } = mutateProjectAccount(projectId, account, (a) => {
    upsertLineOnAccount(a, "income", {
      label: label || id,
      amountUsd,
      period,
      note,
    });
  });
  appendAction("opsFinance.incomeUpsert", {
    projectId,
    account: acct.id,
    label,
    amountUsd: Number(amountUsd) || 0,
  });
  return acct;
}

export function upsertOpsDebt({
  label,
  balanceUsd,
  projectId = "ava",
  account = "debts",
  note = "",
} = {}) {
  const { account: acct } = mutateProjectAccount(projectId, account, (a) => {
    if (a.kind !== "debt" && a.kind !== "credit") a.kind = "debt";
    upsertLineOnAccount(a, "debt", {
      label,
      amountUsd: balanceUsd,
      period: "once",
      note,
    });
  });
  appendAction("opsFinance.debtUpsert", {
    projectId,
    account: acct.id,
    label,
    balanceUsd: Number(balanceUsd) || 0,
  });
  return acct;
}

export function addOpsAccount({
  projectId = "ava",
  name,
  kind = "cash",
  balanceUsd = 0,
  note = "",
} = {}) {
  const ledger = loadOpsLedger();
  let proj = findProject(ledger.projects, projectId);
  if (!proj) {
    proj = emptyProject({
      id: String(projectId)
        .toLowerCase()
        .replace(/[^a-z0-9-]+/g, "-"),
      name: projectId,
    });
    ledger.projects.push(proj);
  }
  const ens = ensureAccount(proj.accounts, name, { kind, create: true });
  proj.accounts = ens.accounts;
  if (ens.created || balanceUsd) {
    setAccountBalance(ens.account, balanceUsd, { note });
    ens.account.kind = kind;
  }
  const idx = ledger.projects.findIndex((p) => p.id === proj.id);
  ledger.projects[idx] = proj;
  saveOpsLedger(ledger);
  appendAction("opsFinance.accountAdd", {
    projectId: proj.id,
    account: ens.account.id,
    kind,
  });
  return ens.account;
}

export function formatOpsLedgerPlain(ledger = loadOpsLedger()) {
  const sum = summarizeOpsLedger(ledger);
  const blocks = [
    `Projects: ${sum.projectCount} · accounts: ${sum.accountCount} · bal ${formatUsd(sum.balanceUsd)} · debts ${formatUsd(sum.debtBalanceUsd)}`,
    `~Income ${formatUsd(sum.otherIncomeMonthlyUsd)}/mo · ~expenses ${formatUsd(sum.expensesMonthlyUsd)}/mo · net ${formatUsd(sum.netOtherMonthlyUsd)}/mo`,
  ];
  for (const p of ledger.projects || []) {
    blocks.push("");
    blocks.push(
      formatAccountsPlain(p.accounts || [], {
        title: `Project ${p.name} (${p.id})`,
      }),
    );
  }
  if (sum.staleIds.length) {
    blocks.push("");
    blocks.push(`Stale / never updated: ${sum.staleIds.slice(0, 10).join(", ")}`);
  }
  return blocks.join("\n");
}

export { parsePeriod, findAccount };
