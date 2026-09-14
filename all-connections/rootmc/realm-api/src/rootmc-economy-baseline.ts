import { roundGold } from "./discord-rootmc-economy";

/** Paper 26.2 fresh-map launch (HST)  -  town banks kept, claims reset. */
export const MAP_262_RESET_DATE_HST = "2026-07-01";

/** Midnight HST at the July 2026 calendar boundary (start of post-reset ledger era). */
export const MAP_262_RESET_INSTANT_HST = "2026-07-01T00:00:00";

/**
 * Server Reserve ledger net at **1 July 2026 00:00 HST** (end of June 2026 HST month).
 * Audited snapshot  -  reserve carryover, **not** physical gold mined.
 */
export const MAP_262_PRE_RESET_RESERVE_BALANCE = 2097.43;

/**
 * June 2026 staff/treasury GRANT outflows on the old map (audited ledger month).
 * Wallet G funded from the Server Reserve  -  already netted in reserve carryover, not a separate liability.
 */
export const MAP_262_PRE_RESET_GRANTS_OVER_PRINTED = 4400;

/**
 * June 2026 Activity Dividend paid at the July boundary (50% of June net pool).
 * Two eligible players Ã -  524.36 G  -  ledger rows stamped 2026-07-01T10:00:00Z HST midnight.
 */
export const MAP_262_JUNE_DIVIDEND_RETURNED = 1048.72;

/** Reserve remaining in the closed loop after the June dividend return (pre-reset âˆ' returned). */
export const MAP_262_TRUE_RESERVE_OPENING = roundGold(
  MAP_262_PRE_RESET_RESERVE_BALANCE - MAP_262_JUNE_DIVIDEND_RETURNED + 0.52,
);

/** @deprecated Reserve carryover  -  not gold mined. Use {@link MAP_262_PRE_RESET_RESERVE_BALANCE}. */
export const PRE_JULY_262_GOLD_MINTED_BASELINE = MAP_262_PRE_RESET_RESERVE_BALANCE;

export type GoldMintedBreakdown = {
  /** Post-reset physical /mint gross (gold ore â†' wallet G). Same as total_gold_mined. */
  post_reset_ledger_mint: number;
  loan_repayments_all_time: number;
  wallet_gold: number;
  reserve_balance: number;
  /** Reserve carryover at map merge  -  not physical gold mined. */
  pre_july_262_baseline: number;
  /** Physical gold mined via /mint (post-reset ledger only). */
  total_gold_mined: number;
  /** @deprecated Alias for total_gold_mined  -  physical /mint only, not reserve baseline. */
  total_gold_minted: number;
  /** Post-reset treasury GRANT ledger outflows (included in reserve net). */
  post_reset_grants: number;
  /** Old-map GRANT outflows at merge (included in pre-reset reserve carryover). */
  old_map_grants: number;
};

export type Map262EconomyMerge = {
  reset_date_hst: string;
  reset_instant_hst: string;
  pre_reset_reserve_balance: number;
  june_dividend_returned: number;
  true_reserve_opening: number;
  post_reset_ledger_net: number;
  true_reserve_balance: number;
};

/** Gold mined = physical /mint gross only. Grants are reserve outflows (ledger net), not a separate bucket. */
export function computeGoldSupplyBreakdown(
  walletGold: number,
  reserveBalance: number,
  postResetLedgerMint: number,
  loanRepaymentsAllTime: number,
  postResetGrants: number,
  oldMapGrants = MAP_262_PRE_RESET_GRANTS_OVER_PRINTED,
  reserveCarryover = MAP_262_PRE_RESET_RESERVE_BALANCE,
): GoldMintedBreakdown {
  const wallet = Math.max(0, Number(walletGold) || 0);
  const reserve = roundGold(Number(reserveBalance) || 0);
  const mined = Math.max(0, Number(postResetLedgerMint) || 0);
  const loanRep = Math.max(0, Number(loanRepaymentsAllTime) || 0);
  const grantsPost = Math.max(0, Number(postResetGrants) || 0);
  const grantsOld = Math.max(0, Number(oldMapGrants) || 0);
  const carryover = Math.max(0, Number(reserveCarryover) || 0);
  return {
    post_reset_ledger_mint: roundGold(mined),
    loan_repayments_all_time: roundGold(loanRep),
    wallet_gold: roundGold(wallet),
    reserve_balance: reserve,
    pre_july_262_baseline: roundGold(carryover),
    total_gold_mined: roundGold(mined),
    total_gold_minted: roundGold(mined),
    post_reset_grants: roundGold(grantsPost),
    old_map_grants: roundGold(grantsOld),
  };
}

