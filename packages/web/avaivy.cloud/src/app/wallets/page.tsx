import content from "../../content.json";
import wallets from "../../wallets.json";
import styles from "../status/goals/goals.module.css";

type Wallet = { name: string; address: string; note?: string };

export const metadata = {
  title: "Ava Ivy — Official wallets",
  description: "Official Ava Core receive addresses. Public keys only.",
};

export default function WalletsPage() {
  return (
    <main className={styles.wrap}>
      <p className={styles.kicker}>
        <a href="/">Ava Ivy</a>
        {" · "}
        <a href="/status/goals">Goals</a>
      </p>
      <h1>{wallets.label}</h1>
      <p className={styles.blurb}>
        These are Ava Core receive addresses only. Do not send player Gold here. Helpers for
        public goals use Ava allocation / earned income.
      </p>
      <ol className={styles.list}>
        {wallets.networks.map((w: Wallet) => (
          <li key={`${w.name}-${w.address}`} className={styles.card}>
            <div className={styles.head}>
              <span className={styles.status}>{w.name}</span>
            </div>
            <p className={styles.id}>{w.address}</p>
            {w.note ? <p className={styles.note}>{w.note}</p> : null}
          </li>
        ))}
      </ol>
      <nav className={styles.links}>
        {content.nav.map((n) => (
          <a key={n.href} href={n.href}>
            {n.label}
          </a>
        ))}
      </nav>
    </main>
  );
}
