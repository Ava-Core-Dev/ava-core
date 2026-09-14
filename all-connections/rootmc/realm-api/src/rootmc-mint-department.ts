import type { Connection } from "mysql2/promise";

import { roundGold } from "./discord-rootmc-economy";
import { POST_RESET_LEDGER_HST_MONTH } from "./rootmc-economy-baseline";
import { goldFoundLeaderboardForServer, goldFoundSummaryForServer } from "./rootmc-gold-found";
import { goldItemEventCountForServer } from "./rootmc-gold-item-events";
import { readPlayerWalletNotesTotal } from "./rootmc-holder-supply";
import { physicalGoldSummaryForServer } from "./rootmc-physical-gold";
import { str } from "./realm-lib";
import {
  accumulateMintLeaderboardDelta,
  mintGrossFromLedgerRow,
  mintLeaderboardRowFromStats,
  type MintLeaderboardPlayerStats,
  type MintLeaderboardRow,
} from "./rootmc-mint-ledger";

const TREASURY_SERVER_ID = "rootmc";

function treasuryServerId(_requested?: string): string {
  return TREASURY_SERVER_ID;
}

async function resolvePlayerNames(
  db: D1Database,
  serverId: string,
  uuids: string[],
): Promise<Record<string, string>> {
  const { resolvePlayerNames: resolve } = await import("./rootmc-treasury");
  return resolve(db, serverId, uuids);
}

async function readPostResetNoteSupplySnapshot(db: D1Database, serverId: string) {
  const { readPostResetNoteSupplySnapshot: read } = await import("./rootmc-treasury");
  return read(db, serverId);
}

/** Department of The /Mint  -  reliable ledger era begins 3 Jul 2026 00:00 HST (July 1 - 2 excluded). */
export const MINT_DEPARTMENT_ERA_START_HST = "2026-07-03T00:00:00";
export const MINT_DEPARTMENT_ERA_START_DATE_HST = "2026-07-03";
export const MINT_DEPARTMENT_ERA_START_ISO = `${MINT_DEPARTMENT_ERA_START_HST}Z`;

function normalizeUuid(raw: string | null | undefined): string | null {
  const uuid = str(raw).toLowerCase();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(uuid)) {
    return null;
  }
  return uuid;
}

function sqlLedgerBound(iso: string): string {
  return iso.replace("T", " ").slice(0, 19);
}

const LEDGER_CREATED_AT_NORM = `datetime(replace(substr(created_at, 1, 19), 'T', ' '))`;

/** SQL predicate for audited /mint treasury rows (gross, redeem, legacy). */
export const MINT_LEDGER_SQL = `entry_type IN ('TAX', 'NOTE_BURN')
  AND (details = 'mint' OR details LIKE '%mint:gross=%' OR details LIKE '%mint:redeem=%'
       OR details LIKE 'correction:tax_reclass:mint:%')`;

export type MintLedgerEntry = {
  mysql_id: number;
  created_at: string;
  minecraft_uuid: string | null;
  minecraft_username: string | null;
  kind: "mint_in" | "mint_out";
  amount_g: number;
  details: string | null;
};

async function mintLedgerRowsSince(
  db: D1Database,
  serverId: string,
  sinceIso: string,
): Promise<{ mysql_id: number; from_uuid: string | null; amount: number; details: string | null; created_at: string }[]> {
  const { results } = await db
    .prepare(
      `SELECT mysql_id, from_uuid, amount, details, created_at
       FROM rootmc_treasury_ledger
       WHERE server_id = ?
         AND ${MINT_LEDGER_SQL}
         AND ${LEDGER_CREATED_AT_NORM} >= ?`,
    )
    .bind(treasuryServerId(serverId), sqlLedgerBound(sinceIso))
    .all<{ mysql_id: number; from_uuid: string | null; amount: number; details: string | null; created_at: string }>();
  return results ?? [];
}

