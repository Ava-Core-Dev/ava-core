/** Platform service fees. Stripe processing is extra on cards and is taken by Stripe. */
export const CARD_FEE_BPS = 500; // 5.00%
export const CHAIN_FEE_BPS = 250; // 2.50% — half of card

export function feeFromBps(amount: number, bps: number): number {
  const n = Math.max(0, Math.floor(Number(amount) || 0));
  const b = Math.max(0, Math.floor(Number(bps) || 0));
  return Math.floor((n * b) / 10_000);
}

export function netAfterFee(amount: number, bps: number): { gross: number; fee: number; net: number } {
  const gross = Math.max(0, Math.floor(Number(amount) || 0));
  const fee = feeFromBps(gross, bps);
  return { gross, fee, net: Math.max(0, gross - fee) };
}
