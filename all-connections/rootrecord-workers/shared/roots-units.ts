/** Internal Roots ledger granularity: 100_000_000 atomic units = 1.0 whole Root. */
export const ROOTS_ATOMIC_PER_WHOLE = 100_000_000;

/** Smallest credited increment in whole-Root terms (one atomic unit). */
export const ROOTS_SMALLEST_UNIT_WHOLE = 0.00000001;

export function rootsWholeToAtomic(whole: number): number {
  const w = Number(whole);
  if (!Number.isFinite(w) || w <= 0) return 0;
  return Math.floor(w * ROOTS_ATOMIC_PER_WHOLE);
}

export function rootsAtomicToWhole(atomic: number): number {
  const a = Math.max(0, Math.floor(Number(atomic) || 0));
  return a / ROOTS_ATOMIC_PER_WHOLE;
}

/** Human-readable whole-Roots amount from atomic ledger integer. */
export function formatRootsAtomic(atomic: number): string {
  const a = Math.max(0, Math.floor(Number(atomic) || 0));
  const whole = a / ROOTS_ATOMIC_PER_WHOLE;
  if (whole >= 1_000_000_000) return `${(whole / 1_000_000_000).toFixed(2)}B`;
  if (whole >= 1_000_000) return `${(whole / 1_000_000).toFixed(2)}M`;
  if (whole >= 10_000) return `${(whole / 1_000).toFixed(1)}K`;
  if (whole >= 1_000) return `${(whole / 1_000).toFixed(2)}K`;
  if (whole >= 1) return whole.toLocaleString(undefined, { maximumFractionDigits: 8 });
  if (a > 0) return whole.toFixed(8).replace(/\.?0+$/, "");
  return "0";
}

export function formatRootsAtomicLocale(atomic: number): string {
  const whole = rootsAtomicToWhole(atomic);
  if (whole >= 1) return whole.toLocaleString(undefined, { maximumFractionDigits: 8 });
  const a = Math.max(0, Math.floor(Number(atomic) || 0));
  if (a <= 0) return "0";
  return whole.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 8 });
}
