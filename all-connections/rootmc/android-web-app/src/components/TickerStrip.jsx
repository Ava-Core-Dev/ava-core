import React, { useEffect, useState } from "react";
import { api } from "../lib/api";
import { fmtPct } from "../lib/format";

/**
 * Auto-scrolling market ticker strip.
 */
export default function TickerStrip() {
  const [items, setItems] = useState([]);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const { data } = await api.get("/market/items?sort=volume");
        if (!cancelled) setItems(data.items.slice(0, 12));
      } catch { /* noop */ }
    };
    load();
    const t = setInterval(load, 60_000);
    return () => { cancelled = true; clearInterval(t); };
  }, []);

  if (!items.length) return null;
  const doubled = [...items, ...items];

  return (
    <div
      className="relative overflow-hidden border-y border-white/5 bg-bg-surface/40"
      data-testid="ticker-strip"
    >
      <div className="flex gap-6 py-2 animate-tickerScroll whitespace-nowrap">
        {doubled.map((it, idx) => {
          const up = it.change_24h_pct >= 0;
          return (
            <div key={`${it.id}-${idx}`} className="flex items-center gap-2 shrink-0">
              <span className="font-mono text-[11px] tracking-wider text-white">{it.ticker}</span>
              <span className="font-mono text-[11px] text-text-secondary num">
                {it.current_price.toFixed(2)}
              </span>
              <span
                className={`font-mono text-[11px] num ${up ? "text-pos" : "text-neg"}`}
              >
                {fmtPct(it.change_24h_pct)}
              </span>
              <span className="text-text-muted">•</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
