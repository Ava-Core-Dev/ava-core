import { notFound } from "next/navigation";
import { GOALS_API, goalProgressPct, usd, type PublicGoal } from "@/lib/goals-api";
import styles from "../goals.module.css";
import DonatePanel from "@/components/goals/DonatePanel";

export const revalidate = 20;

async function loadGoal(id: string): Promise<PublicGoal | null> {
  try {
    const r = await fetch(`${GOALS_API}/public/g/${id}`, {
      next: { revalidate: 20 },
      signal: AbortSignal.timeout(10000),
    });
    if (!r.ok) return null;
    const j = (await r.json()) as { goal?: PublicGoal };
    return j.goal || null;
  } catch {
    return null;
  }
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const goal = await loadGoal(id);
  return {
    title: goal ? `${goal.title} — Ava Goals` : "Goal — Ava Ivy",
    description: goal?.purpose || "Public Ava goal",
    openGraph: goal?.image_url ? { images: [goal.image_url] } : undefined,
  };
}

export default async function AvaGoalPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ donated?: string }>;
}) {
  const { id } = await params;
  const q = await searchParams;
  const goal = await loadGoal(id);
  if (!goal) notFound();
  const target = Number(goal.estimated_cost_cents || 0);
  const raised = Number(goal.raised_cents || 0);
  const money = goal.requires_money !== false && target > 0;
  const pct = goalProgressPct(goal);
  const meta = money
    ? `${usd(raised)} raised${target ? ` of ${usd(target)} (${pct}%)` : ""}${goal.token_symbol ? ` · token ${goal.token_symbol}` : ""}`
    : `${pct}% complete${goal.target_date_est ? ` · est completion ${goal.target_date_est}` : ""}${goal.token_symbol ? ` · token ${goal.token_symbol}` : ""}`;

  return (
    <div className={styles.detail}>
      <div>
        <div className={styles.kicker}>
          {goal.is_server_goal ? "Ava · server goal" : "Community goal"}
          {money ? "" : " · non-monetary"}
          {goal.donate_wallet ? " · isolated wallet" : ""}
        </div>
        <h1 style={{ fontSize: 36, letterSpacing: "-0.04em", margin: "8px 0 12px" }}>{goal.title}</h1>
        {q.donated ? <p className={styles.ok}>Thank you — the Stripe donation is recorded.</p> : null}
        <p style={{ color: "var(--muted)", marginBottom: 18, whiteSpace: "pre-wrap" }}>
          {goal.purpose || "No write-up yet."}
        </p>
        <div
          className={styles.art}
          style={goal.image_url ? { backgroundImage: `url(${goal.image_url})` } : undefined}
        />
        <div className={styles.meta} style={{ marginTop: 16 }}>
          {meta}
        </div>
        <div className={styles.meter} style={{ marginTop: 10 }}>
          <span style={{ width: `${pct}%` }} />
        </div>
        <p className={styles.meta} style={{ marginTop: 12 }}>
          Also on{" "}
          <a href={`https://g.rootrecord.info/goals/${goal.id}`} target="_blank" rel="noreferrer">
            g.rootrecord.info
          </a>
        </p>
      </div>
      <DonatePanel goal={goal} />
    </div>
  );
}
