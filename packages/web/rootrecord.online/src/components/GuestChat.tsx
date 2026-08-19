"use client";

import { useState, type ReactNode } from "react";
import styles from "./GuestChat.module.css";

const GREETING =
  "Aloha — I'm Ava. This dashboard is Root Record (solar, Kīlauea, weather). Minecraft lives at play.rootmc.net. Ask — I'll send links.";

function renderText(text: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const re = /(https?:\/\/[^\s]+?)(?=[.,;:!?]?(?:\s|$))|(\bplay\.rootmc\.net\b)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let key = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) nodes.push(text.slice(last, m.index));
    const href = m[1] || `https://${m[2]}`;
    const label = m[1] || m[2];
    nodes.push(
      <a key={key++} href={href} target="_blank" rel="noopener noreferrer">
        {label}
      </a>,
    );
    last = m.index + m[0].length;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

export default function GuestChat() {
  const [log, setLog] = useState([{ who: "ava", text: GREETING }]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);

  async function send(text: string) {
    const trimmed = text.trim();
    if (!trimmed || busy) return;
    setInput("");
    setLog((prev) => [...prev, { who: "you", text: trimmed }]);
    setBusy(true);
    try {
      const r = await fetch("https://avaivy.cloud/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: trimmed }),
      });
      const data = await r.json().catch(() => ({}));
      setLog((prev) => [
        ...prev,
        { who: "ava", text: data.reply || "Host is quiet — try https://rootrecord.online or https://avaivy.cloud/status." },
      ]);
    } catch {
      setLog((prev) => [
        ...prev,
        { who: "ava", text: "Couldn't reach me — https://avaivy.cloud · https://rootrecord.online · join play.rootmc.net" },
      ]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={styles.box}>
      <div className={styles.log}>
        {log.map((m, i) => (
          <div key={i} className={`${styles.msg} ${m.who === "ava" ? styles.ava : styles.user}`}>
            {m.who === "ava" && <span className={styles.avaMark}>◈</span>}
            <p>{renderText(m.text)}</p>
          </div>
        ))}
      </div>
      <div className={styles.chips}>
        {["What is Root Record?", "Solar / host", "Kīlauea", "What's RootMC?"].map((label) => (
          <button key={label} type="button" className={styles.chip} disabled={busy} onClick={() => void send(label)}>
            {label}
          </button>
        ))}
      </div>
      <div className={styles.row}>
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && void send(input)}
          placeholder="Ask Ava something…"
          disabled={busy}
        />
        <button type="button" disabled={busy || !input.trim()} onClick={() => void send(input)}>
          Send
        </button>
      </div>
    </div>
  );
}