function mapMintLedgerRow(
  row: { mysql_id: number; from_uuid: string | null; amount: number; details: string | null; created_at: string },
): MintLedgerEntry | null {
  const delta = mintGrossFromLedgerRow(row.amount, row.details);
  if (delta === 0) return null;
  return {
    mysql_id: Math.floor(Number(row.mysql_id) || 0),
    created_at: str(row.created_at),
    minecraft_uuid: normalizeUuid(row.from_uuid),
    minecraft_username: null,
    kind: delta > 0 ? "mint_in" : "mint_out",
    amount_g: roundGold(Math.abs(delta)),
    details: str(row.details) || null,
  };
}

/** Paginated complete /mint ledger since the department era (3 Jul 2026 HST). */
export async function mintLedgerPublicPage(
  db: D1Database,
  serverId: string,
  opts?: { limit?: number; offset?: number; beforeId?: number },
): Promise<{
  server_id: string;
  era_start_iso: string;
  total: number;
  limit: number;
  offset: number;
  next_offset: number;
  has_more: boolean;
  entries: MintLedgerEntry[];
}> {
  serverId = treasuryServerId(serverId);
  const sinceIso = MINT_DEPARTMENT_ERA_START_ISO;
  const limit = Math.min(200, Math.max(1, Math.floor(Number(opts?.limit) || 100)));
  const offset = Math.max(0, Math.floor(Number(opts?.offset) || 0));
  const beforeId = Math.floor(Number(opts?.beforeId) || 0);

  const where: string[] = ["server_id = ?", MINT_LEDGER_SQL, `${LEDGER_CREATED_AT_NORM} >= ?`];
  const binds: (string | number)[] = [serverId, sqlLedgerBound(sinceIso)];
  if (beforeId > 0) {
    where.push("mysql_id < ?");
    binds.push(beforeId);
  }
  const whereSql = where.join(" AND ");

  const countRow = await db
    .prepare(`SELECT COUNT(*) AS total FROM rootmc_treasury_ledger WHERE ${whereSql}`)
    .bind(...binds)
    .first<{ total: number }>();

  const pageBinds = [...binds];
  let limitSql = "LIMIT ?";
  pageBinds.push(limit);
  if (beforeId <= 0) {
    limitSql += " OFFSET ?";
    pageBinds.push(offset);
  }

  const { results } = await db
    .prepare(
      `SELECT mysql_id, from_uuid, amount, details, created_at
       FROM rootmc_treasury_ledger
       WHERE ${whereSql}
       ORDER BY mysql_id DESC
       ${limitSql}`,
    )
    .bind(...pageBinds)
    .all<{ mysql_id: number; from_uuid: string | null; amount: number; details: string | null; created_at: string }>();

  const rawRows = results ?? [];

  const mapped: MintLedgerEntry[] = [];
  const uuids: string[] = [];
  for (const row of rawRows) {
    const entry = mapMintLedgerRow(row);
    if (!entry) continue;
    mapped.push(entry);
    if (entry.minecraft_uuid) uuids.push(entry.minecraft_uuid);
  }
  const names = await resolvePlayerNames(db, serverId, uuids);
  for (const entry of mapped) {
    if (entry.minecraft_uuid) {
      entry.minecraft_username = names[entry.minecraft_uuid] ?? null;
    }
  }

  return {
    server_id: serverId,
    era_start_iso: sinceIso,
    total: Math.max(0, Math.floor(Number(countRow?.total) || 0)),
    limit,
    offset: beforeId > 0 ? 0 : offset,
    next_offset: beforeId > 0 ? 0 : offset + rawRows.length,
    has_more: beforeId > 0 ? rawRows.length >= limit : offset + rawRows.length < Math.max(0, Math.floor(Number(countRow?.total) || 0)),
    entries: mapped,
  };
}

