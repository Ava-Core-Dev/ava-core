import catalog from "../../goals.json";
import styles from "./goals.module.css";

export const revalidate = 60;

type Factors = {
  operational_impact: number;
  cost_efficiency: number;
  funding_readiness: number;
  strategic_fit: number;
  time_sensitivity: number;
};

type Helper = {
  who?: string;
  amount_usd?: number;
  note?: string;
  at?: string;
};

type Goal = {
  goal_id: string;
  title: string;
  category: string;
  status: string;
  description: string;
  monetary_target_usd: number | null;
  amount_raised_usd: number;
  percent_complete?: number;
  completion_date_est?: string | null;
  funding_source: string;
  hardware?: string[];
  hardware_notes?: string;
  factors: Factors;
  helpers: Helper[];
  progress_notes?: string[];
  priority_score?: number;
};

type Catalog = {
  funding_rules: { summary: string };
  priority_weights: Factors;
  goals: Goal[];
};

const ORIGIN = process.env.AVA_ORIGIN_URL || "https://ava-origin.rootmc.net";

function score(factors: Factors, weights: Factors): number {
  return (
    weights.operational_impact * factors.operational_impact +
    weights.cost_efficiency * factors.cost_efficiency +
    weights.funding_readiness * factors.funding_readiness +
    weights.strategic_fit * factors.strategic_fit +
    weights.time_sensitivity * factors.time_sensitivity
  );
}

function usd(n: number | null | undefined): string {
  if (n == null) return "—";
  return `$${Number(n).toFixed(n % 1 ? 2 : 0)}`;
}

async function load(): Promise<Catalog> {
  try {
    const r = await fetch(`${ORIGIN}/api/goals`, {
      next: { revalidate: 60 },
      signal: AbortSignal.timeout(8000),
    });
    if (r.ok) {
      const live = (await r.json()) as Catalog;
      if (Array.isArray(live.goals) && live.goals.length) return live;
    }
  } catch {
    /* origin down — use the git catalog */
  }
  const fallback = catalog as Catalog;
  const weights = fallback.priority_weights;
  const goals = [...fallback.goals]
    .map((g) => ({ ...g, priority_score: Math.round(score(g.factors, weights) * 100) / 100 }))
    .sort((a, b) => (b.priority_score || 0) - (a.priority_score || 0));
  return { ...fallback, goals };
}

export const metadata = {
  title: "Ava Ivy — Goals",
  description: "Standalone Ava wishlist records. Ava allocation only — never player Gold or the ops buffer.",
};

export default async function GoalsPage() {
  const data = await load();
  return (
    <main className={styles.wrap}>
      <p className={styles.eyebrow}>Wishlist</p>
      <h1>Goals</h1>
      <p className={styles.blurb}>{data.funding_rules.summary}</p>
      <p className={styles.weights}>
        Auto-rank: operational impact 40% · cost efficiency 20% · funding readiness 15% ·
        strategic fit 15% · time sensitivity 10%. Raised totals are only what has been recorded
        — never invented.
      </p>
      <ol className={styles.list}>
        {data.goals.map((g) => {
          const target = g.monetary_target_usd;
          const raised = Number(g.amount_raised_usd || 0);
          const money = target != null && target > 0;
          const pct = money
            ? Math.min(100, Math.round((raised / target) * 100))
            : Math.max(0, Math.min(100, Math.floor(Number(g.percent_complete) || 0)));
          return (
            <li key={g.goal_id} className={styles.card} id={g.goal_id}>
              <div className={styles.head}>
                <span className={styles.status}>{g.status}</span>
                <span className={styles.cat}>{g.category}</span>
                <span className={styles.score}>priority {g.priority_score}</span>
              </div>
              <h2>{g.title}</h2>
              <p className={styles.id}>{g.goal_id}</p>
              <p>{g.description}</p>
              {g.hardware?.length ? (
                <ul className={styles.hw}>
                  {g.hardware.map((h) => (
                    <li key={h}>{h}</li>
                  ))}
                </ul>
              ) : null}
              {g.hardware_notes ? <p className={styles.note}>{g.hardware_notes}</p> : null}
              <dl className={styles.meta}>
                <div>
                  <dt>{money ? "Target" : "Progress"}</dt>
                  <dd>{money ? usd(target) : `${pct}%`}</dd>
                </div>
                <div>
                  <dt>{money ? "Raised" : "Est. complete"}</dt>
                  <dd>{money ? usd(raised) : g.completion_date_est || "—"}</dd>
                </div>
                <div>
                  <dt>Funding</dt>
                  <dd>{g.funding_source}</dd>
                </div>
              </dl>
              <div
                className={styles.meter}
                aria-label={money ? `${pct}% raised` : `${pct}% complete`}
              >
                <span style={{ width: `${pct}%` }} />
              </div>
              {g.helpers?.length ? (
                <div className={styles.helpers}>
                  <h3>Helpers</h3>
                  <ul>
                    {g.helpers.map((h, i) => (
                      <li key={`${h.at || i}`}>
                        {h.who || "helper"}
                        {h.amount_usd ? ` · ${usd(h.amount_usd)}` : ""}
                        {h.note ? ` — ${h.note}` : ""}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : (
                <p className={styles.note}>No helpers recorded yet.</p>
              )}
            </li>
          );
        })}
      </ol>
    </main>
  );
}
