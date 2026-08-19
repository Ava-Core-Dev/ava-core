import Link from "next/link";
import styles from "./goals.module.css";

export default function GoalsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className={styles.shell}>
      <header className={styles.header}>
        <div className={styles.headerInner}>
          <Link href="/goals" className={styles.brand}>
            <span style={{ color: "var(--accent)" }}>◈</span>
            Root Record <em>Goals</em>
          </Link>
          <nav className={styles.nav}>
            <Link href="/">Live</Link>
            <Link href="/goals">Public</Link>
            <Link href="/goals/new">Post a goal</Link>
            <Link href="/login">Sign in</Link>
          </nav>
        </div>
      </header>
      <main className={styles.main}>{children}</main>
    </div>
  );
}
