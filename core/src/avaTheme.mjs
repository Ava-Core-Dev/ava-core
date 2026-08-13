/**
 * Ava Ivy brand palette — locked to Daily Broadcast / cyber-ops thumbnail.
 * Cyan holograms · navy void · white ink · red LIVE · gold hair accent.
 */

export const AVA_COLORS = Object.freeze({
  bg0: "#000d1a",
  bg1: "#001428",
  bg2: "#0a1a2e",
  surface: "#0c1c30",
  surface2: "#122438",
  ink: "#ffffff",
  inkDim: "#c8d8e8",
  muted: "#7a92a8",
  cyan: "#00e5ff",
  cyanBright: "#5ef0ff",
  cyanDim: "#00a8c4",
  cyanGlow: "rgba(0, 229, 255, 0.35)",
  red: "#ff2a3a",
  redDim: "rgba(255, 42, 58, 0.18)",
  gold: "#ffd54a",
  goldDim: "#c9a227",
  warn: "#ffb020",
  ok: "#00e5ff",
  line: "rgba(0, 229, 255, 0.16)",
  lineSoft: "rgba(255, 255, 255, 0.08)",
});

/** Shared `:root` CSS custom properties for Ava HTML pages. */
export function avaThemeCssVars() {
  const c = AVA_COLORS;
  return `
    --bg0: ${c.bg0};
    --bg1: ${c.bg1};
    --bg2: ${c.bg2};
    --surface: ${c.surface};
    --ink: ${c.ink};
    --ink-dim: ${c.inkDim};
    --muted: ${c.muted};
    --accent: ${c.cyan};
    --accent-bright: ${c.cyanBright};
    --accent-dim: ${c.cyanDim};
    --accent-glow: ${c.cyanGlow};
    --lime: ${c.cyanBright};
    --live: ${c.cyan};
    --break: ${c.warn};
    --hush: ${c.muted};
    --down: ${c.red};
    --warn: ${c.warn};
    --hot: ${c.red};
    --ok: ${c.cyan};
    --gold: ${c.gold};
    --line: ${c.line};
    --line-soft: ${c.lineSoft};
    --solar: ${c.gold};
    --load: ${c.cyanBright};
    --bank: ${c.cyan};
    --cpu: ${c.warn};
  `.trim();
}

export function cToF(c) {
  const n = Number(c);
  if (!Number.isFinite(n)) return null;
  return Math.round((n * 9) / 5 + 32);
}

export function fToC(f) {
  const n = Number(f);
  if (!Number.isFinite(n)) return null;
  return Math.round(((n - 32) * 5) / 9);
}

/** e.g. "62°C / 144°F" */
export function fmtTempBothFromC(c) {
  if (c == null || !Number.isFinite(Number(c))) return null;
  const cc = Math.round(Number(c));
  return `${cc}°C / ${cToF(cc)}°F`;
}

/** e.g. "78°F / 26°C" */
export function fmtTempBothFromF(f) {
  if (f == null || !Number.isFinite(Number(f))) return null;
  const ff = Math.round(Number(f));
  return `${ff}°F / ${fToC(ff)}°C`;
}