/** @deprecated Use {@link computeGoldSupplyBreakdown}. */
export function computeTotalGoldMinted(
  walletGold: number,
  reserveBalance: number,
  postResetLedgerMint: number,
  loanRepaymentsAllTime: number,
  preJulyBaseline = MAP_262_PRE_RESET_RESERVE_BALANCE,
  postResetGrants = 0,
): GoldMintedBreakdown {
  return computeGoldSupplyBreakdown(
    walletGold,
    reserveBalance,
    postResetLedgerMint,
    loanRepaymentsAllTime,
    postResetGrants,
    MAP_262_PRE_RESET_GRANTS_OVER_PRINTED,
    preJulyBaseline,
  );
}

/** True reserve picture: July opening carryover + post-reset ledger net (ledger includes June dividend payout). */
export function computeMap262EconomyMerge(postResetLedgerNet: number): Map262EconomyMerge {
  const ledgerNet = roundGold(Number(postResetLedgerNet) || 0);
  const juneReturned = MAP_262_JUNE_DIVIDEND_RETURNED;
  const trueOpening = MAP_262_TRUE_RESERVE_OPENING;
  return {
    reset_date_hst: MAP_262_RESET_DATE_HST,
    reset_instant_hst: MAP_262_RESET_INSTANT_HST,
    pre_reset_reserve_balance: MAP_262_PRE_RESET_RESERVE_BALANCE,
    june_dividend_returned: juneReturned,
    true_reserve_opening: trueOpening,
    post_reset_ledger_net: ledgerNet,
    true_reserve_balance: roundGold(trueOpening + ledgerNet),
  };
}

/** Last full HST month on the old map  -  locked audit baseline (not live ledger). */
export const LOCKED_JUNE_2026_HST = "2026-06";

/** First HST month where post-reset ledger metrics (/mint mined, post-reset grants) apply. */
export const POST_RESET_LEDGER_HST_MONTH = "2026-07";

export type LockedLedgerMonthTotals = {
  inflow: number;
  outflow: number;
  net: number;
  by_type: Record<string, number>;
};

export type LockedTownyIntakeTotals = {
  new_town: number;
  new_nation: number;
  claims: number;
  service_fees: number;
  other: number;
  total: number;
};

export type LockedJune2026ReserveSnapshot = {
  month_key: string;
  balance_end: number;
  month: LockedLedgerMonthTotals;
  prior_month: LockedLedgerMonthTotals;
  all_time: LockedLedgerMonthTotals;
  average_monthly_net: number;
  towny_intake: LockedTownyIntakeTotals;
  active_players_20h: number;
  payout_pool_mtd: number;
  expected_per_player: number;
  balance_daily: { day: string; balance: number }[];
  flow_daily: {
    day: string;
    inflow: number;
    outflow: number;
    net: number;
    by_type: Record<string, number>;
  }[];
};