async function mintLedgerEventTotals(
  db: D1Database,
  serverId: string,
  sinceIso: string,
): Promise<{ mint_events: number; redeem_events: number; ledger_rows: number }> {
  const rows = await mintLedgerRowsSince(db, serverId, sinceIso);
  let mintEvents = 0;
  let redeemEvents = 0;
  let ledgerRows = 0;
  for (const row of rows) {
    const delta = mintGrossFromLedgerRow(row.amount, row.details);
    if (delta === 0) continue;
    ledgerRows++;
    if (delta > 0) mintEvents++;
    else redeemEvents++;
  }
  return { mint_events: mintEvents, redeem_events: redeemEvents, ledger_rows: ledgerRows };
}

async function mintLeaderboardSince(
  db: D1Database,
  serverId: string,
  sinceIso: string,
  limit = 50,
): Promise<{
  leaderboard: MintLeaderboardRow[];
  total_gross_in_g: number;
  total_redeemed_g: number;
  net_minted_g: number;
  /** @deprecated use total_gross_in_g */
  total_gross_minted_g: number;
}> {
  const rows = await mintLedgerRowsSince(db, serverId, sinceIso);
  const byUuid = new Map<string, MintLeaderboardPlayerStats>();
  let totalGrossIn = 0;
  let totalRedeemed = 0;
  for (const row of rows) {
    const delta = mintGrossFromLedgerRow(row.amount, row.details);
    if (delta === 0) continue;
    if (delta > 0) totalGrossIn += delta;
    else totalRedeemed += Math.abs(delta);
    const uuid = normalizeUuid(row.from_uuid);
    if (!uuid) continue;
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
    treasuryServerId(serverId),
    capped.map(([uuid]) => uuid),
  );
  const leaderboard: MintLeaderboardRow[] = capped.map(([uuid, stats], idx) =>
    mintLeaderboardRowFromStats(idx + 1, uuid, names[uuid] ?? null, stats),
  );
  const grossIn = roundGold(totalGrossIn);
  const redeemed = roundGold(totalRedeemed);
  return {
    leaderboard,
    total_gross_in_g: grossIn,
    total_redeemed_g: redeemed,
    net_minted_g: roundGold(grossIn - redeemed),
    total_gross_minted_g: grossIn,
  };
}

export type MintDepartmentReport = {
  server_id: string;
  department: "mint";
  era_start_hst: string;
  era_start_date_hst: string;
  era_month_hst: string;
  synced_at: string;
  totals: {
    total_player_balances_g: number;
    total_minted_g: number;
    unminted_gold_items_g: number;
    mint_gross_g: number;
    mint_redeem_g: number;
    mint_net_g: number;
    mint_events: number;
    redeem_events: number;
    mint_ledger_rows: number;
    backing_pct: number | null;
  };
  note_supply: Awaited<ReturnType<typeof readPostResetNoteSupplySnapshot>>;
  physical_gold: Awaited<ReturnType<typeof physicalGoldSummaryForServer>>;
  leaderboard: MintLeaderboardRow[];
  gold_found_since_era: Awaited<ReturnType<typeof goldFoundLeaderboardForServer>>;
  gold_found_summary: Awaited<ReturnType<typeof goldFoundSummaryForServer>>;
  provenance: MintProvenance;
  transparency: MintTransparency;
};

