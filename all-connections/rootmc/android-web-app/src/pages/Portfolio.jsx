import React, { useEffect, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { Area, AreaChart, ResponsiveContainer, YAxis, PieChart, Pie, Cell } from "recharts";
import { ArrowUpRight, ArrowDownRight, Wallet, Box, Store, Archive, LineChart as LineIcon } from "lucide-react";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { fmtG, fmtPct } from "../lib/format";
import Sparkline from "../components/Sparkline";
import SyncBadge from "../components/SyncBadge";
import PullIndicator from "../components/PullIndicator";
import { usePullToRefresh } from "../lib/usePullToRefresh";

const COLORS = ["#FFB800", "#0A84FF", "#00F58C", "#FF9F0A", "#8B5CF6"];

export default function Portfolio() {
  const nav = useNavigate();
  const { user, refresh: refreshUser } = useAuth();
  const [pf, setPf] = useState(null);
  const [loading, setLoading] = useState(true);
  const [syncedAt, setSyncedAt] = useState(null);

  const load = useCallback(async () => {
    if (!user) return;
    try {
      const { data } = await api.get("/portfolio/me");
      setPf(data);
      setSyncedAt(Date.now());
      refreshUser();
    } finally {
      setLoading(false);
    }
  }, [user, refreshUser]);

  useEffect(() => { if (user) load(); }, [user, load]);

  const ptr = usePullToRefresh(load);

  if (!user) {
    return (
      <div className="px-4 pt-12 space-y-4 text-center" data-testid="portfolio-signin-cta">
        <div className="mx-auto h-16 w-16 rounded-full bg-gold/10 border border-gold/30 grid place-items-center">
          <Wallet className="text-gold" />
        </div>
        <h2 className="font-display font-bold text-xl">Sign in to see your portfolio</h2>
        <p className="text-sm text-text-secondary">Link your Minecraft account with a 6-character /link code to unlock net worth, holdings, and history.</p>
        <button
          onClick={() => nav("/rootmc/auth")}
          className="mx-auto rounded-md bg-gold text-black font-bold px-6 py-3 hover:bg-[#E6A600] transition-colors"
          data-testid="portfolio-signin-btn"
        >
          Sign in
        </button>
      </div>
    );
  }

  if (loading || !pf) {
    return <div className="p-8 text-center text-text-secondary">Loading portfolio…</div>;
  }

  const up = pf.delta_24h_pct >= 0;
  const pieData = [
    { name: "Wallet", value: pf.breakdown.wallet },
    { name: "Inventory", value: pf.breakdown.inventory },
    { name: "Shops", value: pf.breakdown.shops },
    { name: "Chests", value: pf.breakdown.chests },
    { name: "Market", value: pf.breakdown.market_holdings },
  ].filter((d) => d.value > 0);

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="px-4 md:px-6 pt-4 md:pt-6 pb-4 space-y-5 relative"
      data-testid="portfolio-screen"
    >
      <PullIndicator {...ptr} />
      <div>
        <div className="flex items-center justify-between">
          <div className="text-[10px] font-mono uppercase tracking-[0.2em] text-text-secondary">
            Net worth
          </div>
          <SyncBadge syncedAt={syncedAt} />
        </div>
        <div className="mt-1 font-mono text-5xl sm:text-6xl font-bold tracking-tightest text-white num" data-testid="portfolio-net-worth">
          {fmtG(pf.net_worth, 2)}
        </div>
        <div className={`mt-1 font-mono text-sm flex items-center gap-1 ${up ? "text-pos" : "text-neg"}`}>
          {up ? <ArrowUpRight size={14} /> : <ArrowDownRight size={14} />}
          {fmtPct(pf.delta_24h_pct)} · 24h
        </div>
      </div>

      {/* history chart */}
      <div className="h-36 -mx-1">
        <ResponsiveContainer>
          <AreaChart data={pf.history}>
            <defs>
              <linearGradient id="pfArea" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#FFB800" stopOpacity={0.35} />
                <stop offset="100%" stopColor="#FFB800" stopOpacity={0} />
              </linearGradient>
            </defs>
            <YAxis hide domain={["dataMin", "dataMax"]} />
            <Area type="monotone" dataKey="value" stroke="#FFB800" strokeWidth={2} fill="url(#pfArea)" isAnimationActive={false} />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      {/* breakdown */}
      <div className="rounded-md border border-white/10 bg-bg-surface p-4">
        <div className="flex items-center justify-between">
          <div className="text-[10px] font-mono uppercase tracking-[0.2em] text-text-secondary">
            Wealth breakdown
          </div>
        </div>

        <div className="flex items-center gap-3 mt-3">
          <div className="h-24 w-24 shrink-0">
            <ResponsiveContainer>
              <PieChart>
                <Pie data={pieData} innerRadius={28} outerRadius={44} dataKey="value" stroke="none">
                  {pieData.map((_, i) => (
                    <Cell key={i} fill={COLORS[i % COLORS.length]} />
                  ))}
                </Pie>
              </PieChart>
            </ResponsiveContainer>
          </div>
          <div className="flex-1 space-y-1.5">
            <BreakdownRow color={COLORS[0]} icon={<Wallet size={12} />} label="Wallet" value={pf.breakdown.wallet} total={pf.net_worth} />
            <BreakdownRow color={COLORS[1]} icon={<Box size={12} />} label="Inventory" value={pf.breakdown.inventory} total={pf.net_worth} />
            <BreakdownRow color={COLORS[2]} icon={<Store size={12} />} label="Shops" value={pf.breakdown.shops} total={pf.net_worth} />
            <BreakdownRow color={COLORS[3]} icon={<Archive size={12} />} label="Chests" value={pf.breakdown.chests} total={pf.net_worth} />
            <BreakdownRow color={COLORS[4]} icon={<LineIcon size={12} />} label="Market" value={pf.breakdown.market_holdings} total={pf.net_worth} />
          </div>
        </div>
      </div>

      {/* holdings */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <h2 className="font-display font-bold text-white text-sm tracking-tight uppercase">Holdings</h2>
          <span className="text-[10px] font-mono uppercase tracking-widest text-text-secondary">
            {pf.holdings.length} positions
          </span>
        </div>
        <div className="rounded-md border border-white/10 bg-bg-surface overflow-hidden divide-y divide-white/5">
          {pf.holdings.length === 0 && (
            <div className="p-6 text-center text-sm text-text-secondary">
              No positions yet. Visit the market to start.
            </div>
          )}
          {pf.holdings.map((h) => {
            const up = h.pl_pct >= 0;
            return (
              <button
                key={h.ticker}
                onClick={() => nav(`/rootmc/market/${h.ticker}`)}
                data-testid={`holding-${h.ticker}`}
                className="w-full grid grid-cols-[1fr_auto] items-center gap-3 px-3 py-3 hover:bg-bg-elev/60 transition-colors text-left"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-[11px] text-white">{h.ticker}</span>
                    <span className="text-text-muted text-[10px]">•</span>
                    <span className="text-[11px] text-text-secondary font-mono">×{h.quantity}</span>
                  </div>
                  <div className="text-sm font-sans text-white truncate">{h.name}</div>
                  <div className="mt-1"><Sparkline data={h.sparkline} positive={up} height={20} width={110} /></div>
                </div>
                <div className="text-right">
                  <div className="font-mono text-sm text-white num">{fmtG(h.value, 2)}</div>
                  <div className={`font-mono text-[11px] ${up ? "text-pos" : "text-neg"} num`}>
                    {fmtPct(h.pl_pct)} · {fmtG(h.pl, 1)}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </motion.div>
  );
}

function BreakdownRow({ color, icon, label, value, total }) {
  const pct = total > 0 ? (value / total) * 100 : 0;
  return (
    <div className="flex items-center gap-2">
      <span className="h-2 w-2 rounded-sm shrink-0" style={{ background: color }} />
      <span className="text-text-secondary shrink-0">{icon}</span>
      <span className="text-xs text-white flex-1">{label}</span>
      <span className="text-[10px] font-mono text-text-secondary num">{pct.toFixed(0)}%</span>
      <span className="text-xs font-mono text-white num w-20 text-right">{fmtG(value, 0)}</span>
    </div>
  );
}
