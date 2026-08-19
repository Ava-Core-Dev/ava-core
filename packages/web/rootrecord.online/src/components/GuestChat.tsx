"use client";

import { useState } from "react";
import styles from "./GuestChat.module.css";

const LOGIN =
  "The chat is here — log in to talk with me. Free accounts: 1 live use per IP, unlimited canned answers, 3 resources.";

const CHIPS = [
  { label: "What is Root Record?", reply: "Root Record is the real-world data center — solar, Kīlauea, weather, business ops. Minecraft lives on RootMC." },
  { label: "Solar", reply: "Live solar and battery sit on this dashboard. I run on the HI Pacific Solar Root Server." },
  { label: "Kīlauea", reply: "Volcano and weather products are Root Record — not the Minecraft world." },
];

export default function GuestChat() {
  const [log, setLog] = useState([{ who: "ava", text: "Aloha — panel's open. Canned answers are free; type a live question and I'll ask you to log in." }]);
  const [input, setInput] = useState("");

  function add(who: string, text: string) {
    setLog((prev) => [...prev, { who, text }]);
  }

  return (
    <div className={styles.box}>
      <div className={styles.log}>
        {log.map((m, i) => (
          <p key={i} className={m.who === "ava" ? styles.ava : styles.user}>
            {m.text}
          </p>
        ))}
      </div>
      <div className={styles.chips}>
        {CHIPS.map((c) => (
          <button
            key={c.label}
            type="button"
            onClick={() => {
              add("you", c.label);
              add("ava", c.reply);
            }}
          >
            {c.label}
          </button>
        ))}
      </div>
      <div className={styles.row}>
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== "Enter" || !input.trim()) return;
            add("you", input.trim());
            add("ava", `${LOGIN} → https://rootmc.net/login/`);
            setInput("");
          }}
          placeholder="Ask Ava something…"
        />
        <button
          type="button"
          onClick={() => {
            if (!input.trim()) return;
            add("you", input.trim());
            add("ava", `${LOGIN} → https://rootmc.net/login/`);
            setInput("");
          }}
        >
          Send
        </button>
      </div>
    </div>
  );
}
