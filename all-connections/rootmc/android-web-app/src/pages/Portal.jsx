import React from "react";
import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { ArrowRight, Sun, Gamepad2, LayoutGrid, Cpu } from "lucide-react";
import EcosystemNav from "../components/EcosystemNav";

const FOREST = "https://images.unsplash.com/photo-1448375240586-882707db888b?crop=entropy&cs=srgb&fm=jpg&q=85&w=1600";
const bric = { fontFamily: "'Bricolage Grotesque', system-ui, sans-serif" };
const fig = { fontFamily: "'Figtree', system-ui, sans-serif" };

const worlds = [
  {
    key: "rootrecord",
    kicker: "Root Record",
    title: "Ops that stay with you",
    body: "Weather, Kīlauea awareness, business time & money, accounts that sync when you want them — tools for people who run real places.",
    to: "/rootrecord",
    cta: "Enter Root Record",
    accent: "#4ea87a",
    icon: LayoutGrid,
    links: ["Weather Manager", "Kīlauea Alerts", "Business Manager", "Account Hub"],
  },
  {
    key: "rootmc",
    kicker: "RootMC",
    title: "Your journey is written here",
    body: "One primary survival world — linked progression, closed-loop Gold, a live map and Discord bridge. Official survival that isn't pay-to-win.",
    href: "https://rootmc.net/",
    cta: "Enter RootMC",
    accent: "#f0a83c",
    icon: Gamepad2,
    links: ["play.rootmc.net", "Live map", "Player wiki", "Economy guide"],
  },
];

const pulse = [
  { label: "Host · solar · weather", title: "Ava solar core", sub: "Runs the whole tree", icon: Sun },
  { label: "Minecraft", title: "Join the network", sub: "play.rootmc.net", icon: Gamepad2 },
  { label: "Apps & accounts", title: "Root Record products", sub: "*.rootrecord.info", icon: LayoutGrid },
];