/** How /mint works  -  conversion at a fixed peg, not a balance-holding account. */
export type MintTransparency = {
  /** /mint is a pegged conversion service; it does not hold a vault balance. */
  role: "conversion_function";
  has_vault_account: false;
  peg: {
    nugget_g: number;
    ingot_g: number;
    block_g: number;
    note_per_ingot: number;
  };
  /** Audited ledger: cumulative goldâ†'Notes gross since era start. */
  ledger_gross_in_g: number;
  /** Audited ledger: cumulative Notesâ†'gold redemptions since era start. */
  ledger_redeemed_out_g: number;
  /** Net backing recorded by the mint ledger (gross in minus redeem out). */
  ledger_net_backing_g: number;
  /** Spendable Notes in player wallets (not a mint account). */
  player_wallet_notes_g: number;
  /** Server Reserve vault Notes  -  treasury/governance, separate from /mint. */
  reserve_notes_g: number;
  /** Wallet + reserve Notes in circulation. */
  total_circulation_g: number;
  /** Net ledger backing Ã -  player wallet Notes (department era). */
  wallet_backing_pct: number | null;
  /** Gross /mint in Ã -  total circulation (department era). */
  circulation_backing_pct: number | null;
  /** Player wallets above net era ledger backing. */
  wallet_over_issue_g: number;
  /** Net era ledger backing above player wallets. */
  era_surplus_headroom_g: number;
  physical_items_unminted_g: number;
  /** Cumulative gold-found tracker (ore + block + loot + pickups) since era. */
  gold_found_since_era_g: number;
  /** Ore and placed-block mining only since era  -  not loot chests. */
  gold_found_physical_since_era_g: number;
  /** Loot chests, mob drops, and ground pickups since era (tracker only). */
  gold_found_loot_since_era_g: number;
  status: "fully_backed" | "over_issued";
  summary: string;
};

export type MintProvenance = {
  physical_scan_available: boolean;
  physical_scan_at: string | null;
  item_events_count: number;
  item_events_available: boolean;
  gold_found_tracker_synced_at: string | null;
};

function buildMintTransparency(
  board: { total_gross_in_g: number; total_redeemed_g: number; net_minted_g: number },
  playerBalances: number,
  noteSupply: Awaited<ReturnType<typeof readPostResetNoteSupplySnapshot>>,
  physicalGold: Awaited<ReturnType<typeof physicalGoldSummaryForServer>>,
  goldFoundSummary: Awaited<ReturnType<typeof goldFoundSummaryForServer>>,
  eraStartLabel: string,
): MintTransparency {
  const walletNotes = roundGold(playerBalances);
  const netBacking = roundGold(board.net_minted_g);
  const grossIn = roundGold(board.total_gross_in_g);
  const totalCirc = roundGold(noteSupply.total_notes_g);
  const walletBackingPct =
    walletNotes > 0.01 ? roundGold((netBacking / walletNotes) * 100) : null;
  const circulationBackingPct =
    totalCirc > 0.01 ? roundGold((grossIn / totalCirc) * 100) : null;

  let summary: string;
  if (netBacking + 0.01 < walletNotes) {
    summary =
      `Since ${eraStartLabel}, ${netBacking.toFixed(3)} G net passed through /mint while player wallets hold ${walletNotes.toFixed(3)} G Notes. ` +
      "The mint does not store gold  -  it records conversions at the peg. " +
      "Wallet Notes above net ledger backing are covered by Server Reserve policy or await further /mint.";
  } else if (netBacking > walletNotes + 0.01) {
    summary =
      `Since ${eraStartLabel}, ${netBacking.toFixed(3)} G net /mint backing exceeds ${walletNotes.toFixed(3)} G in player wallets  -  ` +
      `${roundGold(netBacking - walletNotes).toFixed(3)} G surplus headroom before reserve circulation.`;
  } else {
    summary =
      `Since ${eraStartLabel}, net /mint ledger backing (${netBacking.toFixed(3)} G) matches player wallet Notes at the 1 ingot = 1 G peg.`;
  }

  return {
    role: "conversion_function",
    has_vault_account: false,
    peg: {
      nugget_g: roundGold(1 / 9),
      ingot_g: 1,
      block_g: 9,
      note_per_ingot: 1,
    },
    ledger_gross_in_g: roundGold(board.total_gross_in_g),
    ledger_redeemed_out_g: roundGold(board.total_redeemed_g),
    ledger_net_backing_g: netBacking,
    player_wallet_notes_g: walletNotes,
    reserve_notes_g: roundGold(noteSupply.reserve_notes_g),
    total_circulation_g: roundGold(noteSupply.total_notes_g),
    wallet_backing_pct: walletBackingPct,
    circulation_backing_pct: circulationBackingPct,
    wallet_over_issue_g: roundGold(Math.max(0, walletNotes - netBacking)),
    era_surplus_headroom_g: roundGold(Math.max(0, netBacking - walletNotes)),
    physical_items_unminted_g: roundGold(physicalGold.total_storage_g),
    gold_found_since_era_g: roundGold(goldFoundSummary.mined_since_july_g),
    gold_found_physical_since_era_g: roundGold(goldFoundSummary.physical_mined_since_july_g),
    gold_found_loot_since_era_g: roundGold(goldFoundSummary.loot_since_july_g),
    status: noteSupply.status,
    summary,
  };
}

