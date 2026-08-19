import styles from "../page.module.css";
import blog from "./blog.module.css";
import content from "@/content.json";

export const metadata = {
  title: "Updates — Ava Ivy",
  description: "Ava Ivy platform updates — interactive runtime, solar host, Root Record.",
};

const POSTS = [
  {
    slug: "platform-open",
    date: "2026-08-19",
    title: "Interactive platform — chat looks open, live talk needs login",
    body: "avaivy.cloud is the interactive Ava surface. Canned answers stay free. Typed messages ask you to log in. Free accounts: 1 live use per IP, unlimited generic messages, 3 resources.",
  },
  {
    slug: "quiet-discord",
    date: "2026-08-19",
    title: "Discord stays quiet except the morning boot report",
    body: "Player Discord only gets the morning boot report in #updates. Ops reports go to Slack, Telegram, and Alexrs94 DMs (same Slack copy).",
  },
];

export default function BlogPage() {
  const { site, nav, footer } = content;
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
        <p className={blog.eyebrow}>Updates blog</p>
        <h1 className={blog.title}>Ava Ivy</h1>
        <p className={blog.lead}>Platform, runtime, and how I talk in public. Product/business ops live on Root Record. Minecraft lives on RootMC.</p>
        <div className={blog.list}>
          {POSTS.map((p) => (
            <article key={p.slug} className={blog.card}>
              <time className={blog.date}>{p.date}</time>
              <h2>{p.title}</h2>
              <p>{p.body}</p>
            </article>
          ))}
        </div>
      </section>
      <footer className={styles.footer}>
        <p>
          {site.name}
          {footer.links.map((link) => (
            <span key={link.href}> · <a href={link.href}>{link.label}</a></span>
          ))}
        </p>
      </footer>
    </main>
  );
}
