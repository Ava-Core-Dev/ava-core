import React, { useEffect, useState } from "react";
import { AlertTriangle, X, WifiOff } from "lucide-react";
import { api } from "../lib/api";

/**
 * Sticky banner that surfaces server-offline or API-down states.
 * Polls /server/status every 30s. When offline (or when a fetch fails), a
 * dismissible banner appears under the top bar so numbers below don't lie.
 */
export default function ServerHealthBanner() {
  const [state, setState] = useState({ online: null, apiOk: true });
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const { data } = await api.get("/server/status");
        if (!cancelled) setState({ online: !!data.online, apiOk: true });
      } catch {
        if (!cancelled) setState({ online: null, apiOk: false });
      }
    };
    load();
    const t = setInterval(load, 30_000);
    return () => { cancelled = true; clearInterval(t); };
  }, []);

  if (dismissed) return null;
  if (state.apiOk && state.online !== false) return null;

  const offline = state.online === false;
  const apiDown = !state.apiOk;

  return (
    <div
      className={`sticky top-[57px] z-30 px-3 md:px-6 py-2 flex items-center gap-2 border-b ${
        apiDown
          ? "bg-neg/10 border-neg/30 text-neg"
          : "bg-warn/10 border-warn/30 text-warn"
      }`}
      data-testid="server-health-banner"
    >
      {apiDown ? <WifiOff size={14} /> : <AlertTriangle size={14} />}
      <div className="flex-1 text-[11px] font-mono uppercase tracking-widest">
        {apiDown ? "API unreachable — retrying" : offline ? "Server offline — numbers may be stale" : ""}
      </div>
      <button
        onClick={() => setDismissed(true)}
        data-testid="server-health-dismiss"
        aria-label="Dismiss"
        className="opacity-70 hover:opacity-100"
      >
        <X size={12} />
      </button>
    </div>
  );
}
