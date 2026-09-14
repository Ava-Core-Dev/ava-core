"use client";

import { useState, useRef, useEffect, type ReactNode } from "react";
import styles from "./ChatWidget.module.css";
import { CHIPS, GREETING } from "@/lib/publicReplies";

interface Message { role: "user" | "ava"; text: string; }

const PERSON_KEY = "ava-web-person";
const THREAD_KEY = "ava-web-thread";
const TOKEN_KEY = "rootrecord_portal_token";

function portalToken(): string {
  try {
    return (localStorage.getItem(TOKEN_KEY) || "").trim();
  } catch {
    return "";
  }
}

/** Old openers in sessionStorage — match without shipping Aloha in the bundle. */
function isRetiredGreeting(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  const low = t.toLowerCase();
  if (low.includes("aloha") && low.includes("ava ivy")) return true;
  if (low.includes("don't have to say my name") || low.includes("do not have to say my name")) return true;
  if (low.includes("talk like you would in the group")) return true;
  return false;
}

function isGreetingBubble(text: string): boolean {
  return text === GREETING || isRetiredGreeting(text);
}

function personId(): string {
  try {
    let id = localStorage.getItem(PERSON_KEY);
    if (!id) {
      id = crypto.randomUUID().replace(/-/g, "");
      localStorage.setItem(PERSON_KEY, id);
    }
    return id;
  } catch {
    return "";
  }
}

function loadThread(): Message[] {
  try {
    const raw = sessionStorage.getItem(THREAD_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    if (Array.isArray(parsed) && parsed.length) {
      return parsed
        .filter((m) => m && (m.role === "user" || m.role === "ava") && typeof m.text === "string")
        .map((m) => (m.role === "ava" && isRetiredGreeting(m.text) ? { ...m, text: GREETING } : m))
        .slice(-24);
    }
  } catch {
    /* ignore */
  }
  return [{ role: "ava", text: GREETING }];
}

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
  const [messages, setMessages] = useState<Message[]>([{ role: "ava", text: GREETING }]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [ready, setReady] = useState(false);
  const messagesRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setMessages(loadThread());
    setReady(true);
  }, []);

  useEffect(() => {
    if (!ready) return;
    // Scroll only the transcript panel — never the document (scrollIntoView
    // was jumping the page past the chat into the guide below).
    const panel = messagesRef.current;
    if (panel) panel.scrollTop = panel.scrollHeight;
    try {
      sessionStorage.setItem(THREAD_KEY, JSON.stringify(messages.slice(-24)));
    } catch {
      /* ignore */
    }
  }, [messages, ready, loading]);

  function push(role: Message["role"], text: string) {
    setMessages((prev) => [...prev, { role, text }]);
  }

  async function sendText(text: string) {
    const trimmed = text.trim();
    if (!trimmed || loading) return;
    setInput("");
    push("user", trimmed);
    setLoading(true);
    const history = [
      ...messages
        .filter((m) => m.text && !isGreetingBubble(m.text))
        .map((m) => ({
          role: m.role === "ava" ? "assistant" : "user",
          content: m.text,
        })),
      { role: "user", content: trimmed },
    ].slice(-10);
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    const tok = portalToken();
    if (tok) headers.Authorization = `Bearer ${tok}`;
    const body = JSON.stringify({
      message: trimmed,
      surface: "public",
      history,
      session_id: personId(),
    });
    const post = async () => {
      const r = await fetch("/api/chat", {
        method: "POST",
        headers,
        credentials: "include",
        body,
      });
      return (await r.json().catch(() => ({}))) as {
        reply?: string;
        error?: string;
        brain?: string;
      };
    };
    try {
      let data = await post();
      const offline =
        data.brain === "offline" ||
        /offline on the Root Server/i.test(String(data.reply || ""));
      if (offline) {
        await new Promise((r) => setTimeout(r, 1200));
        data = await post();
      }
      push("ava", data.reply || data.error || "I could not answer just then.");
    } catch {
      try {
        await new Promise((r) => setTimeout(r, 1200));
        const data = await post();
        push("ava", data.reply || data.error || "I could not answer just then.");
      } catch {
        push("ava", "Connection dropped. The Root Server may be on night bank. Try again in a bit.");
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className={styles.widget}>
      <div className={styles.messages} ref={messagesRef}>
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
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void sendText(input);
            }
          }}
          placeholder="Ask about the host, weather, packs…"
          disabled={loading}
        />
        <button
          type="button"
          className={styles.btn}
          onClick={() => void sendText(input)}
          disabled={loading || !input.trim()}
        >
          Send
        </button>
      </div>
    </div>
  );
}
