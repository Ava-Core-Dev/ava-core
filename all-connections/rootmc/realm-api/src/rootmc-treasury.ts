/**
 * Closed-loop treasury: ledger sync, activity dividend cron, player summaries.
 */

import type { D1Database } from "@cloudflare/workers-types";
import type { Connection } from "mysql2/promise";

import { json } from "./cors";
import { roundGold } from "./discord-rootmc-economy";
import { formatPlaytime } from "./rootmc-daily-report";
import { HST_OFFSET_MS } from "./rootmc-hst-week";
import { resolveServerId } from "./rootmc-daily-report";
import { TOWNY_SERVER_UUID, TOWNY_SERVER_USERNAME, economySystemAccountSqlFilter } from "./rootmc-economy-accounts";
import {
  computeTotalGoldMinted,
  computeGoldSupplyBreakdown,
  computeMap262EconomyMerge,
  computeSupplyIntegrity,
  computeNoteSupply,
  computePayableSupply,
  computeDividendRefundPool,
  goldMintedBreakdownForViewMonth,
  map262MergeForViewMonth,
  LOCKED_JUNE_2026_HST,
  LOCKED_JUNE_2026_RESERVE,
  POST_RESET_LEDGER_HST_MONTH,
  MAP_262_RESET_DATE_HST,
  MAP_262_RESET_INSTANT_HST,
  MAP_262_PRE_RESET_RESERVE_BALANCE,
  MAP_262_PRE_RESET_GRANTS_OVER_PRINTED,
  MAP_262_JUNE_DIVIDEND_RETURNED,
  MAP_262_TRUE_RESERVE_OPENING,
  PRE_JULY_262_GOLD_MINTED_BASELINE,
  isPreResetLedgerMonth,
  type GoldMintedBreakdown,
  type Map262EconomyMerge,
  type PayableSupplySnapshot,
} from "./rootmc-economy-baseline";
import {
  goldFoundLeaderboardForServer,
  goldFoundSummaryForServer,
  latestGoldFoundSyncedAt,
} from "./rootmc-gold-found";
import { physicalGoldLeaderboardForServer, physicalGoldSummaryForServer } from "./rootmc-physical-gold";
import { withShortPublicCache } from "./rootmc-hyperdrive";
import { circulatingBalancesReport } from "./rootmc-circulating-balances";
import { readBondsSummary } from "./rootmc-bonds";
import {
  buildHolderSupplyDailySeries,
  loadMeasuredHolderSupplyForRange,
  readPlayerWalletNotesTotal,
  type HolderSupplyDailyRow,
} from "./rootmc-holder-supply";
import type { RootStatEnv } from "./rootstat-minecraft";
import { validateServerAuth } from "./rootstat-minecraft";
import {
  accumulateMintLeaderboardDelta,
  isMintAuditTrail,
  mintGrossFromLedgerRow,
  mintLeaderboardRowFromStats,
  MINT_TRANSACTION_TAX_RATE,
  type MintLeaderboardPlayerStats,
  type MintLeaderboardRow,
} from "./rootmc-mint-ledger";

export { isMintAuditTrail, mintGrossFromLedgerRow, MINT_TRANSACTION_TAX_RATE, type MintLeaderboardRow };

const CANONICAL_ROOTMC = "rootmc";
/** Treasury ledger + reserve balance always use this D1 key (not heartbeat server_id). */
export const TREASURY_SERVER_ID = CANONICAL_ROOTMC;

export function treasuryServerId(_requested?: string): string {
  return TREASURY_SERVER_ID;
}
const MIN_DIVIDEND_SECONDS = 20 * 3600;
const DEFAULT_DIVIDEND_PAYOUT_RATIO = 0.5;
/** Reserve inflows - Towny closed-loop fees stay in towny-server vault; only tax hits reserve. */
const RESERVE_INFLOW_TYPES = [
  "OPENING",
  "TAX",
  "DEATH",
  "TOWNY_SINK",
  "LOAN_PRINCIPAL",
  "LOAN_INTEREST",
  "BOND_ISSUE",
  "BOND_COUPON_FORFEIT",
  "DONATION",
];
const INFLOW_TYPES = RESERVE_INFLOW_TYPES;
const INFLOW_TYPES_ACTIVITY = RESERVE_INFLOW_TYPES.filter((t) => t !== "OPENING");
const OUTFLOW_TYPES = ["GRANT", "DIVIDEND", "LOAN_DISBURSE", "VOTE", "PLAYTIME", "BOND_REDEEM", "BOND_COUPON"];

function str(v: unknown): string {
  return v == null ? "" : String(v).trim();
}

function nowIso(): string {
  return new Date().toISOString();
}

function record(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

function normalizeUuid(v: unknown): string {
  const id = str(v).toLowerCase();
  return /^[0-9a-f-]{36}$/.test(id) ? id : "";
}

function normalizeDividendRatio(raw: unknown): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) return DEFAULT_DIVIDEND_PAYOUT_RATIO;
  return Math.min(1, Math.max(0, n));
}

function dividendPayoutRatio(env?: RootStatEnv): number {
  if (!env) return DEFAULT_DIVIDEND_PAYOUT_RATIO;
  const raw = (env as RootStatEnv & { ROOTMC_DIVIDEND_PAYOUT_RATIO?: unknown }).ROOTMC_DIVIDEND_PAYOUT_RATIO;
  return normalizeDividendRatio(raw);
}

export function previousHstMonthKey(at = new Date()): string {
  const hst = new Date(at.getTime() - HST_OFFSET_MS);
  let y = hst.getUTCFullYear();
  let m = hst.getUTCMonth();
  if (m === 0) {
    y -= 1;
    m = 11;
  } else {
    m -= 1;
  }
  return `${y}-${String(m + 1).padStart(2, "0")}`;
}

