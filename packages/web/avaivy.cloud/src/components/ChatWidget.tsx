"use client";

import { useState, useRef, useEffect, type ReactNode } from "react";
import styles from "./ChatWidget.module.css";
import { CHIPS, GREETING } from "@/lib/publicReplies";

interface Message { role: "user" | "ava"; text: string; }

function renderText(text: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const re =
    /\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)|(https?:\/\/[^\s]+?)(?=[.,;:!?]?(?:\s|$))|(\bplay\.rootmc\.net\b)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let key = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) nodes.push(text.slice(last, m.index));
    if (m[1] && m[2]) {
      nodes.push(
        <a key={key++} href={m[2]} target="_blank" rel="noopener noreferrer">
          {m[1]}
        </a>,
      );
    } else {
      const href = m[3] || `https://${m[4]}`;
      const label = m[3] || m[4];
      nodes.push(
        <a key={key++} href={href} target="_blank" rel="noopener noreferrer">
          {label}
        </a>,
      );
    }
    last = m.index + m[0].length;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

export default function ChatWidget() {
  const [messages, setMessages] = useState<Message[]>([
    { role: "ava", text: GREETING },
  ]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  function push(role: Message["role"], text: string) {
    setMessages((prev) => [...prev, { role, text }]);
  }

  async function sendText(text: string) {
    const trimmed = text.trim();
    if (!trimmed || loading) return;
    setInput("");
    push("user", trimmed);
    setLoading(true);
    try {
      const r = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ message: trimmed }),
      });
      const data = await r.json().catch(() => ({}));
      push("ava", data.reply || data.error || GREETING);
    } catch {
      push("ava", "Connection dropped — I may be on solar night. Try https://avaivy.cloud/status or https://rootrecord.online.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className={styles.widget}>
      <div className={styles.messages}>
        {messages.map((m, i) => (
          <div key={i} className={`${styles.msg} ${m.role === "user" ? styles.user : styles.ava}`}>
            {m.role === "ava" && <span className={styles.avaMark}>◈</span>}
            <p className={styles.bubble}>{renderText(m.text)}</p>
          </div>
        ))}
        {loading && (
          <div className={`${styles.msg} ${styles.ava}`}>
            <span className={styles.avaMark}>◈</span>
            <p className={styles.thinking}>thinking…</p>
          </div>
        )}
        <div ref={bottomRef} />
      </div>
      <div className={styles.chips}>
        {CHIPS.map((g) => (
          <button key={g.id} type="button" className={styles.chip} onClick={() => void sendText(g.label)}>
            {g.label}
          </button>
        ))}
      </div>
      <div className={styles.inputRow}>
        <input
          className={styles.input}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && void sendText(input)}
          placeholder="Ask Ava something…"
          disabled={loading}
        />
        <button className={styles.btn} onClick={() => void sendText(input)} disabled={loading || !input.trim()}>
          Send
        </button>
      </div>
    </div>
  );
}
