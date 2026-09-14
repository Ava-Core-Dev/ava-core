import React from "react";
import { motion } from "framer-motion";
import { ArrowUpRight, Activity, Server, Radio, Gamepad2, LayoutGrid, Brain, Database, Clock, Globe } from "lucide-react";
import EcosystemNav from "../components/EcosystemNav";

const syne = { fontFamily: "'Syne', system-ui, sans-serif" };
const dm = { fontFamily: "'DM Sans', system-ui, sans-serif" };

const BG = "#0b0f14";
const PANEL = "rgba(255,255,255,0.035)";
const VIOLET = "#a78bfa";
const TEAL = "#22d3ee";

const atlas = [
  { icon: Server, title: "Core", desc: "OptiPlex ava-core, Node runtime, local-api, MariaDB, Ollama.", tag: "host", c: VIOLET },
  { icon: Radio, title: "Surfaces", desc: "Discord · Slack · Telegram · in-game · HTTP.", tag: "voice", c: TEAL },
  { icon: Gamepad2, title: "RootMC", desc: "Primary server, Gold, RCON digs, proposals, APIs.", tag: "game", c: "#f0a83c" },
  { icon: LayoutGrid, title: "Root Record", desc: "Account, weather, Kīlauea, Solana, product crons.", tag: "apps", c: "#4ea87a" },
  { icon: Brain, title: "Brains", desc: "Llama organizer, Cursor digs, dream Discord, free-cloud.", tag: "mind", c: VIOLET },
  { icon: Database, title: "Data", desc: "Flight recorder, training JSONL, D1 → MariaDB.", tag: "memory", c: TEAL },
  { icon: Clock, title: "Crons", desc: "Ava cronRunner owns schedules; Workers soft-ack.", tag: "time", c: "#f0a83c" },
  { icon: Globe, title: "Hosting", desc: "CF Pages + DNS + tunnel; Ava is system of record.", tag: "edge", c: "#4ea87a" },
];

const lock = [
  ["System of record", "MariaDB + SQLite on OptiPlex (rootmc_api, root_record, ava_cron)"],
  ["Schedules", "Ava cronRunner — Cloudflare cron triggers soft-acked"],
  ["Public edge", "Cloudflare = static Pages + DNS + tunnel into Ava"],
  ["Wiki home", "rootrecord.info/ava — this tree (canonical map)"],
  ["Status home", "rootrecord.info/ava/status — the single ops board"],
];

