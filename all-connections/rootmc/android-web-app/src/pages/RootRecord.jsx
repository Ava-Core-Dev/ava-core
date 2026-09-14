import React from "react";
import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { ArrowUpRight, ArrowRight, CloudLightning, Flame, Briefcase } from "lucide-react";
import EcosystemNav from "../components/EcosystemNav";
import RRSubnav from "../components/RRSubnav";

const fr = { fontFamily: "'Fraunces', Georgia, serif" };
const ge = { fontFamily: "'Geist', system-ui, sans-serif" };

const INK = "#0B1F2A";
const MOSS = "#2F6B4F";
const PAPER = "#F4F0E7";

const IMG = {
  kilauea: "https://images.unsplash.com/photo-1518457607834-6e8d80c183c5?crop=entropy&cs=srgb&fm=jpg&q=85&w=1200",
  weather: "https://images.unsplash.com/photo-1537210249814-b9a10a161ae4?crop=entropy&cs=srgb&fm=jpg&q=85&w=1200",
};

const products = [
  {
    key: "business", icon: Briefcase, tag: "Live on Google Play · Android & web",
    title: "Business Manager",
    desc: "Time, money, clients, inventory, scheduling, work log, and reports in one workspace. Honest totals you can defend.",
    links: [
      { label: "Open web app", href: "https://business.rootrecord.info/" },
      { label: "Google Play", href: "https://play.google.com/store/apps/details?id=com.rootrecord.businessmanager" },
    ],
  },
  {
    key: "weather", icon: CloudLightning, tag: "Newest public app · Android & web",
    title: "Weather Manager", img: IMG.weather,
    desc: "Weather, alerts, earthquakes and hazard context for the places you care about. Same account on Android and the web.",
    links: [
      { label: "Google Play", href: "https://play.google.com/store/apps/details?id=com.rootrecord.weathermanager" },
      { label: "weather.rootrecord.info", href: "https://weather.rootrecord.info/" },
    ],
  },
  {
    key: "kilauea", icon: Flame, tag: "For Hawaiʻi Island · Android & web",
    title: "Kīlauea Alerts", img: IMG.kilauea,
    desc: "Kīlauea dashboards, earthquakes, weather, live USGS volcano notices and NWS alerts for Hawaiʻi Island. Install free.",
    links: [
      { label: "Google Play", href: "https://play.google.com/store/apps/details?id=com.rootrecord.kilauea" },
      { label: "kilauea.rootrecord.info", href: "https://kilauea.rootrecord.info/" },
    ],
  },
];

const principles = [
  { n: "01", h: "Your data, your devices", p: "Operational data stays with you and the product — on-device where the app stores it locally, or with our hosted API when you sign in." },
  { n: "02", h: "Totals you can defend", p: "Overlapping clock intervals merge for unique coverage — no double-counted minutes in reports and exports." },
  { n: "03", h: "Sync when you want it", p: "Subscription, sync and secure online backup are available when you want them. Use as much or as little as fits your workflow." },
];

