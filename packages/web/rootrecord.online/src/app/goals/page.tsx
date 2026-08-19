import Link from "next/link";
import { GOALS_API, usd, type PublicGoal } from "@/lib/goals-api";
import styles from "./goals.module.css";

export const revalidate = 30;

async function load(kind: "server" | "all"): Promise<PublicGoal[]> {
  const path = kind === "server" ? "/public/server/goals" : "/public/catalog";
  try {
    const r = await fetch(`${GOALS_API}${path}`, {
      next: { revalidate: 30 },
      signal: AbortSignal.timeout(8000),
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
  const pct = target > 0 ? Math.min(100, Math.round((raised / target) * 100)) : 0;
  return (
    <Link href={`/goals/${goal.id}`} className={styles.poster}>
      <div
        className={styles.posterImg}
        style={goal.image_url ? { backgroundImage: `url(${goal.image_url})` } : undefined}
      />
      <div className={styles.posterBody}>
        <div className={styles.kicker}>{goal.is_server_goal ? "Ava · server" : "Community"}</div>
        <h3>{goal.title}</h3>
        <div className={styles.meta}>
          {usd(raised)}
          {target ? ` of ${usd(target)}` : " raised"}
          {goal.token_symbol ? ` · $${goal.token_symbol}` : ""}
        </div>
        {target > 0 ? (
          <div className={styles.meter}>
            <span style={{ width: `${pct}%` }} />
          </div>
        ) : null}
      </div>
    </Link>
  );
}

export default async function GoalsHome() {
  const [ava, all] = await Promise.all([load("server"), load("all")]);
  const community = all.filter((g) => !g.is_server_goal);
  return (
    <>
      <section className={styles.hero}>
        <h1>Public goals with a face, a token, and a wallet.</h1>
        <p>
          Anyone with a Root Record account can post a goal. It gets its own page, a Solana
          token using the uploaded image, a custodial donate wallet (SOL / USDC), and a Stripe
          payment link. Official Ava goals are marked Ava · server.
        </p>
      </section>

      <div className={styles.sectionHead}>
        <h2>Ava · server goals</h2>
        <Link href="/goals/new">Post yours</Link>
      </div>
      {ava.length ? (
        <div className={styles.grid}>
          {ava.map((g) => (
            <Poster key={g.id} goal={g} />
          ))}
        </div>
      ) : (
        <p className={styles.empty}>No server goals published yet.</p>
      )}

      <div className={styles.sectionHead}>
        <h2>Community</h2>
      </div>
      {community.length ? (
        <div className={styles.grid}>
          {community.map((g) => (
            <Poster key={g.id} goal={g} />
          ))}
        </div>
      ) : (
        <p className={styles.empty}>No community goals yet.</p>
      )}
    </>
  );
}
