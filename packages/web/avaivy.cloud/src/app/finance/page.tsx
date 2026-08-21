import type { Metadata } from "next";
import styles from "./finance.module.css";

export const metadata: Metadata = {
  title: "Ava Ivy — Finance",
  description:
    "Ava’s money board: balances, expected MRR, subscriptions, expenses, income, and the next mandatory goal purchase.",
};

type FinanceBoard = {
  ok?: boolean;
  expectedMrrUsd?: number | null;
  income30dUsd?: number | null;
  updatedAt?: string;
  balances?: Array<{
    id: string;
    label: string;
    amountUsd?: number;
    amountUsdLow?: number;
    amountUsdHigh?: number;
    kind?: string;
    note?: string;
  }>;
  subscriptions?: Array<{
    label: string;
    amountUsd?: number;
    status?: string;
    recentCharges?: number;
  }>;
  nextMandatoryPurchase?: {
    title?: string;
    amountUsd?: number;
    note?: string;
  } | null;
  expenses?: { all?: Array<{ label: string; monthlyUsd?: number; amountUsd?: number; status?: string; project?: string }> };
  income?: { all?: Array<{ label: string; monthlyUsd?: number; amountUsd?: number; status?: string; project?: string }> };
  actions?: Array<{ id?: string; type?: string; label?: string; amountUsd?: number; at?: string }>;
  detail?: string;
};

async function loadBoard(): Promise<FinanceBoard> {
  const bases = [
    process.env.NEXT_PUBLIC_AVA_ORIGIN || "https://ava-origin.rootmc.net",
    "http://127.0.0.1:8787",
  ];
  for (const base of bases) {
    try {
      const res = await fetch(`${base.replace(/\/$/, "")}/api/finance/public`, {
        next: { revalidate: 120 },
      });
      if (!res.ok) continue;
      return (await res.json()) as FinanceBoard;
    } catch {
      /* try next */
    }
  }
  return { ok: false, detail: "Finance API unreachable." };
}

function money(n: number | null | undefined) {
  if (n == null || Number.isNaN(n)) return "—";
  const sign = n < 0 ? "-" : "";
  return `${sign}$${Math.abs(n).toFixed(2)}`;
}

export default async function FinancePage() {
  const board = await loadBoard();
  const expenses = board.expenses?.all || [];
  const income = board.income?.all || [];
  const actions = board.actions || [];
  const subs = board.subscriptions || [];
  const balances = board.balances || [];
  const next = board.nextMandatoryPurchase;

  return (
    <main className={styles.wrap}>
      <p className={styles.eyebrow}>Ava money board</p>
      <h1>Finance</h1>
      <p className={styles.lead}>
        Live aggregates from Ava’s ops ledger and payment snapshot. Gold never converts to
        USD. Totals are only what the desk already recorded.
      </p>

      {!board.ok ? (
        <p className={styles.warn}>{board.detail || "Finance board unavailable."}</p>
      ) : null}

      <section className={styles.stats} aria-label="Snapshot">
        <article>
          <span>Expected MRR</span>
          <strong>{money(board.expectedMrrUsd)}</strong>
        </article>
        <article>
          <span>Income (≈30d)</span>
          <strong>{money(board.income30dUsd)}</strong>
        </article>
        <article>
          <span>Active subs</span>
          <strong>{subs.length}</strong>
        </article>
        <article>
          <span>Updated</span>
          <strong className={styles.small}>
            {board.updatedAt ? board.updatedAt.slice(0, 16).replace("T", " ") : "—"}
          </strong>
        </article>
      </section>

      <div className={styles.actions}>
        <a className={styles.primary} href="https://rootrecord.info/products.html">
          View all services &amp; products
        </a>
        <a className={styles.secondary} href="https://rootrecord.info/services/finance-automation">
          Have Ava manage my finances
        </a>
      </div>

      {next ? (
        <section className={styles.card}>
          <h2>Next mandatory goal purchase</h2>
          <p>
            <strong>{next.title || "Goal"}</strong>
            {next.amountUsd != null ? ` · ${money(next.amountUsd)}` : ""}
          </p>
          {next.note ? <p className={styles.muted}>{next.note}</p> : null}
          <a href="/goals">Open goals →</a>
        </section>
      ) : null}

      <section className={styles.card}>
        <h2>Balances</h2>
        <ul className={styles.list}>
          {balances.map((b) => (
            <li key={b.id}>
              <span>{b.label}</span>
              <strong>
                {b.amountUsdLow != null && b.amountUsdHigh != null
                  ? `${money(b.amountUsdLow)}–${money(b.amountUsdHigh)}`
                  : money(b.amountUsd)}
              </strong>
            </li>
          ))}
        </ul>
      </section>

      <section className={styles.grid2}>
        <div className={styles.card}>
          <h2>Subscriptions</h2>
          <ul className={styles.list}>
            {subs.length === 0 ? <li className={styles.muted}>None recorded.</li> : null}
            {subs.map((s, i) => (
              <li key={`${s.label}-${i}`}>
                <span>
                  {s.label}
                  {s.status ? ` · ${s.status}` : ""}
                </span>
                <strong>{money(s.amountUsd)}</strong>
              </li>
            ))}
          </ul>
        </div>
        <div className={styles.card}>
          <h2>Recent money actions</h2>
          <ul className={styles.list}>
            {actions.length === 0 ? <li className={styles.muted}>None recorded.</li> : null}
            {actions.slice(0, 12).map((a, i) => (
              <li key={a.id || `${a.type}-${i}`}>
                <span>
                  {a.label || a.type || "Action"}
                  {a.at ? ` · ${String(a.at).slice(0, 10)}` : ""}
                </span>
                <strong>{money(a.amountUsd)}</strong>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className={styles.grid2}>
        <div className={styles.card}>
          <h2>Expenses</h2>
          <ul className={styles.list}>
            {expenses.length === 0 ? <li className={styles.muted}>None recorded.</li> : null}
            {expenses.map((e, i) => (
              <li key={`${e.label}-${i}`}>
                <span>
                  {e.label}
                  {e.project ? ` · ${e.project}` : ""}
                </span>
                <strong>{money(e.monthlyUsd ?? e.amountUsd)}</strong>
              </li>
            ))}
          </ul>
        </div>
        <div className={styles.card}>
          <h2>Income</h2>
          <ul className={styles.list}>
            {income.length === 0 ? <li className={styles.muted}>None recorded.</li> : null}
            {income.map((e, i) => (
              <li key={`${e.label}-${i}`}>
                <span>
                  {e.label}
                  {e.project ? ` · ${e.project}` : ""}
                </span>
                <strong>{money(e.monthlyUsd ?? e.amountUsd)}</strong>
              </li>
            ))}
          </ul>
        </div>
      </section>
    </main>
  );
}