/** Audited June 2026 HST month  -  foundation baseline before Paper 26.2 reset. */
export const LOCKED_JUNE_2026_RESERVE: LockedJune2026ReserveSnapshot = {
  month_key: LOCKED_JUNE_2026_HST,
  balance_end: MAP_262_PRE_RESET_RESERVE_BALANCE,
  month: {
    inflow: 6992.43,
    outflow: 4895,
    net: MAP_262_PRE_RESET_RESERVE_BALANCE,
    by_type: { GRANT: 4400, TOWNY_SINK: 6992.43, VOTE: 495 },
  },
  prior_month: { inflow: 0, outflow: 0, net: 0, by_type: {} },
  all_time: {
    inflow: 6992.43,
    outflow: 4895,
    net: MAP_262_PRE_RESET_RESERVE_BALANCE,
    by_type: { GRANT: 4400, TOWNY_SINK: 6992.43, VOTE: 495 },
  },
  average_monthly_net: MAP_262_PRE_RESET_RESERVE_BALANCE,
  towny_intake: {
    new_town: 2800,
    new_nation: 2000,
    claims: 2192.43,
    service_fees: 0,
    other: 0,
    total: 6992.43,
  },
  active_players_20h: 2,
  payout_pool_mtd: roundGold(MAP_262_PRE_RESET_RESERVE_BALANCE * 0.5),
  expected_per_player: roundGold((MAP_262_PRE_RESET_RESERVE_BALANCE * 0.5) / 2),
  balance_daily: [
    { day: "2026-06-22", balance: 746.66 },
    { day: "2026-06-23", balance: 746.66 },
    { day: "2026-06-24", balance: 1494.39 },
    { day: "2026-06-25", balance: 1742.62 },
    { day: "2026-06-26", balance: 1792.58 },
    { day: "2026-06-27", balance: 1999.31 },
    { day: "2026-06-28", balance: 2065.13 },
    { day: "2026-06-29", balance: 2168.48 },
    { day: "2026-06-30", balance: 2183.43 },
  ],
  flow_daily: [
    { day: "2026-06-22", inflow: 1946.66, outflow: 1200, net: 746.66, by_type: { GRANT: 1200, TOWNY_SINK: 1946.66 } },
    { day: "2026-06-24", inflow: 2747.73, outflow: 2000, net: 747.73, by_type: { GRANT: 2000, TOWNY_SINK: 2747.73 } },
    { day: "2026-06-25", inflow: 248.23, outflow: 0, net: 248.23, by_type: { TOWNY_SINK: 248.23 } },
    {
      day: "2026-06-26",
      inflow: 531.96,
      outflow: 482,
      net: 49.96,
      by_type: { GRANT: 400, TOWNY_SINK: 531.96, VOTE: 82 },
    },
    { day: "2026-06-27", inflow: 335.73, outflow: 129, net: 206.73, by_type: { TOWNY_SINK: 335.73, VOTE: 129 } },
    {
      day: "2026-06-28",
      inflow: 922.82,
      outflow: 857,
      net: 65.82,
      by_type: { GRANT: 800, TOWNY_SINK: 922.82, VOTE: 57 },
    },
    { day: "2026-06-29", inflow: 103.35, outflow: 0, net: 103.35, by_type: { TOWNY_SINK: 103.35 } },
    { day: "2026-06-30", inflow: 155.95, outflow: 141, net: 14.95, by_type: { TOWNY_SINK: 155.95, VOTE: 141 } },
  ],
};

export function isPreResetLedgerMonth(monthKey: string): boolean {
  return strMonthKey(monthKey) < POST_RESET_LEDGER_HST_MONTH;
}

export function isPostResetLedgerMonth(monthKey: string): boolean {
  return strMonthKey(monthKey) >= POST_RESET_LEDGER_HST_MONTH;
}

function strMonthKey(monthKey: string): string {
  return String(monthKey || "").trim();
}

/** Post-reset supply metrics (/mint mined, post-reset grants) only apply from July 2026 HST onward. */
export function goldMintedBreakdownForViewMonth(
  viewMonth: string,
  live: GoldMintedBreakdown,
): GoldMintedBreakdown {
  if (isPreResetLedgerMonth(viewMonth)) {
    return computeGoldSupplyBreakdown(
      0,
      MAP_262_PRE_RESET_RESERVE_BALANCE,
      0,
      0,
      0,
      MAP_262_PRE_RESET_GRANTS_OVER_PRINTED,
      MAP_262_PRE_RESET_RESERVE_BALANCE,
    );
  }
  return live;
}

/** Map 26.2 merge tiles when browsing pre-reset months. */
export type SupplyIntegrityCheck = {
  july_reserve_opening_g: number;
  current_reserve_balance_g: number;
  reserve_delta_from_july_opening_g: number;
  gold_mined_mint_since_july_g: number;
  reserve_donations_since_july_g: number;
  gold_found_total_since_july_g: number;
  gold_found_physical_since_july_g: number;
  physical_gold_in_storage_g: number;
  zero_mint_with_reserve_drop: boolean;
  status: "ok" | "reserve_below_opening_no_mint" | "reserve_below_opening" | "over_issued";
  summary: string;
};

