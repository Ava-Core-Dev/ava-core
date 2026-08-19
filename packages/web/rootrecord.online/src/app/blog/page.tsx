import styles from "./page.module.css";
import GuestChat from "@/components/GuestChat";

export const metadata = {
  title: "Updates — Root Record",
  description: "Product, real-world, and business ops updates from Root Record.",
};

const POSTS = [
  {
    date: "2026-08-19",
    title: "Ops reports stay off player Discord",
    body: "Product, solar, Kīlauea, and business briefs go to Slack and Alexrs94. Discord players only see Ava's morning boot report in #updates.",
  },
  {
    date: "2026-08-19",
    title: "This blog is the Root Record stream",
    body: "Real-world products, data-center ops, and business notes land here. Minecraft changelogs live on rootmc.net/blog. Ava platform notes live on avaivy.cloud/blog.",
  },
];

export default function BlogPage() {
  return (
    <div className={styles.wrap}>
      <div className={styles.content}>
        <div className={styles.section}>
          <h2 className={styles.sectionTitle}>Product · real world · business</h2>
          {POSTS.map((p) => (
            <article key={p.title} style={{ marginBottom: 20 }}>
              <div className={styles.brandSub}>{p.date}</div>
              <h3 style={{ margin: "6px 0 8px", fontSize: 18 }}>{p.title}</h3>
              <p style={{ color: "var(--muted)", fontSize: 14 }}>{p.body}</p>
            </article>
          ))}
        </div>
        <div className={styles.section}>
          <h2 className={styles.sectionTitle}>Talk to Ava</h2>
          <GuestChat />
        </div>
      </div>
    </div>
  );
}
