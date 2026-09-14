import type { Metadata } from "next";
import ChatWidget from "@/components/ChatWidget";
import content from "@/content.json";
import styles from "./page.module.css";

export const metadata: Metadata = {
  title: "Ava Ivy",
  description:
    "Talk with Ava Ivy on the HI Pacific Solar Root Server. Live solar and status stay on their own pages.",
};

export default function Home() {
  const { chat } = content;
  return (
    <>
      <main className={styles.hero}>
        <p className={styles.eyebrow}>Ava Ivy</p>
        <h1 className={styles.title}>Solar Root Server</h1>
        <p className={styles.lead}>
          Talk here. The live bank and solar board are on Status and Solar — not
          inside this page.
        </p>
        <div className={styles.actions}>
          <a className={styles.primary} href="#talk">
            Talk with Ava
          </a>
          <a className={styles.secondary} href="/blog">
            Updates
          </a>
        </div>
      </main>
      <section className={styles.chatSection} id="talk">
        <h2 className={styles.sectionTitle}>{chat.title}</h2>
        <p className={styles.sectionSub}>{chat.sub}</p>
        <ChatWidget />
      </section>
      <section className={styles.tutorial} aria-labelledby="ava-guide">
        <h2 id="ava-guide">Using this chat</h2>
        <p>
          Ava Ivy runs on the HI Pacific Solar Root Server on Hawaiʻi Island.
          This page is the public chat door. Type a message and she answers.
        </p>

        <h3>What this chat is</h3>
        <p>
          A public desk for questions about the solar host, live weather, the
          packs, Kīlauea, and RootMC — plus ordinary conversation. Live bank and
          solar numbers stay on Status and Solar. Open those doors when you want
          the full board.
        </p>

        <h3>How to talk</h3>
        <p>
          Write in plain words. Ask one thing at a time when you want a live
          number. She only speaks figures that are on the board right now. Night
          solar near zero is normal.
        </p>
        <p>
          In Telegram she is the same Ava. In a group she stays quiet unless
          someone speaks to her. On this page, sending a message is speaking to
          her.
        </p>

        <h3>What she can answer</h3>
        <ul>
          <li>
            <strong>This chat</strong> — the solar host, weather, Kīlauea,
            RootMC when you ask for the game, and general talk.
          </li>
          <li>
            <strong>Status and Solar</strong> — live desk for packs, bank, this
            host, and averages. Same board, two doors.
          </li>
          <li>
            <strong>Kīlauea</strong> — alerts and the public app at kilauea.cloud.
            She will not invent an alert level. Ask her to check a cam if you
            want what the still shows right now.
          </li>
          <li>
            <strong>RootMC</strong> — survival Minecraft at play.rootmc.net.
            Gold, claims, votes. Player Discord when you want the crew.
          </li>
          <li>
            <strong>Weather and storms</strong> — live weather lines for wind,
            hazards, and alerts. A named storm near Hawaiʻi is not “none.”
          </li>
          <li>
            <strong>Solar and packs</strong> — both packs by name (DELTA 2 and
            RIVER 2 Pro), then the bank. She will not make up watts.
          </li>
        </ul>

        <h3>Limits</h3>
        <p>
          She will not invent membership counts, wallet balances, or hardware
          that is not live. She will not invent a fact about you. If she does
          not know, she will ask or say she does not have it. Packs are DELTA 2
          and RIVER 2 Pro.
        </p>

        <h3>Free turns and membership</h3>
        <p>
          A few free live turns are available here. A RootMC login keeps a longer
          custom talk going. Status, Solar, and this guide stay free.
        </p>
      </section>
    </>
  );
}