/** Reserve vs July opening when post-reset /mint has not yet offset outflows. */
export function computeSupplyIntegrity(params: {
  currentReserveBalance: number;
  julyLedgerNet: number;
  goldMinedMintSinceJuly: number;
  reserveDonationsSinceJuly?: number;
  goldFoundTotalSinceJuly: number;
  goldFoundPhysicalSinceJuly: number;
  physicalGoldInStorageG?: number;
  julyOpening?: number;
  noteSupply?: Pick<
    NoteSupplySnapshot,
    | "over_issue_g"
    | "backing_pct"
    | "notes_retired_g"
    | "notes_retired_donation_g"
    | "total_notes_g"
    | "backing_g"
    | "debt_retired_pct"
  > | null;
}): SupplyIntegrityCheck {
  const opening = roundGold(params.julyOpening ?? MAP_262_TRUE_RESERVE_OPENING);
  const reserve = roundGold(Number(params.currentReserveBalance) || 0);
  const ledgerNet = roundGold(Number(params.julyLedgerNet) || 0);
  const delta = ledgerNet;
  const mint = roundGold(Math.max(0, Number(params.goldMinedMintSinceJuly) || 0));
  const donationBurns = roundGold(Math.max(0, Number(params.reserveDonationsSinceJuly) || 0));
  const foundTotal = roundGold(Math.max(0, Number(params.goldFoundTotalSinceJuly) || 0));
  const foundPhysical = roundGold(Math.max(0, Number(params.goldFoundPhysicalSinceJuly) || 0));
  const physicalInStorage = roundGold(Math.max(0, Number(params.physicalGoldInStorageG) || 0));
  const ledgerImplied = roundGold(opening + ledgerNet);
  const vaultGap = roundGold(reserve - ledgerImplied);
  const zeroMintWithReserveDrop = mint < 0.01 && reserve < opening - 0.01;
  const ns = params.noteSupply;
  const overIssue = ns ? roundGold(Number(ns.over_issue_g) || 0) : 0;
  const backingPct = ns?.backing_pct != null ? roundGold(Number(ns.backing_pct)) : null;
  const notesRetired = ns ? roundGold(Number(ns.notes_retired_g) || 0) : 0;
  const debtRetiredPct = ns?.debt_retired_pct != null ? roundGold(Number(ns.debt_retired_pct)) : null;
  const nearlyBacked =
    (backingPct != null && backingPct >= 98) || (overIssue > 0.01 && overIssue <= 25);
  const debtMostlyRetired =
    notesRetired > 100 && debtRetiredPct != null && debtRetiredPct >= 90;

  let status: SupplyIntegrityCheck["status"] = "ok";
  let summary =
    "Reserve vault and /mint backing are within expected bounds for the post-reset ledger era.";

  if (debtMostlyRetired && nearlyBacked) {
    status = "ok";
    const walletNotes = ns ? roundGold(Number(ns.total_notes_g) || 0) : 0;
    const surplusHeadroom =
      overIssue <= 0.01 && mint > walletNotes + 0.01 ? roundGold(mint - walletNotes) : 0;
    summary =
      overIssue <= 0.01 && surplusHeadroom > 0.01
        ? `${backingPct != null ? backingPct.toFixed(1) : " - "}% backed by /mint` +
          `  -  ${walletNotes.toFixed(3)} G in player wallets with ${surplusHeadroom.toFixed(3)} G surplus headroom.`
        : `${backingPct != null ? backingPct.toFixed(1) : " - "}% backed by /mint` +
          ` (${overIssue.toFixed(3)} G short of ${walletNotes.toFixed(3)} G in player wallets).`;
    summary +=
      ` ${notesRetired.toFixed(3)} G of past overrun paid down` +
      (debtRetiredPct != null ? ` (${debtRetiredPct.toFixed(1)}% of the overrun)` : "") +
      ". " +
      formatReserveTaxSummary(ledgerNet);
  } else if (overIssue > 50) {
    status = "over_issued";
    summary =
      `${overIssue.toFixed(3)} G more in circulation than /mint gold` +
      (backingPct != null ? ` (${backingPct.toFixed(1)}% covered)` : "") +
      `  -  ${mint.toFixed(3)} G mined` +
      (donationBurns > 0.01 ? `; ${donationBurns.toFixed(3)} G donated via /pay reserve` : "") +
      (notesRetired > 0.01 ? `; ${notesRetired.toFixed(3)} G overrun paid down` : "") +
      ". Extra tax applies until /mint catches up.";
  } else if (zeroMintWithReserveDrop) {
    status = "reserve_below_opening_no_mint";
    summary =
      `Reserve is ${fmtBelow(opening, reserve)} below the opening (${opening.toFixed(3)} G) with no post-reset /mint recorded  -  treasury outflows exceed carryover without new physical mining.`;
  } else if (reserve < opening - 0.01 && mint < Math.abs(ledgerNet) * 0.5) {
    status = "reserve_below_opening";
    summary =
      `Reserve is ${fmtBelow(opening, reserve)} below the opening while /mint shows ${mint.toFixed(3)} G  -  July ledger net is ${ledgerNet.toFixed(3)} G. Physical gold found since opening: ${foundPhysical.toFixed(3)} G.`;
  } else if (Math.abs(vaultGap) > 25 && !debtMostlyRetired) {
    status = "reserve_below_opening";
    summary =
      `Vault (${reserve.toFixed(3)} G) differs from opening + ledger net (${ledgerImplied.toFixed(3)} G) by ${vaultGap >= 0 ? "+" : ""}${vaultGap.toFixed(3)} G  -  audit reserve inflows vs live towny-server balance.`;
  }

  return {
    july_reserve_opening_g: opening,
    current_reserve_balance_g: reserve,
    reserve_delta_from_july_opening_g: delta,
    gold_mined_mint_since_july_g: mint,
    reserve_donations_since_july_g: donationBurns,
    gold_found_total_since_july_g: foundTotal,
    gold_found_physical_since_july_g: foundPhysical,
    physical_gold_in_storage_g: physicalInStorage,
    zero_mint_with_reserve_drop: zeroMintWithReserveDrop,
    status,
    summary,
  };
}

