/**
 * Towny escalating plot claim pricing  -  mirrors live `Towny/settings/config.yml`:
 *   price_claim_townblock: 12.0
 *   price_claim_townblock_increase: 1.12
 *   max_price_claim_townblock: 85.0
 *
 * Same formula as Towny marginal claim cost (see TownyPlotRefundBridge in root-essentials).
 */

export type TownyPlotClaimPricing = {
  baseGold: number;
  increaseFactor: number;
  maxMarginalGold: number;
};

/** Live RootMC Towny economy settings (Shockbyte sync). */
export const ROOTMC_TOWNY_PLOT_CLAIM_PRICING: TownyPlotClaimPricing = {
  baseGold: 12,
  increaseFactor: 1.12,
  maxMarginalGold: 85,
};

/** Gold cost to claim the Nth town plot (1-based), capped at maxMarginalGold. */
export function marginalTownPlotClaimCost(
  plotNumber: number,
  pricing: TownyPlotClaimPricing = ROOTMC_TOWNY_PLOT_CLAIM_PRICING,
): number {
  const n = Math.max(1, Math.floor(Number(plotNumber) || 0));
  let price = Math.round(Math.pow(pricing.increaseFactor, n - 1) * pricing.baseGold);
  if (pricing.maxMarginalGold >= 0) {
    price = Math.min(price, pricing.maxMarginalGold);
  }
  return price;
}

/** Cumulative Gold spent to claim `plotCount` plots at escalating Towny fees. */
export function totalTownPlotClaimValue(
  plotCount: number,
  pricing: TownyPlotClaimPricing = ROOTMC_TOWNY_PLOT_CLAIM_PRICING,
): number {
  const n = Math.max(0, Math.floor(Number(plotCount) || 0));
  if (n === 0) return 0;
  let sum = 0;
  for (let i = 1; i <= n; i++) {
    sum += marginalTownPlotClaimCost(i, pricing);
  }
  return sum;
}

export function townyPlotClaimPricingContext(
  pricing: TownyPlotClaimPricing = ROOTMC_TOWNY_PLOT_CLAIM_PRICING,
) {
  return {
    base_gold: pricing.baseGold,
    increase_factor: pricing.increaseFactor,
    max_marginal_gold: pricing.maxMarginalGold,
    formula:
      "Sum of marginal claim costs: round(base x increase^(n−1)), capped at max_marginal_gold per plot",
  };
}
