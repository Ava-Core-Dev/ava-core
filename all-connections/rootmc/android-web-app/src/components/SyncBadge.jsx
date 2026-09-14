import React from "react";

/**
 * Small "Last synced …" pill for data freshness.
 * Ticks every 15s so users know how stale each screen is.
 */
export default function SyncBadge({ syncedAt, className = "" }) {
  const [, setTick] = React.useState(0);
  React.useEffect(() => {
    const t = setInterval(() => setTick((v) => v + 1), 15_000);
    return () => clearInterval(t);
  }, []);
  if (!syncedAt) return null;

  const delta = Math.max(0, Math.floor((Date.now() - syncedAt) / 1000));
  const label =
    delta < 5 ? "just now"
    : delta < 60 ? `${delta}s ago`
    : delta < 3600 ? `${Math.floor(delta / 60)}m ago`
    : `${Math.floor(delta / 3600)}h ago`;

  return (
    <span
      className={`inline-flex items-center gap-1 text-[9px] font-mono uppercase tracking-widest text-text-secondary ${className}`}
      data-testid="sync-badge"
    >
      <span className="h-1 w-1 rounded-full bg-pos/60" />
      Synced {label}
    </span>
  );
}