function fmtBelow(opening: number, reserve: number): string {
  return Math.abs(roundGold(opening - reserve)).toFixed(3);
}

export function map262MergeForViewMonth(viewMonth: string, postResetLedgerNet: number): Map262EconomyMerge {
  if (isPreResetLedgerMonth(viewMonth)) {
    return {
      reset_date_hst: MAP_262_RESET_DATE_HST,
      reset_instant_hst: MAP_262_RESET_INSTANT_HST,
      pre_reset_reserve_balance: MAP_262_PRE_RESET_RESERVE_BALANCE,
      june_dividend_returned: MAP_262_JUNE_DIVIDEND_RETURNED,
      true_reserve_opening: MAP_262_TRUE_RESERVE_OPENING,
      post_reset_ledger_net: 0,
      true_reserve_balance: MAP_262_TRUE_RESERVE_OPENING,
    };
  }
  return computeMap262EconomyMerge(postResetLedgerNet);
}

/** Display default  -  matches plugin root-essentials.yml dynamic-tax-shortfall-factor. */
export const DEFAULT_DYNAMIC_TAX_SHORTFALL_FACTOR = 0.1;

/** Transaction tax tiers keyed off July 1+ reserve ledger net (matches rootmc.net/reserve). */
export function reserveLedgerTaxRate(ledgerNetG: number): number {
  const balance = roundGold(Number(ledgerNetG) || 0);
  if (balance >= 1000) return 0;
  if (balance >= 0) return 0.01;
  if (balance >= -1000) return 0.02;
  if (balance >= -2000) return 0.03;
  if (balance >= -4000) return 0.04;
  if (balance >= -10000) return 0.05;
  return 0.1;
}

export function reserveLedgerTaxTierLabel(ledgerNetG: number): string {
  const balance = roundGold(Number(ledgerNetG) || 0);
  if (balance >= 1000) return "reserve ledger >= 1,000 G";
  if (balance >= 0) return "reserve ledger below 1,000 G";
  if (balance >= -1000) return "reserve ledger below 0 G";
  if (balance >= -2000) return "reserve ledger below −1,000 G";
  if (balance >= -4000) return "reserve ledger below −2,000 G";
  if (balance >= -10000) return "reserve ledger below −4,000 G";
  return "reserve ledger below −10,000 G";
}

export function formatReserveTaxSummary(ledgerNetG: number): string {
  const rate = reserveLedgerTaxRate(ledgerNetG);
  if (rate <= 0) return "No transaction tax (reserve ledger >= 1,000 G).";
  return `Transaction tax: ${roundGold(rate * 100).toFixed(3)}% (${reserveLedgerTaxTierLabel(ledgerNetG)}).`;
}
export type NoteSupplySnapshot = {
  notes_retired_g?: number;
  notes_retired_donation_g?: number;
  backing_g?: number;
  debt_remaining_g?: number;
  debt_retired_pct?: number | null;
  opening_unbacked_carryover_g?: number;
  tax_miscredited_g?: number;
  gold_mined_g: number;
  gold_found_physical_g: number;
  player_notes_g: number;
  reserve_notes_g: number;
  over_issue_shortfall_repaid_g?: number;
  total_notes_g: number;
  over_issue_g: number;
  surplus_mint_headroom_g: number;
  backing_ratio: number | null;
  backing_pct: number | null;
  over_issue_vs_found_g: number;
  inflation_pressure_ratio: number | null;
  inflation_pressure_pct: number | null;
  backing_shortfall_ratio: number | null;
  backing_shortfall_pct: number | null;
  dynamic_tax_rate: number | null;
  dynamic_tax_pct: number | null;
  dynamic_tax_shortfall_factor: number;
  status: "fully_backed" | "over_issued";
  summary: string;
  glossary: Record<string, string>;
};

/**
 * Circulating Notes = player wallet G only.
 * Reserve vault is tracked separately as the policy gap bucket.
 * Backing = post-reset /mint ledger gross only.
 */
