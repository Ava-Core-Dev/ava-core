import React, { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { api } from "../lib/api";
import { fmtG, fmtNum } from "../lib/format";
import { Trophy } from "lucide-react";

const tabs = [
  { id: "net_worth", label: "Net Worth", unit: "G" },
  { id: "playtime", label: "Playtime", unit: "h" },
  { id: "mint", label: "Mint", unit: "G" },
  { id: "mcmmo", label: "McMMO", unit: "PL" },
];

export default function Leaderboards() {
  const [tab, setTab] = useState("net_worth");
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    api
      .get("/leaderboards", { params: { category: tab } })
      .then(({ data }) => setEntries(data.entries))
      .finally(() => setLoading(false));
  }, [tab]);

  const active = tabs.find((t) => t.id === tab);

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="px-4 pt-4 pb-4 space-y-4"
      data-testid="leaderboards-screen"
    >
      <div className="flex items-center gap-3">
        <Trophy className="text-gold" size={22} />
        <div>
          <div className="text-[10px] font-mono uppercase tracking-[0.2em] text-text-secondary">Ranked</div>
          <h1 className="font-display font-extrabold text-3xl tracking-tight">Leaderboards</h1>
        </div>
      </div>

      <div className="grid grid-cols-4 gap-1 p-1 bg-bg-surface/60 border border-white/5 rounded-md">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            data-testid={`lb-tab-${t.id}`}
            className={`py-1.5 rounded text-[10px] font-mono uppercase tracking-widest transition-colors ${
              tab === t.id ? "bg-bg-elev text-white" : "text-text-secondary hover:text-white"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="rounded-md border border-white/10 bg-bg-surface overflow-hidden divide-y divide-white/5">
        {loading ? (
          <div className="p-8 text-center text-text-secondary">Loading…</div>
        ) : (
          entries.map((e) => (
            <div
              key={e.rank}
              className="flex items-center gap-3 px-3 py-3"
              data-testid={`lb-row-${e.rank}`}
            >
              <div
                className={`w-6 h-6 rounded-md grid place-items-center font-mono text-[11px] shrink-0 ${
                  e.rank === 1
                    ? "bg-gold text-black"
                    : e.rank <= 3
                    ? "bg-gold/20 text-gold"
                    : "bg-white/5 text-text-secondary"
                }`}
              >
                {e.rank}
              </div>
              <img
                src={`https://mc-heads.net/head/${e.name}/48`}
                alt=""
                className="h-8 w-8 rounded border border-white/10"
              />
              <div className="min-w-0 flex-1">
                <div className="font-sans text-sm text-white truncate">{e.name}</div>
                {e.delta_pct !== undefined && (
                  <div className={`text-[10px] font-mono ${e.delta_pct >= 0 ? "text-pos" : "text-neg"}`}>
                    {e.delta_pct >= 0 ? "+" : ""}
                    {e.delta_pct}% 24h
                  </div>
                )}
              </div>
              <div className="text-right">
                <div className="font-mono text-sm text-white num">
                  {active.unit === "G" ? fmtG(e.value, 0) : `${fmtNum(e.value, 1)} ${active.unit}`}
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </motion.div>
  );
}
