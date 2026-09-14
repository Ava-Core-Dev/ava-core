/** Player-facing copy rules for public RootMC Discord intelligence reports. */

import type { TreasuryReportBrief } from "./rootmc-treasury";
import { TREASURY_TYPE_GLOSSARY } from "./rootmc-treasury";
import { normalizeDiscordMarkdown } from "./rootmc-discord-markdown";

export const ROOTMC_PLAYER_AUDIENCE_RULES =
  "Audience: RootMC players and staff in public Discord  -  never developers. " +
  "Use plain in-game language. Do not mention plugins, sync, APIs, backends, data pipelines, " +
  "or how metrics are collected. " +
  "Currency is Gold only  -  write amounts like **47.76 Gold** or **12.5k Gold**. " +
  "Never use $, USD, dollars, or real-world money. " +
  "**Net worth** = a player's or the server's total tracked wealth (balance + items + shops, etc.). " +
  "**Wallet Gold** / **balance** = Gold in their account only. Never call net worth 'Gold total' or 'total Gold'. " +
  "Do not cite server IDs, UUIDs, or internal field names from the JSON. ";

export function sanitizePlayerFacingReport(text: string): string {
  let out = String(text || "");
  out = out.replace(/\$\s*([0-9][0-9,]*(?:\.[0-9]+)?)/g, "$1 Gold");
  out = out.replace(/\bUSD\b/gi, "Gold");
  out = out.replace(/\bdollars?\b/gi, "Gold");
  out = out.replace(/\b(?:gold total|total gold(?!\s+minted))\b/gi, "net worth");
  out = out.replace(/\bsync(?:\s+health|\s+status)?\b/gi, "server activity");
  out = out.replace(/\b(?:rootstat|rootmc|plugin)\b/gi, "");
  out = out.replace(/ {2,}/g, " ");
  return normalizeDiscordMarkdown(out.trim());
}

export function formatReportGold(value: number): string {
  const n = Math.max(0, Number(value) || 0);
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(3)}M Gold`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k Gold`;
  if (Number.isInteger(n)) return `${n.toLocaleString()} Gold`;
  return `${n.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 3 })} Gold`;
}

type EconomyTotals = {
  trackedPlayers: number;
  totalNetWorth: number;
  totalBalance: number;
  totalGoldMinted: number;
  totalGoldMined?: number;
  /** null = shop sync missing/stale — never invent a host zero from absent data. */
  shopListings: number | null;
  pricedItems: number;
  syncedAt?: string | null;
};

function formatShopListings(count: number | null | undefined): string {
  if (count == null || !Number.isFinite(Number(count))) return "n/a (not tracked)";
  return String(Math.max(0, Math.floor(Number(count))));
}

type NetWorthRow = {
  minecraft_username?: string | null;
  total_value?: number | null;
  balance_value?: number | null;
};

export function economyContextForPlayers(economy: EconomyTotals) {
  return {
    currency: "Gold",
    players_with_balances: economy.trackedPlayers,
    gold_in_wallets_total: formatReportGold(economy.totalBalance),
    total_gold_mined: formatReportGold(economy.totalGoldMined ?? economy.totalGoldMinted),
    total_gold_minted: formatReportGold(economy.totalGoldMinted),
    combined_net_worth: formatReportGold(Math.max(0, Number(economy.totalNetWorth) || 0)),
    active_shop_listings: formatShopListings(economy.shopListings),
    items_with_shop_prices: economy.pricedItems,
    metric_definitions: {
      wallet_gold: "Spendable Gold in the player's account only (Vault balance)",
      total_gold_mined: "All-time gold found/mined on this host  -  audited on rootmc.net/economy; not treasury grants",
      total_gold_minted: "Same as gold mined on this host",
      net_worth:
        "Total tracked wealth: wallet + inventory/shop stock (when tracked).",
    },
  };
}

export function walletLeaderboardForPlayers(rows: NetWorthRow[], limit = 8) {
  return [...rows]
    .sort((a, b) => (Number(b.balance_value) || 0) - (Number(a.balance_value) || 0))
    .slice(0, limit)
    .map((row, i) => ({
      rank: i + 1,
      player: String(row.minecraft_username || "Unknown").trim() || "Unknown",
      wallet_gold: formatReportGold(Number(row.balance_value) || 0),
    }));
}

export function netWorthLeaderboardForPlayers(rows: NetWorthRow[], limit = 15) {
  return rows.slice(0, limit).map((row, i) => ({
    rank: i + 1,
    player: String(row.minecraft_username || "Unknown").trim() || "Unknown",
    net_worth: formatReportGold(Number(row.total_value) || 0),
    wallet_gold: formatReportGold(Number(row.balance_value) || 0),
  }));
}

