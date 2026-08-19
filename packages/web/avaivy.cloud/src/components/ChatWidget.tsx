"use client";

import { useState, useRef, useEffect } from "react";
import styles from "./ChatWidget.module.css";

interface Message { role: "user" | "ava"; text: string; }

export default function ChatWidget() {
  const [messages, setMessages] = useState<Message[]>([
    { role: "ava", text: "Aloha — I'm Ava. Ask me anything about the Root Server, RootMC, solar, or Kīlauea." }
  ]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function send() {
    const text = input.trim();
    if (!text || loading) return;
    setInput("");
    setMessages(prev => [...prev, { role: "user", text }]);
    setLoading(true);
    try {
      const r = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text }),
      });
      const data = await r.json();
      setMessages(prev => [...prev, { role: "ava", text: data.reply || data.error || "No response." }]);
    } catch {
      setMessages(prev => [...prev, { role: "ava", text: "Connection issue — I may be offline right now." }]);
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
            <p>{m.text}</p>
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
      <div className={styles.inputRow}>
        <input
          className={styles.input}
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => e.key === "Enter" && send()}
          placeholder="Ask Ava something…"
          disabled={loading}
        />
        <button className={styles.btn} onClick={send} disabled={loading || !input.trim()}>
          Send
        </button>
      </div>
    </div>
  );
}