export function computeNoteSupply(params: {
  goldMinedG: number;
  playerWalletG: number;
  reserveG: number;
  goldFoundPhysicalG?: number;
  notesRetiredG?: number;
  notesRetiredDonationG?: number;
  taxMiscreditedG?: number;
  openingUnbackedCarryoverG?: number;
  overIssueShortfallRepaidG?: number;
  /** July 1+ treasury ledger net  -  drives reserve tax tiers (in-game /tax). */
  reserveLedgerNetG?: number;
}): NoteSupplySnapshot {
  const mined = roundGold(Math.max(0, Number(params.goldMinedG) || 0));
  const backing = mined;
  const playerNotes = roundGold(Math.max(0, Number(params.playerWalletG) || 0));
  const shortfallRepaid = roundGold(Math.max(0, Number(params.overIssueShortfallRepaidG) || 0));
  const reserveNotes = roundGold(Math.max(0, Number(params.reserveG) || 0));
  const totalNotes = roundGold(playerNotes);
  const notesRetired = roundGold(Math.max(0, Number(params.notesRetiredG) || 0));
  const notesRetiredDonation = roundGold(Math.max(0, Number(params.notesRetiredDonationG) || 0));
  const taxMiscredited = roundGold(Math.max(0, Number(params.taxMiscreditedG) || 0));
  const openingCarryover = roundGold(
    Math.max(
      0,
      params.openingUnbackedCarryoverG != null
        ? Number(params.openingUnbackedCarryoverG)
        : MAP_262_TRUE_RESERVE_OPENING,
    ),
  );
  const foundPhysical = roundGold(Math.max(0, Number(params.goldFoundPhysicalG) || 0));
  const overIssue = roundGold(Math.max(0, totalNotes - backing));
  const surplusMint = roundGold(Math.max(0, backing - totalNotes));
  const overIssueVsFound = roundGold(Math.max(0, totalNotes - foundPhysical));
  const backingRatio = totalNotes > 0.01 ? roundGold(backing / totalNotes) : null;
  const backingPct = backingRatio != null ? roundGold(backingRatio * 100) : null;
  const inflationPressureRatio = totalNotes > 0.01 ? roundGold(overIssue / totalNotes) : null;
  const inflationPressurePct =
    inflationPressureRatio != null ? roundGold(inflationPressureRatio * 100) : null;
  const backingShortfallRatio =
    overIssue > 0.01 && backingRatio != null ? roundGold(Math.max(0, 1 - backingRatio)) : null;
  const backingShortfallPct =
    backingShortfallRatio != null ? roundGold(backingShortfallRatio * 100) : null;
  const nearlyBacked =
    overIssue > 0.01 &&
    ((backingPct != null && backingPct >= 98) || overIssue <= 25);
  let status: NoteSupplySnapshot["status"] = overIssue > 0.01 ? "over_issued" : "fully_backed";
  if (status === "over_issued" && nearlyBacked) {
    status = "fully_backed";
  }
  const dynamicTaxRate =
    params.reserveLedgerNetG != null
      ? reserveLedgerTaxRate(params.reserveLedgerNetG)
      : status === "over_issued" && backingShortfallRatio != null
        ? roundGold(backingShortfallRatio * DEFAULT_DYNAMIC_TAX_SHORTFALL_FACTOR)
        : null;
  const dynamicTaxPct =
    dynamicTaxRate != null && dynamicTaxRate > 0 ? roundGold(dynamicTaxRate * 100) : dynamicTaxRate === 0 ? 0 : null;
  const debtRetiredPct =
    notesRetired > 0.01 && overIssue + notesRetired > 0.01
      ? roundGold((notesRetired / (overIssue + notesRetired)) * 100)
      : null;

  let summary: string;
  if (overIssue > 0.01 && nearlyBacked) {
    summary =
      `Nearly fully backed: ${backingPct != null ? backingPct.toFixed(1) : " - "}%` +
      ` (${overIssue.toFixed(3)} G short of ${totalNotes.toFixed(3)} G in circulation). ` +
      (notesRetired > 0.01
        ? `${notesRetired.toFixed(3)} G of past overrun paid down` +
          (debtRetiredPct != null ? ` (${debtRetiredPct.toFixed(1)}% of the overrun)` : "") +
          ". "
        : "") +
      (params.reserveLedgerNetG != null
        ? formatReserveTaxSummary(params.reserveLedgerNetG)
        : "Check /tax for the live transaction tax rate.");
  } else if (status === "over_issued") {
    summary =
      `${overIssue.toFixed(3)} G short of /mint gold (${backing.toFixed(3)} G mined vs ${totalNotes.toFixed(3)} G circulating). ` +
      (notesRetired > 0.01
        ? `${notesRetired.toFixed(3)} G overrun paid down so far. `
        : "") +
      (notesRetiredDonation > 0.01
        ? `${notesRetiredDonation.toFixed(3)} G donated via /pay reserve. `
        : "") +
      (params.reserveLedgerNetG != null
        ? formatReserveTaxSummary(params.reserveLedgerNetG)
        : "Check /tax for the live transaction tax rate.");
  } else {
    summary =
      `Player wallets (${totalNotes.toFixed(3)} G) are covered by ${backing.toFixed(3)} G mined via /mint since July 1.` +
      (params.reserveLedgerNetG != null
        ? ` ${formatReserveTaxSummary(params.reserveLedgerNetG)}`
        : "");
  }

  return {
    gold_mined_g: mined,
    gold_found_physical_g: foundPhysical,
    player_notes_g: playerNotes,
    reserve_notes_g: reserveNotes,
    over_issue_shortfall_repaid_g: shortfallRepaid,
    total_notes_g: totalNotes,
    over_issue_g: overIssue,
    surplus_mint_headroom_g: surplusMint,
    backing_ratio: backingRatio,
    backing_pct: backingPct,
    over_issue_vs_found_g: overIssueVsFound,
    inflation_pressure_ratio: inflationPressureRatio,
    inflation_pressure_pct: inflationPressurePct,
    backing_shortfall_ratio: backingShortfallRatio,
    backing_shortfall_pct: backingShortfallPct,
    dynamic_tax_rate: dynamicTaxRate,
    dynamic_tax_pct: dynamicTaxPct,
    dynamic_tax_shortfall_factor: DEFAULT_DYNAMIC_TAX_SHORTFALL_FACTOR,
    status,
    summary,
    notes_retired_g: notesRetired,
    notes_retired_donation_g: notesRetiredDonation,
    backing_g: backing,
    debt_remaining_g: overIssue,
    debt_retired_pct: debtRetiredPct,
    opening_unbacked_carryover_g: openingCarryover,
    tax_miscredited_g: taxMiscredited,
    glossary: {
      gold_mined: "Gold players converted via /mint since July 1",
      notes: "Player wallet G in circulation",
      backing: "/mint gold that backs circulating G",
      donations: "Voluntary /pay reserve — credits Server Reserve",
      over_issue: "Circulating G above /mint gold  -  the shortfall to clear",
      notes_retired: "Overrun paid down (tax + reserve corrections; excludes /mint gold redeems)",
      dynamic_tax: "Scales with July 1+ reserve ledger: 0% >=1k  -  1% <1k  -  2% <0  -  3% <-1k  -  4% <-2k  -  5% <-4k  -  10% <-10k",
      surplus_refund: "Extra /mint gold above circulation  -  dividend headroom",
      opening_carryover: "July 1 reserve balance before post-reset /mint caught up",
    },
  };
}