function ledgerLinesByDirection(direction: "inflow" | "outflow", byType: Record<string, number>) {
  return TREASURY_TYPE_GLOSSARY.filter((g) => g.direction === direction)
    .map((g) => ({ label: g.label, amount: Number(byType[g.type]) || 0 }))
    .filter((row) => row.amount > 0)
    .map((row) => ({ label: row.label, amount: formatReportGold(row.amount) }));
}

export function treasuryIntelBriefContext(brief: TreasuryReportBrief) {
  return {
    server_reserve: {
      balance: formatReportGold(brief.reserve_balance ?? 0),
      synced_at: brief.synced_at,
      current_hst_month: brief.current_hst_month,
      prior_hst_month: brief.prior_hst_month,
      month_to_date: {
        inflow: formatReportGold(brief.month_inflow),
        outflow: formatReportGold(brief.month_outflow),
        net: formatReportGold(brief.month_net),
        inflows_by_source: ledgerLinesByDirection("inflow", brief.month_by_type),
        outflows_by_source: ledgerLinesByDirection("outflow", brief.month_by_type),
      },
      prior_month_net: formatReportGold(brief.prior_month_net),
      all_time_net: formatReportGold(brief.all_time_net),
      average_monthly_net: formatReportGold(brief.average_monthly_net),
      fees_mtd: {
        service_fees: formatReportGold(brief.towny_intake_mtd.service_fees),
        total: formatReportGold(brief.towny_intake_mtd.service_fees),
      },
      metric_definitions: {
        server_reserve: "Closed-loop treasury (Server Reserve)  -  taxes, server fees, votes, death fees in; grants, loans out",
      },
    },
  };
}

export function formatTreasuryBriefAppendix(brief: TreasuryReportBrief, syncedAtLabel?: string): string {
  const inflows = ledgerLinesByDirection("inflow", brief.month_by_type);
  const outflows = ledgerLinesByDirection("outflow", brief.month_by_type);
  const stamp = syncedAtLabel || brief.synced_at || "unknown";
  return [
    `_Server Reserve  -  synced ${stamp} HST_`,
    "",
    "**Reserve balance**",
    `- **Balance:** ${formatReportGold(brief.reserve_balance ?? 0)}`,
    `- **All-time net (ledger):** ${formatReportGold(brief.all_time_net)}`,
    `- **Avg monthly net:** ${formatReportGold(brief.average_monthly_net)}`,
    "",
    `**${brief.current_hst_month} month-to-date**`,
    `- **Inflow:** ${formatReportGold(brief.month_inflow)}  -  **Outflow:** ${formatReportGold(brief.month_outflow)}  -  **Net:** ${formatReportGold(brief.month_net)}`,
    inflows.length ? `- **Inflows:** ${inflows.map((r) => `${r.label} ${r.amount}`).join("  -  ")}` : "",
    outflows.length ? `- **Outflows:** ${outflows.map((r) => `${r.label} ${r.amount}`).join("  -  ")}` : "",
    Number(brief.towny_intake_mtd.service_fees) > 0
      ? `**Fees to reserve (MTD)**\n- Services ${formatReportGold(brief.towny_intake_mtd.service_fees)}`
      : "",
  ]
    .filter(Boolean)
    .join("\n");
}

/** Side-by-side Towny vs Claims metrics for Grok + Discord appendix. */
export function hostComparisonForPlayers(
  towny: {
    name?: string;
    economy: EconomyTotals;
  },
  claims: {
    name?: string;
    onlinePlayers?: number | null;
    economy: EconomyTotals;
  },
) {
  const row = (metric: string, townyVal: string | number, claimsVal: string | number) => ({
    metric,
    towny: townyVal,
    claims: claimsVal,
  });
  const netWorthCell = (eco: EconomyTotals) => formatReportGold(Math.max(0, Number(eco.totalNetWorth) || 0));
  return {
    instruction:
      "REQUIRED: live production is play.rootmc.net (Root-Ava-Core). Do not mention towns, nations, or claims. Playtime/votes are live-production only.",
    columns: {
      towny: towny.name || "Towny",
      claims: claims.name || "Claims",
    },
    rows: [
      row(
        "gold_in_wallets",
        formatReportGold(towny.economy.totalBalance),
        formatReportGold(claims.economy.totalBalance),
      ),
      row("combined_net_worth", netWorthCell(towny.economy), netWorthCell(claims.economy)),
      row(
        "gold_mined_all_time",
        formatReportGold(towny.economy.totalGoldMined ?? towny.economy.totalGoldMinted),
        formatReportGold(claims.economy.totalGoldMined ?? claims.economy.totalGoldMinted),
      ),
      row("shop_listings", formatShopListings(towny.economy.shopListings), formatShopListings(claims.economy.shopListings)),
      row("players_with_wallets", towny.economy.trackedPlayers, claims.economy.trackedPlayers),
      row("players_online", "see live status", claims.onlinePlayers ?? "n/a"),
    ],
  };
}

