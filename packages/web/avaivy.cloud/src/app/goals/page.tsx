import Link from "next/link";
import { GOALS_API, goalProgressPct, usd, type PublicGoal } from "@/lib/goals-api";
import styles from "./goals.module.css";

export const revalidate = 30;

export const metadata = {
  title: "Ava Ivy — Goals",
  description: "Ava’s public goals — each with its own donate wallet, progress bar, and Root Record page.",
};

async function loadServerGoals(): Promise<PublicGoal[]> {
  try {
    const r = await fetch(`${GOALS_API}/public/server/goals`, {
      next: { revalidate: 30 },
      signal: AbortSignal.timeout(10000),
    });
    if (!r.ok) return [];
    const j = (await r.json()) as { goals?: PublicGoal[] };
    return Array.isArray(j.goals) ? j.goals : [];
  } catch {
    return [];
  }
}

function Poster({ goal }: { goal: PublicGoal }) {
  const target = Number(goal.estimated_cost_cents || 0);
  const raised = Number(goal.raised_cents || 0);
  const money = goal.requires_money !== false && target > 0;
  const pct = goalProgressPct(goal);
  const meta = money
    ? `${usd(raised)}${target ? ` of ${usd(target)}` : " raised"}${goal.token_symbol ? ` · $${goal.token_symbol}` : ""}`
    : `${pct}% complete${goal.target_date_est ? ` · est ${goal.target_date_est}` : ""}`;
  return (
    <Link href={`/goals/view?id=${encodeURIComponent(goal.id)}`} className={styles.poster}>
      <div
        className={styles.posterImg}
        style={goal.image_url ? { backgroundImage: `url(${goal.image_url})` } : undefined}
      />
      <div className={styles.posterBody}>
        <div className={styles.kicker}>
          Ava · server
          {money ? "" : " · progress"}
          {goal.donate_wallet ? " · isolated wallet" : ""}
        </div>
        <h3>{goal.title}</h3>
        <div className={styles.meta}>{meta}</div>
        <div className={styles.meter}>
          <span style={{ width: `${pct}%` }} />
        </div>
      </div>
    </Link>
  );
}

export default async function AvaGoalsPage() {
  const goals = await loadServerGoals();
  return (
    <>
      <section className={styles.hero}>
        <h1>Ava’s goals — each one isolated.</h1>
        <p>
          Every public Ava goal has its own Solana donate wallet, progress bar, and page. Money goals
          track raised USD; non-monetary goals track percent complete and an estimated completion
          date. Funded from Ava allocation only — never player Gold or the ops buffer.
        </p>
      </section>

      <div className={styles.sectionHead}>
        <h2>Ava · server goals</h2>
        <Link href="/goals/new">Post yours</Link>
      </div>
      {goals.length ? (
        <div className={styles.grid}>
          {goals.map((g) => (
            <Poster key={g.id} goal={g} />
          ))}
        </div>
      ) : (
        <p className={styles.empty}>No Ava server goals published yet.</p>
      )}
    </>
  );
}