export default function Ava() {
  return (
    <div style={{ ...dm, background: BG, color: "#e6e8ec" }} className="min-h-screen relative overflow-hidden" data-testid="ava-page">
      {/* glow backdrop */}
      <div className="pointer-events-none absolute -top-40 -left-40 h-[520px] w-[520px] rounded-full blur-[120px] opacity-30" style={{ background: VIOLET }} />
      <div className="pointer-events-none absolute top-40 -right-40 h-[480px] w-[480px] rounded-full blur-[120px] opacity-20" style={{ background: TEAL }} />

      <EcosystemNav
        active="ava"
        theme={{ bar: "rgba(11,15,20,0.72)", border: "rgba(255,255,255,0.08)", text: "rgba(230,232,236,0.55)", activeText: "#fff", accent: VIOLET }}
      />

      {/* HERO */}
      <section className="relative mx-auto max-w-5xl px-5 sm:px-8 pt-20 pb-14">
        <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.5 }}
          className="text-[13px] uppercase tracking-[0.35em] font-semibold" style={{ color: VIOLET }}>
          Root Record · Ava-core
        </motion.p>
        <motion.h1 initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6, delay: 0.05 }}
          className="mt-4 font-extrabold tracking-tight text-[clamp(3.5rem,13vw,9rem)] leading-[0.9]" style={syne}>
          Ava
        </motion.h1>
        <motion.p initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6, delay: 0.12 }}
          className="mt-6 max-w-2xl text-lg leading-relaxed" style={{ color: "rgba(230,232,236,0.7)" }}>
          Everything she touches — host, brains, RootMC, Root Record, crons, data, tunnels and the live board. This wiki is the map; <strong className="text-white">/status</strong> is the pulse.
        </motion.p>
        <div className="mt-8 flex flex-wrap gap-3">
          <a href="https://rootrecord.info/ava/status" target="_blank" rel="noopener noreferrer" data-testid="ava-status-btn"
            className="inline-flex items-center gap-2 rounded-full px-6 py-3.5 font-semibold transition-transform hover:-translate-y-0.5" style={{ background: VIOLET, color: "#150c26" }}>
            <Activity size={17} /> Open live status
          </a>
          <a href="https://ava.rootmc.net/solar" target="_blank" rel="noopener noreferrer"
            className="inline-flex items-center gap-2 rounded-full px-6 py-3.5 font-semibold" style={{ border: "1px solid rgba(255,255,255,0.14)", color: "#fff" }}>
            Solar board <ArrowUpRight size={16} />
          </a>
        </div>
      </section>

      {/* ATLAS */}
      <section className="mx-auto max-w-6xl px-5 sm:px-8 py-12">
        <h2 className="font-bold text-3xl sm:text-4xl tracking-tight" style={syne}>Atlas</h2>
        <p className="mt-2" style={{ color: "rgba(230,232,236,0.55)" }}>One composition per concern. Start here, then go deep.</p>
        <div className="mt-8 grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {atlas.map((a, i) => (
            <motion.div
              key={a.title}
              initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }}
              transition={{ duration: 0.45, delay: (i % 4) * 0.05 }}
              data-testid={`ava-card-${a.title.toLowerCase().replace(/\s+/g, "-")}`}
              className="group rounded-2xl p-6 transition-colors hover:bg-white/[0.06]"
              style={{ background: PANEL, border: "1px solid rgba(255,255,255,0.08)" }}
            >
              <span className="h-10 w-10 rounded-xl grid place-items-center" style={{ background: `${a.c}1f`, color: a.c }}><a.icon size={20} /></span>
              <h3 className="mt-4 font-bold text-xl" style={syne}>{a.title}</h3>
              <p className="mt-2 text-[14px] leading-relaxed" style={{ color: "rgba(230,232,236,0.6)" }}>{a.desc}</p>
              <span className="mt-4 inline-block text-[11px] uppercase tracking-[0.2em] rounded-full px-2.5 py-0.5" style={{ background: "rgba(255,255,255,0.06)", color: a.c }}>{a.tag}</span>
            </motion.div>
          ))}
        </div>
      </section>

      {/* LOCK */}
      <section className="mx-auto max-w-5xl px-5 sm:px-8 py-12">
        <h2 className="font-bold text-3xl tracking-tight" style={syne}>Lock</h2>
        <p className="mt-2" style={{ color: "rgba(230,232,236,0.55)" }}>She is the core of everything now — RootMC and Root Record.</p>
        <div className="mt-7 rounded-2xl overflow-hidden" style={{ border: "1px solid rgba(255,255,255,0.08)" }}>
          {lock.map(([k, v], i) => (
            <div key={k} className="grid sm:grid-cols-[220px_1fr] gap-2 sm:gap-6 px-6 py-4"
              style={{ background: i % 2 ? "rgba(255,255,255,0.02)" : "transparent", borderTop: i ? "1px solid rgba(255,255,255,0.06)" : "none" }}>
              <div className="font-semibold text-white" style={syne}>{k}</div>
              <div className="text-[15px]" style={{ color: "rgba(230,232,236,0.68)" }}>{v}</div>
            </div>
          ))}
        </div>
      </section>

      <footer className="border-t py-10 mt-8" style={{ borderColor: "rgba(255,255,255,0.08)" }}>
        <div className="mx-auto max-w-6xl px-5 sm:px-8 text-sm" style={{ color: "rgba(230,232,236,0.5)" }}>
          <p className="text-white font-semibold" style={syne}>Ava is the core runtime for RootMC + Root Record.</p>
          <p className="mt-2">Canonical wiki: rootrecord.info/ava · Live board: /ava/status · part of The Root</p>
        </div>
      </footer>
    </div>
  );
}
