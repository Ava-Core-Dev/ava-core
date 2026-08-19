"use client";

import { useState, useRef, useEffect } from "react";
import styles from "./ChatWidget.module.css";

interface Message { role: "user" | "ava"; text: string; }

const LOGIN_REPLY =
  "The chat is here — log in to talk with me. Free accounts get 1 live use per IP, unlimited canned answers, and 3 resources.";

const GENERIC: { id: string; label: string; reply: string }[] = [
  {
    id: "rootmc",
    label: "What's RootMC?",
    reply:
      "RootMC is survival Minecraft at play.rootmc.net — closed-loop Gold, claims, votes. Hop Discord if you want the live crew.",
  },
  {
    id: "solar",
    label: "Solar / host",
    reply:
      "I run on the HI Pacific Solar Root Server — panels + battery on the Big Island. Live numbers live on rootrecord.online.",
  },
  {
    id: "kilauea",
    label: "Kīlauea",
    reply:
      "Kīlauea and weather apps live under Root Record — real-world ops, not the Minecraft world. See rootrecord.online.",
  },
];

export default function ChatWidget({ loginHref = "/login" }: { loginHref?: string }) {
  const [messages, setMessages] = useState<Message[]>([
    {
      role: "ava",
      text: "Aloha — I'm Ava. The panel's open. Canned answers are free; type a message and I'll ask you to log in.",
    },
  ]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [loggedIn, setLoggedIn] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    fetch("/api/auth/session")
      .then((r) => r.json())
      .then((d) => setLoggedIn(Boolean(d?.loggedIn)))
      .catch(() => setLoggedIn(false));
  }, []);

  function push(role: Message["role"], text: string) {
    setMessages((prev) => [...prev, { role, text }]);
  }

  function sendGeneric(item: (typeof GENERIC)[number]) {
    push("user", item.label);
    push("ava", item.reply);
  }

  async function send() {
    const text = input.trim();
    if (!text || loading) return;
    setInput("");
    push("user", text);
    if (!loggedIn) {
      push("ava", `${LOGIN_REPLY} → ${loginHref}`);
      return;
    }
    setLoading(true);
    try {
      const r = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ message: text }),
      });
      const data = await r.json();
      push("ava", data.reply || data.error || LOGIN_REPLY);
    } catch {
      push("ava", "Connection issue — I may be offline right now.");
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
      <div className={styles.chips}>
        {GENERIC.map((g) => (
          <button key={g.id} type="button" className={styles.chip} onClick={() => sendGeneric(g)}>
            {g.label}
          </button>
        ))}
      </div>
      <div className={styles.inputRow}>
        <input
          className={styles.input}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && send()}
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
