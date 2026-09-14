export const fmtG = (n, digits = 2) => {
  if (n === null || n === undefined || isNaN(n)) return "—";
  const v = Number(n);
  if (Math.abs(v) >= 1_000_000)
    return `${(v / 1_000_000).toFixed(2)}M G`;
  if (Math.abs(v) >= 10_000)
    return `${(v / 1000).toFixed(1)}k G`;
  return `${v.toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits })} G`;
};

export const fmtNum = (n, digits = 2) => {
  if (n === null || n === undefined || isNaN(n)) return "—";
  return Number(n).toLocaleString(undefined, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
};

export const fmtPct = (n, digits = 2) => {
  if (n === null || n === undefined || isNaN(n)) return "—";
  const sign = n > 0 ? "+" : "";
  return `${sign}${Number(n).toFixed(digits)}%`;
};

export const fmtCountdown = (secs) => {
  if (secs <= 0) return "00:00:00";
  const h = Math.floor(secs / 3600).toString().padStart(2, "0");
  const m = Math.floor((secs % 3600) / 60).toString().padStart(2, "0");
  const s = Math.floor(secs % 60).toString().padStart(2, "0");
  return `${h}:${m}:${s}`;
};

export const deltaColor = (n) => (n >= 0 ? "text-pos" : "text-neg");
