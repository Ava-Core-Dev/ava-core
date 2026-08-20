import LivePlayer from "@/components/LivePlayer";
import styles from "./page.module.css";
import StatusCard from "@/components/StatusCard";
import ChatWidget from "@/components/ChatWidget";
import content from "@/content.json";
import { getHostStatus } from "@/lib/status";

export const revalidate = 30; // ISR — refresh every 30s

export default async function Home() {
  const status = await getHostStatus();
  const online = !!status;
  const { site, cards, chat } = content;

  // Cards marked `live: "host"` take their text from the origin instead of JSON.
  const hostCard = {
    value: online ? "Online" : "Offline",
    sub: status
      ? `Uptime ${Math.floor(status.uptime_s / 3600)}h · CPU ${status.cpu_pct}%`
      : "Host is powered down or unreachable",
  };

  return (
    <>
      <section className={styles.hero}>
        <div className={styles.heroGlow} />
        <p className={styles.heroEyebrow}>{site.eyebrow}</p>
        <h1 className={styles.heroTitle}>
          {site.titleLead} <span className={styles.heroAccent}>{site.titleAccent}</span>
        </h1>
        <p className={styles.heroSub}>{site.tagline}</p>
        <div className={styles.heroBadges}>
          <span className={`badge ${online ? "badge-online" : "badge-offline"}`}>
            <span
              className={styles.dot}
              style={{ background: online ? "var(--green)" : "var(--red)" }}
            />
            {online ? "Online" : "Offline"}
          </span>
          {status?.streaming && (
            <a href="/live" className="badge badge-offline" style={{ textDecoration: "none" }}>
              <span className={styles.dot} style={{ background: "var(--red)" }} />
              Live
            </a>
          )}
          {status?.cpu_pct != null && (
            <span className="badge badge-amber">CPU {status.cpu_pct}%</span>
          )}
        </div>
      </section>

      <LivePlayer variant="home" />

      <section className={styles.cards}>
        {cards.map((card) => (
          <StatusCard
            key={card.title}
            title={card.title}
            value={card.live === "host" ? hostCard.value : card.value}
            sub={card.live === "host" ? hostCard.sub : card.sub}
            href={card.href}
            accent={card.live === "host" ? online : false}
          />
        ))}
      </section>

      <section className={styles.chatSection}>
        <h2 className={styles.sectionTitle}>{chat.title}</h2>
        <p className={styles.sectionSub}>{chat.sub}</p>
        <ChatWidget />
      </section>
    </>
  );
}