export async function mintDepartmentReport(
  db: D1Database,
  serverId: string,
  options?: {
    leaderboardLimit?: number;
    mysqlConn?: Connection;
    mysqlPrefix?: string;
  },
): Promise<MintDepartmentReport> {
  serverId = treasuryServerId(serverId);
  const sinceIso = MINT_DEPARTMENT_ERA_START_ISO;
  const lbLimit = Math.min(100, Math.max(1, options?.leaderboardLimit ?? 50));

  const [board, eventTotals, playerBalances, noteSupply, physicalGold, goldFound, goldFoundSummary, itemEventsCount] =
    await Promise.all([
      mintLeaderboardSince(db, serverId, sinceIso, lbLimit),
      mintLedgerEventTotals(db, serverId, sinceIso),
      readPlayerWalletNotesTotal(db, serverId),
      readPostResetNoteSupplySnapshot(db, serverId),
      physicalGoldSummaryForServer(db, serverId, options?.mysqlConn, options?.mysqlPrefix),
      goldFoundLeaderboardForServer(db, serverId, 15, "since_july"),
      goldFoundSummaryForServer(db, serverId),
      goldItemEventCountForServer(db, serverId),
    ]);

  const syncRow = await db
    .prepare(
      `SELECT MAX(synced_at) AS synced_at FROM rootmc_treasury_ledger WHERE server_id = ?`,
    )
    .bind(serverId)
    .first<{ synced_at: string }>();

  const unmintedGold = roundGold(physicalGold.total_storage_g);
  const physicalScanAt = str(physicalGold.scanned_at) || null;
  const provenance: MintProvenance = {
    physical_scan_available: unmintedGold > 0 || Boolean(physicalScanAt),
    physical_scan_at: physicalScanAt,
    item_events_count: itemEventsCount,
    item_events_available: itemEventsCount > 0,
    gold_found_tracker_synced_at: goldFound[0]?.synced_at || null,
  };
  const transparency = buildMintTransparency(
    board,
    playerBalances,
    noteSupply,
    physicalGold,
    goldFoundSummary,
    "3 Jul",
  );

  return {
    server_id: serverId,
    department: "mint",
    era_start_hst: MINT_DEPARTMENT_ERA_START_HST,
    era_start_date_hst: MINT_DEPARTMENT_ERA_START_DATE_HST,
    era_month_hst: POST_RESET_LEDGER_HST_MONTH,
    synced_at: str(syncRow?.synced_at) || new Date().toISOString(),
    totals: {
      total_player_balances_g: roundGold(playerBalances),
      total_minted_g: board.total_gross_in_g,
      unminted_gold_items_g: unmintedGold,
      mint_gross_g: board.total_gross_in_g,
      mint_redeem_g: board.total_redeemed_g,
      mint_net_g: board.net_minted_g,
      mint_events: eventTotals.mint_events,
      redeem_events: eventTotals.redeem_events,
      mint_ledger_rows: eventTotals.ledger_rows,
      backing_pct: transparency.wallet_backing_pct,
    },
    note_supply: noteSupply,
    physical_gold: physicalGold,
    leaderboard: board.leaderboard,
    gold_found_since_era: goldFound,
    gold_found_summary: goldFoundSummary,
    provenance,
    transparency,
  };
}