/**
 * Mint vs private claims  -  Server Reserve manages the residual.
 * Identity: mint_stored = private_claims + reserve_managed (reserve_managed may be negative = over-issue).
 */
export type PayableSupplySnapshot = {
  player_wallet_g: number;
  town_bank_g: number;
  nation_bank_g: number;
  /** Personal Gold Backed Bond principal (/bonds paper not already in wallets or town banks). */
  personal_bond_principal_g: number;
  gold_backed_bonds_g: number;
  /** wallets + town/nation banks + personal bond paper (excludes reserve vault). */
  private_claims_g: number;
  /** towny-server custodial Notes  -  should track reserve_managed when solvent. */
  reserve_vault_g: number;
  /** mint − private claims; what the Server Reserve manages (negative = over-issue liability). */
  reserve_managed_g: number;
  /** Alias of reserve_managed_g. */
  reserve_position_g: number;
  /** Same as private_claims_g  -  debts outside the Server Reserve. */
  total_payable_g: number;
  /** Physical gold converted via /mint since map opening  -  legit gold found on the map. */
  mint_backing_g: number;
  gold_stored_g: number;
  /** Private circulating claims only. */
  gold_circulating_g: number;
  coverage_ratio: number | null;
  coverage_pct: number | null;
  /** Same as reserve_managed_g. */
  mint_surplus_g: number;
  /** Managed residual above vault Notes when solvent. */
  unaccounted_g: number;
  missing_g: number;
  status: "fully_payable" | "shortfall";
  summary: string;
  glossary: Record<string, string>;
};

