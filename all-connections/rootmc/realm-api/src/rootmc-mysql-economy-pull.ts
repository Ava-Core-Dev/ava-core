/**
 * Pull economy read-model from Shockbyte MySQL into D1 (cron).
 * Requires Cloudflare Hyperdrive binding ROOTMC_MYSQL on rootmc-api.
 */

import type { Connection, RowDataPacket } from "mysql2/promise";
import mysql from "mysql2/promise";

import { replaceShopListings, recomputeNetWorth } from "./rootmc-economy";
import { isEconomySystemAccount } from "./rootmc-economy-accounts";
import { roundGold } from "./discord-rootmc-economy";
import { recordShopPriceHistory } from "./rootmc-vault-market";
import { resolveEconomyServerId } from "./realm-lib";
import { resolveServerId } from "./rootmc-daily-report";
import { upsertPlaytimeMonthlyRows, upsertTreasuryLedgerRows, persistTreasuryBalance, resetTreasuryLedgerMirror, ledgerTotalsBetween } from "./rootmc-treasury";
import { runListTotalsSnapshot } from "./rootmc-list-totals";
import { upsertGoldFoundRows } from "./rootmc-gold-found";
import { recordHolderSupplyDaily, readPlayerWalletNotesTotal } from "./rootmc-holder-supply";
import { physicalGoldSummaryForServer, upsertPhysicalGoldScan } from "./rootmc-physical-gold";
import { canonicalListingSiteId } from "./rootmc-listing-sites";
import type { RootStatEnv } from "./rootstat-minecraft";
import { applyTownySnapshot } from "./discord-rootmc-towny";

type MysqlEnv = RootStatEnv & {
  ROOTMC_MYSQL?: {
    host: string;
    port: number;
    user: string;
    password: string;
    database: string;
  };
  ROOTMC_MYSQL_TABLE_PREFIX?: string;
};

const CANONICAL_ROOTMC = "rootmc";
const MIN_PULL_INTERVAL_MS = 50 * 60 * 1000;
/** Same inflow/outflow sets as in-game TreasuryLedgerStore / rootmc-treasury.ts */
const MYSQL_LEDGER_INFLOW = new Set([
  "OPENING",
  "TAX",
  "DEATH",
  "TOWNY_SINK",
  "LOAN_PRINCIPAL",
  "LOAN_INTEREST",
  "BOND_ISSUE",
  "BOND_COUPON_FORFEIT",
  "DONATION",
]);
const MYSQL_LEDGER_OUTFLOW = new Set([
  "GRANT",
  "DIVIDEND",
  "LOAN_DISBURSE",
  "VOTE",
  "PLAYTIME",
  "BOND_REDEEM",
  "BOND_COUPON",
]);
const LEDGER_RECONCILE_MIN_INTERVAL_MS = 10 * 60 * 1000;

function tablePrefix(env: MysqlEnv): string {
  const raw = env.ROOTMC_MYSQL_TABLE_PREFIX;
  return raw == null || String(raw).trim() === "" ? "root_" : String(raw).trim();
}

function nowIso(): string {
  return new Date().toISOString();
}

function normalizeUuid(raw: unknown): string | null {
  const uuid = String(raw ?? "")
    .trim()
    .toLowerCase();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(uuid)) {
    return null;
  }
  return uuid;
}

async function openMysql(env: MysqlEnv): Promise<Connection | null> {
  const hd = env.ROOTMC_MYSQL;
  if (!hd?.host || !hd.user || !hd.database) {
    return null;
  }
  return mysql.createConnection({
    host: hd.host,
    port: hd.port || 3306,
    user: hd.user,
    password: hd.password,
    database: hd.database,
    disableEval: true,
  });
}

async function shouldThrottlePull(env: MysqlEnv, serverId: string): Promise<boolean> {
  const row = await env.DB.prepare(
    `SELECT pulled_at FROM rootmc_mysql_economy_pull_state WHERE server_id = ? LIMIT 1`,
  )
    .bind(serverId)
    .first<{ pulled_at: string }>();
  if (!row?.pulled_at) {
    return false;
  }
  const last = Date.parse(row.pulled_at);
  return Number.isFinite(last) && Date.now() - last < MIN_PULL_INTERVAL_MS;
}

