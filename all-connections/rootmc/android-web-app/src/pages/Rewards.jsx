import React, { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useNavigate, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { Flame, Gift, ExternalLink, Vote as VoteIcon, Check, Lock, Sparkles, AlertTriangle } from "lucide-react";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { fmtCountdown } from "../lib/format";
import { USE_MOCK, LIVE_REWARDS_AVAILABLE } from "../lib/rootmc-api";

const REWARDS_GATED = !USE_MOCK && !LIVE_REWARDS_AVAILABLE;

export default function Rewards() {
  const { user, refresh } = useAuth();
  const nav = useNavigate();
  const [params, setParams] = useSearchParams();
  const initial = params.get("tab") === "vote" ? "vote" : "checkin";
  const [tab, setTab] = useState(initial);

  if (!user) {
    return (
      <div className="px-4 pt-12 space-y-4 text-center" data-testid="rewards-signin-cta">
        <div className="mx-auto h-16 w-16 rounded-full bg-gold/10 border border-gold/30 grid place-items-center">
          <Gift className="text-gold" />
        </div>
        <h2 className="font-display font-bold text-xl">Sign in to claim rewards</h2>
        <p className="text-sm text-text-secondary">Daily check-in and vote rewards debit the treasury directly to your wallet.</p>
        <button
          onClick={() => nav("/rootmc/auth")}
          className="mx-auto rounded-md bg-gold text-black font-bold px-6 py-3"
          data-testid="rewards-signin-btn"
        >
          Sign in
        </button>
      </div>
    );
  }

  return (
    <div className="px-4 md:px-6 pt-4 md:pt-6 space-y-4" data-testid="rewards-screen">
      <div>
        <div className="text-[10px] font-mono uppercase tracking-[0.2em] text-text-secondary">Earn</div>
        <h1 className="font-display font-extrabold text-3xl tracking-tight">Rewards</h1>
      </div>

      {REWARDS_GATED && (
        <div
          className="rounded-md border border-warn/30 bg-warn/5 p-3 flex items-start gap-2"
          data-testid="rewards-gated-banner"
        >
          <AlertTriangle size={14} className="text-warn shrink-0 mt-0.5" />
          <div className="text-[11px] leading-relaxed text-warn font-mono">
            Coming soon — treasury wiring. Claims are disabled until the Worker
            check-in / vote routes ship on api.rootmc.net.
          </div>
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 p-1 bg-bg-surface/60 border border-white/5 rounded-md">
        {[
          { id: "checkin", label: "Daily Check-In" },
          { id: "vote", label: "Vote Sites" },
        ].map((t) => (
          <button
            key={t.id}
            data-testid={`rewards-tab-${t.id}`}
            onClick={() => {
              setTab(t.id);
              const sp = new URLSearchParams(params);
              sp.set("tab", t.id);
              setParams(sp, { replace: true });
            }}
            className={`flex-1 py-2 rounded text-xs font-mono uppercase tracking-widest transition-colors ${
              tab === t.id ? "bg-bg-elev text-white" : "text-text-secondary hover:text-white"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <AnimatePresence mode="wait">
        {tab === "checkin" ? <CheckInTab key="c" refreshUser={refresh} /> : <VoteTab key="v" refreshUser={refresh} />}
      </AnimatePresence>
    </div>
  );
}

/* ---------- CHECK-IN ---------- */
function CheckInTab({ refreshUser }) {
  const [status, setStatus] = useState(null);
  const [claiming, setClaiming] = useState(false);
  const [celebrate, setCelebrate] = useState(false);
  const [tick, setTick] = useState(0);
  const loadedAtRef = React.useRef(Date.now());
  void tick; // forces countdown re-render each second

  useEffect(() => {
    api.get("/checkin/status").then(({ data }) => {
      loadedAtRef.current = Date.now();
      setStatus(data);
    });
  }, []);
  useEffect(() => {
    const t = setInterval(() => setTick((v) => v + 1), 1000);
    return () => clearInterval(t);
  }, []);

  const claim = async () => {
    setClaiming(true);
    try {
      const { data } = await api.post("/checkin/claim");
      toast.success(`+${data.reward.gold} G claimed! Streak: Day ${data.new_streak}`, {
        icon: <Sparkles size={16} className="text-gold" />,
      });
      setCelebrate(true);
      setTimeout(() => setCelebrate(false), 1600);
      const { data: s } = await api.get("/checkin/status");
      loadedAtRef.current = Date.now();
      setStatus(s);
      refreshUser();
    } catch (e) {
      const detail = e?.response?.data?.detail;
      toast.error(typeof detail === "string" ? detail : "Cooldown active");
    } finally {
      setClaiming(false);
    }
  };

  if (!status) return <div className="p-6 text-center text-text-secondary">Loading…</div>;

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0 }}
      className="space-y-4"
    >
      {/* Hero claim card */}
      <div className="relative rounded-md border border-white/10 bg-bg-surface overflow-hidden grain">
        <div className="absolute inset-0 bg-grid opacity-30" />
        <div
          className="absolute -top-20 -right-20 h-56 w-56 rounded-full blur-3xl opacity-30"
          style={{ background: "radial-gradient(circle, #FFB800 0%, transparent 70%)" }}
        />

        <div className="relative p-5">
          <div className="flex items-center justify-between">
            <div className="text-[10px] font-mono uppercase tracking-[0.2em] text-text-secondary">
              Daily Check-In
            </div>
            <div className="text-[10px] font-mono uppercase tracking-widest text-gold">
              Streak · {status.streak}
            </div>
          </div>

          <div className="mt-4 flex items-baseline gap-2">
            <div className="font-mono text-5xl font-bold text-white num">+{status.next_reward.gold}</div>
            <div className="font-mono text-lg text-gold">G</div>
          </div>
          <div className="text-xs text-text-secondary mt-1">
            {status.can_claim ? `Ready to claim · ${status.next_reward.tier_label}` : "Come back tomorrow"}
          </div>

          <motion.button
            whileTap={{ scale: 0.97 }}
            disabled={!status.can_claim || claiming || REWARDS_GATED}
            onClick={claim}
            data-testid="claim-checkin-btn"
            className={`mt-5 w-full rounded-md py-3.5 font-bold font-display tracking-tight text-base transition-colors ${
              status.can_claim && !REWARDS_GATED
                ? "bg-gold hover:bg-[#E6A600] text-black animate-pulseGold"
                : "bg-white/5 text-text-secondary cursor-not-allowed border border-white/10"
            }`}
          >
            {REWARDS_GATED
              ? "Coming soon"
              : claiming
              ? "Claiming…"
              : status.can_claim
              ? "Claim reward"
              : `Next in ${fmtCountdown(Math.max(0, status.seconds_until_next - Math.floor((Date.now() - loadedAtRef.current) / 1000)))}`}
          </motion.button>
        </div>

        {celebrate && <Confetti />}
      </div>

      {/* Streak grid */}
      <div>
        <div className="text-[10px] font-mono uppercase tracking-[0.2em] text-text-secondary mb-2">
          7-Day Streak
        </div>
        <div className="grid grid-cols-7 gap-2">
          {status.week.map((day, idx) => {
            const done = idx < status.streak;
            const isNext = idx === status.streak;
            return (
              <div
                key={idx}
                data-testid={`streak-day-${idx + 1}`}
                className={`aspect-square rounded-md border flex flex-col items-center justify-center gap-0.5 relative ${
                  done
                    ? "bg-gold/10 border-gold/40 text-gold"
                    : isNext
                    ? "bg-white/5 border-white/20 text-white"
                    : "bg-bg-surface border-white/5 text-text-muted"
                }`}
              >
                {done ? <Check size={14} /> : <span className="font-mono text-[10px]">D{idx + 1}</span>}
                <span className="font-mono text-[10px] num">{day.gold}G</span>
              </div>
            );
          })}
        </div>
      </div>

      <div className="rounded-md border border-white/10 bg-bg-surface p-4 flex items-start gap-3">
        <Flame className="text-gold shrink-0" size={18} />
        <div>
          <div className="font-display font-bold text-white text-sm">Treasury-backed</div>
          <p className="text-xs text-text-secondary mt-1 leading-relaxed">
            Every check-in debits the RootMC treasury and credits your wallet on the server.
            Rewards grow through day 7, then loop.
          </p>
        </div>
      </div>
    </motion.div>
  );
}

/* ---------- VOTE ---------- */
function VoteTab({ refreshUser }) {
  const [data, setData] = useState(null);
  const [claiming, setClaiming] = useState(null);
  const [tick, setTick] = useState(0);
  const loadedAtRef = React.useRef(Date.now());
  void tick; // forces cooldown re-render each second
  const [pending, setPending] = useState({}); // siteId -> boolean (visited, can claim)

  const load = () =>
    api.get("/vote/sites").then(({ data }) => {
      loadedAtRef.current = Date.now();
      setData(data);
    });

  useEffect(() => {
    load();
  }, []);
  useEffect(() => {
    const t = setInterval(() => setTick((v) => v + 1), 1000);
    return () => clearInterval(t);
  }, []);

  const openVote = (site) => {
    window.open(site.url, "_blank", "noopener,noreferrer");
    setPending((p) => ({ ...p, [site.id]: true }));
    toast("Vote opened. Come back and tap Claim.", { icon: <VoteIcon size={16} /> });
  };

  const claim = async (site) => {
    setClaiming(site.id);
    try {
      const { data: res } = await api.post("/vote/claim", { site_id: site.id });
      toast.success(`+${res.reward_gold} G from ${res.site}`);
      setPending((p) => ({ ...p, [site.id]: false }));
      load();
      refreshUser();
    } catch (e) {
      const detail = e?.response?.data?.detail;
      toast.error(typeof detail === "string" ? detail : "Cooldown active");
    } finally {
      setClaiming(null);
    }
  };

  if (!data) return <div className="p-6 text-center text-text-secondary">Loading…</div>;

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0 }}
      className="space-y-4"
    >
      <div className="rounded-md border border-white/10 bg-bg-surface p-4 flex items-center justify-between">
        <div>
          <div className="text-[10px] font-mono uppercase tracking-[0.2em] text-text-secondary">
            Earned Today
          </div>
          <div className="font-mono text-2xl font-bold text-white mt-1 num" data-testid="vote-earned-today">
            +{data.earned_today.toFixed(0)} G
          </div>
        </div>
        <div className="text-right">
          <div className="text-[10px] font-mono uppercase tracking-[0.2em] text-text-secondary">
            Sites
          </div>
          <div className="font-mono text-2xl font-bold text-gold mt-1">{data.sites.length}</div>
        </div>
      </div>

      <div className="space-y-2">
        {data.sites.map((s) => {
          const cooldown = Math.max(0, s.seconds_until - Math.floor((Date.now() - loadedAtRef.current) / 1000));
          const canClaim = s.can_claim || pending[s.id];
          const showClaim = pending[s.id] && s.can_claim; // visited & ready
          return (
            <div
              key={s.id}
              className="rounded-md border border-white/10 bg-bg-surface p-3 flex items-center gap-3"
              data-testid={`vote-site-${s.id}`}
            >
              <div className="h-10 w-10 rounded-md bg-gold/10 border border-gold/30 grid place-items-center shrink-0">
                <VoteIcon size={16} className="text-gold" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="font-sans font-semibold text-white text-sm truncate">{s.name}</div>
                <div className="font-mono text-[11px] text-gold">+{s.reward} G / vote</div>
              </div>
              {!canClaim ? (
                <div className="text-right">
                  <Lock size={12} className="text-text-secondary ml-auto mb-1" />
                  <div className="font-mono text-[10px] text-text-secondary num">{fmtCountdown(cooldown)}</div>
                </div>
              ) : showClaim ? (
                <button
                  onClick={() => claim(s)}
                  disabled={claiming === s.id || REWARDS_GATED}
                  data-testid={`vote-claim-${s.id}`}
                  className="rounded-md bg-gold hover:bg-[#E6A600] disabled:opacity-50 disabled:cursor-not-allowed text-black font-bold px-3 py-2 text-xs"
                >
                  {REWARDS_GATED ? "Soon" : claiming === s.id ? "…" : "Claim"}
                </button>
              ) : (
                <button
                  onClick={() => openVote(s)}
                  data-testid={`vote-open-${s.id}`}
                  className="rounded-md bg-white/10 hover:bg-white/20 text-white px-3 py-2 text-xs font-mono uppercase tracking-widest flex items-center gap-1"
                >
                  Vote
                  <ExternalLink size={11} />
                </button>
              )}
            </div>
          );
        })}
      </div>

      <div className="rounded-md border border-white/10 bg-bg-surface p-4 flex items-start gap-3">
        <VoteIcon className="text-gold shrink-0" size={18} />
        <div>
          <div className="font-display font-bold text-white text-sm">How voting works</div>
          <p className="text-xs text-text-secondary mt-1 leading-relaxed">
            Open a site, cast your vote, then return and tap Claim. Each site has a 24-hour cooldown.
            Total possible: <span className="text-white font-mono">+95 G/day</span>.
          </p>
        </div>
      </div>
    </motion.div>
  );
}

/* ---------- Confetti burst ---------- */
function Confetti() {
  const bits = Array.from({ length: 22 });
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden">
      {bits.map((_, i) => {
        const angle = (Math.PI * 2 * i) / bits.length;
        const dist = 80 + (i % 5) * 20;
        return (
          <motion.span
            key={i}
            initial={{ x: 0, y: 0, opacity: 1, scale: 1 }}
            animate={{
              x: Math.cos(angle) * dist,
              y: Math.sin(angle) * dist - 40,
              opacity: 0,
              scale: 0.4,
            }}
            transition={{ duration: 1.1, ease: "easeOut" }}
            className="absolute left-1/2 top-1/2 h-1.5 w-1.5 rounded-full"
            style={{
              background: i % 2 ? "#FFB800" : "#00F58C",
            }}
          />
        );
      })}
    </div>
  );
}
