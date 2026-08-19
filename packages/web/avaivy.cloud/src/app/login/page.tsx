import styles from "../page.module.css";
import blog from "../blog/blog.module.css";
import content from "@/content.json";

export const metadata = {
  title: "Log in — Ava Ivy",
  description: "Log in to talk with Ava on avaivy.cloud.",
};

export default function LoginPage() {
  const { site, nav } = content;
  return (
    <main className={styles.main}>
      <header className={styles.header}>
        <div className={styles.headerInner}>
          <a className={styles.logo} href="/">
            <span className={styles.logoMark}>{site.logoMark}</span>
            <span className={styles.logoName}>{site.name}</span>
          </a>
          <nav className={styles.nav}>
            {nav.map((item) => (
              <a key={item.href} href={item.href}>{item.label}</a>
            ))}
          </nav>
        </div>
      </header>
      <section className={blog.wrap}>
        <p className={blog.eyebrow}>Account</p>
        <h1 className={blog.title}>Log in to talk</h1>
        <p className={blog.lead}>
          The chat panel stays visible. Typed live talk needs an account.
          Free: 1 live use per IP, unlimited canned answers, 3 resources.
        </p>
        <article className={blog.card}>
          <h2>Continue</h2>
          <p>
            Use your RootMC web account (Discord). Same login unlocks Ava on avaivy.cloud.
          </p>
          <p style={{ marginTop: 16 }}>
            <a href="https://rootmc.net/login/">Log in at rootmc.net →</a>
          </p>
        </article>
      </section>
    </main>
  );
}
