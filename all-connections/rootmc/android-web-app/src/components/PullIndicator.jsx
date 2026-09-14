import React from "react";
import { RefreshCw } from "lucide-react";

/**
 * Visual indicator for the pull-to-refresh gesture.
 * Renders at the top of the container.
 */
export default function PullIndicator({ pullDist, threshold, refreshing }) {
  const ready = pullDist >= threshold;
  const visible = pullDist > 4 || refreshing;
  if (!visible) return null;

  const rotation = refreshing ? "" : `rotate(${Math.min(pullDist / threshold, 1) * 180}deg)`;

  return (
    <div
      className="absolute top-0 inset-x-0 flex items-center justify-center pointer-events-none z-30"
      style={{
        transform: `translateY(${Math.min(pullDist, threshold + 16)}px)`,
        transition: refreshing ? "transform 0.2s ease-out" : "none",
      }}
      data-testid="pull-indicator"
    >
      <div
        className={`h-8 w-8 rounded-full border grid place-items-center backdrop-blur-md ${
          ready || refreshing ? "border-gold/50 bg-gold/10 text-gold" : "border-white/10 bg-white/5 text-text-secondary"
        }`}
      >
        <RefreshCw
          size={14}
          className={refreshing ? "animate-spin" : ""}
          style={{ transform: rotation }}
        />
      </div>
    </div>
  );
}
