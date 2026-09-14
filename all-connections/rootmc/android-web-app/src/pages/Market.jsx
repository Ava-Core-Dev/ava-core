import React, { useEffect, useState, useCallback } from "react";
import { motion } from "framer-motion";
import { useNavigate, useSearchParams } from "react-router-dom";
import { api } from "../lib/api";
import { fmtPct } from "../lib/format";
import Sparkline from "../components/Sparkline";
import SyncBadge from "../components/SyncBadge";
import PullIndicator from "../components/PullIndicator";
import { usePullToRefresh } from "../lib/usePullToRefresh";
import { ArrowUpRight, ArrowDownRight, Search } from "lucide-react";

const sorts = [
  { id: "volume", label: "Volume" },
  { id: "gainers", label: "Gainers" },
  { id: "losers", label: "Losers" },
  { id: "price", label: "Price" },
];

const cats = [
  { id: "", label: "All" },
  { id: "gem", label: "Gems" },
  { id: "ore", label: "Ores" },
  { id: "gear", label: "Gear" },
  { id: "farm", label: "Farm" },
  { id: "rare", label: "Rare" },
];

export default function Market() {
  const nav = useNavigate();
  const [params, setParams] = useSearchParams();
  const initialSort = params.get("sort") || "volume";
  const [sort, setSort] = useState(initialSort);
  const [cat, setCat] = useState("");
  const [q, setQ] = useState("");
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [syncedAt, setSyncedAt] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get("/market/items", { params: { sort, ...(cat ? { category: cat } : {}) } });
      setItems(data.items);
      setSyncedAt(Date.now());
    } finally {
      setLoading(false);
    }
  }, [sort, cat]);

  useEffect(() => { load(); }, [load]);

  const ptr = usePullToRefresh(load);

  useEffect(() => {
    const sp = new URLSearchParams(params);
    sp.set("sort", sort);
    setParams(sp, { replace: true });
  }, [sort, params, setParams]);

  const filtered = q
    ? items.filter(
        (i) => i.ticker.toLowerCase().includes(q.toLowerCase()) || i.name.toLowerCase().includes(q.toLowerCase())
      )
    : items;

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
      className="px-4 md:px-6 pt-4 md:pt-6 space-y-4 relative"
      data-testid="market-screen"
    >
      <PullIndicator {...ptr} />
      <div className="flex items-end justify-between">
        <div>
          <div className="text-[10px] font-mono uppercase tracking-[0.2em] text-text-secondary">Player Shops</div>
          <h1 className="font-display font-extrabold text-3xl tracking-tight">Market</h1>
        </div>
        <SyncBadge syncedAt={syncedAt} className="mb-1" />
      </div>

      {/* Search */}
      <div className="relative">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-secondary" />
        <input
          data-testid="market-search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search ticker or item…"
          className="w-full bg-bg-surface border border-white/10 rounded-md pl-9 pr-3 py-2.5 font-mono text-sm placeholder:text-text-muted focus:border-gold/50 focus:outline-none"
        />
      </div>

      {/* Sort segmented */}
      <div className="flex gap-1 p-1 bg-bg-surface/60 border border-white/5 rounded-md">
        {sorts.map((s) => (
          <button
            key={s.id}
            onClick={() => setSort(s.id)}
            data-testid={`sort-${s.id}`}
            className={`flex-1 py-1.5 rounded text-[11px] font-mono uppercase tracking-widest transition-colors ${
              sort === s.id ? "bg-bg-elev text-white" : "text-text-secondary hover:text-white"
            }`}
          >
            {s.label}
          </button>
        ))}
      </div>

      {/* Category chips */}
      <div className="flex gap-2 overflow-x-auto no-scrollbar -mx-4 px-4">
        {cats.map((c) => (
          <button
            key={c.id || "all"}
            onClick={() => setCat(c.id)}
            data-testid={`cat-${c.id || "all"}`}
            className={`shrink-0 rounded-md px-3 py-1.5 border text-[11px] font-mono uppercase tracking-widest transition-colors ${
              cat === c.id
                ? "border-gold/50 bg-gold/10 text-gold"
                : "border-white/10 bg-bg-surface text-text-secondary hover:text-white"
            }`}
          >
            {c.label}
          </button>
        ))}
      </div>

      {/* List */}
      <div className="rounded-md border border-white/10 bg-bg-surface overflow-hidden divide-y divide-white/5">
        <div className="grid grid-cols-[1fr_auto_auto] gap-3 px-3 py-2 text-[9px] font-mono uppercase tracking-widest text-text-secondary bg-bg-elev/40">
          <span>Item</span>
          <span>Price</span>
          <span>24h</span>
        </div>
        {loading && (
          <div className="p-8 text-center text-sm text-text-secondary" data-testid="market-loading">
            Loading market…
          </div>
        )}
        {!loading && filtered.length === 0 && (
          <div className="p-8 text-center text-sm text-text-secondary">No results.</div>
        )}
        {!loading &&
          filtered.map((it) => {
            const up = it.change_24h_pct >= 0;
            return (
              <button
                key={it.id}
                onClick={() => nav(`/rootmc/market/${it.ticker}`)}
                data-testid={`market-row-${it.ticker}`}
                className="w-full grid grid-cols-[1fr_auto_auto] items-center gap-3 px-3 py-3 hover:bg-bg-elev/60 transition-colors text-left"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-[11px] text-white">{it.ticker}</span>
                    <span className="text-text-muted text-[10px] font-mono">•</span>
                    <span className="text-[11px] text-text-secondary font-mono uppercase">{it.category}</span>
                  </div>
                  <div className="text-sm font-sans text-white truncate">{it.name}</div>
                  <div className="mt-1"><Sparkline data={it.sparkline} positive={up} height={22} width={110} /></div>
                </div>
                <div className="text-right font-mono text-sm text-white num">{it.current_price.toFixed(2)}</div>
                <div className={`text-right font-mono text-[12px] num ${up ? "text-pos" : "text-neg"} flex items-center gap-0.5 justify-end min-w-[54px]`}>
                  {up ? <ArrowUpRight size={11} /> : <ArrowDownRight size={11} />}
                  {fmtPct(it.change_24h_pct)}
                </div>
              </button>
            );
          })}
      </div>
    </motion.div>
  );
}
