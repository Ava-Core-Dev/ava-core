import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { motion } from "framer-motion";
import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ChevronLeft, ArrowUpRight, ArrowDownRight, TrendingUp, Package, Layers } from "lucide-react";
import { api } from "../lib/api";
import { fmtG, fmtPct } from "../lib/format";
import SyncBadge from "../components/SyncBadge";
import PullIndicator from "../components/PullIndicator";
import { usePullToRefresh } from "../lib/usePullToRefresh";

const ranges = ["1H", "1D", "1W", "1M", "ALL"];

export default function MarketDetail() {
  const { ticker } = useParams();
  const nav = useNavigate();
  const [range, setRange] = useState("1D");
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [syncedAt, setSyncedAt] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get(`/market/item/${ticker}`, { params: { range } });
      setData(data);
      setSyncedAt(Date.now());
    } finally {
      setLoading(false);
    }
  }, [ticker, range]);

  useEffect(() => { load(); }, [load]);

  const ptr = usePullToRefresh(load);

  const up = (data?.change_24h_pct ?? 0) >= 0;
  const stroke = up ? "#00F58C" : "#FF453A";
  const chartData = useMemo(() => (data?.history || []).map((p) => ({ ...p, t: p.t })), [data]);

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="px-4 pt-4 pb-4 space-y-5 relative"
      data-testid="market-detail"
    >
      <PullIndicator {...ptr} />
      <div className="flex items-center justify-between">
        <button onClick={() => nav(-1)} className="flex items-center gap-1 text-text-secondary hover:text-white" data-testid="detail-back">
          <ChevronLeft size={18} />
          <span className="text-xs font-mono uppercase tracking-widest">Back</span>
        </button>
        <SyncBadge syncedAt={syncedAt} />
      </div>

      {loading && <div className="py-16 text-center text-text-secondary">Loading…</div>}
      {data && (
        <>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-mono text-xs text-text-secondary">{data.category?.toUpperCase()}</span>
              <span className="text-text-muted text-[10px]">•</span>
              <span className="font-mono text-xs text-text-secondary">{data.listings} listings</span>
            </div>
            <div className="flex items-baseline gap-3 mt-1">
              <h1 className="font-display font-extrabold text-3xl tracking-tight">{data.name}</h1>
              <span className="font-mono text-sm text-text-secondary">{data.ticker}</span>
            </div>
            <div className="mt-2 flex items-baseline gap-3">
              <div className="font-mono text-5xl font-bold tracking-tightest text-white num">
                {data.current_price.toFixed(2)}
              </div>
              <div className="font-mono text-sm text-text-secondary">G</div>
            </div>
            <div className={`mt-1 font-mono text-sm ${up ? "text-pos" : "text-neg"} flex items-center gap-1`}>
              {up ? <ArrowUpRight size={14} /> : <ArrowDownRight size={14} />}
              {fmtPct(data.change_24h_pct)} · 24h
              <span className="text-text-muted ml-3">7d {fmtPct(data.change_7d_pct)}</span>
            </div>
          </div>

          {/* Chart */}
          <div className="h-56 -mx-1">
            <ResponsiveContainer>
              <AreaChart data={chartData}>
                <defs>
                  <linearGradient id="fillArea" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={stroke} stopOpacity={0.35} />
                    <stop offset="100%" stopColor={stroke} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <XAxis dataKey="t" hide />
                <YAxis hide domain={["dataMin", "dataMax"]} />
                <Tooltip
                  contentStyle={{
                    background: "#121212",
                    border: "1px solid rgba(255,255,255,0.1)",
                    borderRadius: 6,
                    fontFamily: "JetBrains Mono, monospace",
                    fontSize: 12,
                    color: "#fff",
                  }}
                  labelFormatter={(v) => new Date(v).toLocaleString()}
                  formatter={(v) => [`${Number(v).toFixed(3)} G`, "Price"]}
                />
                <Area
                  type="monotone"
                  dataKey="price"
                  stroke={stroke}
                  strokeWidth={2}
                  fill="url(#fillArea)"
                  isAnimationActive={false}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>

          {/* Range tabs */}
          <div className="flex gap-1 p-1 bg-bg-surface/60 border border-white/5 rounded-md">
            {ranges.map((r) => (
              <button
                key={r}
                onClick={() => setRange(r)}
                data-testid={`range-${r}`}
                className={`flex-1 py-1.5 rounded text-[11px] font-mono uppercase tracking-widest transition-colors ${
                  range === r ? "bg-bg-elev text-white" : "text-text-secondary hover:text-white"
                }`}
              >
                {r}
              </button>
            ))}
          </div>

          {/* Stats grid */}
          <div className="grid grid-cols-2 gap-3">
            <StatBox icon={<TrendingUp size={12} />} label="High" value={data.high?.toFixed(2)} />
            <StatBox icon={<TrendingUp size={12} className="rotate-180" />} label="Low" value={data.low?.toFixed(2)} />
            <StatBox icon={<Layers size={12} />} label="24h Volume" value={fmtG(data.volume_24h, 0)} />
            <StatBox icon={<Package size={12} />} label="Listings" value={data.listings} />
          </div>

          <div className="rounded-md border border-white/10 bg-bg-surface p-4">
            <div className="text-[10px] font-mono uppercase tracking-[0.2em] text-text-secondary">
              How to trade
            </div>
            <p className="mt-2 text-sm text-text-secondary leading-relaxed">
              List and buy {data.name} at any player shop on <span className="font-mono text-white">play.rootmc.net</span>.
              Prices update live from in-game listings; the treasury sets no floors.
            </p>
          </div>
        </>
      )}
    </motion.div>
  );
}

function StatBox({ icon, label, value }) {
  return (
    <div className="rounded-md border border-white/10 bg-bg-surface p-3">
      <div className="flex items-center gap-1.5 text-text-secondary">
        {icon}
        <span className="text-[9px] font-mono uppercase tracking-widest">{label}</span>
      </div>
      <div className="mt-1.5 font-mono text-lg text-white num">{value}</div>
    </div>
  );
}