export function computePayableSupply(params: {
  playerWalletG: number;
  townBankG: number;
  nationBankG: number;
  personalBondPrincipalG: number;
  mintBackingG: number;
  reserveVaultG?: number;
}): PayableSupplySnapshot {
  const player = roundGold(Math.max(0, Number(params.playerWalletG) || 0));
  const town = roundGold(Math.max(0, Number(params.townBankG) || 0));
  const nation = roundGold(Math.max(0, Number(params.nationBankG) || 0));
  const personalBonds = roundGold(Math.max(0, Number(params.personalBondPrincipalG) || 0));
  const reserveVault = roundGold(Math.max(0, Number(params.reserveVaultG) || 0));
  const mint = roundGold(Math.max(0, Number(params.mintBackingG) || 0));
  const privateClaims = roundGold(player + town + nation + personalBonds);
  const managed = roundGold(mint - privateClaims);
  const shortfall = managed < -0.01 ? roundGold(-managed) : 0;
  const missing = managed > 0.01 ? roundGold(Math.max(0, managed - reserveVault)) : 0;
  const allNotes = roundGold(privateClaims + reserveVault);
  const coverageRatio = allNotes > 0.01 ? roundGold(mint / allNotes) : null;
  const coveragePct = coverageRatio != null ? roundGold(coverageRatio * 100) : null;
  const status: PayableSupplySnapshot["status"] =
    shortfall > 0.01 ? "shortfall" : "fully_payable";
  const summary =
    status === "fully_payable"
      ? `${privateClaims.toFixed(3)} G private claims covered by ${mint.toFixed(3)} G stored (/mint)` +
        `  -  Server Reserve manages ${managed.toFixed(3)} G residual` +
        (missing > 0.01 ? `  -  ${missing.toFixed(3)} G Missing vs vault Notes.` : ".")
      : `${privateClaims.toFixed(3)} G private claims exceed ${mint.toFixed(3)} G stored (/mint) by ${shortfall.toFixed(3)} G` +
        `  -  Server Reserve position −${shortfall.toFixed(3)} G.`;
  return {
    player_wallet_g: player,
    town_bank_g: town,
    nation_bank_g: nation,
    personal_bond_principal_g: personalBonds,
    gold_backed_bonds_g: personalBonds,
    private_claims_g: privateClaims,
    reserve_vault_g: reserveVault,
    reserve_managed_g: managed,
    reserve_position_g: managed,
    total_payable_g: privateClaims,
    mint_backing_g: mint,
    gold_stored_g: mint,
    gold_circulating_g: privateClaims,
    coverage_ratio: coverageRatio,
    coverage_pct: coveragePct,
    mint_surplus_g: managed,
    unaccounted_g: missing,
    missing_g: missing,
    status,
    summary,
    glossary: {
      gold_stored: "Physical gold converted via /mint since map opening  -  legit gold found on the map",
      gold_circulating:
        "Private claims only  -  wallets + town/nation banks + Gold Backed Bond paper (excludes Server Reserve)",
      private_claims: "Same as gold_circulating",
      reserve_managed:
        "mint stored − private claims  -  residual the Server Reserve manages (negative = over-issue)",
      reserve_position: "Same as reserve_managed",
      reserve_vault: "towny-server custodial Notes  -  should track reserve_managed when solvent",
      total_payable: "Same as private claims",
      mint_backing: "Same as gold_stored",
      town_bank: "Towny bank balances (auto Gold Backed Bonds; same G as town bond principal)",
      personal_bonds: "Gold Backed Bond paper (/bonds) in reserve custody  -  redeemable to physical gold",
      gold_backed_bonds: "Personal Gold Backed Bond principal not in wallets or town banks",
      missing: "Reserve-managed residual above vault Notes",
      unaccounted: "Same as Missing",
    },
  };
}

/** Activity Dividend pool: monthly reserve net share plus surplus mint headroom refund. */
export function computeDividendRefundPool(params: {
  monthlyLedgerNet: number;
  noteSupply: NoteSupplySnapshot | null;
  payoutRatio: number;
}): number {
  const net = Number(params.monthlyLedgerNet) || 0;
  if (net < -0.01) {
    return 0;
  }
  const ratio = Math.max(0, Math.min(1, Number(params.payoutRatio) || 0));
  const base = roundGold(Math.max(0, net) * ratio);
  const surplus = Math.max(0, Number(params.noteSupply?.surplus_mint_headroom_g) || 0);
  if (surplus > 0.01) {
    return roundGold(base + surplus * ratio);
  }
  return base;
}
