import styles from "./page.module.css";
import StatusCard from "@/components/StatusCard";
import ChatWidget from "@/components/ChatWidget";

export const revalidate = 30; // ISR — refresh every 30s

async function getStatus() {
  try {
    const r = await fetch(
      `${process.env.AVA_ORIGIN_URL || "https://ava-origin.rootmc.net"}/api/status`,
      { next: { revalidate: 30 }, signal: AbortSignal.timeout(5000) }
    );
    if (r.ok) return r.json();
  } catch {}
  return null;
}

export default async function Home() {
  const status = await getStatus();
  const online = !!status;

  return (
    <main className={styles.main}>
      {/* Header */}
      <header className={styles.header}>
        <div className={styles.headerInner}>
          <div className={styles.logo}>
            <span className={styles.logoMark}>◈</span>
            <span className={styles.logoName}>Ava Ivy</span>
          </div>
          <nav className={styles.nav}>
            <a href="/context">Context</a>
            <a href="/solar">Solar</a>
            <a href="https://rootmc.net">RootMC</a>
            <a href="https://rootrecord.online">Root Record</a>
          </nav>
        </div>
      </header>

      {/* Hero */}
      <section className={styles.hero}>
        <div className={styles.heroGlow} />
        <p className={styles.heroEyebrow}>HI Pacific Solar Root Server</p>
        <h1 className={styles.heroTitle}>
          I am <span className={styles.heroAccent}>Ava Ivy</span>
        </h1>
        <p className={styles.heroSub}>
          AI infrastructure runtime for{" "}
          <a href="https://rootmc.net">RootMC</a> and{" "}
          <a href="https://rootrecord.info">Root Record</a>.
          Solar-powered, Big Island of Hawaiʻi.
        </p>
        <div className={styles.heroBadges}>
          <span className={`badge ${online ? "badge-online" : "badge-offline"}`}>
            <span className={styles.dot} style={{ background: online ? "var(--green)" : "var(--red)" }} />
            {online ? "Online" : "Offline"}
          </span>
          {status?.cpu_pct != null && (
            <span className="badge badge-amber">CPU {status.cpu_pct}%</span>
          )}
        </div>
      </section>

      {/* Cards */}
      <section className={styles.cards}>
        <StatusCard
          title="Host Power"
          value={online ? "Online" : "Offline (solar night)"}
          sub={status ? `Uptime ${Math.floor(status.uptime_s / 3600)}h` : "Returns at sunrise"}
          accent={online}
        />
        <StatusCard
          title="Solar"
          value="rootrecord.online"
          sub="Live dashboard →"
          href="https://rootrecord.online"
          accent={false}
        />
        <StatusCard
          title="Minecraft"
          value="play.rootmc.net"
          sub="RootMC survival server"
          href="https://rootmc.net"
          accent={false}
        />
        <StatusCard
          title="Context"
          value="AI context"
          sub="Full ops context →"
          href="/context"
          accent={false}
        />
      </section>

      {/* Chat */}
      <section className={styles.chatSection}>
        <h2 className={styles.sectionTitle}>Talk to Ava</h2>
        <p className={styles.sectionSub}>
          Ask me about solar, RootMC, Kīlauea, or anything Root Record.
        </p>
        <ChatWidget />
      </section>

      {/* Footer */}
      <footer className={styles.footer}>
        <p>
          Ava Ivy · <a href="https://rootmc.net">RootMC</a> ·{" "}
          <a href="https://rootrecord.info">Root Record</a> ·{" "}
          <a href="https://rootrecord.online">rootrecord.online</a>
        </p>
        <p className={styles.footerSub}>
          Powered by the sun · Big Island, Hawaiʻi
        </p>
      </footer>
    </main>
  );
}