export default function Portal() {
  return (
    <div style={{ ...fig, background: "#0a1210", color: "#e8efe9" }} className="min-h-screen relative overflow-hidden" data-testid="portal-page">
      <EcosystemNav active="root" />

      {/* HERO */}
      <section className="relative">
        <div className="absolute inset-0 -z-10">
          <img src={FOREST} alt="" className="w-full h-full object-cover opacity-25" />
          <div className="absolute inset-0" style={{ background: "linear-gradient(180deg, rgba(10,18,16,0.55) 0%, rgba(10,18,16,0.85) 55%, #0a1210 100%)" }} />
        </div>
        <div className="mx-auto max-w-6xl px-5 sm:px-8 pt-20 pb-24">
          <motion.p
            initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }}
            className="text-[13px] uppercase tracking-[0.35em] font-semibold" style={{ color: "#4ea87a" }}
          >
            Root Record · RootMC
          </motion.p>
          <motion.h1
            initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6, delay: 0.05 }}
            className="mt-4 font-extrabold leading-[0.92] tracking-tight text-[clamp(3rem,11vw,7.5rem)]" style={bric}
          >
            The Root
          </motion.h1>
          <motion.p
            initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6, delay: 0.12 }}
            className="mt-6 max-w-xl text-lg sm:text-xl text-[#a9bdb1] leading-relaxed"
          >
            Two worlds. One living core — <span className="text-white font-semibold">Ava</span> — running on solar from Hawaiʻi. Three sites, now one home.
          </motion.p>
          <motion.div
            initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6, delay: 0.2 }}
            className="mt-6 inline-flex items-center gap-2 rounded-full px-4 py-1.5 text-[13px]"
            style={{ background: "rgba(240,168,60,0.12)", border: "1px solid rgba(240,168,60,0.3)", color: "#f0a83c" }}
          >
            <Sun size={14} /> Powered by solar · usual hours 6am–8pm HST
          </motion.div>
          <motion.div
            initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6, delay: 0.28 }}
            className="mt-9 flex flex-wrap gap-3"
          >
            <Link to="/rootrecord" data-testid="portal-cta-rootrecord"
              className="group inline-flex items-center gap-2 rounded-full px-6 py-3.5 font-semibold text-[#0a1210] transition-transform hover:-translate-y-0.5"
              style={{ background: "#4ea87a" }}>
              Enter Root Record <ArrowRight size={17} className="transition-transform group-hover:translate-x-1" />
            </Link>
            <a
              href="https://rootmc.net/"
              data-testid="portal-cta-rootmc"
              className="group inline-flex items-center gap-2 rounded-full px-6 py-3.5 font-semibold transition-transform hover:-translate-y-0.5"
              style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.14)", color: "#fff" }}>
              Enter RootMC <ArrowRight size={17} className="transition-transform group-hover:translate-x-1" />
            </a>
          </motion.div>
        </div>
      </section>

      {/* WORLDS */}
      <section id="worlds" className="mx-auto max-w-6xl px-5 sm:px-8 pb-20">
        <div className="flex items-end justify-between flex-wrap gap-2 mb-8">
          <h2 className="font-bold text-3xl sm:text-4xl tracking-tight" style={bric}>Two worlds</h2>
          <p style={{ color: "#8fa397" }}>Same operator family. Different ground underfoot.</p>
        </div>
        <div className="grid md:grid-cols-2 gap-5">
          {worlds.map((w, i) => (
            <motion.div
              key={w.key}
              initial={{ opacity: 0, y: 24 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }}
              transition={{ duration: 0.5, delay: i * 0.08 }}
            >
              {w.href ? (
                <a
                  href={w.href}
                  data-testid={`portal-world-${w.key}`}
                  className="group block rounded-3xl p-8 h-full transition-colors"
                  style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.09)" }}
                >
                  <div className="flex items-center gap-3">
                    <span className="h-11 w-11 rounded-xl grid place-items-center" style={{ background: `${w.accent}22`, color: w.accent }}>
                      <w.icon size={22} />
                    </span>
                    <span className="text-[13px] uppercase tracking-[0.25em] font-semibold" style={{ color: w.accent }}>{w.kicker}</span>
                  </div>
                  <h3 className="mt-6 font-bold text-2xl sm:text-[1.75rem] tracking-tight text-white" style={bric}>{w.title}</h3>
                  <p className="mt-3 text-[#a9bdb1] leading-relaxed">{w.body}</p>
                  <ul className="mt-6 flex flex-wrap gap-2">
                    {w.links.map((l) => (
                      <li key={l} className="text-[12.5px] rounded-full px-3 py-1" style={{ background: "rgba(255,255,255,0.05)", color: "#c6d4cb" }}>{l}</li>
                    ))}
                  </ul>
                  <span className="mt-7 inline-flex items-center gap-2 font-semibold transition-transform group-hover:translate-x-1" style={{ color: w.accent }}>
                    {w.cta} <ArrowRight size={16} />
                  </span>
                </a>
              ) : (
              <Link
                to={w.to}
                data-testid={`portal-world-${w.key}`}
                className="group block rounded-3xl p-8 h-full transition-colors"
                style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.09)" }}
              >
                <div className="flex items-center gap-3">
                  <span className="h-11 w-11 rounded-xl grid place-items-center" style={{ background: `${w.accent}22`, color: w.accent }}>
                    <w.icon size={22} />
                  </span>
                  <span className="text-[13px] uppercase tracking-[0.25em] font-semibold" style={{ color: w.accent }}>{w.kicker}</span>
                </div>
                <h3 className="mt-6 font-bold text-2xl sm:text-[1.75rem] tracking-tight text-white" style={bric}>{w.title}</h3>
                <p className="mt-3 text-[#a9bdb1] leading-relaxed">{w.body}</p>
                <ul className="mt-6 flex flex-wrap gap-2">
                  {w.links.map((l) => (
                    <li key={l} className="text-[12.5px] rounded-full px-3 py-1" style={{ background: "rgba(255,255,255,0.05)", color: "#c6d4cb" }}>{l}</li>
                  ))}
                </ul>
                <span className="mt-7 inline-flex items-center gap-2 font-semibold transition-transform group-hover:translate-x-1" style={{ color: w.accent }}>
                  {w.cta} <ArrowRight size={16} />
                </span>
              </Link>
              )}
            </motion.div>
          ))}
        </div>
      </section>

      {/* AVA CORE */}
      <section id="ava" className="relative py-20" style={{ background: "linear-gradient(180deg,#0a1210,#0c1712)" }}>
        <div className="mx-auto max-w-4xl px-5 sm:px-8 text-center">
          <span className="inline-flex items-center gap-2 text-[13px] uppercase tracking-[0.3em] font-semibold" style={{ color: "#a78bfa" }}>
            <Cpu size={15} /> Ava-core
          </span>
          <h2 className="mt-5 font-extrabold text-4xl sm:text-6xl tracking-tight text-white" style={bric}>Ava</h2>
          <p className="mt-5 text-lg text-[#a9bdb1] leading-relaxed max-w-2xl mx-auto">
            Lead developer for the Root Record ecosystem — schedules, data, digs, the solar host. Not a help-desk bot. The core that keeps both worlds breathing.
          </p>
          <div className="mt-8 flex justify-center gap-3 flex-wrap">
            <Link to="/ava" data-testid="portal-cta-ava"
              className="inline-flex items-center gap-2 rounded-full px-6 py-3.5 font-semibold transition-transform hover:-translate-y-0.5"
              style={{ background: "#a78bfa", color: "#150c26" }}>
              Open the Ava wiki <ArrowRight size={17} />
            </Link>
          </div>
        </div>
      </section>

      {/* LIVE PULSE */}
      <section className="mx-auto max-w-6xl px-5 sm:px-8 py-20">
        <h2 className="font-bold text-3xl tracking-tight mb-2" style={bric}>Live pulse</h2>
        <p style={{ color: "#8fa397" }} className="mb-8">Where the merged tree is breathing right now.</p>
        <div className="grid sm:grid-cols-3 gap-4">
          {pulse.map((p) => (
            <div key={p.title} className="rounded-2xl p-6" style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)" }}>
              <p.icon size={20} style={{ color: "#f0a83c" }} />
              <div className="mt-4 text-[12px] uppercase tracking-[0.2em]" style={{ color: "#8fa397" }}>{p.label}</div>
              <div className="mt-1 font-semibold text-white text-lg">{p.title}</div>
              <div className="text-sm text-[#a9bdb1] mt-0.5">{p.sub}</div>
            </div>
          ))}
        </div>
      </section>

      <footer className="border-t py-10" style={{ borderColor: "rgba(255,255,255,0.08)" }}>
        <div className="mx-auto max-w-6xl px-5 sm:px-8 text-sm" style={{ color: "#8fa397" }}>
          <p className="text-white font-semibold" style={bric}>The Root — Root Record × RootMC · core by Ava · solar powered</p>
          <p className="mt-2">rootrecord.info · rootmc.net · one unified home</p>
        </div>
      </footer>
    </div>
  );
}
