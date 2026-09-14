import Link from "next/link";
import styles from "./goals.module.css";

export default function GoalsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className={styles.shell}>
      <nav className={styles.subnav} aria-label="Goals">
        <Link href="/goals">Public</Link>
        <Link href="/goals/new">Post a goal</Link>
        <Link href="/login">Sign in</Link>
      </nav>
      <main className={styles.main}>{children}</main>
    </div>
  );
}
