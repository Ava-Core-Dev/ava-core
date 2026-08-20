import styles from "./page.module.css";
import GuestChat from "@/components/GuestChat";

export const metadata = {
  title: "Updates — Root Record",
  description: "Product, real-world, and business ops updates from Root Record.",
};

const POSTS = [
  {
    date: "2026-08-19",
    title: "Three blogs, one operator",
    body: "This page is Root Record: solar, Kīlauea, Goals, business ops. Minecraft changelogs — including the full May–August 2026 timeline — live on rootmc.net/blog. Ava platform notes live on avaivy.cloud/blog. Player Discord stays the morning boot report only.",
  },
  {
    date: "2026-08-19",
    title: "Ops reports stay off player Discord",
    body: "Product, solar, Kīlauea, and business briefs go to Slack and Alexrs94. Discord players only see Ava's morning boot report in #updates. Kīlauea briefs stay Hawaiʻi-scoped; charts stay on rootrecord.online.",
  },
  {
    date: "2026-08-18",
    title: "MagmaAlert pack and the solar desk",
    body: "The 18 Aug archive holds MagmaAlert APKs and web assets for the Kīlauea consumer surface. Same window: Ava's desk FastAPI origin, Ollama, D1 heartbeat. Host-power (battery, CPU, solar) is what RootMC players already feel as mining multipliers and tax — game writeup is rootmc.net/blog/age-of-ava/.",
  },
  {
    date: "2026-08-09",
    title: "Morning merged reports (solar, weather, HVO)",
    body: "9–13 Aug Ava posted merged mornings that mixed player census, Root-Economy, solar/host, NWS, and HVO Kīlauea. Those posts were the public pulse. They now land here and in Slack, not in player Discord.",
  },
  {
    date: "2026-08-03",
    title: "Solar Gold multiplier on the live economy",
    body: "Root-Economy 1.8.1 fixed the solar Gold multiplier so watts on the host actually move in-game rates. That is a Root Record sensor feeding a RootMC rule. Skills XP later scaled the same way in the Age of Ava pack.",
  },
  {
    date: "2026-06-27",
    title: "Minecraft leaves the Root Record monorepo",
    body: "27 Jun 2026 RootMC sources moved into their own workspace with Change Logs/. Solar, volcano, and business product stayed here. Ava still sits on both brands. Minecraft history from that split forward is reconstructed at rootmc.net/blog/changelog-discipline/.",
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
