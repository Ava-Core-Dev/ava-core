/** Town/nation intelligence brief helpers for Discord reports. */

import { formatReportGold } from "./rootmc-player-facing";
import {
  ROOTMC_TOWNY_PLOT_CLAIM_PRICING,
  totalTownPlotClaimValue,
  townyPlotClaimPricingContext,
} from "./rootmc-towny-plot-value";

function str(v: unknown): string {
  return String(v ?? "").trim();
}

export type TownReportRow = {
  name: string;
  mayor: string | null;
  residents: number;
  nation: string | null;
  is_capital: boolean;
  plot_count: number;
  plot_claim_value_gold: number;
  town_bank_gold: number;
  total_wealth_gold: number;
};

export function normalizeTownReportRow(row: Record<string, unknown>): TownReportRow {
  const plot_count = Math.max(0, Number(row.plot_count) || 0);
  const town_bank_gold = Math.max(0, Number(row.town_balance_gold) || 0);
  const plot_claim_value_gold = totalTownPlotClaimValue(plot_count);
  return {
    name: str(row.town_name) || "Unknown",
    mayor: str(row.mayor_name) || null,
    residents: Math.max(0, Number(row.resident_count) || 0),
    nation: str(row.nation_name) || null,
    is_capital: Number(row.is_capital) === 1,
    plot_count,
    plot_claim_value_gold,
    town_bank_gold,
    total_wealth_gold: plot_claim_value_gold + town_bank_gold,
  };
}

export function townsForReports(towns: Record<string, unknown>[], plotCountsAvailable = true): TownReportRow[] {
  const ranked = towns.map(normalizeTownReportRow);
  if (plotCountsAvailable) {
    return ranked.sort(
      (a, b) => b.plot_count - a.plot_count || b.residents - a.residents || a.name.localeCompare(b.name),
    );
  }
  return ranked.sort((a, b) => b.residents - a.residents || a.name.localeCompare(b.name));
}

export function townsIntelBriefContext(towny: {
  townCount: number;
  nationCount: number;
  totalPlots?: number;
  totalTownBanks?: number;
  syncedAt?: string | null;
  plotCountsAvailable?: boolean;
  towns: Record<string, unknown>[];
}) {
  const plotCountsAvailable = towny.plotCountsAvailable !== false && (towny.totalPlots ?? 0) > 0;
  const ranked = townsForReports(towny.towns, plotCountsAvailable);
  const totalPlots = Math.max(0, Number(towny.totalPlots) || ranked.reduce((sum, t) => sum + t.plot_count, 0));
  const totalBanks = Math.max(
    0,
    Number(towny.totalTownBanks) || ranked.reduce((sum, t) => sum + t.town_bank_gold, 0),
  );
  const totalPlotClaimValue = ranked.reduce((sum, t) => sum + t.plot_claim_value_gold, 0);
  const pricing = townyPlotClaimPricingContext(ROOTMC_TOWNY_PLOT_CLAIM_PRICING);
  return {
    active_town_count: towny.townCount,
    active_nation_count: towny.nationCount,
    total_claimed_plots: totalPlots,
    total_town_banks: formatReportGold(totalBanks),
    total_plot_claim_value: formatReportGold(totalPlotClaimValue),
    total_town_wealth_estimate: formatReportGold(totalPlotClaimValue + totalBanks),
    plot_claim_pricing: pricing,
    plot_counts_available: plotCountsAvailable,
    towny_synced_at: towny.syncedAt || null,
    metric_definitions: {
      claimed_plots: "Town land plots claimed  -  each additional plot costs more Gold to claim",
      plot_claim_value_gold:
        "Estimated cumulative Gold to claim this many plots at escalating fees " +
        `(base ${pricing.base_gold}g, x${pricing.increase_factor} per plot, ${pricing.max_marginal_gold}g cap per marginal claim)`,
      town_bank_gold: "Spendable Gold in the town bank only",
      total_wealth_gold: "plot_claim_value_gold + town_bank_gold",
    },
    towns_by_plots: ranked.slice(0, 20).map((t, i) => ({
      rank: i + 1,
      town: t.name,
      claimed_plots: plotCountsAvailable ? t.plot_count : null,
      plot_claim_value_gold: plotCountsAvailable ? formatReportGold(t.plot_claim_value_gold) : null,
      total_wealth_gold: plotCountsAvailable ? formatReportGold(t.total_wealth_gold) : null,
      residents: t.residents,
      town_bank_gold: formatReportGold(t.town_bank_gold),
      mayor: t.mayor,
      nation: t.nation,
      is_capital: t.is_capital,
    })),
  };
}

export function formatTownsBriefAppendix(towny: {
  townCount: number;
  nationCount: number;
  totalPlots?: number;
  totalTownBanks?: number;
  syncedAt?: string | null;
  plotCountsAvailable?: boolean;
  towns: Record<string, unknown>[];
}): string {
  const plotCountsAvailable = towny.plotCountsAvailable !== false && (towny.totalPlots ?? 0) > 0;
  const ranked = townsForReports(towny.towns, plotCountsAvailable);
  const totalPlots = Math.max(0, Number(towny.totalPlots) || ranked.reduce((sum, t) => sum + t.plot_count, 0));
  const totalBanks = Math.max(
    0,
    Number(towny.totalTownBanks) || ranked.reduce((sum, t) => sum + t.town_bank_gold, 0),
  );
  const totalPlotClaimValue = ranked.reduce((sum, t) => sum + t.plot_claim_value_gold, 0);
  const pricing = ROOTMC_TOWNY_PLOT_CLAIM_PRICING;
  const synced = towny.syncedAt ? `_Towny snapshot  -  ${towny.syncedAt}_` : "";
  const lines = [
    synced,
    plotCountsAvailable
      ? `_**Land value** = cumulative claim cost (${pricing.baseGold}g base, x${pricing.increaseFactor} per plot, ${pricing.maxMarginalGold}g cap)  -  **Town bank** = spendable Gold only_`
      : `_Plot counts syncing  -  ranking by **residents** until next Towny sync  -  **Town bank** = spendable Gold only_`,
    "",
    "**Server totals**",
    `- **Active towns:** ${towny.townCount}`,
    plotCountsAvailable
      ? `- **Total claimed plots:** ${totalPlots.toLocaleString()}`
      : `- **Total claimed plots:** pending sync`,
    plotCountsAvailable
      ? `- **Estimated land value:** ${formatReportGold(totalPlotClaimValue)}`
      : null,
    plotCountsAvailable
      ? `- **Combined town wealth (land + banks):** ${formatReportGold(totalPlotClaimValue + totalBanks)}`
      : null,
    `- **Combined town banks:** ${formatReportGold(totalBanks)}`,
    `- **Active nations:** ${towny.nationCount}`,
    "",
    plotCountsAvailable ? "**Towns by plot count**" : "**Towns by residents**",
  ].filter(Boolean);
  if (ranked.length === 0) {
    lines.push("_No towns._");
  } else {
    for (let i = 0; i < Math.min(ranked.length, 15); i++) {
      const t = ranked[i];
      const nation = t.nation ? `  -  ${t.nation}` : "";
      const capital = t.is_capital ? "  -  capital" : "";
      const plotPart = plotCountsAvailable
        ? `**${t.plot_count}** plots  -  land ${formatReportGold(t.plot_claim_value_gold)}  -  `
        : "";
      lines.push(
        `${i + 1}. **${t.name}**  -  ${plotPart}${t.residents} residents  -  bank ${formatReportGold(t.town_bank_gold)}  -  ${t.mayor || "?"}${nation}${capital}`,
      );
    }
  }
  return lines.join("\n");
}