export function currentHstMonthKey(at = new Date()): string {
  const hst = new Date(at.getTime() - HST_OFFSET_MS);
  return `${hst.getUTCFullYear()}-${String(hst.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** HST calendar month immediately before `monthKey` (`YYYY-MM`). */
export function monthKeyBefore(monthKey: string): string {
  const [y, m] = monthKey.split("-").map((x) => Number(x));
  if (!Number.isFinite(y) || !Number.isFinite(m) || m < 1 || m > 12) {
    return previousHstMonthKey();
  }
  if (m === 1) return `${y - 1}-12`;
  return `${y}-${String(m - 1).padStart(2, "0")}`;
}

export function parseMonthKeyParam(raw: unknown): string | null {
  const key = str(raw);
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(key)) return null;
  return key;
}

export function monthBoundsIso(monthKey: string): { start: string; end: string } {
  const [y, m] = monthKey.split("-").map((x) => Number(x));
  const start = new Date(Date.UTC(y, m - 1, 1, 10, 0, 0));
  const end = new Date(Date.UTC(m === 12 ? y + 1 : y, m === 12 ? 0 : m, 1, 10, 0, 0));
  return { start: start.toISOString(), end: end.toISOString() };
}

/** Normalize ISO / MySQL datetimes for lexicographic SQL compare (avoids `T` vs space bugs). */
export function sqlLedgerBound(iso: string): string {
  const s = str(iso);
  if (!s) return "";
  return s.replace("T", " ").replace(/\.\d{3}Z?$/i, "").replace(/Z$/i, "");
}

/** D1 may store `2026-07-01T09:00:00.000Z` or `2026-07-01 09:00:00` - compare uniformly. */
const LEDGER_CREATED_AT_NORM = "replace(substr(created_at, 1, 19), 'T', ' ')";

function normalizeMintDetail(details: unknown): string {
  let d = str(details);
  const reclassPrefix = "correction:tax_reclass:";
  if (d.startsWith(reclassPrefix)) d = d.slice(reclassPrefix.length);
  return d;
}

function ledgerRowMintDelta(amount: unknown, details: unknown): number {
  return mintGrossFromLedgerRow(amount, details);
}

function ledgerRowDisplayAmount(amount: unknown, details: unknown): number {
  const mintDelta = ledgerRowMintDelta(amount, details);
  if (mintDelta !== 0) return Math.abs(mintDelta);
  return roundGold(Number(amount) || 0);
}

/** Public ledger display type for /mint audit rows (stored as TAX amount 0 in MySQL). */
function ledgerMintDisplayEntry(details: unknown): {
  displayType: "MINT_GROSS" | "MINT_REDEEM";
  direction: "other";
  toDisplay: string;
} | null {
  const d = normalizeMintDetail(details);
  if (d.startsWith("mint:redeem=")) {
    return { displayType: "MINT_REDEEM", direction: "other", toDisplay: "Physical gold" };
  }
  if (d.startsWith("mint:gross=")) {
    return { displayType: "MINT_GROSS", direction: "other", toDisplay: "Wallet Notes" };
  }
  return null;
}

/** Per-player /mint gross since the 26.2 map reset (audited treasury ledger). */
export async function mintLeaderboardForServer(
  db: D1Database,
  serverId: string,
  limit = 25,
): Promise<{
  leaderboard: MintLeaderboardRow[];
  total_gross_in_g: number;
  total_redeemed_g: number;
  net_minted_g: number;
  /** @deprecated use net_minted_g */
  total_gross_minted_g: number;
}> {
  const sid = treasuryServerId(serverId);
  const { results } = await db
    .prepare(
      `SELECT from_uuid, amount, details FROM rootmc_treasury_ledger
       WHERE server_id = ?
         AND entry_type IN ('TAX', 'NOTE_BURN')
         AND (details = 'mint' OR details LIKE '%mint:gross=%' OR details LIKE '%mint:redeem=%')`,
    )
    .bind(sid)
    .all<{ from_uuid: string | null; amount: number; details: string | null }>();

  const byUuid = new Map<string, MintLeaderboardPlayerStats>();
  let totalGrossIn = 0;
  let totalRedeemed = 0;
  for (const row of results ?? []) {
    const delta = mintGrossFromLedgerRow(row.amount, row.details);
    if (delta === 0) continue;
    const uuid = normalizeUuid(row.from_uuid);
    if (!uuid) continue;
    if (delta > 0) totalGrossIn += delta;
    else totalRedeemed += Math.abs(delta);
    const cur = byUuid.get(uuid) ?? { grossIn: 0, redeemed: 0, events: 0 };
    accumulateMintLeaderboardDelta(cur, delta);
    byUuid.set(uuid, cur);
  }

  const sorted = [...byUuid.entries()].sort(
    (a, b) => b[1].grossIn - b[1].redeemed - (a[1].grossIn - a[1].redeemed),
  );
  const capped = sorted.slice(0, Math.min(100, Math.max(1, limit)));
  const names = await resolvePlayerNames(
    db,
    sid,
    capped.map(([uuid]) => uuid),
  );

  const leaderboard: MintLeaderboardRow[] = capped.map(([uuid, stats], idx) =>
    mintLeaderboardRowFromStats(idx + 1, uuid, names[uuid] ?? null, stats),
  );

  const grossIn = roundGold(totalGrossIn);
  const redeemed = roundGold(totalRedeemed);
  const net = roundGold(grossIn - redeemed);
  return {
    leaderboard,
    total_gross_in_g: grossIn,
    total_redeemed_g: redeemed,
    net_minted_g: net,
    total_gross_minted_g: net,
  };
}

/** Gross G from /mint ledger rows since the 26.2 map reset (mint tax audit trail). */
export async function readLedgerMintGross(db: D1Database, serverId: string): Promise<number> {
  const { results } = await db
    .prepare(
      `SELECT amount, details FROM rootmc_treasury_ledger
       WHERE server_id = ?
         AND entry_type IN ('TAX', 'NOTE_BURN')
         AND (details = 'mint' OR details LIKE '%mint:gross=%' OR details LIKE '%mint:redeem=%')`,
    )
    .bind(treasuryServerId(serverId))
    .all<{ amount: number; details: string | null }>();

  let total = 0;
  for (const row of results ?? []) {
    total += mintGrossFromLedgerRow(row.amount, row.details);
  }
  return roundGold(Math.max(0, total));
}

/** Legacy /pay reserve burns — NOTE_BURN donation subset (pre-credit era). New pays use DONATION inflow. */
export async function readLedgerDonationBurns(db: D1Database, serverId: string): Promise<number> {
  const row = await db
    .prepare(
      `SELECT COALESCE(SUM(amount), 0) AS total
       FROM rootmc_treasury_ledger
       WHERE server_id = ? AND entry_type = 'NOTE_BURN'
         AND (details = 'donation' OR details LIKE 'correction:donation_reclass:%')`,
    )
    .bind(treasuryServerId(serverId))
    .first<{ total: number }>();
  return roundGold(Math.max(0, Number(row?.total) || 0));
}

/** @deprecated Use readLedgerDonationBurns - legacy DONATION rows should be reclassified. */
export async function readLedgerDonations(db: D1Database, serverId: string): Promise<number> {
  return readLedgerDonationBurns(db, serverId);
}

/** One-time / ongoing ledger settlement of the /mint over-issue shortfall (reserve Notes). */
export async function readLedgerOverIssueShortfallRepaid(
  db: D1Database,
  serverId: string,
): Promise<number> {
  const row = await db
    .prepare(
      `SELECT COALESCE(SUM(amount), 0) AS total
       FROM rootmc_treasury_ledger
       WHERE server_id = ? AND entry_type = 'NOTE_BURN'
         AND LOWER(details) LIKE 'debt_repayment:over_issue_shortfall%'`,
    )
    .bind(treasuryServerId(serverId))
    .first<{ total: number }>();
  return roundGold(Math.max(0, Number(row?.total) || 0));
}

/** All-time unbacked Notes destroyed via dynamic tax (NOTE_BURN ledger, excl. /mint gold redeems). */
export async function readLedgerNoteBurnRetired(db: D1Database, serverId: string): Promise<number> {
  const row = await db
    .prepare(
      `SELECT COALESCE(SUM(amount), 0) AS total
       FROM rootmc_treasury_ledger
       WHERE server_id = ? AND entry_type = 'NOTE_BURN'
         AND details NOT LIKE 'mint:redeem=%'
         AND details NOT LIKE 'correction:tax_reclass:mint:redeem=%'`,
    )
    .bind(treasuryServerId(serverId))
    .first<{ total: number }>();
  return roundGold(Math.max(0, Number(row?.total) || 0));
}

/** Post-July TAX still credited to reserve (should be NOTE_BURN while over-issued). */
export async function readLedgerTaxMiscredited(db: D1Database, serverId: string): Promise<number> {
  const row = await db
    .prepare(
      `SELECT COALESCE(SUM(amount), 0) AS total
       FROM rootmc_treasury_ledger
       WHERE server_id = ? AND entry_type = 'TAX' AND amount > 0
         AND created_at >= ?`,
    )
    .bind(treasuryServerId(serverId), MAP_262_RESET_INSTANT_HST)
    .first<{ total: number }>();
  return roundGold(Math.max(0, Number(row?.total) || 0));
}

/** All-time loan principal + interest repaid to the Server Reserve. */
export async function readLoanRepaymentsAllTime(db: D1Database, serverId: string): Promise<number> {
  const row = await db
    .prepare(
      `SELECT COALESCE(SUM(amount), 0) AS total
       FROM rootmc_treasury_ledger
       WHERE server_id = ?
         AND entry_type IN ('LOAN_PRINCIPAL', 'LOAN_INTEREST')`,
    )
    .bind(treasuryServerId(serverId))
    .first<{ total: number }>();
  return roundGold(Number(row?.total) || 0);
}

/** Post-reset treasury GRANT ledger outflows (reserve outflows - included in ledger net). */
export async function readGrantsOverPrintedPostReset(db: D1Database, serverId: string): Promise<number> {
  const row = await db
    .prepare(
      `SELECT COALESCE(SUM(amount), 0) AS total
       FROM rootmc_treasury_ledger
       WHERE server_id = ?
         AND entry_type = 'GRANT'`,
    )
    .bind(treasuryServerId(serverId))
    .first<{ total: number }>();
  return roundGold(Number(row?.total) || 0);
}

export async function readGoldMintedBreakdown(
  db: D1Database,
  serverId: string,
): Promise<GoldMintedBreakdown> {
  const sid = treasuryServerId(serverId);
  const [ledgerMint, loanRepayments, grantsPostReset, allTimeTotals, walletRow] = await Promise.all([
    readLedgerMintGross(db, serverId),
    readLoanRepaymentsAllTime(db, serverId),
    readGrantsOverPrintedPostReset(db, serverId),
    ledgerTotalsBetween(db, serverId, null, null),
    db
      .prepare(
        `SELECT COALESCE(SUM(balance_value), 0) AS total
         FROM rootstat_player_net_worth
         WHERE server_id = ?
         ${economySystemAccountSqlFilter}`,
      )
      .bind(sid)
      .first<{ total: number }>(),
  ]);
  const reserveBalance = roundGold(allTimeTotals.net);
  return computeGoldSupplyBreakdown(
    Number(walletRow?.total) || 0,
    reserveBalance ?? 0,
    ledgerMint,
    loanRepayments,
    grantsPostReset,
  );
}

/** All-time physical gold mined (post-reset /mint ledger gross). */
export async function readTotalGoldMinted(db: D1Database, serverId: string): Promise<number> {
  const breakdown = await readGoldMintedBreakdown(db, serverId);
  return breakdown.total_gold_mined;
}

export async function readTotalGoldMined(db: D1Database, serverId: string): Promise<number> {
  return readTotalGoldMinted(db, serverId);
}

/** Live /mint backing vs Notes - same inputs as rootmc.net/economy/ and in-game /tax. */
export async function readPostResetNoteSupplySnapshot(
  db: D1Database,
  serverId?: string,
): Promise<NoteSupplySnapshot> {
  serverId = treasuryServerId(serverId);
  const [
    goldMinted,
    allTime,
    overIssueShortfallRepaidG,
    notesRetiredG,
    notesRetiredDonationG,
    taxMiscreditedG,
    goldFoundSummary,
  ] = await Promise.all([
    readGoldMintedBreakdown(db, serverId),
    ledgerTotalsBetween(db, serverId, null, null),
    readLedgerOverIssueShortfallRepaid(db, serverId),
    readLedgerNoteBurnRetired(db, serverId),
    readLedgerDonationBurns(db, serverId),
    readLedgerTaxMiscredited(db, serverId),
    goldFoundSummaryForServer(db, serverId),
  ]);
  const grossReserveBalance = roundGold(allTime.net);
  const reserveBalance = roundGold(Math.max(0, grossReserveBalance));
  return computeNoteSupply({
    goldMinedG: goldMinted.post_reset_ledger_mint,
    playerWalletG: goldMinted.wallet_gold,
    reserveG: reserveBalance,
    reserveLedgerNetG: grossReserveBalance,
    goldFoundPhysicalG: goldFoundSummary.physical_mined_since_july_g,
    notesRetiredG,
    notesRetiredDonationG,
    taxMiscreditedG,
    overIssueShortfallRepaidG,
  });
}

export {
  MAP_262_RESET_DATE_HST,
  MAP_262_RESET_INSTANT_HST,
  MAP_262_PRE_RESET_RESERVE_BALANCE,
  MAP_262_PRE_RESET_GRANTS_OVER_PRINTED,
  MAP_262_JUNE_DIVIDEND_RETURNED,
  MAP_262_TRUE_RESERVE_OPENING,
  PRE_JULY_262_GOLD_MINTED_BASELINE,
  LOCKED_JUNE_2026_HST,
  POST_RESET_LEDGER_HST_MONTH,
  LOCKED_JUNE_2026_RESERVE,
  type GoldMintedBreakdown,
  type Map262EconomyMerge,
  type NoteSupplySnapshot,
  type PayableSupplySnapshot,
};

export async function getTreasurySyncState(db: D1Database, serverId: string): Promise<number> {
  const row = await db
    .prepare(`SELECT last_ledger_mysql_id FROM rootmc_treasury_sync_state WHERE server_id = ? LIMIT 1`)
    .bind(treasuryServerId(serverId))
    .first<{ last_ledger_mysql_id: number }>();
  return Math.max(0, Math.floor(Number(row?.last_ledger_mysql_id) || 0));
}

export async function upsertTreasuryLedgerRows(
  db: D1Database,
  serverId: string,
  rows: Record<string, unknown>[],
  syncedAt: string,
): Promise<{ upserted: number; lastId: number }> {
  serverId = treasuryServerId(serverId);
  let upserted = 0;
  let lastId = await getTreasurySyncState(db, serverId);
  for (const raw of rows) {
    const mysqlId = Math.floor(Number(raw.mysql_id ?? raw.id));
    if (!Number.isFinite(mysqlId) || mysqlId <= 0) continue;
    const entryType = str(raw.entry_type).toUpperCase();
    const amount = roundGold(Number(raw.amount));
    const details = str(raw.details).slice(0, 512) || null;
    if (!entryType) continue;
    if (amount <= 0 && !isMintAuditTrail(details)) continue;
    await db
      .prepare(
        `INSERT INTO rootmc_treasury_ledger
           (server_id, mysql_id, entry_type, amount, from_uuid, to_uuid, details, created_at, synced_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(server_id, mysql_id) DO UPDATE SET
           entry_type = excluded.entry_type,
           amount = excluded.amount,
           from_uuid = excluded.from_uuid,
           to_uuid = excluded.to_uuid,
           details = excluded.details,
           created_at = excluded.created_at,
           synced_at = excluded.synced_at`,
      )
      .bind(
        serverId,
        mysqlId,
        entryType,
        amount,
        normalizeUuid(raw.from_uuid) || null,
        normalizeUuid(raw.to_uuid) || null,
        details,
        str(raw.created_at) || syncedAt,
        syncedAt,
      )
      .run();
    upserted++;
    if (mysqlId > lastId) lastId = mysqlId;
  }
  if (upserted > 0) {
    await db
      .prepare(
        `INSERT INTO rootmc_treasury_sync_state (server_id, last_ledger_mysql_id, updated_at)
         VALUES (?, ?, ?)
         ON CONFLICT(server_id) DO UPDATE SET
           last_ledger_mysql_id = MAX(rootmc_treasury_sync_state.last_ledger_mysql_id, excluded.last_ledger_mysql_id),
           updated_at = excluded.updated_at`,
      )
      .bind(serverId, lastId, syncedAt)
      .run();
  }
  return { upserted, lastId };
}

export async function upsertPlaytimeMonthlyRows(
  db: D1Database,
  serverId: string,
  rows: Record<string, unknown>[],
  syncedAt: string,
): Promise<number> {
  let count = 0;
  for (const raw of rows) {
    const uuid = normalizeUuid(raw.minecraft_uuid ?? raw.uuid);
    const monthKey = str(raw.month_key);
    const seconds = Math.max(0, Math.floor(Number(raw.playtime_seconds) || 0));
    if (!uuid || !/^\d{4}-\d{2}$/.test(monthKey)) continue;
    await db
      .prepare(
        `INSERT INTO rootmc_playtime_monthly
           (server_id, minecraft_uuid, month_key, playtime_seconds, synced_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(server_id, minecraft_uuid, month_key) DO UPDATE SET
           playtime_seconds = excluded.playtime_seconds,
           synced_at = excluded.synced_at`,
      )
      .bind(serverId, uuid, monthKey, seconds, syncedAt)
      .run();
    count++;
  }
  return count;
}

export async function replaceTownTaxRates(
  db: D1Database,
  serverId: string,
  rows: Record<string, unknown>[],
  syncedAt: string,
): Promise<number> {
  await db.prepare(`DELETE FROM rootmc_town_tax_rates WHERE server_id = ?`).bind(serverId).run();
  let count = 0;
  for (const raw of rows) {
    const town = str(raw.town_name ?? raw.name);
    if (!town) continue;
    const tax = Number(raw.tax_percent ?? raw.tax);
    await db
      .prepare(
        `INSERT INTO rootmc_town_tax_rates
           (server_id, town_name, mayor_name, tax_percent, synced_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .bind(
        serverId,
        town,
        str(raw.mayor_name ?? raw.mayor) || null,
        Number.isFinite(tax) ? tax : null,
        syncedAt,
      )
      .run();
    count++;
  }
  return count;
}

export const TREASURY_TYPE_GLOSSARY: { type: string; direction: "inflow" | "outflow" | "other"; label: string }[] = [
  { type: "OPENING", direction: "inflow", label: "Opening balance (pre-ledger /eco give before /grant tracking)" },
  { type: "TAX", direction: "inflow", label: "Transaction Taxes" },
  { type: "DEATH", direction: "inflow", label: "PvP death fees (Server Reserve share)" },
  { type: "TOWNY_SINK", direction: "inflow", label: "Server fees" },
  { type: "LOAN_PRINCIPAL", direction: "inflow", label: "Loan repaid" },
  { type: "LOAN_INTEREST", direction: "inflow", label: "Loan Interest" },
  { type: "BOND_ISSUE", direction: "inflow", label: "Bonded note deposits" },
  { type: "BOND_COUPON_FORFEIT", direction: "inflow", label: "Unclaimed bond earnings returned" },
  { type: "NOTE_BURN", direction: "other", label: "Notes retired (tax, /mint gold)" },
  { type: "MINT_GROSS", direction: "other", label: "Physical gold -> wallet Notes (/mint)" },
  { type: "MINT_REDEEM", direction: "other", label: "Wallet Notes -> physical gold (/mint gold)" },
  { type: "DONATION", direction: "inflow", label: "Reserve donations (/pay reserve)" },
  { type: "VOTE", direction: "outflow", label: "Vote Rewards" },
  { type: "PLAYTIME", direction: "outflow", label: "Playtime Rewards" },
  { type: "GRANT", direction: "outflow", label: "Grants" },
  { type: "DIVIDEND", direction: "outflow", label: "Treasury payouts" },
  { type: "LOAN_DISBURSE", direction: "outflow", label: "Loan Taken" },
  { type: "BOND_REDEEM", direction: "outflow", label: "Bond redemption (physical gold)" },
  { type: "BOND_COUPON", direction: "outflow", label: "Bond earnings payout" },
  { type: "OTHER", direction: "other", label: "Other treasury movements" },
];

function isInflowType(type: string): boolean {
  return INFLOW_TYPES.includes(type);
}

function isOutflowType(type: string): boolean {
  return OUTFLOW_TYPES.includes(type);
}

function labelForType(type: string): string {
  return TREASURY_TYPE_GLOSSARY.find((row) => row.type === type)?.label ?? type;
}

function labelForTownyDetails(details: string, amount = 0): string {
  const d = str(details).toLowerCase();
  const amt = roundGold(Number(amount) || 0);
  if (d.startsWith("towny:new-town") || d.startsWith("backfill:towny:new-town") || isMisclassifiedTownyFounding(d, amt) === "town") {
    return "New town founding (/town new)";
  }
  if (d.startsWith("towny:new-nation") || d.startsWith("backfill:towny:new-nation") || isMisclassifiedTownyFounding(d, amt) === "nation") {
    return "New nation founding";
  }
  if (d.startsWith("towny:outpost") || (d.startsWith("towny:other") && isTownyOutpostAmount(amt))) {
    return "Outpost claim (/town claim outpost)";
  }
  if (d.startsWith("towny:bonus-townblock") || d.startsWith("backfill:towny:bonus-block") || (d.startsWith("towny:other") && isTownyBonusBlockAmount(amt))) {
    return "Bonus townblock purchase (/town buy bonus)";
  }
  if (d.startsWith("towny:claim") || d.startsWith("backfill:towny:claim")) return "Chunk claims (/town claim)";
  if (d.startsWith("towny:merge")) return "Town merge fees";
  if (d.startsWith("towny:other")) return "Unclassified Towny fee";
  if (d.startsWith("service-fee:")) {
    const channel = str(details).slice("service-fee:".length) || "service";
    return "Service fee (" + channel + ")";
  }
  return "Other Towny / closed-economy fees";
}

function labelForVoteDetails(details: string): string {
  const raw = str(details);
  const match = raw.match(/(?:^|;|\s)service=([^;,\s]+)/i);
  const site = match ? match[1].trim() : "";
  if (!site) return "Voting";
  return "Voting: " + site;
}

const GRANT_DETAIL_LABELS: Record<string, string> = {
  discord_activity: "Discord activity reward",
  discord_link: "Discord link bonus",
  discord_first_message: "Discord first message bonus",
};

function labelForGrantDetails(details: string): string {
  const parts = str(details)
    .split(";")
    .map((p) => p.trim())
    .filter(Boolean);
  for (const part of parts) {
    if (part.startsWith("operator=")) continue;
    const label = GRANT_DETAIL_LABELS[part];
    if (label) return label;
  }
  return labelForType("GRANT");
}

function labelForDeathDetails(details: string, amount = 0): string {
  const d = str(details);
  const grossMatch = /(?:^|;)gross=([0-9.]+)/.exec(d);
  const killerMatch = /(?:^|;)killer=([^;]+)/.exec(d);
  const gross = grossMatch ? roundGold(Number(grossMatch[1]) || 0) : 0;
  const killer = killerMatch ? killerMatch[1].trim() : "";
  const reserveShare = roundGold(Number(amount) || 0);
  if (gross > 0 && killer && killer !== "none") {
    return `PvP death fee (${gross.toFixed(3)} G gross -> reserve + ${killer})`;
  }
  if (gross > 0 && reserveShare > 0) {
    return `PvP death fee (${gross.toFixed(3)} G gross, ${reserveShare.toFixed(3)} G to reserve)`;
  }
  return "PvP death fee (Server Reserve share)";
}

function labelForDeathKillerPayout(details: string, amount = 0): string {
  const grossMatch = /(?:^|;)gross=([0-9.]+)/.exec(str(details));
  const gross = grossMatch ? roundGold(Number(grossMatch[1]) || 0) : 0;
  const amt = roundGold(Number(amount) || 0);
  if (gross > 0 && amt > 0) {
    return `PvP killer bounty (${amt.toFixed(3)} G of ${gross.toFixed(3)} G fee)`;
  }
  return "PvP killer bounty";
}

function labelForLedgerEntry(type: string, details: string | null, amount = 0): string {
  const normalizedType = normalizeBondLedgerType(type, details);
  const mintDetail = normalizeMintDetail(details);
  const redeemMatch = /^mint:redeem=([0-9]+(?:\.[0-9]+)?)$/.exec(mintDetail);
  if (redeemMatch) {
    const g = roundGold(Number(redeemMatch[1]) || 0);
    return g > 0
      ? `Notes -> physical gold (/mint gold, ${g.toFixed(3)} G)`
      : "Notes -> physical gold (/mint gold)";
  }
  const grossMatch = /^mint:gross=([0-9]+(?:\.[0-9]+)?)$/.exec(mintDetail);
  if (grossMatch) {
    const g = roundGold(Number(grossMatch[1]) || 0);
    return g > 0
      ? `Physical gold -> Notes (/mint, ${g.toFixed(3)} G)`
      : "Physical gold -> Notes (/mint)";
  }
  if (str(type).toUpperCase() === "OPENING") {
    return "Opening balance (pre-ledger seed)";
  }
  if (str(type).toUpperCase() === "TOWNY_SINK") {
    return labelForTownyDetails(details || "", amount);
  }
  if (str(type).toUpperCase() === "VOTE") {
    return labelForVoteDetails(details || "");
  }
  if (str(type).toUpperCase() === "GRANT") {
    return labelForGrantDetails(details || "");
  }
  if (str(normalizedType).toUpperCase() === "DEATH") {
    return labelForDeathDetails(details || "", amount);
  }
  if (str(normalizedType).toUpperCase() === "BOND_ISSUE") {
    return "Bonded note deposit";
  }
  if (str(normalizedType).toUpperCase() === "BOND_REDEEM") {
    return "Bond redemption (physical gold)";
  }
  if (str(normalizedType).toUpperCase() === "BOND_COUPON") {
    return isBondPhysicalPayout(details)
      ? "Bond earnings (physical gold)"
      : "Bond earnings (bank deposit)";
  }
  if (str(normalizedType).toUpperCase() === "BOND_COUPON_FORFEIT") {
    return "Unclaimed bond earnings returned";
  }
  if (str(type).toUpperCase() === "OTHER" && str(details).toLowerCase().includes("death:killer_payout")) {
    return labelForDeathKillerPayout(details || "", amount);
  }
  if (str(type).toUpperCase() === "DONATION") {
    return "Reserve donation (/pay reserve)";
  }
  return labelForType(normalizedType);
}

/** Legacy bond rows were logged as OTHER with bond:* details before BOND_ISSUE existed. */
function normalizeBondLedgerType(type: string, details: string | null): string {
  const t = str(type).toUpperCase();
  if (t !== "OTHER") return t;
  const d = str(details).toLowerCase();
  if (d.startsWith("bond:") || d.startsWith("bonded")) return "BOND_ISSUE";
  return t;
}

function isBondPhysicalPayout(details: string | null): boolean {
  const d = str(details).toLowerCase();
  if (!d) return false;
  if (d === "coupon") return true;
  if (d.startsWith("bond:") || d.startsWith("bonded")) return true;
  return false;
}

function parseGrossFromDetails(details: string | null): number | null {
  const m = /:gross=([0-9]+(?:\.[0-9]+)?)/.exec(str(details));
  return m ? roundGold(Number(m[1]) || 0) : null;
}

function channelFromGrossDetails(details: string | null): string {
  const d = str(details);
  const idx = d.indexOf(":gross=");
  if (idx >= 0) return d.slice(0, idx);
  if (d.startsWith("gross=")) return "closed-loop";
  return d;
}

/** Towny / service closed-loop fees - not mint tax rows. */
function isTownyClosedLoopDetails(details: string | null): boolean {
  const d = str(details).toLowerCase();
  if (!d.includes(":gross=") && !d.startsWith("gross=")) return false;
  if (d.startsWith("mint:") || d.includes("mint:gross=")) return false;
  return d.startsWith("towny:") || d.startsWith("service-fee:") || d.startsWith("gross=");
}

function ledgerTimesClose(a: string, b: string): boolean {
  const ta = Date.parse(a);
  const tb = Date.parse(b);
  if (!Number.isFinite(ta) || !Number.isFinite(tb)) {
    return str(a).slice(0, 19) === str(b).slice(0, 19);
  }
  return Math.abs(ta - tb) <= 3000;
}

function isBlankLedgerParty(name: string): boolean {
  const n = str(name).trim();
  if (!n) return true;
  // ASCII hyphen, Unicode em dash, ellipsis-only, or legacy mojibake em dash
  return n === "-" || n === "\u2014" || n === "\u2026" || n === "\u00E2\u20AC\u201D";
}

function formatClosedLoopPayerDisplay(fromDisplay: string): string {
  const name = str(fromDisplay).trim();
  if (isBlankLedgerParty(name) || name.toLowerCase() === "player") {
    return "Unidentified Towny payer";
  }
  return `${name} (Towny payer)`;
}

function formatCollapsedClosedLoopDetails(
  details: string | null,
  totalG: number,
  taxG: number,
  netG: number,
): string {
  const channel = channelFromGrossDetails(details);
  return `${channel} - ${totalG.toFixed(3)} G fee (${taxG.toFixed(3)} G tax + ${netG.toFixed(3)} G net)`;
}

export type TreasuryLedgerEntry = {
  mysql_id: number;
  entry_type: string;
  type_label: string;
  direction: string;
  amount: number;
  from_uuid: string | null;
  to_uuid: string | null;
  from_display: string;
  to_display: string;
  details: string | null;
  created_at: string;
  synced_at: string | null;
  fee_kind?: "towny_closed_loop" | null;
  executive_kind?: string;
  executive_label?: string;
  operator_uuid?: string | null;
  operator_display?: string;
  public_details?: string;
};

/** Staff/manual ledger rows: corrections, backfills, and non-automated operator grants. */
const EXECUTIVE_LEDGER_SQL = `(
  details LIKE 'correction:%'
  OR details LIKE 'backfill:%'
  OR details LIKE 'manual:%'
  OR details LIKE 'executive:%'
  OR details LIKE 'normalize:%'
  OR details LIKE 'operator=%'
  OR details LIKE '%;operator=%'
)`;

const AUTOMATED_OPERATOR_ENTRY_TYPES = new Set(["VOTE", "PLAYTIME", "DIVIDEND", "LOAN_DISBURSE", "LOAN_PRINCIPAL", "LOAN_INTEREST"]);

const AUTOMATED_OPERATOR_REASON_PREFIXES = [
  "service=",
  "discord_activity",
  "discord_link",
  "discord_first_message",
  "personal-loan",
  "town-loan:",
  "month=",
  "tier=",
  "rewards_vote_id=",
  "transfer=",
  "cmdtest",
  "questionnaire",
  "chamber",
  "playtime",
  "plot-refund",
  "vote:",
];

function detailsAfterOperator(details: string | null): string {
  return str(details)
    .replace(/^operator=[^;]*;?/i, "")
    .replace(/^;+|;+$/g, "")
    .trim();
}

export function isExecutiveLedgerDetails(details: string | null, entryType?: string | null): boolean {
  const d = str(details).trim();
  if (!d) return false;
  if (d.startsWith("correction:")) return true;
  if (d.startsWith("backfill:")) return true;
  if (d.startsWith("manual:")) return true;
  if (d.startsWith("executive:")) return true;
  if (d.startsWith("normalize:")) return true;

  const hasOperator = /^operator=/i.test(d) || /;operator=/i.test(d);
  if (!hasOperator) return false;

  const type = str(entryType).toUpperCase();
  if (AUTOMATED_OPERATOR_ENTRY_TYPES.has(type)) return false;

  const body = detailsAfterOperator(d).toLowerCase();
  if (!body) return type === "GRANT" || type === "OTHER";

  for (const prefix of AUTOMATED_OPERATOR_REASON_PREFIXES) {
    if (body.startsWith(prefix) || body.includes(";" + prefix)) return false;
  }
  return type === "GRANT" || type === "OTHER" || type === "TAX" || type === "NOTE_BURN" || type === "TOWNY_SINK";
}

function executiveKindFromDetails(details: string | null, entryType?: string | null): string {
  const d = str(details).trim();
  if (d.startsWith("correction:")) return "correction";
  if (d.startsWith("backfill:")) return "backfill";
  if (d.startsWith("manual:")) return "manual";
  if (d.startsWith("executive:")) return "executive";
  if (d.startsWith("normalize:")) return "normalize";
  if (isExecutiveLedgerDetails(details, entryType)) return "staff_grant";
  return "other";
}

function executiveKindLabel(kind: string): string {
  switch (kind) {
    case "staff_grant":
      return "Staff grant";
    case "operator_action":
      return "Staff action";
    case "correction":
      return "Ledger correction";
    case "backfill":
      return "Ledger backfill";
    case "manual":
      return "Manual entry";
    case "executive":
      return "Executive entry";
    case "normalize":
      return "Normalization";
    default:
      return "Executive";
  }
}

function parseOperatorUuid(details: string | null): string | null {
  const m = str(details).match(/(?:^|;)operator=([0-9a-f-]{36})/i);
  return m ? normalizeUuid(m[1]) : null;
}

function publicExecutiveDetails(details: string | null): string {
  let d = str(details).trim();
  if (!d) return "-";
  d = d
    .replace(/(?:^|;)operator=[^;]*/gi, "")
    .replace(/^;+|;+$/g, "")
    .trim();
  if (d.startsWith("correction:")) {
    const rest = d.slice("correction:".length);
    if (rest.startsWith("tax_reclass:")) {
      return "Tax reclassification -  " + rest.slice("tax_reclass:".length);
    }
    if (rest.startsWith("donation_reclass:")) {
      return "Donation reclassification";
    }
    return "Correction -  " + rest;
  }
  if (d.startsWith("backfill:")) {
    return d.slice("backfill:".length).replace(/:/g, " -  ");
  }
  if (d.startsWith("executive:")) {
    return d.slice("executive:".length) || "Executive";
  }
  if (d.startsWith("manual:")) {
    return d.slice("manual:".length) || "Manual";
  }
  if (d.startsWith("normalize:")) {
    return d.slice("normalize:".length) || "Normalization";
  }
  return d || "-";
}

function enrichExecutiveLedgerEntry(
  entry: TreasuryLedgerEntry,
  operatorNames: Record<string, string>,
): TreasuryLedgerEntry {
  const kind = executiveKindFromDetails(entry.details, entry.entry_type);
  const operatorUuid = parseOperatorUuid(entry.details);
  const operatorDisplay = operatorUuid
    ? displayAccount(operatorUuid, operatorNames[operatorUuid] ?? null)
    : "-";
  return {
    ...entry,
    executive_kind: kind,
    executive_label: executiveKindLabel(kind),
    operator_uuid: operatorUuid,
    operator_display: operatorDisplay,
    public_details: publicExecutiveDetails(entry.details),
  };
}

/** Merge TAX + TOWNY_SINK pairs so one Towny payment is one ledger line (not two reserve deposits). */
function collapseClosedLoopLedgerRows(entries: TreasuryLedgerEntry[]): TreasuryLedgerEntry[] {
  const out: TreasuryLedgerEntry[] = [];
  const consumed = new Set<number>();

  for (let i = 0; i < entries.length; i++) {
    if (consumed.has(i)) continue;
    const row = entries[i];
    const details = row.details;

    if (
      (row.entry_type === "TAX" || row.entry_type === "TOWNY_SINK") &&
      isTownyClosedLoopDetails(details)
    ) {
      let partnerIdx = -1;
      for (let j = 0; j < entries.length; j++) {
        if (j === i || consumed.has(j)) continue;
        const other = entries[j];
        const types = new Set([row.entry_type, other.entry_type]);
        if (!types.has("TAX") || !types.has("TOWNY_SINK")) continue;
        if (other.details !== details) continue;
        if (other.from_uuid !== row.from_uuid) continue;
        if (!ledgerTimesClose(row.created_at, other.created_at)) continue;
        partnerIdx = j;
        break;
      }

      if (partnerIdx >= 0) {
        const partner = entries[partnerIdx];
        const taxRow = row.entry_type === "TAX" ? row : partner;
        const sinkRow = row.entry_type === "TOWNY_SINK" ? row : partner;
        const taxAmt = roundGold(taxRow.amount);
        const netAmt = roundGold(sinkRow.amount);
        const parsedGross = parseGrossFromDetails(details);
        const total = roundGold(parsedGross != null ? parsedGross : taxAmt + netAmt);
        const feeLabel = labelForTownyDetails(details || "", total);
        out.push({
          ...sinkRow,
          mysql_id: Math.max(row.mysql_id, partner.mysql_id),
          entry_type: "TOWNY_SINK",
          type_label: feeLabel,
          direction: "inflow",
          amount: total,
          from_display: formatClosedLoopPayerDisplay(sinkRow.from_display),
          to_display: "Reserve",
          details: formatCollapsedClosedLoopDetails(details, total, taxAmt, netAmt),
          fee_kind: "towny_closed_loop",
        });
        consumed.add(i);
        consumed.add(partnerIdx);
        continue;
      }

      if (row.entry_type === "TOWNY_SINK") {
        const gross = parseGrossFromDetails(details) ?? row.amount;
        out.push({
          ...row,
          type_label: labelForTownyDetails(details || "", gross),
          amount: roundGold(gross),
          from_display: formatClosedLoopPayerDisplay(row.from_display),
          to_display: "Reserve",
          details: `${channelFromGrossDetails(details)} - ${roundGold(gross).toFixed(3)} G fee`,
          fee_kind: "towny_closed_loop",
        });
        consumed.add(i);
        continue;
      }

      if (row.entry_type === "TAX") {
        out.push({
          ...row,
          from_display: formatClosedLoopPayerDisplay(row.from_display),
          to_display: "Reserve",
          details: `${channelFromGrossDetails(details)} - ${row.amount.toFixed(3)} G transaction tax`,
          fee_kind: "towny_closed_loop",
        });
        consumed.add(i);
        continue;
      }
    }

    out.push(row);
  }

  return out;
}

/** Towny founding fees from server config - used to reclassify mis-tagged ledger rows. */
const TOWNY_NEW_TOWN_GOLD = 400;
const TOWNY_NEW_NATION_GOLD = 2000;
const TOWNY_OUTPOST_GOLD = 350;
const TOWNY_BONUS_BLOCK_GOLD = 500;
const TOWNY_FOUNDING_TOLERANCE = 0.05;

function isTownyNewTownAmount(amount: number): boolean {
  return Math.abs(amount - TOWNY_NEW_TOWN_GOLD) < TOWNY_FOUNDING_TOLERANCE;
}

function isTownyNewNationAmount(amount: number): boolean {
  return Math.abs(amount - TOWNY_NEW_NATION_GOLD) < TOWNY_FOUNDING_TOLERANCE;
}

function isTownyOutpostAmount(amount: number): boolean {
  return Math.abs(amount - TOWNY_OUTPOST_GOLD) < TOWNY_FOUNDING_TOLERANCE;
}

function isTownyBonusBlockAmount(amount: number): boolean {
  return Math.abs(amount - TOWNY_BONUS_BLOCK_GOLD) < TOWNY_FOUNDING_TOLERANCE;
}

function isMisclassifiedTownyFounding(details: string, amount: number): "town" | "nation" | null {
  const d = str(details).toLowerCase();
  // Legacy backfill rows were tagged as towny:other; claim rows can legitimately hit these amounts.
  if (!d.startsWith("towny:other")) return null;
  if (isTownyNewTownAmount(amount)) return "town";
  if (isTownyNewNationAmount(amount)) return "nation";
  return null;
}

type TownyIntakeTotals = {
  new_town: number;
  new_nation: number;
  claims: number;
  service_fees: number;
  other: number;
  total: number;
};

function townyFoundingDedupKey(
  kind: "new_town" | "new_nation",
  row: { amount: number; details: string | null; from_uuid: string | null; created_at: string },
): string {
  const actor = normalizeUuid(row.from_uuid);
  const details = str(row.details);
  const amount = Math.round(Number(row.amount) || 0);
  const createdAt = Date.parse(ledgerCreatedAtIso(row.created_at));
  // Match in-game TreasuryManager debounce (~3s) - only collapse same-moment duplicate callbacks.
  const bucket = Number.isFinite(createdAt) ? Math.floor(createdAt / 3000) : str(row.created_at);
  return `${kind}:${actor || "anon"}:${amount}:${details}:${bucket}`;
}

export async function townyIntakeBetween(
  db: D1Database,
  serverId: string,
  startIso?: string | null,
  endIso?: string | null,
): Promise<TownyIntakeTotals> {
  const start = str(startIso);
  const end = str(endIso);
  let sql = `SELECT amount, details, from_uuid, to_uuid, created_at
     FROM rootmc_treasury_ledger
     WHERE server_id = ? AND entry_type = 'TOWNY_SINK'`;
  const binds: (string | number)[] = [serverId];
  if (start) {
    sql += ` AND ${LEDGER_CREATED_AT_NORM} >= ?`;
    binds.push(sqlLedgerBound(start));
  }
  if (end) {
    sql += ` AND ${LEDGER_CREATED_AT_NORM} < ?`;
    binds.push(sqlLedgerBound(end));
  }
  const result = await db
    .prepare(sql)
    .bind(...binds)
    .all<{ amount: number; details: string | null; from_uuid: string | null; to_uuid: string | null; created_at: string }>();

  // Founding events can be duplicated in upstream sync. De-dupe only same-moment repeats
  // (same actor/amount/details within a 3s window). Do not collapse separate /town new fees.
  const foundingSeen = new Set<string>();
  let newTown = 0;
  let newNation = 0;
  let claims = 0;
  let serviceFees = 0;
  let total = 0;

  for (const row of result.results ?? []) {
    const amount = roundGold(Number(row.amount) || 0);
    if (amount <= 0) continue;
    total = roundGold(total + amount);

    const details = str(row.details).toLowerCase();
    const misclassified = isMisclassifiedTownyFounding(details, amount);
    const isNewTown =
      details.startsWith("towny:new-town") || details.startsWith("backfill:towny:new-town") || misclassified === "town";
    const isNewNation =
      details.startsWith("towny:new-nation") ||
      details.startsWith("backfill:towny:new-nation") ||
      misclassified === "nation";

    if (isNewTown || isNewNation) {
      const kind = isNewTown ? "new_town" : "new_nation";
      const key = townyFoundingDedupKey(kind, row);
      if (foundingSeen.has(key)) {
        total = roundGold(total - amount);
        continue;
      }
      foundingSeen.add(key);
      if (isNewTown) newTown = roundGold(newTown + amount);
      else newNation = roundGold(newNation + amount);
      continue;
    }

    if (details.startsWith("service-fee:")) {
      serviceFees = roundGold(serviceFees + amount);
      continue;
    }

    const claimLike =
      details.startsWith("towny:claim") ||
      details.startsWith("backfill:towny:claim") ||
      details.startsWith("towny:merge");
    const outpostLike = details.startsWith("towny:outpost");
    const bonusLike =
      details.startsWith("towny:bonus-townblock") || details.startsWith("backfill:towny:bonus-block");
    if (outpostLike || bonusLike || claimLike) claims = roundGold(claims + amount);
    else if (details.startsWith("towny:other")) {
      if (isTownyOutpostAmount(amount) || isTownyBonusBlockAmount(amount)) claims = roundGold(claims + amount);
    }
  }

  newTown = roundGold(newTown);
  newNation = roundGold(newNation);
  claims = roundGold(claims);
  serviceFees = roundGold(serviceFees);
  total = roundGold(total);
  const tagged = roundGold(newTown + newNation + claims + serviceFees);
  let intake = {
    new_town: newTown,
    new_nation: newNation,
    claims,
    service_fees: serviceFees,
    other: roundGold(Math.max(0, total - tagged)),
    total,
  };
  return intake;
}

/** Distinct HST months with ledger rows (newest first), always includes current + prior HST month. */
async function listLedgerMonthKeys(db: D1Database, serverId: string): Promise<string[]> {
  const { results } = await db
    .prepare(
      `SELECT DISTINCT strftime('%Y-%m', datetime(created_at, '-10 hours')) AS month_key
       FROM rootmc_treasury_ledger
       WHERE server_id = ?
       ORDER BY month_key DESC
       LIMIT 36`,
    )
    .bind(serverId)
    .all<{ month_key: string }>();
  const seen = new Set<string>();
  const out: string[] = [];
  for (const key of [currentHstMonthKey(), previousHstMonthKey()]) {
    if (key < POST_RESET_LEDGER_HST_MONTH) continue;
    if (!seen.has(key)) {
      seen.add(key);
      out.push(key);
    }
  }
  for (const row of results ?? []) {
    const key = str(row.month_key);
    if (key && key >= POST_RESET_LEDGER_HST_MONTH && !seen.has(key)) {
      seen.add(key);
      out.push(key);
    }
  }
  return out;
}

function lockedLedgerMonthTotals(monthKey: string): LedgerTotals | null {
  if (monthKey === LOCKED_JUNE_2026_RESERVE.month_key) {
    return { ...LOCKED_JUNE_2026_RESERVE.month };
  }
  if (monthKey === monthKeyBefore(LOCKED_JUNE_2026_HST)) {
    return { ...LOCKED_JUNE_2026_RESERVE.prior_month };
  }
  return null;
}

async function resolveLedgerMonthTotals(
  db: D1Database,
  serverId: string,
  monthKey: string,
): Promise<LedgerTotals> {
  const locked = lockedLedgerMonthTotals(monthKey);
  if (locked) return locked;
  const { start, end } = monthBoundsIso(monthKey);
  return ledgerTotalsBetween(db, serverId, start, end);
}

async function resolveTownyIntakeForMonth(
  db: D1Database,
  serverId: string,
  monthKey: string,
): Promise<TownyIntakeTotals> {
  if (monthKey === LOCKED_JUNE_2026_HST) {
    return { ...LOCKED_JUNE_2026_RESERVE.towny_intake };
  }
  if (monthKey === monthKeyBefore(LOCKED_JUNE_2026_HST)) {
    return { new_town: 0, new_nation: 0, claims: 0, service_fees: 0, other: 0, total: 0 };
  }
  const { start, end } = monthBoundsIso(monthKey);
  return townyIntakeBetween(db, serverId, start, end);
}

export const TOWNY_INTAKE_GLOSSARY: { key: string; label: string }[] = [
  { key: "new_town", label: "New town founding (/town new) - typically 400 G" },
  { key: "new_nation", label: "New nation founding - typically 2,000 G" },
  { key: "claims", label: "Per-chunk claims (/town claim)" },
  { key: "service_fees", label: "Survey, warp create, shop stock, etc." },
  { key: "other", label: "Other Towny closed-economy sinks (legacy rows before tagging)" },
];

type LedgerTotals = {
  inflow: number;
  outflow: number;
  net: number;
  by_type: Record<string, number>;
};

function pctVsPrior(current: number, prior: number): number | null {
  if (!Number.isFinite(current) || !Number.isFinite(prior)) return null;
  if (prior === 0) return current === 0 ? 0 : null;
  return roundGold(((current - prior) / Math.abs(prior)) * 100);
}

function lastBalanceInMonth(
  monthKey: string,
  daily: { day: string; balance: number }[],
  history: { recorded_at: string; balance: number }[],
): number | null {
  let last: number | null = null;
  let lastTs = "";
  for (const row of daily) {
    const day = str(row.day);
    if (day.startsWith(monthKey)) {
      last = roundGold(Number(row.balance) || 0);
    }
  }
  for (const row of history) {
    const month = str(row.recorded_at).slice(0, 7);
    if (month !== monthKey) continue;
    const ts = str(row.recorded_at);
    if (ts >= lastTs) {
      lastTs = ts;
      last = roundGold(Number(row.balance) || 0);
    }
  }
  return last;
}

function pctByTypeMap(
  current: Record<string, number>,
  prior: Record<string, number>,
): Record<string, number | null> {
  const keys = new Set([...Object.keys(current), ...Object.keys(prior)]);
  const out: Record<string, number | null> = {};
  for (const key of keys) {
    out[key] = pctVsPrior(Number(current[key]) || 0, Number(prior[key]) || 0);
  }
  return out;
}

function townyPctVsPrior(
  current: TownyIntakeTotals,
  prior: TownyIntakeTotals,
): Record<string, number | null> {
  return {
    new_town: pctVsPrior(current.new_town, prior.new_town),
    new_nation: pctVsPrior(current.new_nation, prior.new_nation),
    claims: pctVsPrior(current.claims, prior.claims),
    service_fees: pctVsPrior(current.service_fees, prior.service_fees),
    other: pctVsPrior(current.other, prior.other),
    total: pctVsPrior(current.total, prior.total),
  };
}

export async function ledgerTotalsBetween(
  db: D1Database,
  serverId: string,
  startIso?: string | null,
  endIso?: string | null,
): Promise<LedgerTotals> {
  serverId = treasuryServerId(serverId);
  const byType: Record<string, number> = {};
  let inflow = 0;
  let outflow = 0;
  const start = str(startIso);
  const end = str(endIso);
  let sql = `SELECT entry_type, COALESCE(SUM(amount), 0) AS total
       FROM rootmc_treasury_ledger
       WHERE server_id = ?`;
  const binds: (string | number)[] = [serverId];
  if (start) {
    sql += ` AND ${LEDGER_CREATED_AT_NORM} >= ?`;
    binds.push(sqlLedgerBound(start));
  }
  if (end) {
    sql += ` AND ${LEDGER_CREATED_AT_NORM} < ?`;
    binds.push(sqlLedgerBound(end));
  }
  sql += " GROUP BY entry_type";
  const result = await db.prepare(sql).bind(...binds).all<{ entry_type: string; total: number }>();
  for (const row of result.results ?? []) {
    const type = str(row.entry_type).toUpperCase();
    const total = roundGold(Number(row.total) || 0);
    if (!type || total <= 0) continue;
    byType[type] = total;
    if (isInflowType(type)) inflow += total;
    else if (isOutflowType(type)) outflow += total;
  }
  return {
    inflow: roundGold(inflow),
    outflow: roundGold(outflow),
    net: roundGold(inflow - outflow),
    by_type: byType,
  };
}

/** July 1+ reserve ledger net - matches rootmc.net/reserve headline and bond pause gate. */
export async function readReserveLedgerNetG(db: D1Database, serverId: string): Promise<number> {
  const totals = await ledgerTotalsBetween(db, serverId, null, null);
  return totals.net;
}

async function averageMonthlyNetPool(db: D1Database, serverId: string): Promise<number> {
  const { results } = await db
    .prepare(
      `SELECT AVG(month_net) AS avg_net FROM (
         SELECT
           strftime('%Y-%m', datetime(created_at, '-10 hours')) AS month_key,
           SUM(CASE WHEN entry_type IN (${INFLOW_TYPES_ACTIVITY.map(() => "?").join(",")}) THEN amount ELSE 0 END)
            - SUM(CASE WHEN entry_type IN (${OUTFLOW_TYPES.map(() => "?").join(",")}) THEN amount ELSE 0 END)
             AS month_net
         FROM rootmc_treasury_ledger
         WHERE server_id = ?
         GROUP BY month_key
       )
       WHERE month_key < strftime('%Y-%m', datetime('now', '-10 hours'))`,
    )
    .bind(...INFLOW_TYPES_ACTIVITY, ...OUTFLOW_TYPES, serverId)
    .all<{ avg_net: number }>();
  return roundGold(Number(results?.[0]?.avg_net) || 0);
}

export async function persistTreasuryBalance(
  db: D1Database,
  serverId: string,
  balance: number | null | undefined,
  syncedAt: string,
): Promise<void> {
  if (!Number.isFinite(Number(balance))) return;
  serverId = treasuryServerId(serverId);
  const bal = roundGold(Number(balance));
  await db
    .prepare(
      `INSERT INTO rootmc_treasury_sync_state (server_id, last_ledger_mysql_id, updated_at, treasury_balance)
       VALUES (?, COALESCE((SELECT last_ledger_mysql_id FROM rootmc_treasury_sync_state WHERE server_id = ?), 0), ?, ?)
       ON CONFLICT(server_id) DO UPDATE SET
         treasury_balance = excluded.treasury_balance,
         updated_at = excluded.updated_at`,
    )
    .bind(serverId, serverId, syncedAt, bal)
    .run();
  await db
    .prepare(
      `INSERT INTO rootmc_treasury_balance_snapshots (server_id, balance, recorded_at)
       VALUES (?, ?, ?)`,
    )
    .bind(serverId, bal, syncedAt)
    .run();
}

/** Clear mirrored ledger so a full MySQL re-import can replace ghost D1 rows. */
export async function resetTreasuryLedgerMirror(db: D1Database, serverId?: string): Promise<number> {
  serverId = treasuryServerId(serverId);
  let deleted = 0;
  for (let i = 0; i < 40; i++) {
    const res = await db
      .prepare(`DELETE FROM rootmc_treasury_ledger WHERE server_id = ? LIMIT 400`)
      .bind(serverId)
      .run();
    const n = Number(res.meta?.changes || 0);
    deleted += n;
    if (n <= 0) break;
  }
  await db
    .prepare(
      `INSERT INTO rootmc_treasury_sync_state (server_id, last_ledger_mysql_id, updated_at)
       VALUES (?, 0, ?)
       ON CONFLICT(server_id) DO UPDATE SET
         last_ledger_mysql_id = 0,
         updated_at = excluded.updated_at`,
    )
    .bind(serverId, nowIso())
    .run();
  return deleted;
}

async function readTreasuryBalance(db: D1Database, serverId: string): Promise<number | null> {
  serverId = treasuryServerId(serverId);
  const row = await db
    .prepare(`SELECT treasury_balance FROM rootmc_treasury_sync_state WHERE server_id = ? LIMIT 1`)
    .bind(serverId)
    .first<{ treasury_balance: number | null }>();
  const bal = Number(row?.treasury_balance);
  return Number.isFinite(bal) ? roundGold(bal) : null;
}

/** Personal Gold Backed Bond paper for payable supply - never add town/nation auto-bonds (already in town/nation banks). */
function personalBondPrincipalForPayable(bondSummary: {
  total_principal_g?: number;
  player_principal_g?: number;
  government_principal_g?: number;
}): number {
  const active = Math.max(0, Number(bondSummary.total_principal_g) || 0);
  const gov = Math.max(0, Number(bondSummary.government_principal_g) || 0);
  const player = Math.max(0, Number(bondSummary.player_principal_g) || 0);
  if (gov > active + 0.01) return roundGold(active);
  return roundGold(player > 0.01 ? player : active);
}

/** Live towny-server vault notes (custodial reserve G). */
async function readReserveVaultNotes(db: D1Database, serverId: string): Promise<number> {
  serverId = treasuryServerId(serverId);
  const system = await db
    .prepare(
      `SELECT notes_g FROM rootstat_system_account_balances
       WHERE server_id = ?
         AND (account_type = 'reserve' OR LOWER(minecraft_username) = ?)
       ORDER BY synced_at DESC
       LIMIT 1`,
    )
    .bind(serverId, TOWNY_SERVER_USERNAME)
    .first<{ notes_g: number }>();
  const systemBal = Number(system?.notes_g);
  if (Number.isFinite(systemBal) && systemBal > 0.01) return roundGold(systemBal);

  const player = await db
    .prepare(
      `SELECT balance FROM rootstat_player_balances
       WHERE server_id = ? AND LOWER(minecraft_uuid) = ? LIMIT 1`,
    )
    .bind(serverId, TOWNY_SERVER_UUID)
    .first<{ balance: number }>();
  const playerBal = Number(player?.balance);
  return Number.isFinite(playerBal) ? roundGold(Math.max(0, playerBal)) : 0;
}

function ledgerCreatedAtIso(raw: unknown): string {
  const s = str(raw).trim();
  if (!s) return "";
  const norm = s.includes("T") ? s : s.replace(" ", "T");
  if (!/Z$/i.test(norm) && !/[+-]\d{2}:?\d{2}$/.test(norm)) return norm + "Z";
  return norm;
}

/** HST calendar day key (`YYYY-MM-DD`) for a ledger timestamp. */
function ledgerHstDayKey(createdAt: string): string {
  const iso = ledgerCreatedAtIso(createdAt);
  if (!iso) return "";
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return "";
  const hst = new Date(at.getTime() - HST_OFFSET_MS);
  const y = hst.getUTCFullYear();
  const m = String(hst.getUTCMonth() + 1).padStart(2, "0");
  const d = String(hst.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** HST hour bucket key (`YYYY-MM-DD HH:00`) for a ledger timestamp. */
function ledgerHstHourKey(createdAt: string): string {
  const iso = ledgerCreatedAtIso(createdAt);
  if (!iso) return "";
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return "";
  const hst = new Date(at.getTime() - HST_OFFSET_MS);
  const y = hst.getUTCFullYear();
  const m = String(hst.getUTCMonth() + 1).padStart(2, "0");
  const d = String(hst.getUTCDate()).padStart(2, "0");
  const h = String(hst.getUTCHours()).padStart(2, "0");
  return `${y}-${m}-${d} ${h}:00`;
}

function hstHourFloor(at = new Date()): Date {
  const hstMs = at.getTime() - HST_OFFSET_MS;
  const floored = Math.floor(hstMs / 3600000) * 3600000;
  return new Date(floored + HST_OFFSET_MS);
}

function buildLastNHstHourSlots(n: number, at = new Date()): string[] {
  const end = hstHourFloor(at);
  const slots: string[] = [];
  for (let i = n - 1; i >= 0; i--) {
    slots.push(ledgerHstHourKey(new Date(end.getTime() - i * 3600000).toISOString()));
  }
  return slots;
}

function hstHourStartIso(hourKey: string): string {
  const key = str(hourKey).trim();
  if (!key) return "";
  const [date, time] = key.split(" ");
  if (!date || !time) return "";
  const ms = Date.parse(`${date}T${time}:00-10:00`);
  if (Number.isNaN(ms)) return "";
  return new Date(ms).toISOString();
}

function hstDayStartIso(dayKey: string): string {
  const ms = Date.parse(`${dayKey}T00:00:00-10:00`);
  if (Number.isNaN(ms)) return "";
  return new Date(ms).toISOString();
}

function addHstDays(dayKey: string, delta: number): string {
  const ms = Date.parse(`${dayKey}T12:00:00-10:00`) + delta * 86400000;
  return ledgerHstDayKey(new Date(ms).toISOString());
}

/** Ledger rows on or after the Paper 26.2 HST midnight boundary (July 2026+). */
function postResetLedgerSqlBound(): string {
  return sqlLedgerBound(hstDayStartIso(`${POST_RESET_LEDGER_HST_MONTH}-01`));
}

/** NOTE_BURN from towny-server (debt payoff, opening carryover) debits Reserve Gold; player/tax burns do not. */
function isNoteBurnReserveOutflow(
  type: string,
  fromUuid: string | null | undefined,
  details: string | null | undefined,
): boolean {
  if (str(type).toUpperCase() !== "NOTE_BURN") return false;
  const from = normalizeUuid(fromUuid);
  if (from && from.toLowerCase() === TOWNY_SERVER_UUID) return true;
  const d = str(details).toLowerCase();
  return d.startsWith("debt_repayment:") || d.startsWith("opening:");
}

function reserveLedgerDelta(
  type: string,
  amount: number,
  fromUuid?: string | null,
  details?: string | null,
): number {
  const t = str(type).toUpperCase();
  const amt = roundGold(Number(amount) || 0);
  if (amt <= 0 || !t) return 0;
  if (isInflowType(t)) return amt;
  if (isOutflowType(t)) return -amt;
  if (isNoteBurnReserveOutflow(t, fromUuid, details)) return -amt;
  return 0;
}

/** Matches {@link ledgerTotalsBetween} net - used for reserve balance charts (no NOTE_BURN reserve debits). */
function reserveChartLedgerDelta(type: string, amount: number): number {
  const t = str(type).toUpperCase();
  const amt = roundGold(Number(amount) || 0);
  if (amt <= 0 || !t) return 0;
  if (isInflowType(t)) return amt;
  if (isOutflowType(t)) return -amt;
  return 0;
}

/** Post-reset chart balance - ledger net only (matches public headline `balance`). */
function reserveBalanceFromLedgerNet(ledgerNet: number): number {
  return roundGold(ledgerNet);
}

/** Daily net buckets using the same inflow/outflow rules as {@link ledgerTotalsBetween}. */
async function ledgerDailyNetBucketsSql(
  db: D1Database,
  serverId: string,
  startIso: string | null,
): Promise<Map<string, number>> {
  serverId = treasuryServerId(serverId);
  let sql = `SELECT strftime('%Y-%m-%d', datetime(created_at, '-10 hours')) AS day,
                    entry_type, COALESCE(SUM(amount), 0) AS total
             FROM rootmc_treasury_ledger
             WHERE server_id = ?`;
  const binds: (string | number)[] = [serverId];
  if (startIso) {
    sql += ` AND ${LEDGER_CREATED_AT_NORM} >= ?`;
    binds.push(sqlLedgerBound(startIso));
  }
  sql += " GROUP BY day, entry_type ORDER BY day ASC";
  const { results } = await db
    .prepare(sql)
    .bind(...binds)
    .all<{ day: string; entry_type: string; total: number }>();

  const map = new Map<string, number>();
  for (const row of results ?? []) {
    const day = str(row.day);
    const delta = reserveChartLedgerDelta(row.entry_type, row.total);
    if (!day || delta === 0) continue;
    map.set(day, roundGold((map.get(day) || 0) + delta));
  }
  return map;
}

/** Hourly net buckets using the same inflow/outflow rules as {@link ledgerTotalsBetween}. */
async function ledgerHourlyNetBucketsSql(
  db: D1Database,
  serverId: string,
  startIso: string,
): Promise<Map<string, number>> {
  serverId = treasuryServerId(serverId);
  const start = str(startIso);
  if (!start) return new Map();
  const { results } = await db
    .prepare(
      `SELECT strftime('%Y-%m-%d %H', datetime(created_at, '-10 hours')) || ':00' AS hour_key,
              entry_type, COALESCE(SUM(amount), 0) AS total
       FROM rootmc_treasury_ledger
       WHERE server_id = ? AND ${LEDGER_CREATED_AT_NORM} >= ?
       GROUP BY hour_key, entry_type
       ORDER BY hour_key ASC`,
    )
    .bind(serverId, sqlLedgerBound(start))
    .all<{ hour_key: string; entry_type: string; total: number }>();

  const map = new Map<string, number>();
  for (const row of results ?? []) {
    const hour = str(row.hour_key);
    const delta = reserveChartLedgerDelta(row.entry_type, row.total);
    if (!hour || delta === 0) continue;
    map.set(hour, roundGold((map.get(hour) || 0) + delta));
  }
  return map;
}

/** One balance per HST hour for the last N hours (24 points for the Hours chart). */
async function balanceHourlySeries(
  db: D1Database,
  serverId: string,
  hours = 24,
): Promise<{ hour: string; balance: number }[]> {
  const slots = buildLastNHstHourSlots(Math.max(1, hours));
  if (!slots.length) return [];
  const firstHourStart = hstHourStartIso(slots[0]);
  if (!firstHourStart) return [];
  const [openingTotals, hourNet] = await Promise.all([
    ledgerTotalsBetween(db, serverId, null, firstHourStart),
    ledgerHourlyNetBucketsSql(db, serverId, firstHourStart),
  ]);
  let running = reserveBalanceFromLedgerNet(openingTotals.net);
  return slots.map((hour) => {
    running = roundGold(running + (hourNet.get(hour) || 0));
    return { hour, balance: running };
  });
}

function applyReserveLedgerRow(
  type: string,
  amount: number,
  running: number,
  fromUuid?: string | null,
  details?: string | null,
): number {
  const delta = reserveLedgerDelta(type, amount, fromUuid, details);
  if (delta === 0) return running;
  return roundGold(running + delta);
}

async function holderSupplyDailySeries(
  db: D1Database,
  serverId: string,
  balanceDaily: { day: string; balance: number }[],
  mysqlConn?: Connection,
  mysqlPrefix?: string,
): Promise<HolderSupplyDailyRow[]> {
  if (!balanceDaily.length) return [];
  const startDay = balanceDaily[0].day;
  const [measuredByDay, liveWallet, physicalSummary] = await Promise.all([
    loadMeasuredHolderSupplyForRange(db, serverId, startDay),
    readPlayerWalletNotesTotal(db, serverId),
    physicalGoldSummaryForServer(db, serverId, mysqlConn, mysqlPrefix),
  ]);
  const todayKey = ledgerHstDayKey(new Date().toISOString());
  if (todayKey) {
    measuredByDay.set(todayKey, {
      player_notes_g: liveWallet,
      physical_gold_g: roundGold(physicalSummary.total_storage_g),
    });
  }
  return buildHolderSupplyDailySeries(balanceDaily, measuredByDay);
}

async function ledgerBalanceHistory(
  db: D1Database,
  serverId: string,
): Promise<{ recorded_at: string; balance: number }[]> {
  const byDay = await ledgerRunningBalanceByDay(db, serverId);
  const openingDay = `${POST_RESET_LEDGER_HST_MONTH}-01`;
  const points: { recorded_at: string; balance: number }[] = [];
  for (const day of [...byDay.keys()].sort()) {
    if (day < openingDay) continue;
    const balance = byDay.get(day);
    if (!Number.isFinite(balance)) continue;
    const recorded_at = hstDayStartIso(day);
    if (!recorded_at) continue;
    points.push({ recorded_at, balance: roundGold(balance) });
  }
  return points;
}

/** @deprecated Vault snapshots - kept for ops; charts use ledgerBalanceHistory. */
async function vaultBalanceSnapshots(
  db: D1Database,
  serverId: string,
  limit = 500,
): Promise<{ recorded_at: string; balance: number }[]> {
  const { results } = await db
    .prepare(
      `SELECT balance, recorded_at
       FROM rootmc_treasury_balance_snapshots
       WHERE server_id = ?
       ORDER BY recorded_at DESC
       LIMIT ?`,
    )
    .bind(serverId, Math.min(5000, Math.max(10, limit)))
    .all<{ balance: number; recorded_at: string }>();
  return (results ?? [])
    .slice()
    .reverse()
    .map((row) => ({
      balance: roundGold(Number(row.balance) || 0),
      recorded_at: str(row.recorded_at),
    }));
}

async function ledgerRunningBalanceByDay(
  db: D1Database,
  serverId: string,
): Promise<Map<string, number>> {
  const dayNet = await ledgerDailyNetBucketsSql(db, serverId, null);
  const openingDay = `${POST_RESET_LEDGER_HST_MONTH}-01`;
  const todayHst = ledgerHstDayKey(new Date().toISOString());

  let ledgerNet = 0;
  for (const day of [...dayNet.keys()].sort()) {
    if (day >= openingDay) break;
    ledgerNet = roundGold(ledgerNet + dayNet.get(day)!);
  }

  const byDay = new Map<string, number>();
  let cursor = openingDay;
  while (cursor <= todayHst) {
    if (dayNet.has(cursor)) ledgerNet = roundGold(ledgerNet + dayNet.get(cursor)!);
    byDay.set(cursor, reserveBalanceFromLedgerNet(ledgerNet));
    cursor = addHstDays(cursor, 1);
  }
  return byDay;
}

/** One balance per HST day from ledger running total (carry-forward between active days). */
async function balanceDailySeries(
  db: D1Database,
  serverId: string,
  days = 90,
): Promise<{ day: string; balance: number }[]> {
  const ledgerByDay = await ledgerRunningBalanceByDay(db, serverId);
  if (!ledgerByDay.size) return [];

  const todayHst = ledgerHstDayKey(new Date().toISOString());
  const sinceHst = addHstDays(todayHst, -(Math.max(1, days) - 1));
  const openingDay = `${POST_RESET_LEDGER_HST_MONTH}-01`;
  const startDay = sinceHst < openingDay ? openingDay : sinceHst;

  const out: { day: string; balance: number }[] = [];
  let cursor = startDay;
  while (cursor <= todayHst) {
    const balance = ledgerByDay.get(cursor);
    if (balance != null) out.push({ day: cursor, balance });
    cursor = addHstDays(cursor, 1);
  }
  return out;
}

/** Prepend audited June 2026 reserve path so live charts show the full journey through the map reset. */
function rebuildJulyJourneyPoints(
  july: { day: string; balance: number }[],
): { day: string; balance: number }[] {
  if (!july.length) return [];
  const opening = 0;
  const end = roundGold(july[july.length - 1].balance);
  if (july.length === 1) return [{ day: july[0].day, balance: end }];
  const steps = july.length - 1;
  const out: { day: string; balance: number }[] = [];
  for (let i = 0; i < july.length; i++) {
    const t = i / steps;
    out.push({
      day: july[i].day,
      balance: roundGold(i === 0 ? opening : opening + (end - opening) * t),
    });
  }
  out[out.length - 1].balance = end;
  return out;
}

function mergeFullJourneyBalanceDaily(
  postResetDaily: { day: string; balance: number }[],
): { day: string; balance: number }[] {
  const julyStart = `${POST_RESET_LEDGER_HST_MONTH}-01`;
  const june = LOCKED_JUNE_2026_RESERVE.balance_daily.map((row) => ({
    day: row.day,
    balance: roundGold(row.balance),
  }));
  const july = rebuildJulyJourneyPoints(
    postResetDaily.filter((row) => str(row.day) >= julyStart),
  );
  return [...june, ...july];
}

function mergeFullJourneyBalanceHistory(
  postResetHistory: { recorded_at: string; balance: number }[],
): { recorded_at: string; balance: number }[] {
  const julyStart = `${POST_RESET_LEDGER_HST_MONTH}-01`;
  const byDay = new Map<string, number>();
  for (const row of postResetHistory) {
    const day = ledgerHstDayKey(row.recorded_at);
    if (!day || day < julyStart) continue;
    byDay.set(day, roundGold(row.balance));
  }
  const postResetDaily = [...byDay.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([day, balance]) => ({ day, balance }));
  return mergeFullJourneyBalanceDaily(postResetDaily).map((row) => ({
    recorded_at: hstDayStartIso(row.day),
    balance: row.balance,
  }));
}

async function dailyFlowBuckets(
  db: D1Database,
  serverId: string,
  days: number,
): Promise<
  {
    day: string;
    inflow: number;
    outflow: number;
    net: number;
    closed_loop: number;
    by_type: Record<string, number>;
  }[]
> {
  const since = new Date(Date.now() - days * 86400000).toISOString();
  const { results } = await db
    .prepare(
      `SELECT strftime('%Y-%m-%d', datetime(created_at, '-10 hours')) AS day,
              entry_type, from_uuid, details, COALESCE(SUM(amount), 0) AS total
       FROM rootmc_treasury_ledger
       WHERE server_id = ? AND ${LEDGER_CREATED_AT_NORM} >= replace(substr(?, 1, 19), 'T', ' ')
       GROUP BY day, entry_type, from_uuid, details
       ORDER BY day ASC`,
    )
    .bind(serverId, since)
    .all<{
      day: string;
      entry_type: string;
      from_uuid: string | null;
      details: string | null;
      total: number;
    }>();
  const map = new Map<
    string,
    { inflow: number; outflow: number; closed_loop: number; by_type: Record<string, number> }
  >();
  for (const row of results ?? []) {
    const day = str(row.day);
    const type = str(row.entry_type).toUpperCase();
    const total = roundGold(Number(row.total) || 0);
    if (!day || !type || total <= 0) continue;
    const bucket = map.get(day) ?? { inflow: 0, outflow: 0, closed_loop: 0, by_type: {} };
    bucket.by_type[type] = roundGold((bucket.by_type[type] || 0) + total);
    if (isInflowType(type)) bucket.inflow += total;
    else if (isOutflowType(type) || isNoteBurnReserveOutflow(type, row.from_uuid, row.details)) {
      bucket.outflow += total;
    }
    map.set(day, bucket);
  }
  return [...map.entries()].map(([day, bucket]) => ({
    day,
    inflow: roundGold(bucket.inflow),
    outflow: roundGold(bucket.outflow),
    net: roundGold(bucket.inflow - bucket.outflow),
    closed_loop: roundGold(bucket.closed_loop),
    by_type: bucket.by_type,
  }));
}

async function balanceServerIds(db: D1Database, serverId: string): Promise<string[]> {
  const featured = await resolveServerId(db);
  return [...new Set([treasuryServerId(serverId), featured, CANONICAL_ROOTMC].filter(Boolean))];
}

export async function resolvePlayerNames(
  db: D1Database,
  serverId: string,
  uuids: string[],
): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  const unique = [...new Set(uuids.map((id) => normalizeUuid(id)).filter(Boolean))];
  if (!unique.length) return out;

  const balanceServerIdsList = await balanceServerIds(db, serverId);

  const fill = (uuid: string, username: string) => {
    const id = normalizeUuid(uuid);
    const name = str(username);
    if (id && name && !out[id]) out[id] = name;
  };

  for (let i = 0; i < unique.length; i += 40) {
    const chunk = unique.slice(i, i + 40);
    const uuidPlaceholders = chunk.map(() => "?").join(", ");
    const serverPlaceholders = balanceServerIdsList.map(() => "?").join(", ");
    const { results: balanceRows } = await db
      .prepare(
        `SELECT LOWER(minecraft_uuid) AS uuid, minecraft_username
         FROM rootstat_player_balances
         WHERE server_id IN (${serverPlaceholders})
           AND LOWER(minecraft_uuid) IN (${uuidPlaceholders})
           AND minecraft_username IS NOT NULL AND TRIM(minecraft_username) != ''`,
      )
      .bind(...balanceServerIdsList, ...chunk)
      .all<{ uuid: string; minecraft_username: string | null }>();
    for (const row of balanceRows ?? []) {
      fill(row.uuid, str(row.minecraft_username));
    }
  }

  let missing = unique.filter((id) => !out[id]);
  for (let i = 0; i < missing.length; i += 40) {
    const chunk = missing.slice(i, i + 40);
    const placeholders = chunk.map(() => "?").join(", ");
    const { results: linkRows } = await db
      .prepare(
        `SELECT LOWER(minecraft_uuid) AS uuid, minecraft_username
         FROM rootstat_minecraft_links
         WHERE LOWER(minecraft_uuid) IN (${placeholders})
           AND minecraft_username IS NOT NULL AND TRIM(minecraft_username) != ''`,
      )
      .bind(...chunk)
      .all<{ uuid: string; minecraft_username: string | null }>();
    for (const row of linkRows ?? []) {
      fill(row.uuid, str(row.minecraft_username));
    }
  }

  missing = unique.filter((id) => !out[id]);
  for (let i = 0; i < missing.length; i += 40) {
    const chunk = missing.slice(i, i + 40);
    const placeholders = chunk.map(() => "?").join(", ");
    const serverPlaceholders = balanceServerIdsList.map(() => "?").join(", ");
    const { results: playRows } = await db
      .prepare(
        `SELECT LOWER(minecraft_uuid) AS uuid, minecraft_username
         FROM rootstat_player_playtime
         WHERE server_id IN (${serverPlaceholders})
           AND LOWER(minecraft_uuid) IN (${placeholders})
           AND minecraft_username IS NOT NULL AND TRIM(minecraft_username) != ''`,
      )
      .bind(...balanceServerIdsList, ...chunk)
      .all<{ uuid: string; minecraft_username: string | null }>();
    for (const row of playRows ?? []) {
      fill(row.uuid, str(row.minecraft_username));
    }
  }

  missing = unique.filter((id) => !out[id]);
  for (let i = 0; i < missing.length; i += 40) {
    const chunk = missing.slice(i, i + 40);
    const placeholders = chunk.map(() => "?").join(", ");
    const { results: transferRows } = await db
      .prepare(
        `SELECT LOWER(to_uuid) AS uuid, to_username
         FROM rootmc_gold_transfers
         WHERE LOWER(to_uuid) IN (${placeholders})
           AND to_username IS NOT NULL AND TRIM(to_username) != ''
         ORDER BY created_at DESC`,
      )
      .bind(...chunk)
      .all<{ uuid: string; to_username: string | null }>();
    for (const row of transferRows ?? []) {
      fill(row.uuid, str(row.to_username));
    }
  }

  // Town / nation bank accounts (unclaim refunds, gov grants) — not in player tables.
  missing = unique.filter((id) => !out[id]);
  for (let i = 0; i < missing.length; i += 40) {
    const chunk = missing.slice(i, i + 40);
    const placeholders = chunk.map(() => "?").join(", ");
    const serverPlaceholders = balanceServerIdsList.map(() => "?").join(", ");
    const { results: systemRows } = await db
      .prepare(
        `SELECT LOWER(minecraft_uuid) AS uuid, minecraft_username
         FROM rootstat_system_account_balances
         WHERE server_id IN (${serverPlaceholders})
           AND LOWER(minecraft_uuid) IN (${placeholders})
           AND account_type IN ('town', 'nation')
           AND minecraft_username IS NOT NULL AND TRIM(minecraft_username) != ''`,
      )
      .bind(...balanceServerIdsList, ...chunk)
      .all<{ uuid: string; minecraft_username: string | null }>();
    for (const row of systemRows ?? []) {
      fill(row.uuid, str(row.minecraft_username));
    }
  }

  missing = unique.filter((id) => !out[id]);
  for (let i = 0; i < missing.length; i += 40) {
    const chunk = missing.slice(i, i + 40);
    const placeholders = chunk.map(() => "?").join(", ");
    const serverPlaceholders = balanceServerIdsList.map(() => "?").join(", ");
    const { results: townRows } = await db
      .prepare(
        `SELECT LOWER(town_uuid) AS uuid, town_name
         FROM rootmc_towny_towns
         WHERE server_id IN (${serverPlaceholders})
           AND LOWER(town_uuid) IN (${placeholders})
           AND town_name IS NOT NULL AND TRIM(town_name) != ''`,
      )
      .bind(...balanceServerIdsList, ...chunk)
      .all<{ uuid: string; town_name: string | null }>();
    for (const row of townRows ?? []) {
      const name = str(row.town_name);
      if (name) fill(row.uuid, `town-${name}`);
    }
  }

  missing = unique.filter((id) => !out[id]);
  for (let i = 0; i < missing.length; i += 40) {
    const chunk = missing.slice(i, i + 40);
    const placeholders = chunk.map(() => "?").join(", ");
    const serverPlaceholders = balanceServerIdsList.map(() => "?").join(", ");
    const { results: nationRows } = await db
      .prepare(
        `SELECT LOWER(nation_uuid) AS uuid, nation_name
         FROM rootmc_towny_nations
         WHERE server_id IN (${serverPlaceholders})
           AND LOWER(nation_uuid) IN (${placeholders})
           AND nation_name IS NOT NULL AND TRIM(nation_name) != ''`,
      )
      .bind(...balanceServerIdsList, ...chunk)
      .all<{ uuid: string; nation_name: string | null }>();
    for (const row of nationRows ?? []) {
      const name = str(row.nation_name);
      if (name) fill(row.uuid, `nation-${name}`);
    }
  }

  return out;
}

function displayAccount(uuid: string | null, username: string | null): string {
  if (username) {
    const u = username.trim();
    if (/^town-/i.test(u) && u.length > 5) return `Town of ${u.slice(5)}`;
    if (/^nation-/i.test(u) && u.length > 7) return `Nation of ${u.slice(7)}`;
    return u;
  }
  if (!uuid) return "-";
  if (uuid.toLowerCase() === TOWNY_SERVER_UUID) return TOWNY_SERVER_USERNAME;
  return uuid.slice(0, 8) + "...";
}

/** Town/nation auto-bond coupons store `town:Name` / `nation:Name` in details (often after `operator=`). */
function formatBondCouponRecipient(
  details: string | null,
  toUuid: string | null,
  toName: string | null,
): string {
  const d = str(details).trim();
  const gov = /(?:^|;)(town|nation):([^;]+)/i.exec(d);
  if (gov) {
    const kind = gov[1].toLowerCase() === "nation" ? "Nation" : "Town";
    const name = gov[2].trim();
    if (name) return `${kind} of ${name}`;
  }
  const account = str(toName).trim();
  if (account.toLowerCase().startsWith("town-")) {
    return `Town of ${account.slice(5)}`;
  }
  if (account.toLowerCase().startsWith("nation-")) {
    return `Nation of ${account.slice(7)}`;
  }
  return displayAccount(toUuid, toName);
}

export type TreasuryReportBrief = {
  reserve_balance: number | null;
  synced_at: string | null;
  current_hst_month: string;
  prior_hst_month: string;
  month_inflow: number;
  month_outflow: number;
  month_net: number;
  month_by_type: Record<string, number>;
  prior_month_inflow: number;
  prior_month_outflow: number;
  prior_month_net: number;
  prior_month_by_type: Record<string, number>;
  all_time_inflow: number;
  all_time_outflow: number;
  all_time_net: number;
  towny_intake_mtd: TownyIntakeTotals;
  average_monthly_net: number;
};

/** Compact reserve snapshot for daily/economy Discord intelligence (no raw history arrays). */
export async function treasuryBriefForReports(
  db: D1Database,
  serverId: string,
): Promise<TreasuryReportBrief> {
  serverId = treasuryServerId(serverId);
  const currentMonth = currentHstMonthKey();
  const priorMonth = previousHstMonthKey();
  const { start: monthStart, end: monthEnd } = monthBoundsIso(currentMonth);
  const { start: priorStart, end: priorEnd } = monthBoundsIso(priorMonth);

  const [month, priorMonthTotals, allTime, avgMonthlyNet, townyMtd, syncRow] =
    await Promise.all([
      ledgerTotalsBetween(db, serverId, monthStart, monthEnd),
      ledgerTotalsBetween(db, serverId, priorStart, priorEnd),
      ledgerTotalsBetween(db, serverId, null, null),
      averageMonthlyNetPool(db, serverId),
      townyIntakeBetween(db, serverId, monthStart, monthEnd),
      db
        .prepare(`SELECT updated_at FROM rootmc_treasury_sync_state WHERE server_id = ? LIMIT 1`)
        .bind(serverId)
        .first<{ updated_at: string }>(),
    ]);

  const ledgerImplied = roundGold(MAP_262_TRUE_RESERVE_OPENING + allTime.net);

  return {
    reserve_balance: ledgerImplied,
    synced_at: str(syncRow?.updated_at) || null,
    current_hst_month: currentMonth,
    prior_hst_month: priorMonth,
    month_inflow: month.inflow,
    month_outflow: month.outflow,
    month_net: month.net,
    month_by_type: month.by_type,
    prior_month_inflow: priorMonthTotals.inflow,
    prior_month_outflow: priorMonthTotals.outflow,
    prior_month_net: priorMonthTotals.net,
    prior_month_by_type: priorMonthTotals.by_type,
    all_time_inflow: allTime.inflow,
    all_time_outflow: allTime.outflow,
    all_time_net: allTime.net,
    towny_intake_mtd: townyMtd,
    average_monthly_net: avgMonthlyNet,
  };
}

function filterDailyInViewMonth<T extends { day: string }>(rows: T[], viewMonth: string): T[] {
  const prefix = `${viewMonth}-`;
  return rows.filter((row) => str(row.day).startsWith(prefix));
}

function filterHistoryBefore(isoEnd: string, history: { recorded_at: string; balance: number }[]) {
  const end = str(isoEnd);
  if (!end) return history;
  return history.filter((row) => str(row.recorded_at) < end);
}

export async function treasuryReservePublicSummary(
  db: D1Database,
  serverId: string,
  options?: {
    viewMonthKey?: string | null;
    mysqlConn?: Connection;
    mysqlPrefix?: string;
  },
): Promise<Record<string, unknown>> {
  serverId = treasuryServerId(serverId);
  const liveMonth = currentHstMonthKey();
  const requestedMonth = parseMonthKeyParam(options?.viewMonthKey);
  const viewMonth = requestedMonth && requestedMonth >= POST_RESET_LEDGER_HST_MONTH
    ? requestedMonth
    : liveMonth;
  const priorMonth = monthKeyBefore(viewMonth);
  const { start: monthStart, end: monthEnd } = monthBoundsIso(viewMonth);
  const { start: priorStart, end: priorEnd } = monthBoundsIso(priorMonth);
  const viewingHistoricalMonth = viewMonth !== liveMonth;
  const cumulativeEnd = viewingHistoricalMonth ? monthEnd : null;
  const useLockedJuneView = viewMonth === LOCKED_JUNE_2026_HST;

  const [month, priorMonthTotals, allTime, avgMonthlyNet, historyRaw, balanceDailyRaw, flowDailyRaw, townyMtd, townyPrior, townyAll, availableMonths, liveGoldMinted, goldFoundSummary, goldFoundSyncedAt, physicalGoldSummary, physicalGoldLeaderboard, liveTreasuryBalance] =
    await Promise.all([
      resolveLedgerMonthTotals(db, serverId, viewMonth),
      resolveLedgerMonthTotals(db, serverId, priorMonth),
      useLockedJuneView
        ? Promise.resolve({ ...LOCKED_JUNE_2026_RESERVE.all_time })
        : ledgerTotalsBetween(db, serverId, null, cumulativeEnd),
      useLockedJuneView
        ? Promise.resolve(LOCKED_JUNE_2026_RESERVE.average_monthly_net)
        : averageMonthlyNetPool(db, serverId),
      ledgerBalanceHistory(db, serverId),
      balanceDailySeries(db, serverId, 90),
      dailyFlowBuckets(db, serverId, 90),
      resolveTownyIntakeForMonth(db, serverId, viewMonth),
      resolveTownyIntakeForMonth(db, serverId, priorMonth),
      useLockedJuneView
        ? Promise.resolve({ ...LOCKED_JUNE_2026_RESERVE.towny_intake })
        : townyIntakeBetween(db, serverId, null, cumulativeEnd),
      listLedgerMonthKeys(db, serverId),
      readGoldMintedBreakdown(db, serverId),
      goldFoundSummaryForServer(db, serverId),
      latestGoldFoundSyncedAt(db, serverId),
      physicalGoldSummaryForServer(db, serverId, options?.mysqlConn, options?.mysqlPrefix),
      physicalGoldLeaderboardForServer(db, serverId, 10, options?.mysqlConn, options?.mysqlPrefix),
      readTreasuryBalance(db, serverId),
    ]);

  const goldMinted = goldMintedBreakdownForViewMonth(viewMonth, liveGoldMinted);

  const history = viewingHistoricalMonth
    ? filterHistoryBefore(monthEnd, historyRaw)
    : historyRaw;
  const balanceDaily = useLockedJuneView
    ? LOCKED_JUNE_2026_RESERVE.balance_daily
    : viewingHistoricalMonth
      ? filterDailyInViewMonth(balanceDailyRaw, viewMonth)
      : balanceDailyRaw;
  const holderSupplyDaily =
    !useLockedJuneView && balanceDaily.length
      ? await holderSupplyDailySeries(
          db,
          serverId,
          balanceDaily,
          options?.mysqlConn,
          options?.mysqlPrefix,
        )
      : [];
  const flowDaily = useLockedJuneView
    ? LOCKED_JUNE_2026_RESERVE.flow_daily
    : viewingHistoricalMonth
      ? filterDailyInViewMonth(flowDailyRaw, viewMonth)
      : flowDailyRaw;

  const map262Merge = map262MergeForViewMonth(viewMonth, allTime.net);
  const postResetView = !useLockedJuneView && !isPreResetLedgerMonth(viewMonth);
  const overIssueShortfallRepaidG = postResetView
    ? await readLedgerOverIssueShortfallRepaid(db, serverId)
    : 0;
  const grossReserveBalance = useLockedJuneView
    ? LOCKED_JUNE_2026_RESERVE.balance_end
    : roundGold(allTime.net);
  const vaultBalance = useLockedJuneView
    ? grossReserveBalance
    : roundGold(Math.max(0, grossReserveBalance));
  const priorMonthEndBalance = roundGold(allTime.net - month.net);

  const notesRetiredDonationG = postResetView ? await readLedgerDonationBurns(db, serverId) : 0;
  const notesRetiredG = postResetView ? await readLedgerNoteBurnRetired(db, serverId) : 0;
  const taxMiscreditedG = postResetView ? await readLedgerTaxMiscredited(db, serverId) : 0;
  const goldFoundLeaderboard = postResetView
    ? await goldFoundLeaderboardForServer(db, serverId, 15, "since_july")
    : [];
  const [noteSupply, circulating, bondSummary, reserveVaultBalance] = postResetView
    ? await Promise.all([
        readPostResetNoteSupplySnapshot(db, serverId),
        circulatingBalancesReport(db, serverId),
        readBondsSummary(db, serverId),
        readReserveVaultNotes(db, serverId),
      ])
    : [null, null, null, null];
  const payableSupply: PayableSupplySnapshot | null =
    postResetView && noteSupply && circulating && bondSummary
      ? computePayableSupply({
          playerWalletG: circulating.totals.player_notes_g,
          townBankG: circulating.totals.town_notes_g,
          nationBankG: circulating.totals.nation_notes_g,
          personalBondPrincipalG: personalBondPrincipalForPayable(bondSummary),
          mintBackingG: noteSupply.gold_mined_g,
          reserveVaultG: reserveVaultBalance,
        })
      : null;
  /**
   * Headline Server Reserve = post-reset ledger (matches balance charts).
   * Mint residual after private claims stays on payable_supply.reserve_managed_g
   * (shown separately as Private-claim shortfall).
   */
  const balance = grossReserveBalance;
  const supplyIntegrity = postResetView
    ? computeSupplyIntegrity({
        currentReserveBalance: balance,
        julyLedgerNet: allTime.net,
        goldMinedMintSinceJuly: goldMinted.post_reset_ledger_mint,
        reserveDonationsSinceJuly: notesRetiredDonationG,
        goldFoundTotalSinceJuly: goldFoundSummary.mined_since_july_g,
        goldFoundPhysicalSinceJuly: goldFoundSummary.physical_mined_since_july_g,
        physicalGoldInStorageG: physicalGoldSummary.total_storage_g,
        julyOpening: 0,
        noteSupply,
      })
    : null;

  const syncRow = await db
    .prepare(`SELECT updated_at FROM rootmc_treasury_sync_state WHERE server_id = ? LIMIT 1`)
    .bind(serverId)
    .first<{ updated_at: string }>();

  const balancePctVsPrior =
    Math.abs(priorMonthEndBalance) > 0.01
      ? pctVsPrior(grossReserveBalance, priorMonthEndBalance)
      : null;
  const ledgerNetAtMonthStart = priorMonthEndBalance;
  const allTimeMonthContributionPct =
    viewingHistoricalMonth && ledgerNetAtMonthStart > 0.01
      ? pctVsPrior(month.net, ledgerNetAtMonthStart)
      : null;

  // MTD vs full prior month is misleading on the live month (e.g. July day 1 vs all of June).
  const mtdCompare = viewingHistoricalMonth;
  const mtdInflowPct = mtdCompare ? pctVsPrior(month.inflow, priorMonthTotals.inflow) : null;
  const mtdOutflowPct = mtdCompare ? pctVsPrior(month.outflow, priorMonthTotals.outflow) : null;
  const mtdNetPct = mtdCompare ? pctVsPrior(month.net, priorMonthTotals.net) : null;
  const avgMonthlyNetPct = mtdCompare ? pctVsPrior(month.net, avgMonthlyNet) : null;

  const [executiveTransactions24h, balanceHourly] = await Promise.all([
    postResetView
      ? executiveTransactionsSince(db, serverId, 24)
      : Promise.resolve({ since_iso: null, hours: 24, count: 0, net: 0, entries: [] }),
    postResetView && !viewingHistoricalMonth
      ? balanceHourlySeries(db, serverId, 24)
      : Promise.resolve([] as { hour: string; balance: number }[]),
  ]);

  return {
    server_id: serverId,
    synced_at: str(syncRow?.updated_at) || null,
    balance,
    vault_balance:
      liveTreasuryBalance != null
        ? liveTreasuryBalance
        : reserveVaultBalance != null
          ? reserveVaultBalance
          : vaultBalance,
    current_hst_month: liveMonth,
    view_hst_month: viewMonth,
    prior_hst_month: priorMonth,
    viewing_historical_month: viewingHistoricalMonth,
    balance_as_of: viewingHistoricalMonth
      ? "month_end"
      : "ledger_all_time",
    locked_hst_baseline: useLockedJuneView ? LOCKED_JUNE_2026_HST : null,
    post_reset_metrics_from_hst_month: POST_RESET_LEDGER_HST_MONTH,
    available_months: availableMonths,
    month_label: viewMonth,
    month,
    prior_month: priorMonthTotals,
    all_time: allTime,
    average_monthly_net: avgMonthlyNet,
    total_gold_mined: goldMinted.total_gold_mined,
    total_gold_minted: goldMinted.total_gold_minted,
    gold_minted_post_reset_ledger: goldMinted.post_reset_ledger_mint,
    gold_mined_post_reset: goldMinted.post_reset_ledger_mint,
    gold_minted_loan_repayments_all_time: goldMinted.loan_repayments_all_time,
    gold_minted_wallet_gold: goldMinted.wallet_gold,
    gold_minted_pre_july_262_baseline: 0,
    gold_minted_reserve_adjustment: 0,
    map_262_reset_date_hst: null,
    map_262_reset_instant_hst: null,
    map_262_pre_reset_reserve_balance: 0,
    map_262_june_dividend_returned: 0,
    map_262_true_reserve_opening: 0,
    map_262_post_reset_ledger_net: allTime.net,
    map_262_gross_reserve_balance: grossReserveBalance,
    map_262_true_reserve_balance: balance,
    gold_found_summary: postResetView ? goldFoundSummary : null,
    gold_found_synced_at: postResetView ? goldFoundSyncedAt : null,
    gold_found_leaderboard_since_july: postResetView ? goldFoundLeaderboard : [],
    physical_gold_storage_summary: postResetView ? physicalGoldSummary : null,
    physical_gold_storage_leaderboard: postResetView ? physicalGoldLeaderboard : [],
    supply_integrity: supplyIntegrity,
    note_supply: noteSupply,
    payable_supply: payableSupply,
    notes_retired_donation_g: postResetView ? notesRetiredDonationG : null,
    executive_transactions_24h: executiveTransactions24h,
    balance_history: history,
    balance_hourly: balanceHourly,
    balance_daily: balanceDaily,
    holder_supply_daily: holderSupplyDaily,
    flow_daily: flowDaily,
    towny_intake_mtd: townyMtd,
    towny_intake_prior_month: townyPrior,
    towny_intake_all_time: townyAll,
    towny_intake_glossary: TOWNY_INTAKE_GLOSSARY,
    changes_vs_prior_month: {
      label: viewingHistoricalMonth
        ? `${viewMonth} vs ${priorMonth} (full month)`
        : `MTD vs ${priorMonth} (full month)`,
      balance_pct: balancePctVsPrior,
      prior_month_end_balance: priorMonthEndBalance,
      mtd_inflow_pct: mtdInflowPct,
      mtd_outflow_pct: mtdOutflowPct,
      mtd_net_pct: mtdNetPct,
      all_time_month_contribution_pct: allTimeMonthContributionPct,
      average_monthly_net_pct: avgMonthlyNetPct,
      towny: townyPctVsPrior(townyMtd, townyPrior),
      by_type: pctByTypeMap(month.by_type, priorMonthTotals.by_type),
    },
    month_bounds: { start: monthStart, end: monthEnd },
    type_glossary: TREASURY_TYPE_GLOSSARY,
    scope_note:
      "July 1+ data only: /mint backing vs Notes in player wallets + Reserve Gold (towny-server vault). /pay reserve credits Reserve (DONATION); /mint gold burns Notes (NOTE_BURN).",
  };
}

export async function treasuryLedgerPublicPage(
  db: D1Database,
  serverId: string,
  opts: {
    limit?: number;
    offset?: number;
    type?: string;
    direction?: string;
    beforeId?: number;
    startIso?: string;
    endIso?: string;
    executive?: boolean;
  },
): Promise<Record<string, unknown>> {
  serverId = treasuryServerId(serverId);
  const limit = Math.min(100, Math.max(1, Math.floor(Number(opts.limit) || 50)));
  const offset = Math.max(0, Math.floor(Number(opts.offset) || 0));
  const typeFilter = str(opts.type).toUpperCase();
  const direction = str(opts.direction).toLowerCase();
  const beforeId = Math.floor(Number(opts.beforeId) || 0);
  const executiveOnly = opts.executive === true;
  let startIso = str(opts.startIso);
  const endIso = str(opts.endIso);
  if (executiveOnly && !startIso) {
    startIso = new Date(Date.now() - 24 * 3600000).toISOString();
  }

  const where: string[] = ["server_id = ?"];
  const binds: (string | number)[] = [serverId];
  if (executiveOnly) {
    where.push(EXECUTIVE_LEDGER_SQL);
  }
  if (typeFilter) {
    if (typeFilter === "MINT_REDEEM") {
      where.push(
        "((entry_type = 'NOTE_BURN' AND (details LIKE 'mint:redeem=%' OR details LIKE 'correction:tax_reclass:mint:redeem=%'))"
          + " OR (entry_type = 'TAX' AND (details LIKE 'mint:redeem=%' OR details LIKE 'correction:tax_reclass:mint:redeem=%')))",
      );
    } else if (typeFilter === "MINT_GROSS") {
      where.push("(entry_type = 'TAX' AND (details LIKE 'mint:gross=%' OR details LIKE 'correction:tax_reclass:mint:gross=%'))");
    } else {
      where.push("entry_type = ?");
      binds.push(typeFilter);
    }
  } else if (direction === "inflow") {
    where.push(`entry_type IN (${INFLOW_TYPES.map(() => "?").join(",")})`);
    binds.push(...INFLOW_TYPES);
  } else if (direction === "outflow") {
    where.push(
      `(entry_type IN (${OUTFLOW_TYPES.map(() => "?").join(",")}) OR (entry_type = 'NOTE_BURN' AND (LOWER(from_uuid) = ? OR LOWER(details) LIKE 'debt_repayment:%' OR LOWER(details) LIKE 'opening:%')))`,
    );
    binds.push(...OUTFLOW_TYPES, TOWNY_SERVER_UUID);
  }
  if (beforeId > 0) {
    where.push("mysql_id < ?");
    binds.push(beforeId);
  }
  if (startIso) {
    where.push(`${LEDGER_CREATED_AT_NORM} >= ?`);
    binds.push(sqlLedgerBound(startIso));
  }
  if (endIso) {
    where.push(`${LEDGER_CREATED_AT_NORM} < ?`);
    binds.push(sqlLedgerBound(endIso));
  }

  const whereSql = where.join(" AND ");
  const countRow = await db
    .prepare(`SELECT COUNT(*) AS total FROM rootmc_treasury_ledger WHERE ${whereSql}`)
    .bind(...binds)
    .first<{ total: number }>();

  const { results } = await db
    .prepare(
      `SELECT mysql_id, entry_type, amount, from_uuid, to_uuid, details, created_at, synced_at
       FROM rootmc_treasury_ledger
       WHERE ${whereSql}
       ORDER BY mysql_id DESC
       LIMIT ? OFFSET ?`,
    )
    .bind(...binds, limit, offset)
    .all<Record<string, unknown>>();

  const rows = results ?? [];
  const nameUuids: string[] = [];
  for (const row of rows) {
    const from = normalizeUuid(row.from_uuid);
    const to = normalizeUuid(row.to_uuid);
    if (from) nameUuids.push(from);
    if (to) nameUuids.push(to);
    if (executiveOnly) {
      const op = parseOperatorUuid(str(row.details) || null);
      if (op) nameUuids.push(op);
    }
  }
  const names = await resolvePlayerNames(db, serverId, nameUuids);

  let entries = collapseClosedLoopLedgerRows(
    rows.map((row) => {
      const details = str(row.details) || null;
      const entryType = normalizeBondLedgerType(str(row.entry_type).toUpperCase(), details);
      const fromUuid = normalizeUuid(row.from_uuid) || null;
      const toUuid = normalizeUuid(row.to_uuid) || null;
      const fromName = fromUuid ? names[fromUuid] ?? null : null;
      const toName = toUuid ? names[toUuid] ?? null : null;
      const rawAmount = roundGold(Number(row.amount) || 0);
      const mintDisplay = ledgerMintDisplayEntry(details);
      const displayAmount = ledgerRowDisplayAmount(rawAmount, details);
      const bondPhysicalOut =
        entryType === "BOND_REDEEM" || (entryType === "BOND_COUPON" && isBondPhysicalPayout(details));
      const direction = mintDisplay
        ? mintDisplay.direction
        : isInflowType(entryType)
          ? "inflow"
          : isOutflowType(entryType) || isNoteBurnReserveOutflow(entryType, fromUuid, details)
            ? "outflow"
            : "other";
      return {
        mysql_id: Math.floor(Number(row.mysql_id) || 0),
        entry_type: mintDisplay ? mintDisplay.displayType : entryType,
        type_label: labelForLedgerEntry(entryType, details, displayAmount),
        direction,
        amount: displayAmount,
        from_uuid: fromUuid,
        to_uuid: toUuid,
        from_display: displayAccount(fromUuid, fromName),
        to_display: bondPhysicalOut
          ? "Physical gold"
          : entryType === "BOND_COUPON"
            ? formatBondCouponRecipient(details, toUuid, toName)
            : mintDisplay
              ? mintDisplay.toDisplay
              : displayAccount(toUuid, toName),
        details,
        created_at: str(row.created_at),
        synced_at: str(row.synced_at) || null,
        fee_kind: bondPhysicalOut ? "bond_physical" : null,
      };
    }),
  );

  if (executiveOnly) {
    entries = entries
      .filter((entry) => isExecutiveLedgerDetails(entry.details, entry.entry_type))
      .map((entry) => enrichExecutiveLedgerEntry(entry, names));
  }

  return {
    server_id: serverId,
    total: executiveOnly ? entries.length : Math.floor(Number(countRow?.total) || 0),
    limit,
    offset,
    start_iso: startIso || null,
    end_iso: endIso || null,
    executive_only: executiveOnly,
    entries,
  };
}

async function executiveTransactionsSince(
  db: D1Database,
  serverId: string,
  hours = 24,
): Promise<Record<string, unknown>> {
  const sinceIso = new Date(Date.now() - hours * 3600000).toISOString();
  const page = await treasuryLedgerPublicPage(db, serverId, {
    limit: 200,
    offset: 0,
    startIso: sinceIso,
    executive: true,
  });
  const entries = ((page.entries as TreasuryLedgerEntry[]) || []).filter((row) =>
    isExecutiveLedgerDetails(row.details, row.entry_type),
  );
  let net = 0;
  for (const row of entries) {
    if (row.direction === "inflow") net += row.amount;
    else if (row.direction === "outflow") net -= row.amount;
  }
  return {
    since_iso: sinceIso,
    hours,
    count: entries.length,
    net: roundGold(net),
    entries,
  };
}

async function monthNetAmount(db: D1Database, serverId: string, monthKey: string): Promise<number> {
  const { start, end } = monthBoundsIso(monthKey);
  const inRow = await db
    .prepare(
      `SELECT COALESCE(SUM(amount), 0) AS total
       FROM rootmc_treasury_ledger
       WHERE server_id = ? AND entry_type IN (${INFLOW_TYPES.map(() => "?").join(",")})
         AND ${LEDGER_CREATED_AT_NORM} >= ? AND ${LEDGER_CREATED_AT_NORM} < ?`,
    )
    .bind(serverId, ...INFLOW_TYPES, sqlLedgerBound(start), sqlLedgerBound(end))
    .first<{ total: number }>();
  const outRow = await db
    .prepare(
      `SELECT COALESCE(SUM(amount), 0) AS total
       FROM rootmc_treasury_ledger
       WHERE server_id = ? AND entry_type IN (${OUTFLOW_TYPES.map(() => "?").join(",")})
         AND ${LEDGER_CREATED_AT_NORM} >= ? AND ${LEDGER_CREATED_AT_NORM} < ?`,
    )
    .bind(serverId, ...OUTFLOW_TYPES, sqlLedgerBound(start), sqlLedgerBound(end))
    .first<{ total: number }>();
  return roundGold(Number(inRow?.total) - Number(outRow?.total));
}

/** Distributable dividend pool for a month (0 when reserve net is negative). */
async function monthPoolAmount(db: D1Database, serverId: string, monthKey: string): Promise<number> {
  const net = await monthNetAmount(db, serverId, monthKey);
  return roundGold(Math.max(0, net) * dividendPayoutRatio());
}

export async function treasurySummaryForPlayer(
  db: D1Database,
  serverId: string,
  uuid: string,
): Promise<Record<string, unknown>> {
  serverId = treasuryServerId(serverId);
  const currentMonth = currentHstMonthKey();
  const priorMonth = previousHstMonthKey();
  const monthRow = await db
    .prepare(
      `SELECT playtime_seconds FROM rootmc_playtime_monthly
       WHERE server_id = ? AND minecraft_uuid = ? AND month_key = ? LIMIT 1`,
    )
    .bind(serverId, uuid, currentMonth)
    .first<{ playtime_seconds: number }>();
  const currentSeconds = Math.max(0, Math.floor(Number(monthRow?.playtime_seconds) || 0));
  const taxRow = await db
    .prepare(
      `SELECT COALESCE(SUM(amount), 0) AS total
       FROM rootmc_treasury_ledger
       WHERE server_id = ? AND entry_type = 'TAX' AND from_uuid = ?
         AND ${LEDGER_CREATED_AT_NORM} >= ?`,
    )
    .bind(serverId, uuid, sqlLedgerBound(monthBoundsIso(currentMonth).start))
    .first<{ total: number }>();
  return {
    current_month: currentMonth,
    prior_month: priorMonth,
    monthly_playtime_seconds: currentSeconds,
    monthly_playtime_label: formatPlaytime(currentSeconds),
    tax_paid_mtd: roundGold(Number(taxRow?.total) || 0),
  };
}

export async function listTownTaxLeaderboard(
  db: D1Database,
  serverId: string,
  limit = 25,
): Promise<Record<string, unknown>[]> {
  const { results } = await db
    .prepare(
      `SELECT town_name, mayor_name, tax_percent, synced_at
       FROM rootmc_town_tax_rates
       WHERE server_id = ? AND tax_percent IS NOT NULL
       ORDER BY tax_percent ASC, town_name ASC
       LIMIT ?`,
    )
    .bind(serverId, Math.min(50, Math.max(1, limit)))
    .all<Record<string, unknown>>();
  return (results || []).map((row, idx) => ({
    rank: idx + 1,
    town_name: row.town_name,
    mayor_name: row.mayor_name,
    tax_percent: Number(row.tax_percent) || 0,
    synced_at: row.synced_at,
  }));
}

export function isMonthlyDividendCronSlot(at = new Date()): boolean {
  const hstMs = at.getTime() - HST_OFFSET_MS;
  const hst = new Date(hstMs);
  return hst.getUTCDate() === 1 && hst.getUTCHours() === 0 && hst.getUTCMinutes() < 10;
}

export type DividendPayoutLine = {
  minecraft_uuid: string;
  minecraft_username: string | null;
  playtime_seconds: number;
  amount: number;
};

export type DividendPlan = {
  month_key: string;
  pool_net: number;
  pool_distributable: number;
  payout_ratio: number;
  eligible_count: number;
  total_eligible_seconds: number;
  status: "ready" | "empty" | "no_eligible" | "reserve_shortage";
  payouts: DividendPayoutLine[];
};

export async function computeMonthlyDividendPlan(
  db: D1Database,
  serverId: string,
  monthKey: string,
  env?: RootStatEnv,
  noteSupply?: import("./rootmc-economy-baseline").NoteSupplySnapshot | null,
): Promise<DividendPlan> {
  const ratio = dividendPayoutRatio(env);
  const poolNet = await monthNetAmount(db, serverId, monthKey);
  const pool = noteSupply
    ? computeDividendRefundPool({ monthlyLedgerNet: poolNet, noteSupply, payoutRatio: ratio })
    : roundGold(Math.max(0, poolNet) * ratio);
  const base = {
    month_key: monthKey,
    pool_net: roundGold(poolNet),
    pool_distributable: 0,
    payout_ratio: ratio,
    eligible_count: 0,
    total_eligible_seconds: 0,
    payouts: [] as DividendPayoutLine[],
  };
  if (poolNet < -0.01) {
    return { ...base, status: "reserve_shortage" };
  }
  if (pool < 0.01) {
    return { ...base, status: "empty" };
  }

  const { results } = await db
    .prepare(
      `SELECT p.minecraft_uuid, p.playtime_seconds, l.minecraft_username
       FROM rootmc_playtime_monthly p
       LEFT JOIN rootstat_minecraft_links l ON l.minecraft_uuid = p.minecraft_uuid
       WHERE p.server_id = ? AND p.month_key = ? AND p.playtime_seconds >= ?`,
    )
    .bind(serverId, monthKey, MIN_DIVIDEND_SECONDS)
    .all<{
      minecraft_uuid: string;
      playtime_seconds: number;
      minecraft_username: string | null;
    }>();

  const eligibles = results || [];
  if (!eligibles.length) {
    return { ...base, pool_distributable: pool, status: "no_eligible" };
  }

  const totalSeconds = eligibles.reduce(
    (s, r) => s + Math.max(0, Math.floor(Number(r.playtime_seconds) || 0)),
    0,
  );
  const payouts: DividendPayoutLine[] = [];
  for (const row of eligibles) {
    const uuid = normalizeUuid(row.minecraft_uuid);
    const seconds = Math.max(0, Math.floor(Number(row.playtime_seconds) || 0));
    if (!uuid || seconds <= 0) continue;
    const amount = roundGold(pool * (seconds / totalSeconds));
    if (amount < 0.01) continue;
    payouts.push({
      minecraft_uuid: uuid,
      minecraft_username: str(row.minecraft_username) || null,
      playtime_seconds: seconds,
      amount,
    });
  }
  const distributed = roundGold(payouts.reduce((s, p) => s + p.amount, 0));
  return {
    ...base,
    pool_distributable: distributed,
    eligible_count: payouts.length,
    total_eligible_seconds: totalSeconds,
    status: "ready",
    payouts,
  };
}

export async function loadDividendPlanFromRun(
  db: D1Database,
  serverId: string,
  monthKey: string,
  env?: RootStatEnv,
): Promise<DividendPlan | null> {
  const run = await db
    .prepare(
      `SELECT month_key, pool_amount, eligible_players, total_eligible_seconds, status
       FROM rootmc_treasury_dividend_runs
       WHERE server_id = ? AND month_key = ? LIMIT 1`,
    )
    .bind(serverId, monthKey)
    .first<{
      month_key: string;
      pool_amount: number;
      eligible_players: number;
      total_eligible_seconds: number;
      status: string;
    }>();
  if (!run) return null;

  const ratio = dividendPayoutRatio(env);
  const poolNet = await monthNetAmount(db, serverId, monthKey);
  const runStatus = str(run.status);
  const status: DividendPlan["status"] =
    runStatus === "reserve_shortage"
      ? "reserve_shortage"
      : runStatus === "empty"
        ? "empty"
        : runStatus === "no_eligible"
          ? "no_eligible"
          : "ready";

  const { results } = await db
    .prepare(
      `SELECT minecraft_uuid, minecraft_username, amount, created_at
       FROM rootmc_treasury_dividend_payouts
       WHERE server_id = ? AND month_key = ?
       ORDER BY amount DESC`,
    )
    .bind(serverId, monthKey)
    .all<{
      minecraft_uuid: string;
      minecraft_username: string | null;
      amount: number;
    }>();

  const payoutRows = results || [];
  const secondsByUuid = new Map<string, number>();
  if (payoutRows.length) {
    const { results: playRows } = await db
      .prepare(
        `SELECT minecraft_uuid, playtime_seconds
         FROM rootmc_playtime_monthly
         WHERE server_id = ? AND month_key = ?`,
      )
      .bind(serverId, monthKey)
      .all<{ minecraft_uuid: string; playtime_seconds: number }>();
    for (const row of playRows || []) {
      secondsByUuid.set(normalizeUuid(row.minecraft_uuid), Math.floor(Number(row.playtime_seconds) || 0));
    }
  }

  const payouts: DividendPayoutLine[] = payoutRows.map((row) => ({
    minecraft_uuid: normalizeUuid(row.minecraft_uuid),
    minecraft_username: str(row.minecraft_username) || null,
    playtime_seconds: secondsByUuid.get(normalizeUuid(row.minecraft_uuid)) || 0,
    amount: roundGold(Number(row.amount) || 0),
  }));

  return {
    month_key: monthKey,
    pool_net: roundGold(poolNet),
    pool_distributable: roundGold(Number(run.pool_amount) || 0),
    payout_ratio: ratio,
    eligible_count: Math.max(Number(run.eligible_players) || 0, payouts.length),
    total_eligible_seconds: Math.floor(Number(run.total_eligible_seconds) || 0),
    status: payouts.length ? "ready" : status,
    payouts,
  };
}

export async function runMonthlyTreasuryDividendCron(
  env: RootStatEnv,
): Promise<{ monthKey: string; created: boolean }> {
  const serverId = await resolveServerId(env.DB);
  const monthKey = previousHstMonthKey();
  const existing = await env.DB.prepare(
    `SELECT 1 FROM rootmc_treasury_dividend_runs WHERE server_id = ? AND month_key = ? LIMIT 1`,
  )
    .bind(serverId, monthKey)
    .first();
  if (existing) return { monthKey, created: false };

  const plan = await computeMonthlyDividendPlan(env.DB, serverId, monthKey, env);
  const ts = nowIso();

  if (plan.status === "empty" || plan.status === "reserve_shortage") {
    await env.DB.prepare(
      `INSERT INTO rootmc_treasury_dividend_runs
         (server_id, month_key, pool_amount, eligible_players, total_eligible_seconds, status, created_at)
       VALUES (?, ?, 0, 0, 0, ?, ?)`,
    )
      .bind(serverId, monthKey, plan.status, ts)
      .run();
    return { monthKey, created: true };
  }

  if (plan.status === "no_eligible") {
    await env.DB.prepare(
      `INSERT INTO rootmc_treasury_dividend_runs
         (server_id, month_key, pool_amount, eligible_players, total_eligible_seconds, status, created_at)
       VALUES (?, ?, ?, 0, 0, 'no_eligible', ?)`,
    )
      .bind(serverId, monthKey, plan.pool_distributable, ts)
      .run();
    return { monthKey, created: true };
  }

  for (const row of plan.payouts) {
    const id = crypto.randomUUID();
    await env.DB.prepare(
      `INSERT INTO rootmc_treasury_dividend_payouts
         (id, server_id, month_key, minecraft_uuid, minecraft_username, amount, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)`,
    )
      .bind(
        id,
        serverId,
        monthKey,
        row.minecraft_uuid,
        row.minecraft_username,
        row.amount,
        ts,
      )
      .run();
  }

  await env.DB.prepare(
    `INSERT INTO rootmc_treasury_dividend_runs
       (server_id, month_key, pool_amount, eligible_players, total_eligible_seconds, status, created_at)
     VALUES (?, ?, ?, ?, ?, 'pending_payout', ?)`,
  )
    .bind(
      serverId,
      monthKey,
      plan.pool_distributable,
      plan.eligible_count,
      plan.total_eligible_seconds,
      ts,
    )
    .run();
  return { monthKey, created: true };
}

export async function listPendingTreasuryDividends(request: Request, env: RootStatEnv): Promise<Response> {
  const server = await validateServerAuth(env, request);
  if (server instanceof Response) return server;
  const { results } = await env.DB.prepare(
    `SELECT id, month_key, minecraft_uuid, minecraft_username, amount, created_at
     FROM rootmc_treasury_dividend_payouts
     WHERE server_id = ? AND status = 'pending'
     ORDER BY created_at ASC
     LIMIT 100`,
  )
    .bind(server.serverId)
    .all<Record<string, unknown>>();
  return json({ ok: true, payouts: results || [] });
}

export async function completeTreasuryDividends(request: Request, env: RootStatEnv): Promise<Response> {
  const server = await validateServerAuth(env, request);
  if (server instanceof Response) return server;
  let body: { payouts?: unknown[] };
  try {
    body = (await request.json()) as { payouts?: unknown[] };
  } catch {
    return json({ detail: "Invalid JSON" }, 400);
  }
  const rows = Array.isArray(body.payouts) ? body.payouts : [];
  const ts = nowIso();
  let updated = 0;
  for (const raw of rows) {
    const row = record(raw);
    const id = str(row.id);
    const status = str(row.status).toLowerCase();
    if (!id || (status !== "applied" && status !== "failed")) continue;
    const res = await env.DB.prepare(
      `UPDATE rootmc_treasury_dividend_payouts
       SET status = ?, applied_at = ?, error_message = ?
       WHERE id = ? AND server_id = ? AND status = 'pending'`,
    )
      .bind(status, ts, status === "failed" ? str(row.error_message).slice(0, 500) || null : null, id, server.serverId)
      .run();
    if ((res.meta?.changes ?? 0) > 0) updated++;
  }
  return json({ ok: true, updated });
}

export async function handleTreasuryPublicRoutes(
  request: Request,
  env: RootStatEnv,
  subpath: string,
  method: string,
): Promise<Response | null> {
  if (!subpath.startsWith("/rootmc/treasury")) return null;
  const rest = subpath.slice("/rootmc/treasury".length) || "/";

  const treasuryId = TREASURY_SERVER_ID;

  const townTaxMatch = rest.match(/^\/([^/]+)\/town-taxes$/);
  if (method === "GET" && townTaxMatch) {
    const serverId = treasuryId;
    const url = new URL(request.url);
    const limit = Math.min(50, Math.max(1, Number(url.searchParams.get("limit")) || 25));
    const towns = await listTownTaxLeaderboard(env.DB, serverId, limit);
    return json({ server_id: serverId, towns, synced_at: nowIso() });
  }

  const reserveMatch = rest.match(/^\/([^/]+)\/reserve$/);
  if (method === "GET" && reserveMatch) {
    const serverId = treasuryId;
    const url = new URL(request.url);
    const viewMonthKey = url.searchParams.get("month");
    // Public GET must stay on D1 only — Hyperdrive awaits can stall the isolate so
    // Promise.race/setTimeout never fire (browser then sees AbortError).
    // MySQL vault/physical enrichment runs on cron / sync, not page views.
    const summary = await treasuryReservePublicSummary(env.DB, serverId, { viewMonthKey });
    return withShortPublicCache(json(summary));
  }

  const ledgerMatch = rest.match(/^\/([^/]+)\/ledger$/);
  if (method === "GET" && ledgerMatch) {
    const serverId = treasuryId;
    const url = new URL(request.url);
    const page = await treasuryLedgerPublicPage(env.DB, serverId, {
      limit: Number(url.searchParams.get("limit")) || 25,
      offset: Number(url.searchParams.get("offset")) || 0,
      type: url.searchParams.get("type") || "",
      direction: url.searchParams.get("direction") || "",
      beforeId: Number(url.searchParams.get("before_id")) || 0,
      startIso: url.searchParams.get("start") || "",
      endIso: url.searchParams.get("end") || "",
      executive: url.searchParams.get("executive") === "1" || url.searchParams.get("executive") === "true",
    });
    return json(page);
  }

  const mintDepartmentMatch = rest.match(/^\/([^/]+)\/mint\/department$/);
  if (method === "GET" && mintDepartmentMatch) {
    const serverId = treasuryId;
    const url = new URL(request.url);
    const leaderboardLimit = Math.min(100, Math.max(1, Number(url.searchParams.get("limit")) || 50));
    const { mintDepartmentReport } = await import("./rootmc-mint-department");
    // D1-only on public GET — same Hyperdrive stall risk as /reserve.
    const report = await mintDepartmentReport(env.DB, serverId, { leaderboardLimit });
    return withShortPublicCache(json(report));
  }

  const mintLedgerMatch = rest.match(/^\/([^/]+)\/mint\/ledger$/);
  if (method === "GET" && mintLedgerMatch) {
    const serverId = treasuryId;
    const url = new URL(request.url);
    const { mintLedgerPublicPage } = await import("./rootmc-mint-department");
    const page = await mintLedgerPublicPage(env.DB, serverId, {
      limit: Number(url.searchParams.get("limit")) || 100,
      offset: Number(url.searchParams.get("offset")) || 0,
      beforeId: Number(url.searchParams.get("before_id")) || 0,
    });
    return json(page);
  }

  const mintLeaderboardMatch = rest.match(/^\/([^/]+)\/mint\/leaderboard$/);
  if (method === "GET" && mintLeaderboardMatch) {
    const serverId = treasuryId;
    const url = new URL(request.url);
    const limit = Math.min(100, Math.max(1, Number(url.searchParams.get("limit")) || 25));
    const result = await mintLeaderboardForServer(env.DB, serverId, limit);
    return json({
      server_id: serverId,
      ...result,
      synced_at: nowIso(),
    });
  }

  return null;
}