export default function RootRecord() {
  return (
    <div style={{ ...ge, background: PAPER, color: INK }} className="min-h-screen" data-testid="rootrecord-page">
      <EcosystemNav
        active="rootrecord"
        theme={{ bar: "rgba(244,240,231,0.82)", border: "rgba(11,31,42,0.12)", text: "rgba(11,31,42,0.55)", activeText: INK, accent: MOSS }}
      />
      <RRSubnav active="home" />
      {/* HERO */}
      <section className="mx-auto max-w-6xl px-5 sm:px-8 pt-16 pb-14 grid lg:grid-cols-[1.1fr_.9fr] gap-12 items-center">
        <div>
          <motion.span
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.5 }}
            className="text-[13px] font-semibold tracking-wide" style={{ color: MOSS }}
          >
            Android &amp; web · live on Google Play
          </motion.span>
          <motion.h1
            initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6, delay: 0.05 }}
            className="mt-3 font-semibold leading-[0.95] tracking-tight text-[clamp(2.8rem,8vw,5.5rem)]" style={fr}
          >
            RootRecord
          </motion.h1>
          <motion.p
            initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6, delay: 0.12 }}
            className="mt-6 text-lg leading-relaxed max-w-xl" style={{ color: "rgba(11,31,42,0.72)" }}
          >
            Software for people who run real operations — <strong style={{ color: INK }}>Weather Manager</strong> and <strong style={{ color: INK }}>Kīlauea Alerts</strong> are live on Google Play, alongside <strong style={{ color: INK }}>Business Manager</strong> and full web apps at <strong style={{ color: INK }}>*.rootrecord.info</strong>. Subscription and online features stay optional until you want them.
          </motion.p>
          <div className="mt-8 flex flex-wrap gap-3">
            <a href="https://play.google.com/store/apps/details?id=com.rootrecord.weathermanager" target="_blank" rel="noopener noreferrer"
              data-testid="rr-hero-play"
              className="group inline-flex items-center gap-2 rounded-full px-6 py-3.5 font-semibold text-white transition-transform hover:-translate-y-0.5" style={{ background: MOSS }}>
              Get Weather Manager <ArrowUpRight size={17} />
            </a>
            <a href="#products" data-testid="rr-hero-explore"
              className="inline-flex items-center gap-2 rounded-full px-6 py-3.5 font-semibold transition-colors" style={{ border: `1px solid rgba(11,31,42,0.2)`, color: INK }}>
              Explore products
            </a>
          </div>
          <div className="mt-8 flex flex-wrap gap-x-6 gap-y-2 text-[13px]" style={{ color: "rgba(11,31,42,0.55)" }}>
            {["Android & web", "Built for real operations", "Weather & volcano alerts", "Lifetime plan available"].map((m) => (
              <span key={m} className="flex items-center gap-2"><span className="h-1.5 w-1.5 rounded-full" style={{ background: MOSS }} />{m}</span>
            ))}
          </div>
        </div>
        <motion.div
          initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 0.7, delay: 0.1 }}
          className="relative rounded-[28px] overflow-hidden aspect-[4/5] shadow-2xl"
        >
          <img src={IMG.kilauea} alt="Kīlauea volcano" className="w-full h-full object-cover" />
          <div className="absolute inset-0" style={{ background: "linear-gradient(180deg,transparent 40%,rgba(11,31,42,0.85))" }} />
          <div className="absolute bottom-5 left-5 right-5 text-white">
            <div className="text-[12px] uppercase tracking-[0.2em] opacity-80">Live on Google Play</div>
            <div className="font-semibold text-2xl mt-1" style={fr}>Kīlauea Alerts for Hawaiʻi Island</div>
          </div>
        </motion.div>
      </section>

      {/* PRINCIPLES */}
      <section className="mx-auto max-w-6xl px-5 sm:px-8 py-10">
        <div className="grid md:grid-cols-3 gap-6">
          {principles.map((pr) => (
            <div key={pr.n} className="rounded-2xl p-7" style={{ background: "#fff", border: "1px solid rgba(11,31,42,0.08)" }}>
              <div className="text-[13px] font-mono tracking-widest" style={{ color: MOSS }}>{pr.n} /</div>
              <h3 className="mt-3 font-semibold text-xl" style={fr}>{pr.h}</h3>
              <p className="mt-2 text-[15px] leading-relaxed" style={{ color: "rgba(11,31,42,0.65)" }}>{pr.p}</p>
            </div>
          ))}
        </div>
      </section>

      {/* PRODUCTS */}
      <section id="products" className="mx-auto max-w-6xl px-5 sm:px-8 py-14">
        <div className="mb-9">
          <div className="text-[13px] font-semibold tracking-wide" style={{ color: MOSS }}>What we build</div>
          <h2 className="mt-2 font-semibold text-4xl sm:text-5xl tracking-tight" style={fr}>Practical tools, <em>carefully made</em>.</h2>
          <p className="mt-4 max-w-2xl text-[17px] leading-relaxed" style={{ color: "rgba(11,31,42,0.68)" }}>
            Every product also has a web app at its own <code>*.rootrecord.info</code> subdomain. One RootRecord account, same data on every device.
          </p>
        </div>
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-5">
          {products.map((p, i) => (
            <motion.article
              key={p.key}
              initial={{ opacity: 0, y: 22 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }}
              transition={{ duration: 0.5, delay: (i % 3) * 0.06 }}
              data-testid={`rr-product-${p.key}`}
              className="rounded-2xl overflow-hidden flex flex-col" style={{ background: "#fff", border: "1px solid rgba(11,31,42,0.09)" }}
            >
              {p.img && (
                <div className="aspect-[16/9] overflow-hidden">
                  <img src={p.img} alt={p.title} className="w-full h-full object-cover" />
                </div>
              )}
              <div className="p-6 flex flex-col flex-1">
                <div className="flex items-center gap-2">
                  <span className="h-9 w-9 rounded-lg grid place-items-center" style={{ background: `${MOSS}18`, color: MOSS }}><p.icon size={18} /></span>
                  <span className="text-[11.5px] font-semibold uppercase tracking-wide" style={{ color: "rgba(11,31,42,0.5)" }}>{p.tag}</span>
                </div>
                <h3 className="mt-4 font-semibold text-2xl" style={fr}>{p.title}</h3>
                <p className="mt-2 text-[15px] leading-relaxed flex-1" style={{ color: "rgba(11,31,42,0.66)" }}>{p.desc}</p>
                {p.links.length > 0 && (
                  <div className="mt-5 flex flex-wrap gap-x-5 gap-y-2">
                    {p.links.map((l) => (
                      <a key={l.label} href={l.href} target="_blank" rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-[14px] font-semibold" style={{ color: MOSS }}>
                        {l.label} <ArrowUpRight size={14} />
                      </a>
                    ))}
                  </div>
                )}
              </div>
            </motion.article>
          ))}
        </div>
      </section>

      {/* CTA BAND */}
      <section className="mx-auto max-w-6xl px-5 sm:px-8 pb-20">
        <div className="rounded-[28px] p-10 sm:p-14 text-white" style={{ background: INK }}>
          <h2 className="font-semibold text-3xl sm:text-4xl tracking-tight" style={fr}>Start with the <em>program</em> that matches your work.</h2>
          <p className="mt-4 max-w-2xl text-[17px]" style={{ color: "rgba(255,255,255,0.7)" }}>
            Browse products, review pricing, or jump to your account to manage a subscription. Want something custom? Request an app build.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link to="/rootrecord/pricing" data-testid="rr-cta-pricing"
              className="inline-flex items-center gap-2 rounded-full px-6 py-3.5 font-semibold text-[#0B1F2A]" style={{ background: "#fff" }}>
              See pricing — one membership <ArrowRight size={16} />
            </Link>
            <Link to="/rootrecord/about" data-testid="rr-cta-about"
              className="inline-flex items-center gap-2 rounded-full px-6 py-3.5 font-semibold" style={{ border: "1px solid rgba(255,255,255,0.25)", color: "#fff" }}>
              About RootRecord
            </Link>
            <a href="https://account.rootrecord.info/" target="_blank" rel="noopener noreferrer"
              className="inline-flex items-center gap-2 rounded-full px-6 py-3.5 font-semibold" style={{ border: "1px solid rgba(255,255,255,0.25)", color: "#fff" }}>
              Account hub <ArrowUpRight size={16} />
            </a>
          </div>
        </div>
      </section>

      <footer className="border-t py-10" style={{ borderColor: "rgba(11,31,42,0.1)" }}>
        <div className="mx-auto max-w-6xl px-5 sm:px-8 text-sm" style={{ color: "rgba(11,31,42,0.55)" }}>
          <p className="font-semibold" style={{ ...fr, color: INK }}>RootRecord — multi-device solutions, your grounding roots for productivity.</p>
          <p className="mt-2">© {new Date().getFullYear()} RootRecord · part of The Root ecosystem</p>
        </div>
      </footer>
    </div>
  );
}
