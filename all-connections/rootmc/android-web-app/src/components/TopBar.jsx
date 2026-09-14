import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";

export default function TopBar() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [status, setStatus] = useState(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const { data } = await api.get("/server/status");
        if (!cancelled) setStatus(data);
      } catch { /* noop */ }
    };
    load();
    const t = setInterval(load, 30_000);
    return () => { cancelled = true; clearInterval(t); };
  }, []);

  const online = status?.online;
  return (
    <header
      className="sticky top-0 z-40 bg-bg-base/80 backdrop-blur-xl border-b border-white/5"
      data-testid="top-bar"
    >
      <div className="px-4 md:px-6 py-3 flex items-center justify-between max-w-6xl mx-auto md:max-w-none">
        <div className="flex items-center gap-2 cursor-pointer md:hidden" onClick={() => navigate("/")} data-testid="topbar-root-link">
          <div className="h-8 w-8 rounded-md bg-gold/10 border border-gold/30 grid place-items-center">
            <span className="font-display font-extrabold text-gold text-sm tracking-tight">R</span>
          </div>
          <div className="leading-tight">
            <div className="font-display font-extrabold tracking-tight text-white text-sm">
              ROOTMC<span className="text-gold">.</span>
            </div>
            <div className="text-[10px] font-mono uppercase tracking-[0.2em] text-text-secondary">
              Terminal
            </div>
          </div>
        </div>
        <div className="hidden md:block text-[11px] font-mono uppercase tracking-[0.2em] text-text-secondary">
          Trading terminal
        </div>

        <div className="flex items-center gap-2">
          <div
            className={`flex items-center gap-1.5 rounded-md border px-2 py-1 ${
              online
                ? "border-pos/30 bg-pos/5 text-pos"
                : "border-white/10 bg-white/5 text-text-secondary"
            }`}
            data-testid="server-status-pill"
          >
            <span className={`h-1.5 w-1.5 rounded-full ${online ? "bg-pos animate-pulse" : "bg-text-muted"}`} />
            <span className="text-[10px] font-mono uppercase tracking-widest">
              {online ? `${status?.players_online ?? 0} online` : "offline"}
            </span>
          </div>

          {user && (
            <button
              className="h-8 w-8 rounded-md overflow-hidden border border-white/10 bg-bg-surface"
              data-testid="user-avatar-button"
              onClick={() => navigate("/rootmc/more")}
              aria-label="Profile"
            >
              <img src={user.head_url} alt={user.minecraft_username} className="h-full w-full object-cover" />
            </button>
          )}
        </div>
      </div>
    </header>
  );
}
