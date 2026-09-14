import React, { useEffect, useState, useCallback } from "react";
import { motion } from "framer-motion";
import { useNavigate } from "react-router-dom";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { fmtG, fmtPct } from "../lib/format";
import Sparkline from "../components/Sparkline";
import SyncBadge from "../components/SyncBadge";
import PullIndicator from "../components/PullIndicator";
import { usePullToRefresh } from "../lib/usePullToRefresh";
import { ArrowUpRight, ArrowDownRight, Flame, Vote as VoteIcon, Coins, Activity, TrendingUp } from "lucide-react";

const fade = { initial: { opacity: 0, y: 10 }, animate: { opacity: 1, y: 0 }, transition: { duration: 0.3 } };

export default function Home() {
  const { user } = useAuth();
  const nav = useNavigate();
  const [economy, setEconomy] = useState(null);
  const [market, setMarket] = useState([]);
  const [status, setStatus] = useState(null);
  const [report, setReport] = useState(null);
  const [checkin, setCheckin] = useState(null);
  const [syncedAt, setSyncedAt] = useState(null);

  const load = useCallback(async () => {
    try {
      const [ec, mk, st, rp] = await Promise.all([
        api.get("/economy/overview"),
        api.get("/market/items?sort=gainers"),
        api.get("/server/status"),
        api.get("/daily-report/latest"),
      ]);
      setEconomy(ec.data);
      setMarket(mk.data.items);
      setStatus(st.data);
      setReport(rp.data);
      setSyncedAt(Date.now());
    } catch { /* noop */ }
    if (user) {
      try {
        const { data } = await api.get("/checkin/status");
        setCheckin(data);
      } catch { /* noop */ }
    }
  }, [user]);

  useEffect(() => { load(); }, [load]);

  const ptr = usePullToRefresh(load);

  const gainers = market.slice(0, 4);
  const losers = [...market].sort((a, b) => a.change_24h_pct - b.change_24h_pct).slice(0, 4);

  return (
    <motion.div {...fade} className="px-4 md:px-6 pt-4 md:pt-6 space-y-6 relative" data-testid="home-screen">
      <PullIndicator {...ptr} />
      {/* Greeting / Signed-in state */}
      {user ? (
        <div className="flex items-center gap-3">
          <img src={user.head_url} alt="" className="h-10 w-10 rounded-md border border-white/10 bg-bg-surface" />
          <div className="min-w-0">
            <div className="text-[10px] font-mono uppercase tracking-[0.2em] text-text-secondary">
              Signed in
            </div>
            <div className="font-display font-bold text-white text-lg truncate">
              {user.minecraft_username}
              {user.town && <span className="text-text-secondary font-sans font-medium text-xs ml-2">/ {user.town}</span>}
            </div>
          </div>
          <button
            onClick={() => nav("/rootmc/portfolio")}
            className="ml-auto rounded-md bg-white/5 hover:bg-white/10 border border-white/10 px-3 py-2 text-xs font-mono uppercase tracking-widest"
            data-testid="home-view-portfolio-btn"
          >
            Portfolio
          </button>
        </div>
      ) : (
        <button
          onClick={() => nav("/rootmc/auth")}
          className="w-full rounded-md bg-gold hover:bg-[#E6A600] text-black font-bold py-3 flex items-center justify-center gap-2"
          data-testid="home-signin-btn"
        >
          Sign in with /link
        </button>
      )}

      {/* Server Card */}
      <div className="rounded-md border border-white/10 bg-bg-surface overflow-hidden relative grain">
        <div className="absolute inset-0 bg-grid opacity-40" />
        <div className="relative p-4">
          <div className="flex items-center justify-between mb-3">
            <div className="text-[10px] font-mono uppercase tracking-[0.2em] text-text-secondary">
              Server
            </div>
            <div className="flex items-center gap-1.5">
              <span className={`h-1.5 w-1.5 rounded-full ${status?.online ? "bg-pos animate-pulse" : "bg-text-muted"}`} />
              <span className="text-[10px] font-mono uppercase tracking-widest text-white">
                {status?.online ? "LIVE" : "OFFLINE"}
              </span>
            </div>
          </div>
          <div className="font-mono text-xs text-text-secondary">play.rootmc.net</div>
          <div className="mt-3 grid grid-cols-3 gap-3">
            <Stat label="Online" value={status ? `${status.players_online}/${status.players_max}` : "—"} />
            <Stat label="TPS" value={status?.tps?.toFixed(1) ?? "—"} accent={status?.tps >= 19 ? "pos" : "warn"} />
            <Stat label="Ver" value={status?.version ?? "—"} />
          </div>
        </div>
      </div>

      {/* Economy pulse strip */}
      <div className="flex items-center justify-between">
        <div className="text-[10px] font-mono uppercase tracking-[0.2em] text-text-secondary">
          Economy Pulse
        </div>
        <SyncBadge syncedAt={syncedAt} />
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 !mt-2">
        <PulseCard
          icon={<Coins size={14} />}
          label="Treasury"
          value={economy ? fmtG(economy.treasury_reserve, 0) : "—"}
          sub={economy ? `${economy.reserve_ratio_pct.toFixed(1)}% reserve ratio` : ""}
        />
        <PulseCard
          icon={<Activity size={14} />}
          label="Supply"
          value={economy ? fmtG(economy.money_supply, 0) : "—"}
          sub={economy ? `${economy.circulating_players} active` : ""}
        />
        <PulseCard
          icon={<TrendingUp size={14} />}
          label="24h Vol"
          value={economy ? fmtG(economy.avg_daily_volume, 0) : "—"}
          sub="Market activity"
        />
        <PulseCard
          icon={<Flame size={14} />}
          label="Peg"
          value={economy ? `${economy.gold_peg_g_per_ingot} G` : "—"}
          sub="Ingot mint peg"
        />
      </div>

      {/* Quick actions */}
      <div className="grid grid-cols-2 gap-3">
        <ActionTile
          testId="quick-checkin"
          onClick={() => nav("/rootmc/rewards")}
          title="Daily Check-In"
          tag={checkin && !checkin.can_claim ? "CLAIMED" : "AVAILABLE"}
          reward={checkin ? `+${checkin.next_reward.gold} G` : "+10 G"}
          highlight={checkin ? checkin.can_claim : true}
          icon={<Flame />}
        />
        <ActionTile
          testId="quick-vote"
          onClick={() => nav("/rootmc/rewards?tab=vote")}
          title="Vote Sites"
          tag="5 SITES"
          reward="+95 G / day"
          highlight={false}
          icon={<VoteIcon />}
        />
      </div>

      {/* Movers */}
      <div className="grid md:grid-cols-2 gap-6">
        <div>
          <SectionHeader
            title="Top Gainers"
            action="See market"
            onAction={() => nav("/rootmc/market?sort=gainers")}
          />
          <div className="rounded-md border border-white/10 overflow-hidden divide-y divide-white/5">
            {gainers.map((it) => (
              <MoverRow key={it.id} item={it} onClick={() => nav(`/rootmc/market/${it.ticker}`)} />
            ))}
          </div>
        </div>
        <div>
          <SectionHeader
            title="Top Losers"
            action="See market"
            onAction={() => nav("/rootmc/market?sort=losers")}
          />
          <div className="rounded-md border border-white/10 overflow-hidden divide-y divide-white/5">
            {losers.map((it) => (
              <MoverRow key={it.id} item={it} onClick={() => nav(`/rootmc/market/${it.ticker}`)} />
            ))}
          </div>
        </div>
      </div>

      {/* Daily report */}
      {report && (
        <div className="rounded-md border border-white/10 bg-bg-surface p-4" data-testid="daily-report-card">
          <div className="text-[10px] font-mono uppercase tracking-[0.2em] text-gold mb-1">
            Daily Report
          </div>
          <div className="font-display font-bold text-white text-base leading-snug">
            {report.title}
          </div>
          <p className="mt-2 text-sm text-text-secondary leading-relaxed">
            {report.summary}
          </p>
          <div className="mt-3 grid grid-cols-2 gap-2">
            {report.highlights.map((h, i) => (
              <div key={i} className="rounded-md border border-white/10 bg-bg-elev px-3 py-2">
                <div className="text-[9px] font-mono uppercase tracking-widest text-text-secondary">{h.label}</div>
                <div className="font-mono text-sm text-white mt-0.5">{h.value}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </motion.div>
  );
}

function Stat({ label, value, accent }) {
  const color = accent === "pos" ? "text-pos" : accent === "warn" ? "text-warn" : "text-white";
  return (
    <div>
      <div className="text-[9px] font-mono uppercase tracking-widest text-text-secondary">{label}</div>
      <div className={`font-mono text-base ${color} mt-0.5 num`}>{value}</div>
    </div>
  );
}

function PulseCard({ icon, label, value, sub }) {
  return (
    <div className="rounded-md border border-white/10 bg-bg-surface p-3">
      <div className="flex items-center gap-1.5 text-text-secondary">
        {icon}
        <span className="text-[9px] font-mono uppercase tracking-widest">{label}</span>
      </div>
      <div className="mt-1.5 font-mono text-lg text-white num">{value}</div>
      <div className="text-[10px] text-text-secondary mt-0.5 truncate">{sub}</div>
    </div>
  );
}

function ActionTile({ title, reward, tag, highlight, onClick, icon, testId }) {
  return (
    <motion.button
      whileTap={{ scale: 0.97 }}
      onClick={onClick}
      data-testid={testId}
      className={`text-left rounded-md p-4 border transition-colors overflow-hidden relative ${
        highlight
          ? "bg-gold/10 border-gold/40 hover:bg-gold/15"
          : "bg-bg-surface border-white/10 hover:bg-bg-elev"
      }`}
    >
      <div className="flex items-center justify-between">
        <div className={`h-8 w-8 rounded-md grid place-items-center ${highlight ? "bg-gold text-black" : "bg-white/5 text-white"}`}>
          {React.cloneElement(icon, { size: 16 })}
        </div>
        <span className={`text-[9px] font-mono uppercase tracking-widest ${highlight ? "text-gold" : "text-text-secondary"}`}>
          {tag}
        </span>
      </div>
      <div className="font-display font-bold text-white mt-3">{title}</div>
      <div className="font-mono text-sm text-gold mt-1">{reward}</div>
    </motion.button>
  );
}

function SectionHeader({ title, action, onAction }) {
  return (
    <div className="flex items-center justify-between">
      <h2 className="font-display font-bold text-white text-sm tracking-tight uppercase">{title}</h2>
      {action && (
        <button onClick={onAction} className="text-[10px] font-mono uppercase tracking-widest text-gold">
          {action} →
        </button>
      )}
    </div>
  );
}

function MoverRow({ item, onClick }) {
  const up = item.change_24h_pct >= 0;
  return (
    <button
      onClick={onClick}
      className="w-full flex items-center gap-3 px-3 py-3 bg-bg-surface hover:bg-bg-elev transition-colors text-left"
      data-testid={`mover-row-${item.ticker}`}
    >
      <div className="w-10">
        <div className="font-mono text-[11px] text-white">{item.ticker}</div>
        <div className="font-sans text-[10px] text-text-secondary truncate">{item.name}</div>
      </div>
      <Sparkline data={item.sparkline} positive={up} height={28} width={72} />
      <div className="ml-auto text-right">
        <div className="font-mono text-sm text-white num">{item.current_price.toFixed(2)}</div>
        <div className={`font-mono text-[11px] num ${up ? "text-pos" : "text-neg"} flex items-center gap-0.5 justify-end`}>
          {up ? <ArrowUpRight size={10} /> : <ArrowDownRight size={10} />}
          {fmtPct(item.change_24h_pct)}
        </div>
      </div>
    </button>
  );
}