async function markPullComplete(env: MysqlEnv, serverId: string, syncedAt: string): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO rootmc_mysql_economy_pull_state (server_id, pulled_at)
     VALUES (?, ?)
     ON CONFLICT(server_id) DO UPDATE SET pulled_at = excluded.pulled_at`,
  )
    .bind(serverId, syncedAt)
    .run();
}

async function ensurePullStateTable(env: MysqlEnv): Promise<void> {
  await env.DB.prepare(
    `CREATE TABLE IF NOT EXISTS rootmc_mysql_economy_pull_state (
       server_id TEXT PRIMARY KEY,
       pulled_at TEXT NOT NULL
     )`,
  ).run();
}

async function pullBalances(
  conn: Connection,
  env: MysqlEnv,
  serverId: string,
  syncedAt: string,
  prefix: string,
): Promise<number> {
  const table = `${prefix}economy_balances`;
  const [rows] = await conn.query<
    Array<RowDataPacket & { minecraft_uuid: string; minecraft_username: string; balance: number }>
  >(`SELECT minecraft_uuid, minecraft_username, balance FROM ${table} WHERE balance > 0`);

  if (!rows.length) {
    return 0;
  }

  await env.DB.prepare(`DELETE FROM rootstat_player_balances WHERE server_id = ?`).bind(serverId).run();

  let count = 0;
  for (const row of rows) {
    const uuid = normalizeUuid(row.minecraft_uuid);
    if (!uuid) continue;
    const balance = Number(row.balance);
    if (!Number.isFinite(balance) || balance <= 0) continue;
    if (isEconomySystemAccount(uuid, row.minecraft_username)) continue;
    await env.DB.prepare(
      `INSERT INTO rootstat_player_balances
         (server_id, minecraft_uuid, minecraft_username, balance, currency, synced_at, updated_at)
       VALUES (?, ?, ?, ?, 'G', ?, ?)
       ON CONFLICT(server_id, minecraft_uuid) DO UPDATE SET
         minecraft_username = excluded.minecraft_username,
         balance = excluded.balance,
         currency = excluded.currency,
         synced_at = excluded.synced_at,
         updated_at = excluded.updated_at`,
    )
      .bind(serverId, uuid, row.minecraft_username || null, balance, syncedAt, syncedAt)
      .run();
    count++;
  }
  return count;
}

async function pullGoldFound(
  conn: Connection,
  env: MysqlEnv,
  serverId: string,
  syncedAt: string,
  prefix: string,
): Promise<number> {
  const table = `${prefix}gold_found`;
  const [rows] = await conn.query<
    Array<RowDataPacket & {
      minecraft_uuid: string;
      minecraft_username: string;
      total_gold_g: number;
      mined_ore_g: number;
      mined_block_g: number;
      loot_chest_g: number;
      loot_mob_g: number;
      pickup_g: number;
      find_events: number;
    }>
  >(
    `SELECT minecraft_uuid, minecraft_username, total_gold_g, mined_ore_g, mined_block_g,
            loot_chest_g, loot_mob_g, pickup_g, find_events
     FROM ${table}
     WHERE total_gold_g > 0`,
  );

  const payload = rows
    .map((row) => ({
      minecraft_uuid: row.minecraft_uuid,
      minecraft_username: row.minecraft_username,
      total_gold_g: Number(row.total_gold_g) || 0,
      mined_ore_g: Number(row.mined_ore_g) || 0,
      mined_block_g: Number(row.mined_block_g) || 0,
      loot_chest_g: Number(row.loot_chest_g) || 0,
      loot_mob_g: Number(row.loot_mob_g) || 0,
      pickup_g: Number(row.pickup_g) || 0,
      find_events: Number(row.find_events) || 0,
    }))
    .filter((row) => normalizeUuid(row.minecraft_uuid) && row.total_gold_g > 0);

  return upsertGoldFoundRows(env.DB, serverId, payload, syncedAt);
}

async function pullPlaytimeMonthly(
  conn: Connection,
  env: MysqlEnv,
  serverId: string,
  syncedAt: string,
  prefix: string,
): Promise<number> {
  const table = `${prefix}rootmc_playtime_monthly`;
  const [rows] = await conn.query<Array<RowDataPacket & { uuid: string; month_key: string; playtime_seconds: number }>>(
    `SELECT uuid, month_key, playtime_seconds FROM ${table}`,
  );
  const payload = rows
    .map((row) => ({
      minecraft_uuid: row.uuid,
      month_key: row.month_key,
      playtime_seconds: Number(row.playtime_seconds) || 0,
    }))
    .filter((row) => normalizeUuid(row.minecraft_uuid) && row.month_key);
  return upsertPlaytimeMonthlyRows(env.DB, serverId, payload, syncedAt);
}

/** Sync shared Gen1+Gen2 totals into D1 so heartbeats/fallbacks match Hyperdrive. */
async function pullTotalPlaytime(
  conn: Connection,
  env: MysqlEnv,
  serverId: string,
  syncedAt: string,
  prefix: string,
): Promise<number> {
  const table = `${prefix}rootmc_playtime`;
  try {
    const [rows] = await conn.query<
      Array<
        RowDataPacket & {
          uuid: string;
          username: string;
          total_playtime_seconds: number;
          first_join_at?: Date | string | null;
          last_login_at?: Date | string | null;
        }
      >
    >(
      `SELECT uuid, username, total_playtime_seconds, first_join_at, last_login_at FROM ${table}`,
    );
    let count = 0;
    for (const row of rows || []) {
      const uuid = normalizeUuid(row.uuid);
      if (!uuid) continue;
      const firstJoin =
        row.first_join_at instanceof Date
          ? row.first_join_at.toISOString()
          : row.first_join_at
            ? new Date(String(row.first_join_at)).toISOString()
            : null;
      const lastLogin =
        row.last_login_at instanceof Date
          ? row.last_login_at.toISOString()
          : row.last_login_at
            ? new Date(String(row.last_login_at)).toISOString()
            : null;
      await env.DB.prepare(
        `INSERT INTO rootstat_player_playtime
           (server_id, minecraft_uuid, minecraft_username, total_playtime_seconds,
            first_join_at, last_login_at, synced_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(server_id, minecraft_uuid) DO UPDATE SET
           minecraft_username = excluded.minecraft_username,
           total_playtime_seconds = excluded.total_playtime_seconds,
           first_join_at = COALESCE(excluded.first_join_at, first_join_at),
           last_login_at = COALESCE(excluded.last_login_at, last_login_at),
           synced_at = excluded.synced_at,
           updated_at = excluded.updated_at`,
      )
        .bind(
          serverId,
          uuid,
          String(row.username ?? "").trim() || null,
          Math.max(0, Math.floor(Number(row.total_playtime_seconds) || 0)),
          firstJoin,
          lastLogin,
          syncedAt,
          syncedAt,
        )
        .run();
      count++;
    }
    return count;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("doesn't exist") || msg.includes("Unknown table") || msg.includes("Unknown column")) {
      return 0;
    }
    throw e;
  }
}

async function pullTreasuryLedger(
  conn: Connection,
  env: MysqlEnv,
  serverId: string,
  syncedAt: string,
  prefix: string,
): Promise<number> {
  const table = `${prefix}treasury_ledger`;
  const treasuryId = CANONICAL_ROOTMC;
  const stateRow = await env.DB.prepare(
    `SELECT last_ledger_mysql_id FROM rootmc_treasury_sync_state WHERE server_id = ? LIMIT 1`,
  )
    .bind(treasuryId)
    .first<{ last_ledger_mysql_id: number }>();
  const afterId = Number(stateRow?.last_ledger_mysql_id) || 0;

  const [rows] = await conn.query<
    Array<RowDataPacket & {
      id: number;
      entry_type: string;
      amount: number;
      from_uuid: string | null;
      to_uuid: string | null;
      details: string | null;
      created_at: Date;
    }>
  >(
    `SELECT id, entry_type, amount, from_uuid, to_uuid, details, created_at
     FROM ${table} WHERE id > ? ORDER BY id ASC LIMIT 500`,
    [afterId],
  );

  const ledgerRows = rows.map((row) => ({
    mysql_id: row.id,
    entry_type: row.entry_type,
    amount: row.amount,
    from_uuid: row.from_uuid,
    to_uuid: row.to_uuid,
    details: row.details,
    created_at: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
  }));

  const result = await upsertTreasuryLedgerRows(env.DB, CANONICAL_ROOTMC, ledgerRows, syncedAt);
  return result.upserted;
}

/** Live MySQL ledger net — same formula as in-game /tax Ledger. */
export async function readMysqlTreasuryLedgerTotals(
  conn: Connection,
  prefix: string,
): Promise<{ inflow: number; outflow: number; net: number; by_type: Record<string, number> }> {
  const table = `${prefix}treasury_ledger`;
  const [rows] = await conn.query<Array<RowDataPacket & { entry_type: string; total: number }>>(
    `SELECT entry_type, COALESCE(SUM(amount), 0) AS total FROM ${table} GROUP BY entry_type`,
  );
  const byType: Record<string, number> = {};
  let inflow = 0;
  let outflow = 0;
  for (const row of rows) {
    const type = String(row.entry_type || "")
      .trim()
      .toUpperCase();
    const total = roundGold(Number(row.total) || 0);
    if (!type || total <= 0) continue;
    byType[type] = total;
    if (MYSQL_LEDGER_INFLOW.has(type)) inflow += total;
    else if (MYSQL_LEDGER_OUTFLOW.has(type)) outflow += total;
  }
  return {
    inflow: roundGold(inflow),
    outflow: roundGold(outflow),
    net: roundGold(inflow - outflow),
    by_type: byType,
  };
}

async function rebuildTreasuryLedgerFromMysql(
  conn: Connection,
  env: MysqlEnv,
  prefix: string,
): Promise<{ deleted: number; upserted: number }> {
  const deleted = await resetTreasuryLedgerMirror(env.DB, CANONICAL_ROOTMC);
  let upserted = 0;
  for (let i = 0; i < 200; i++) {
    const n = await pullTreasuryLedger(conn, env, CANONICAL_ROOTMC, nowIso(), prefix);
    upserted += n;
    if (n <= 0) break;
  }
  return { deleted, upserted };
}

/**
 * If D1 ledger net drifts from live MySQL (/tax), wipe the D1 mirror and re-import.
 * Throttled so public /reserve pages do not rebuild every request.
 */
export async function reconcileTreasuryLedgerFromMysql(env: MysqlEnv): Promise<{
  ok: boolean;
  rebuilt: boolean;
  mysql_net: number | null;
  d1_net: number | null;
  reason?: string;
}> {
  const conn = await openMysql(env);
  if (!conn) {
    return { ok: false, rebuilt: false, mysql_net: null, d1_net: null, reason: "no_mysql" };
  }
  try {
    const prefix = tablePrefix(env);
    const mysqlTotals = await readMysqlTreasuryLedgerTotals(conn, prefix);
    const d1Totals = await ledgerTotalsBetween(env.DB, CANONICAL_ROOTMC, null, null);
    const drift = Math.abs(mysqlTotals.net - d1Totals.net);
    if (drift < 1) {
      return {
        ok: true,
        rebuilt: false,
        mysql_net: mysqlTotals.net,
        d1_net: d1Totals.net,
        reason: "in_sync",
      };
    }

    const stateRow = await env.DB.prepare(
      `SELECT updated_at FROM rootmc_treasury_sync_state WHERE server_id = ? LIMIT 1`,
    )
      .bind(CANONICAL_ROOTMC)
      .first<{ updated_at: string }>();
    const updatedMs = Date.parse(String(stateRow?.updated_at || ""));
    // Allow rebuild when drift is large; still avoid hammering on every page view.
    if (
      Number.isFinite(updatedMs) &&
      Date.now() - updatedMs < LEDGER_RECONCILE_MIN_INTERVAL_MS &&
      drift < 50
    ) {
      return {
        ok: true,
        rebuilt: false,
        mysql_net: mysqlTotals.net,
        d1_net: d1Totals.net,
        reason: "throttled",
      };
    }

    await rebuildTreasuryLedgerFromMysql(conn, env, prefix);
    const after = await ledgerTotalsBetween(env.DB, CANONICAL_ROOTMC, null, null);
    return {
      ok: true,
      rebuilt: true,
      mysql_net: mysqlTotals.net,
      d1_net: after.net,
      reason: `rebuilt_drift_${roundGold(drift)}`,
    };
  } finally {
    await conn.end().catch(() => undefined);
  }
}

const TOWNY_SERVER_VAULT_UUID = "a73f39b0-1b7c-2930-b4a3-ce101812d926";

async function pullTreasuryBalance(
  conn: Connection,
  env: MysqlEnv,
  _serverId: string,
  syncedAt: string,
  prefix: string,
): Promise<number | null> {
  const table = `${prefix}economy_balances`;
  const [rows] = await conn.query<Array<RowDataPacket & { balance: number }>>(
    `SELECT balance FROM ${table} WHERE minecraft_uuid = ? LIMIT 1`,
    [TOWNY_SERVER_VAULT_UUID],
  );
  const balance = Number(rows[0]?.balance);
  if (Number.isFinite(balance)) {
    await persistTreasuryBalance(env.DB, CANONICAL_ROOTMC, balance, syncedAt);
    return roundGold(balance);
  }
  return null;
}

/** Live towny-server vault from MySQL  -  keeps D1 note_supply/tax aligned with in-game /tax. */
export async function refreshTreasuryVaultFromMysql(env: MysqlEnv): Promise<number | null> {
  try {
    await reconcileTreasuryLedgerFromMysql(env);
  } catch (error) {
    console.warn("treasury_ledger_reconcile_failed", String(error).slice(0, 300));
  }
  const conn = await openMysql(env);
  if (!conn) return null;
  try {
    return await pullTreasuryBalance(conn, env, CANONICAL_ROOTMC, nowIso(), tablePrefix(env));
  } finally {
    await conn.end().catch(() => undefined);
  }
}

async function pullShopListings(
  conn: Connection,
  env: MysqlEnv,
  serverId: string,
  syncedAt: string,
  prefix: string,
): Promise<number> {
  const table = `${prefix}rootstat_shop_listings`;
  const [rows] = await conn.query<
    Array<RowDataPacket & {
      shop_id: string;
      owner_uuid: string | null;
      owner_username: string | null;
      world_name: string;
      x: number;
      y: number;
      z: number;
      item_key: string;
      price: number;
      listing_type: string;
      stock_quantity: number;
    }>
  >(
    `SELECT shop_id, owner_uuid, owner_username, world_name, x, y, z, item_key, price, listing_type,
            COALESCE(stock_quantity, 0) AS stock_quantity
     FROM ${table}`,
  );

  const listingRows = rows.map((row) => ({
    shop_id: row.shop_id,
    owner_uuid: row.owner_uuid,
    owner_username: row.owner_username,
    world: row.world_name,
    x: row.x,
    y: row.y,
    z: row.z,
    item_key: row.item_key,
    price: row.price,
    listing_type: row.listing_type || "sell",
    stock_quantity: Math.max(0, Math.floor(Number(row.stock_quantity) || 0)),
  }));

  const count = await replaceShopListings(env.DB, serverId, listingRows, syncedAt);
  if (serverId !== CANONICAL_ROOTMC && count > 0) {
    await replaceShopListings(env.DB, CANONICAL_ROOTMC, listingRows, syncedAt);
  }
  return count;
}

const TOWNY_MYSQL_PREFIX = "towny_";

type TownyMysqlRow = {
  town_name: string;
  town_uuid: string | null;
  plot_count: number;
  balance: number;
};

/** Enrich D1 town rows from Towny MySQL (plot counts + bank via town UUID in economy_balances). */
async function pullTownyTownEnrichment(
  conn: Connection,
  env: MysqlEnv,
  serverId: string,
  syncedAt: string,
  rootPrefix: string,
): Promise<number> {
  const tp = TOWNY_MYSQL_PREFIX;
  let rows: TownyMysqlRow[] = [];
  const queries = [
    `SELECT t.name AS town_name, LOWER(t.uuid) AS town_uuid,
            COALESCE(pc.plot_count, 0) AS plot_count,
            COALESCE(e.balance, 0) AS balance
     FROM ${tp}TOWNS t
     LEFT JOIN (
       SELECT name, COUNT(*) AS plot_count FROM ${tp}TOWNBLOCKS GROUP BY name
     ) pc ON pc.name = t.name
     LEFT JOIN ${rootPrefix}economy_balances e ON LOWER(e.minecraft_uuid) = LOWER(t.uuid)`,
    `SELECT t.name AS town_name, LOWER(t.uuid) AS town_uuid,
            COALESCE(pc.plot_count, 0) AS plot_count, 0 AS balance
     FROM ${tp}TOWNS t
     LEFT JOIN (
       SELECT name, COUNT(*) AS plot_count FROM ${tp}TOWNBLOCKS GROUP BY name
     ) pc ON pc.name = t.name`,
  ];

  for (const sql of queries) {
    try {
      const [result] = await conn.query<Array<RowDataPacket & Record<string, unknown>>>(sql);
      rows = (result || []).map((row) => ({
        town_name: String(row.town_name || "").trim(),
        town_uuid: row.town_uuid ? String(row.town_uuid).trim().toLowerCase() : null,
        plot_count: Math.max(0, Math.floor(Number(row.plot_count) || 0)),
        balance: Math.max(0, roundGold(Number(row.balance) || 0)),
      }));
      if (rows.length) break;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.warn("towny_mysql_enrichment_query_failed", msg.slice(0, 200));
    }
  }

  if (!rows.length) return 0;

  let updated = 0;
  for (const row of rows) {
    if (!row.town_name) continue;
    const res = await env.DB.prepare(
      `UPDATE rootmc_towny_towns
       SET plot_count = ?, town_balance_gold = ?, synced_at = ?
       WHERE server_id = ? AND is_active = 1
         AND (LOWER(town_uuid) = ? OR LOWER(town_name) = LOWER(?))`,
    )
      .bind(
        row.plot_count,
        row.balance,
        syncedAt,
        serverId,
        row.town_uuid || "__none__",
        row.town_name,
      )
      .run();
    updated += res.meta?.changes ?? 0;
  }

  console.log(
    "towny_mysql_enrichment_ok",
    serverId,
    `towns=${rows.length}`,
    `updated=${updated}`,
    `plots=${rows.reduce((s, r) => s + r.plot_count, 0)}`,
  );
  return updated;
}

async function pullListingVotes(
  conn: Connection,
  env: MysqlEnv,
  syncedAt: string,
  prefix: string,
): Promise<number> {
  const table = `${prefix}rewards_votes`;
  try {
    const [rows] = await conn.query<Array<RowDataPacket & { uuid: string; service: string; voted_at: Date | string }>>(
      `SELECT uuid, service, voted_at FROM ${table} ORDER BY voted_at DESC LIMIT 50000`,
    );
    let count = 0;
    for (const row of rows || []) {
      const uuid = normalizeUuid(row.uuid);
      const rawService = String(row.service ?? "").trim();
      const service = canonicalListingSiteId(rawService) ?? rawService.toLowerCase();
      if (!uuid || !service || service === "unknown") continue;
      const votedAt =
        row.voted_at instanceof Date
          ? row.voted_at.toISOString()
          : new Date(String(row.voted_at)).toISOString();
      await env.DB.prepare(
        `INSERT INTO rootmc_listing_votes (minecraft_uuid, service, voted_at, synced_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(minecraft_uuid, service, voted_at) DO UPDATE SET synced_at = excluded.synced_at`,
      )
        .bind(uuid, service, votedAt, syncedAt)
        .run();
      count++;
    }
    return count;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("doesn't exist") || msg.includes("Unknown table")) {
      return 0;
    }
    throw e;
  }
}

async function pullPhysicalGold(
  conn: Connection,
  env: MysqlEnv,
  serverId: string,
  syncedAt: string,
  prefix: string,
): Promise<number> {
  try {
    const [summaryRows] = await conn.query<Array<RowDataPacket & Record<string, unknown>>>(
      `SELECT total_storage_g, unattributed_g, player_count, shops_scanned,
              chunks_scanned, towny_blocks_scanned
       FROM ${prefix}physical_gold_summary
       ORDER BY updated_at DESC
       LIMIT 1`,
    );
    const summary = summaryRows[0];
    if (!summary) return 0;
    const [players] = await conn.query<Array<RowDataPacket & Record<string, unknown>>>(
      `SELECT minecraft_uuid, minecraft_username, inventory_g, ender_g, shop_g,
              chest_g, towny_placed_g, total_g
       FROM ${prefix}player_physical_gold
       WHERE server_id = (
         SELECT server_id FROM ${prefix}physical_gold_summary
         ORDER BY updated_at DESC LIMIT 1
       )`,
    );
    const body = {
      total_g: Number(summary.total_storage_g) || 0,
      unattributed_g: Number(summary.unattributed_g) || 0,
      shops_scanned: Number(summary.shops_scanned) || 0,
      chunks_scanned: Number(summary.chunks_scanned) || 0,
      towny_blocks_scanned: Number(summary.towny_blocks_scanned) || 0,
      players,
    };
    await upsertPhysicalGoldScan(env.DB, serverId, body, syncedAt);
    if (serverId !== CANONICAL_ROOTMC) {
      await upsertPhysicalGoldScan(env.DB, CANONICAL_ROOTMC, body, syncedAt);
    }
    return players.length;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("doesn't exist") || msg.includes("Unknown table")) return 0;
    throw e;
  }
}

async function pullTownySnapshot(
  conn: Connection,
  env: MysqlEnv,
  serverId: string,
  prefix: string,
): Promise<{ towns: number; nations: number }> {
  try {
    const [serverRows] = await conn.query<Array<RowDataPacket & { server_id: string }>>(
      `SELECT server_id FROM ${prefix}towny_towns_snapshot ORDER BY updated_at DESC LIMIT 1`,
    );
    const sourceServerId = serverRows[0]?.server_id;
    if (!sourceServerId) return { towns: 0, nations: 0 };
    const [towns] = await conn.query<Array<RowDataPacket & Record<string, unknown>>>(
      `SELECT town_uuid, town_name, mayor_uuid, mayor_name, resident_count,
              nation_name, is_capital, plot_count, town_balance_gold
       FROM ${prefix}towny_towns_snapshot WHERE server_id = ?`,
      [sourceServerId],
    );
    const [nations] = await conn.query<Array<RowDataPacket & Record<string, unknown>>>(
      `SELECT nation_uuid, nation_name, leader_uuid, leader_name, town_count
       FROM ${prefix}towny_nations_snapshot WHERE server_id = ?`,
      [sourceServerId],
    );
    const result = await applyTownySnapshot(env, serverId, { towns, nations });
    return { towns: result.towns, nations: result.nations };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("doesn't exist") || message.includes("Unknown table")) {
      return { towns: 0, nations: 0 };
    }
    throw error;
  }
}

/** One-shot Towny plot/bank enrichment (server auth or cron). */
export async function runTownyMysqlEnrichmentNow(env: MysqlEnv): Promise<{ ok: boolean; updated: number; detail?: string }> {
  const conn = await openMysql(env);
  if (!conn) {
    return { ok: false, updated: 0, detail: "ROOTMC_MYSQL not configured" };
  }
  const syncedAt = nowIso();
  const featuredId = await resolveServerId(env.DB);
  const prefix = tablePrefix(env);
  try {
    const updated = await pullTownyTownEnrichment(conn, env, featuredId, syncedAt, prefix);
    return { ok: true, updated };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, updated: 0, detail: msg.slice(0, 300) };
  } finally {
    await conn.end().catch(() => undefined);
  }
}

/** Cron: MySQL -> D1 economy read model. No-op when ROOTMC_MYSQL Hyperdrive binding is missing.
 * Writes to LEGACY_DB (pre-cutover archive) when bound, so it does not interfere with LIVE_DB / Hyperdrive full sync. */
export async function runMysqlEconomyPullCron(env: MysqlEnv): Promise<void> {
  const legacy = (env as { LEGACY_DB?: D1Database }).LEGACY_DB;
  const pullEnv: MysqlEnv = legacy ? { ...env, DB: legacy } : env;
  const conn = await openMysql(pullEnv);
  if (!conn) {
    return;
  }

  const syncedAt = nowIso();
  const serverId = await resolveEconomyServerId(pullEnv.DB, CANONICAL_ROOTMC);
  const featuredId = await resolveServerId(pullEnv.DB);

  try {
    await ensurePullStateTable(pullEnv);
    if (await shouldThrottlePull(pullEnv, serverId)) {
      return;
    }

    const prefix = tablePrefix(pullEnv);
    const balances = await pullBalances(conn, pullEnv, serverId, syncedAt, prefix);
    const goldFound = await pullGoldFound(conn, pullEnv, serverId, syncedAt, prefix);
    const playtime = await pullPlaytimeMonthly(conn, pullEnv, serverId, syncedAt, prefix);
    const playtimeTotals = await pullTotalPlaytime(conn, pullEnv, serverId, syncedAt, prefix);
    if (serverId !== CANONICAL_ROOTMC) {
      await pullTotalPlaytime(conn, pullEnv, CANONICAL_ROOTMC, syncedAt, prefix);
    }
    const ledger = await pullTreasuryLedger(conn, pullEnv, serverId, syncedAt, prefix);
    await pullTreasuryBalance(conn, pullEnv, serverId, syncedAt, prefix);
    const shops = await pullShopListings(conn, pullEnv, serverId, syncedAt, prefix);
    const physicalGold = await pullPhysicalGold(conn, pullEnv, serverId, syncedAt, prefix);
    const towny = await pullTownySnapshot(conn, pullEnv, featuredId, prefix);
    const priceHistory = await recordShopPriceHistory(pullEnv.DB, serverId, syncedAt);
    const townyEnriched = await pullTownyTownEnrichment(conn, pullEnv, featuredId, syncedAt, prefix);

    await recomputeNetWorth(pullEnv.DB, serverId, syncedAt);
    if (serverId !== CANONICAL_ROOTMC) {
      await recomputeNetWorth(pullEnv.DB, CANONICAL_ROOTMC, syncedAt);
    }

    const treasuryId = CANONICAL_ROOTMC;
    const [walletNotes, physicalSummary] = await Promise.all([
      readPlayerWalletNotesTotal(pullEnv.DB, treasuryId),
      physicalGoldSummaryForServer(pullEnv.DB, treasuryId),
    ]);
    await recordHolderSupplyDaily(
      pullEnv.DB,
      treasuryId,
      { player_notes_g: walletNotes, physical_gold_g: physicalSummary.total_storage_g },
      syncedAt,
    );

    const listingVotes = await pullListingVotes(conn, pullEnv, syncedAt, prefix);

    let listHostRows = 0;
    try {
      const listSnap = await runListTotalsSnapshot(pullEnv, conn, prefix);
      listHostRows = listSnap.hostRows;
    } catch (listErr) {
      const msg = listErr instanceof Error ? listErr.message : String(listErr);
      console.warn("list_totals_snapshot_failed", msg.slice(0, 300));
    }

    await markPullComplete(pullEnv, serverId, syncedAt);

    console.log(
      "mysql_economy_pull_ok",
      serverId,
      `balances=${balances}`,
      `gold_found=${goldFound}`,
      `playtime=${playtime}`,
      `playtime_totals=${playtimeTotals}`,
      `ledger=${ledger}`,
      `shops=${shops}`,
      `physical_gold=${physicalGold}`,
      `towns=${towny.towns}`,
      `nations=${towny.nations}`,
      `price_history=${priceHistory}`,
      `towny_enriched=${townyEnriched}`,
      `listing_votes=${listingVotes}`,
      `list_totals=${listHostRows}`,
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("mysql_economy_pull_failed", msg.slice(0, 500));
  } finally {
    await conn.end().catch(() => undefined);
  }
}
