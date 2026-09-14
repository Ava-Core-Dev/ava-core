import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { useAuth } from "../lib/auth";
import {
  LogOut, Trophy, MessageSquare, BookOpen, Scale, Map, ExternalLink, ChevronRight, User, HelpCircle,
  Search, MessagesSquare,
} from "lucide-react";
import { fmtG } from "../lib/format";

const linksExternal = [
  { label: "Discord", href: "https://discord.gg/rFFQYrNaqS", icon: MessageSquare },
  { label: "Wiki", href: "https://rootmc.net/wiki/player/", icon: BookOpen },
  { label: "Constitution", href: "https://rootmc.net/wiki/constitution/", icon: Scale },
  { label: "Live Map", href: "https://map.rootmc.net", icon: Map },
];

export default function More() {
  const nav = useNavigate();
  const { user, logout } = useAuth();
  const [playerQuery, setPlayerQuery] = useState("");

  const submitPlayerSearch = (e) => {
    e.preventDefault();
    const q = playerQuery.trim();
    if (q.length < 3) return;
    // Public web player profile until in-app API exists.
    window.open(`https://rootmc.net/player/?u=${encodeURIComponent(q)}`, "_blank", "noopener,noreferrer");
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="px-4 pt-4 pb-4 space-y-4"
      data-testid="more-screen"
    >
      <div>
        <div className="text-[10px] font-mono uppercase tracking-[0.2em] text-text-secondary">Menu</div>
        <h1 className="font-display font-extrabold text-3xl tracking-tight">More</h1>
      </div>

      {/* Signed-in profile card */}
      {user ? (
        <div className="rounded-md border border-white/10 bg-bg-surface p-4 flex items-center gap-3">
          <img
            src={user.head_url}
            alt=""
            className="h-14 w-14 rounded-md border border-white/10 bg-bg-elev"
          />
          <div className="min-w-0 flex-1">
            <div className="font-display font-bold text-white text-lg leading-tight">
              {user.minecraft_username}
            </div>
            <div className="text-[11px] font-mono text-text-secondary">
              {user.town ? `Town: ${user.town}` : "No town"}
            </div>
            <div className="mt-1 font-mono text-sm text-gold">
              {fmtG(user.wallet_gold, 0)} <span className="text-text-secondary text-xs">wallet</span>
            </div>
          </div>
        </div>
      ) : (
        <button
          onClick={() => nav("/rootmc/auth")}
          className="w-full rounded-md bg-gold text-black font-bold py-3 flex items-center justify-center gap-2"
          data-testid="more-signin-btn"
        >
          <User size={16} />
          Sign in with /link
        </button>
      )}

      {/* In-app sections */}
      <Section title="Explore">
        <Row
          testId="more-leaderboards"
          icon={<Trophy size={16} />}
          label="Leaderboards"
          onClick={() => nav("/rootmc/leaderboards")}
        />
      </Section>

      {/* Player search */}
      <div>
        <div className="text-[10px] font-mono uppercase tracking-[0.2em] text-text-secondary mb-1.5">
          Player Search
        </div>
        <form
          onSubmit={submitPlayerSearch}
          className="flex items-center gap-2 rounded-md border border-white/10 bg-bg-surface px-3 py-2"
          data-testid="more-player-search-form"
        >
          <Search size={14} className="text-text-secondary shrink-0" />
          <input
            value={playerQuery}
            onChange={(e) => setPlayerQuery(e.target.value)}
            placeholder="Minecraft username…"
            maxLength={16}
            data-testid="more-player-search-input"
            className="flex-1 bg-transparent font-mono text-sm text-white placeholder:text-text-muted focus:outline-none"
          />
          <button
            type="submit"
            disabled={playerQuery.trim().length < 3}
            data-testid="more-player-search-submit"
            className="rounded-md bg-gold disabled:opacity-40 text-black text-[10px] font-mono uppercase tracking-widest px-2.5 py-1.5"
          >
            Open
          </button>
        </form>
        <p className="text-[10px] font-mono text-text-muted mt-1">
          Opens rootmc.net player profile in a new tab (in-app API coming soon).
        </p>
      </div>

      <Section title="Community">
        {linksExternal.map((l) => (
          <Row
            key={l.label}
            testId={`more-link-${l.label.toLowerCase()}`}
            icon={<l.icon size={16} />}
            label={l.label}
            external
            onClick={() => window.open(l.href, "_blank", "noopener,noreferrer")}
          />
        ))}
      </Section>

      <Section title="Support">
        <Row
          testId="more-beta-feedback"
          icon={<MessagesSquare size={16} />}
          label="Beta Feedback"
          external
          onClick={() => window.open("https://discord.gg/rFFQYrNaqS", "_blank")}
        />
        <Row
          testId="more-support"
          icon={<HelpCircle size={16} />}
          label="Help & Rules"
          external
          onClick={() => window.open("https://rootmc.net/wiki/", "_blank")}
        />
      </Section>

      {user && (
        <button
          onClick={() => { logout(); nav("/rootmc"); }}
          data-testid="more-logout-btn"
          className="w-full rounded-md border border-neg/30 bg-neg/5 hover:bg-neg/10 text-neg font-mono uppercase tracking-widest text-xs py-3 flex items-center justify-center gap-2"
        >
          <LogOut size={14} />
          Sign out
        </button>
      )}

      <div className="text-center pt-4">
        <div className="text-[10px] font-mono uppercase tracking-widest text-text-muted">
          RootMC Terminal · v1.1 · Phase 2
        </div>
      </div>
    </motion.div>
  );
}

function Section({ title, children }) {
  return (
    <div>
      <div className="text-[10px] font-mono uppercase tracking-[0.2em] text-text-secondary mb-1.5">
        {title}
      </div>
      <div className="rounded-md border border-white/10 bg-bg-surface overflow-hidden divide-y divide-white/5">
        {children}
      </div>
    </div>
  );
}

function Row({ icon, label, onClick, external, testId }) {
  return (
    <button
      onClick={onClick}
      data-testid={testId}
      className="w-full flex items-center gap-3 px-4 py-3 hover:bg-bg-elev/60 transition-colors"
    >
      <span className="text-text-secondary">{icon}</span>
      <span className="text-sm text-white flex-1 text-left">{label}</span>
      {external ? <ExternalLink size={14} className="text-text-secondary" /> : <ChevronRight size={16} className="text-text-secondary" />}
    </button>
  );
}