export function formatHostComparisonAppendix(
  townyEco: EconomyTotals,
  claimsEco: EconomyTotals,
  labels?: { towny?: string; claims?: string },
): string {
  const t = labels?.towny || "Towny";
  const c = labels?.claims || "Claims";
  const line = (label: string, a: string | number, b: string | number) =>
    `- **${label}:** ${t} **${a}**  |  ${c} **${b}**`;
  const nw = (eco: EconomyTotals) => formatReportGold(Math.max(0, Number(eco.totalNetWorth) || 0));
  return [
    line("Gold in wallets", formatReportGold(townyEco.totalBalance), formatReportGold(claimsEco.totalBalance)),
    line("Combined net worth", nw(townyEco), nw(claimsEco)),
    line(
      "Gold mined (all-time)",
      formatReportGold(townyEco.totalGoldMined ?? townyEco.totalGoldMinted),
      formatReportGold(claimsEco.totalGoldMined ?? claimsEco.totalGoldMinted),
    ),
    line("Shop listings", formatShopListings(townyEco.shopListings), formatShopListings(claimsEco.shopListings)),
    line("Players with wallets", townyEco.trackedPlayers, claimsEco.trackedPlayers),
  ].join("\n");
}

function formatPlayLabel(seconds: number): string {
  const s = Math.max(0, Math.floor(Number(seconds) || 0));
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

type DualHostPlayRow = {
  minecraft_username?: string | null;
  total_playtime_seconds?: number | null;
};

function formatNetWorthLine(eco: EconomyTotals): string {
  return formatReportGold(Math.max(0, Number(eco.totalNetWorth) || 0));
}

/** Live-production glance for the daily summary — economy brief owns the deep metrics. */
export function formatEqualDualHostDailyBody(input: {
  linked: number;
  playersWithPlaytime: number;
  playtime: DualHostPlayRow[];
  towny: {
    economy: EconomyTotals;
    townCount?: number;
    nationCount?: number;
    totalPlots?: number;
  };
  claims: {
    economy: EconomyTotals;
    onlinePlayers?: number | null;
  };
}): string {
  const topPt = input.playtime[0];
  const playtimeNote = topPt
    ? `_Playtime: **${input.playersWithPlaytime}** players · top **${String(topPt.minecraft_username || "Unknown").trim() || "Unknown"}** at ${formatPlayLabel(Number(topPt.total_playtime_seconds) || 0)}_`
    : `_Playtime: **${input.playersWithPlaytime}** players_`;

  return [
    "## Live production",
    "",
    `_play.rootmc.net — RootMC live production (Root-Ava-Core)._`,
    "",
    `- **Gold in wallets:** **${formatReportGold(input.towny.economy.totalBalance)}** (**${input.towny.economy.trackedPlayers}** players)`,
    "",
    `_Linked players: **${input.linked}**_`,
    playtimeNote,
    "",
    `_Full economy detail is in the Economy brief._`,
  ]
    .filter(Boolean)
    .join("\n");
}

/** Discord activity block for the daily summary (counts only — no message quotes). */
export function formatDiscordDailySection(input: {
  memberCount: number;
  totalMessages: number;
  topChannels: { name: string; count: number }[];
}): string {
  const lines = [
    "## Discord",
    "",
    `- **Members:** **${Math.max(0, Math.floor(Number(input.memberCount) || 0))}**`,
    `- **Messages yesterday:** **${Math.max(0, Math.floor(Number(input.totalMessages) || 0))}**`,
  ];
  if (input.topChannels.length) {
    lines.push(
      `- **Busiest channels:** ${input.topChannels
        .slice(0, 5)
        .map((c) => `**#${String(c.name || "channel").replace(/^#/, "")}** (${c.count})`)
        .join("; ")}`,
    );
  }
  return lines.join("\n");
}

/** Keep only Executive Summary + Outlook from model text; host/Discord sections are injected in code. */
export function extractExecutiveAndOutlook(reportText: string): {
  executive: string;
  outlook: string;
} {
  const text = String(reportText || "").trim();
  const pull = (title: string) => {
    const re = new RegExp(`##\\s*${title}\\s*\\n+([\\s\\S]*?)(?=\\n##\\s|$)`, "i");
    const m = text.match(re);
    return m ? m[1].trim() : "";
  };
  let executive = pull("Executive Summary");
  const outlook = pull("Outlook");
  if (!executive && text && !/^##\s/m.test(text)) {
    executive = text.slice(0, 500);
  }
  return { executive, outlook };
}

export function composeDualHostDailyReportText(opts: {
  aiReportText: string;
  discordSection: string;
  dualHostBody: string;
}): string {
  const { executive, outlook } = extractExecutiveAndOutlook(opts.aiReportText);
  const parts = [
    "## Executive Summary",
    "",
    executive || "_See Discord and host glance below._",
    "",
    opts.discordSection.trim(),
    "",
    opts.dualHostBody.trim(),
  ];
  if (outlook) {
    parts.push("", "## Outlook", "", outlook);
  }
  return parts.join("\n").trim();
}

/** Singular live-production economy body — play.rootmc.net only. */
export function formatLiveProductionEconomyBody(input: {
  linked: number;
  playersWithPlaytime: number;
  playtime: DualHostPlayRow[];
  live: {
    economy: EconomyTotals;
    wallets: NetWorthRow[];
  };
}): string {
  const eco = input.live.economy;
  const wallets = walletLeaderboardForPlayers(input.live.wallets, 5);
  const topPt = input.playtime[0];
  const playtimeNote = topPt
    ? `_Playtime: **${input.playersWithPlaytime}** players · top **${String(topPt.minecraft_username || "Unknown").trim() || "Unknown"}** at ${formatPlayLabel(Number(topPt.total_playtime_seconds) || 0)}_`
    : `_Playtime: **${input.playersWithPlaytime}** players_`;

  const lines = [
    "## Live production",
    "",
    `_play.rootmc.net — RootMC live production (Root-Ava-Core)._`,
    "",
    `- **Gold in wallets:** **${formatReportGold(eco.totalBalance)}** (**${eco.trackedPlayers}** players)`,
    `- **Combined net worth:** **${formatNetWorthLine(eco)}**`,
    `- **Gold mined (all-time):** **${formatReportGold(eco.totalGoldMined ?? eco.totalGoldMinted)}**`,
    `- **Shop listings:** **${formatShopListings(eco.shopListings)}**`,
  ];
  if (wallets.length) {
    lines.push(
      `- **Top wallets:** ${wallets.map((w) => `**${w.player}** ${w.wallet_gold}`).join("; ")}`,
    );
  }
  lines.push("", `_Linked players: **${input.linked}**_`, playtimeNote);
  return lines.join("\n");
}

/** @deprecated Prefer formatLiveProductionEconomyBody. */
export function formatEqualDualHostEconomyBody(input: {
  linked: number;
  playersWithPlaytime: number;
  playtime: DualHostPlayRow[];
  towny: {
    economy: EconomyTotals;
    wallets: NetWorthRow[];
  };
  claims: {
    economy: EconomyTotals;
    wallets: NetWorthRow[];
  };
}): string {
  return formatLiveProductionEconomyBody({
    linked: input.linked,
    playersWithPlaytime: input.playersWithPlaytime,
    playtime: input.playtime,
    live: input.towny,
  });
}

export function composeDualHostEconomyReportText(opts: {
  aiReportText: string;
  dualHostBody: string;
}): string {
  const text = String(opts.aiReportText || "").trim();
  const pull = (title: string) => {
    const re = new RegExp(`##\\s*${title}\\s*\\n+([\\s\\S]*?)(?=\\n##\\s|$)`, "i");
    const m = text.match(re);
    return m ? m[1].trim() : "";
  };
  const overview = pull("Market Overview") || pull("Executive Summary");
  const outlook = pull("Outlook");
  const parts = [
    "## Market Overview",
    "",
    overview || "_See Live production below._",
    "",
    opts.dualHostBody.trim(),
  ];
  if (outlook) {
    parts.push("", "## Outlook", "", outlook);
  }
  return parts.join("\n").trim();
}

/** Grok prompt + Discord appendix payload for economy_intel briefs (singular live production). */
export function economyIntelBriefContext(
  economy: EconomyTotals,
  netWorthRows: NetWorthRow[],
  treasury: TreasuryReportBrief,
  netWorthLimit = 15,
  claims?: {
    displayName: string;
    joinAddress: string;
    onlinePlayers: number | null;
    linked?: number;
    economy: EconomyTotals;
    netWorth: NetWorthRow[];
    wallets?: NetWorthRow[];
  },
  townyMeta?: {
    displayName: string;
    linked?: number;
    playersWithPlaytime?: number;
    playtime?: { minecraft_username?: string | null; total_playtime_seconds?: number | null }[];
    wallets?: NetWorthRow[];
  },
) {
  const formatPlay = (seconds: number) => {
    const s = Math.max(0, Math.floor(Number(seconds) || 0));
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    if (h > 0) return `${h}h ${m}m`;
    return `${m}m`;
  };
  const playLeaders = (
    rows: { minecraft_username?: string | null; total_playtime_seconds?: number | null }[] | undefined,
  ) =>
    (rows || []).slice(0, 5).map((p, i) => ({
      rank: i + 1,
      player: String(p.minecraft_username || "Unknown").trim() || "Unknown",
      playtime: formatPlay(Number(p.total_playtime_seconds) || 0),
    }));

  const realmLinked = townyMeta?.linked ?? claims?.linked ?? null;
  const liveWallets = townyMeta?.wallets?.length ? townyMeta.wallets : netWorthRows;

  return {
    ...treasuryIntelBriefContext(treasury),
    realm_note:
      "RootMC live production is play.rootmc.net (Root-Ava-Core / Root-Economy). Use only these figures. Never mention towns, nations, or claims. Never invent a second host. Never treat wallet totals as combined net worth.",
    linked_players: realmLinked,
    linked_players_note: "Discord-linked Minecraft accounts for live production.",
    realm_playtime: {
      players_with_playtime: townyMeta?.playersWithPlaytime ?? null,
      top_playtime: playLeaders(townyMeta?.playtime),
      note: "Live production playtime pool (Root-Ava-Core).",
    },
    live_production: {
      name: townyMeta?.displayName || "RootMC",
      join: "play.rootmc.net",
      economy: economyContextForPlayers(economy),
      top_wallet_balances: walletLeaderboardForPlayers(liveWallets),
      top_net_worth: netWorthLeaderboardForPlayers(netWorthRows, netWorthLimit),
    },
  };
}

export function formatEconomyBriefAppendix(
  economy: EconomyTotals,
  netWorthRows: NetWorthRow[],
  syncedAtLabel: string,
  treasury?: TreasuryReportBrief,
  claims?: {
    displayName: string;
    economy: EconomyTotals;
    netWorth: NetWorthRow[];
  },
): string {
  const hostBlock = (
    title: string,
    eco: EconomyTotals,
    walletRows: NetWorthRow[],
    nwRows: NetWorthRow[],
  ) => {
    const wallets = walletLeaderboardForPlayers(walletRows, 5);
    const netWorth =
      Number(eco.totalNetWorth) > 0 ? netWorthLeaderboardForPlayers(nwRows, 5) : [];
    return [
      `**${title}**`,
      `- **Gold in wallets:** ${formatReportGold(eco.totalBalance)} (${eco.trackedPlayers} players)`,
      `- **Gold mined (all-time):** ${formatReportGold(eco.totalGoldMined ?? eco.totalGoldMinted)}`,
      `- **Combined net worth:** ${formatReportGold(Math.max(0, Number(eco.totalNetWorth) || 0))}`,
      `- **Shop listings:** ${formatShopListings(eco.shopListings)}`,
      wallets.length
        ? wallets.map((w) => `  ${w.rank}. ${w.player}  -  ${w.wallet_gold}`).join("\n")
        : "  _No wallet balances tracked._",
      netWorth.length
        ? netWorth.map((w) => `  ${w.rank}. ${w.player}  -  ${w.net_worth}`).join("\n")
        : "  _No net worth rankings yet._",
    ].join("\n");
  };

  const parts = [
    `_Live economy snapshot  -  synced ${syncedAtLabel} HST_`,
    `_**Wallet Gold** = spendable balance only  -  **Net worth** = wallet + items + shop stock (when tracked)_`,
    `_Live production (play.rootmc.net) — Root-Ava-Core / Root-Economy._`,
    "",
    hostBlock("Live production", economy, netWorthRows, netWorthRows),
  ];
  if (treasury) {
    parts.push("", formatTreasuryBriefAppendix(treasury, syncedAtLabel));
  }
  return parts.join("\n");
}

export function discordActivityForPlayers(discord: {
  memberCount: number;
  totalMessages: number;
  topChannels: { name: string; count: number }[];
}) {
  return {
    discord_members: discord.memberCount,
    messages_yesterday: discord.totalMessages,
    busiest_channels: discord.topChannels.slice(0, 6).map((c) => ({
      channel: c.name,
      messages: c.count,
    })),
  };
}
