import styles from "./page.module.css";
import { getHostStatus, formatUptime } from "@/lib/status";

// Always fresh — a cached status page is worse than no status page.
export const dynamic = "force-dynamic";

export const metadata = {
  title: "Ava Ivy — Host Status",
  description: "Live power and reachability status for the HI Pacific Solar Root Server.",
};

export default async function StatusPage() {
  const status = await getHostStatus(0);
  const online = !!status;

  return (
    <main className={styles.wrap}>
      <div className={styles.card}>
        <span className={online ? styles.badgeOnline : styles.badgeOffline}>
          {online ? "HOST ONLINE" : "HOST OFFLINE"}
        </span>

        <h1 className={styles.title}>Ava Ivy</h1>
        <p className={styles.blurb}>
          {online
            ? "Solar Root Server is powered on and reporting in."
            : "Solar Root Server is powered down or unreachable. It returns when there is sun on the panels."}
        </p>

        <div className={online ? styles.ruleOnline : styles.ruleOffline} />

        {status ? (
          <dl className={styles.stats}>
            <div>
              <dt>Uptime</dt>
              <dd>{formatUptime(status.uptime_s)}</dd>
            </div>
            <div>
              <dt>CPU</dt>
              <dd>{status.cpu_pct}%</dd>
            </div>
            <div>
              <dt>Memory</dt>
              <dd>{status.mem_pct}%</dd>
            </div>
            <div>
              <dt>Host</dt>
              <dd>{status.host}</dd>
            </div>
          </dl>
        ) : (
          <p className={styles.meta}>No response from the origin tunnel.</p>
        )}

        <div className={styles.links}>
          <a href="/status">Retry</a>
          <a href="/status/goals">Goals</a>
          <a href="/">Home</a>
          <a href="https://rootrecord.online">Root Record</a>
          <a href="https://rootmc.net">RootMC</a>
        </div>
      </div>
    </main>
  );
}
