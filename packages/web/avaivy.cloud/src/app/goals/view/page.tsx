"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { GOALS_API, goalProgressPct, usd, type PublicGoal } from "@/lib/goals-api";
import styles from "../goals.module.css";
import DonatePanel from "@/components/goals/DonatePanel";
import MonetaryGoalArticle from "@/components/goals/MonetaryGoalArticle";

function GoalBody() {
  const search = useSearchParams();
  const id = String(search.get("id") || "");
  const donated = search.get("donated");
  const [goal, setGoal] = useState<PublicGoal | null>(null);
  const [err, setErr] = useState("");

  useEffect(() => {
    if (!id) {
      setErr("Missing goal id.");
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const r = await fetch(`${GOALS_API}/public/g/${encodeURIComponent(id)}`, {
          signal: AbortSignal.timeout(12000),
        });
        const j = (await r.json()) as { goal?: PublicGoal; detail?: string };
        if (cancelled) return;
        if (!r.ok || !j.goal) {
          setErr(String(j.detail || "Goal not found."));
          return;
        }
        setGoal(j.goal);
        document.title = `${j.goal.title} — Ava Goals`;
      } catch (ex) {
        if (!cancelled) setErr(ex instanceof Error ? ex.message : "failed");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id]);

  if (err) return <p className={styles.err}>{err}</p>;
  if (!goal) return <p className={styles.empty}>Loading goal…</p>;

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
        {donated ? <p className={styles.ok}>Thank you — the Stripe donation is recorded.</p> : null}
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
        {money ? (
          <>
            <p className={styles.meta} style={{ marginTop: 12 }}>
              100 goal tokens = 100% of the target. A $1 landed deposit on a $100 goal mints 1 token
              after ATA rent. Over 100% still mints.
            </p>
            <MonetaryGoalArticle goal={goal} />
          </>
        ) : null}
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

export default function GoalViewPage() {
  return (
    <Suspense fallback={<p className={styles.empty}>Loading goal…</p>}>
      <GoalBody />
    </Suspense>
  );
}
