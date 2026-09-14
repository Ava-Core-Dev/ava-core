/** Canonical Gold (G) rounding and player-facing display  -  three decimal places. */
export const GOLD_DECIMALS = 3;
export const GOLD_SCALE = 1000;
export const GOLD_MIN_AMOUNT = 0.001;

export function roundGold(amount: number): number {
  if (!Number.isFinite(amount)) return 0;
  return Math.round(amount * GOLD_SCALE) / GOLD_SCALE;
}

export function formatGold(amount: number): string {
  return `${roundGold(amount).toFixed(GOLD_DECIMALS)} gold`;
}

export function formatGoldG(amount: number): string {
  return `${roundGold(amount).toFixed(GOLD_DECIMALS)} G`;
}

export function formatGoldCompact(amount: number): string {
  const n = roundGold(amount);
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(GOLD_DECIMALS)}M G`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(GOLD_DECIMALS)} G`;
  return `${n.toFixed(GOLD_DECIMALS)} G`;
}

export function formatGoldDailyReport(amount: number): string {
  const n = Math.max(0, roundGold(amount));
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(GOLD_DECIMALS)}M Gold`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(GOLD_DECIMALS)}k Gold`;
  return `${n.toFixed(GOLD_DECIMALS)} Gold`;
}
