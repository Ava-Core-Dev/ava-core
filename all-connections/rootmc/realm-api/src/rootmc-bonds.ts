import type { D1Database } from "@cloudflare/workers-types";
import type { Connection, RowDataPacket } from "mysql2/promise";

import { json } from "./cors";
import { record, resolveEconomyServerId, str } from "./realm-lib";
import type { RootStatEnv } from "./rootstat-minecraft";
import { validateServerAuth } from "./rootstat-minecraft";
import { openRootMcMysql, rootMcMysqlTablePrefix, withShortPublicCache } from "./rootmc-hyperdrive";

function nowIso(): string {
  return new Date().toISOString();
}

function normalizeMinecraftUuid(raw: string): string | null {
  const uuid = str(raw).toLowerCase();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(uuid)) {
    return null;
  }
  return uuid;
}

function num(v: unknown, fallback = 0): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

/** Drop rows missing from the latest server snapshot (e.g. redeemed bonds). */
async function purgeStaleRows(
  db: D1Database,
  table: string,
  idColumn: string,
  serverId: string,
  keepIds: string[],
  extraWhere = "",
): Promise<number> {
  const whereExtra = extraWhere ? ` AND ${extraWhere}` : "";
  if (keepIds.length === 0) {
    const result = await db
      .prepare(`DELETE FROM ${table} WHERE server_id = ?${whereExtra}`)
      .bind(serverId)
      .run();
    return result.meta.changes ?? 0;
  }
  const placeholders = keepIds.map(() => "?").join(", ");
  const result = await db
    .prepare(
      `DELETE FROM ${table} WHERE server_id = ? AND ${idColumn} NOT IN (${placeholders})${whereExtra}`,
    )
    .bind(serverId, ...keepIds)
    .run();
  return result.meta.changes ?? 0;
}

export async function handleBondsSync(request: Request, env: RootStatEnv): Promise<Response> {
  const server = await validateServerAuth(env, request);
  if (server instanceof Response) return server;

  let body: Record<string, unknown> = {};
  try {
    body = record(JSON.parse(await request.text()));
  } catch {
    return json({ detail: "Invalid JSON body." }, 400);
  }

  const syncedAt = str(body.synced_at) || nowIso();
  const incomeShare = num(body.income_share, 0.25);
  const pendingMcDayId = Math.max(0, Math.floor(num(body.pending_mc_day_id)));
  const pendingGrossInflow = Math.max(0, num(body.pending_gross_inflow_g));
  const pendingEstimatedPool = pendingGrossInflow * incomeShare;

  const bondRows = Array.isArray(body.bonds) ? body.bonds : [];
  let bondsUpserted = 0;
  const syncedBondIds: string[] = [];
  for (const raw of bondRows) {
    const row = record(raw);
    const bondId = str(row.bond_id);
    const ownerUuid = normalizeMinecraftUuid(str(row.owner_uuid));
    if (!bondId || !ownerUuid) continue;
    const principal = num(row.principal_g);
    const issuedAt = str(row.issued_at);
    if (!issuedAt || principal <= 0) continue;
    syncedBondIds.push(bondId);
    await env.DB.prepare(
      `INSERT INTO rootmc_bonds
         (server_id, bond_id, owner_uuid, owner_name, display_name, principal_g, issued_at, redeemed_at, synced_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(server_id, bond_id) DO UPDATE SET
         owner_uuid = excluded.owner_uuid,
         owner_name = excluded.owner_name,
         display_name = excluded.display_name,
         principal_g = excluded.principal_g,
         issued_at = excluded.issued_at,
         redeemed_at = excluded.redeemed_at,
         synced_at = excluded.synced_at`,
    )
      .bind(
        server.serverId,
        bondId,
        ownerUuid,
        str(row.owner_name) || "?",
        str(row.display_name) || "Bond",
        principal,
        issuedAt,
        str(row.redeemed_at) || null,
        syncedAt,
      )
      .run();
    bondsUpserted++;
  }
  const bondsPurged = await purgeStaleRows(
    env.DB,
    "rootmc_bonds",
    "bond_id",
    server.serverId,
    syncedBondIds,
    "redeemed_at IS NULL",
  );

  const playerRows = Array.isArray(body.players) ? body.players : [];
  let playersUpserted = 0;
  const syncedPlayerUuids: string[] = [];
  for (const raw of playerRows) {
    const row = record(raw);
    const ownerUuid = normalizeMinecraftUuid(str(row.owner_uuid));
    if (!ownerUuid) continue;
    syncedPlayerUuids.push(ownerUuid);
    await env.DB.prepare(
      `INSERT INTO rootmc_bonds_player_stats
         (server_id, owner_uuid, owner_name, active_bonds, principal_g, uncollected_g, lifetime_earned_g, weight_pct, avg_24h_g, synced_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(server_id, owner_uuid) DO UPDATE SET
         owner_name = excluded.owner_name,
         active_bonds = excluded.active_bonds,
         principal_g = excluded.principal_g,
         uncollected_g = excluded.uncollected_g,
         lifetime_earned_g = excluded.lifetime_earned_g,
         weight_pct = excluded.weight_pct,
         avg_24h_g = excluded.avg_24h_g,
         synced_at = excluded.synced_at`,
    )
      .bind(
        server.serverId,
        ownerUuid,
        str(row.owner_name) || "?",
        Math.max(0, Math.floor(num(row.active_bonds))),
        num(row.principal_g),
        num(row.uncollected_g),
        num(row.lifetime_earned_g),
        num(row.weight_pct),
        num(row.avg_24h_g),
        syncedAt,
      )
      .run();
    playersUpserted++;
  }
  const playersPurged = await purgeStaleRows(
    env.DB,
    "rootmc_bonds_player_stats",
    "owner_uuid",
    server.serverId,
    syncedPlayerUuids,
  );

  const govRows = Array.isArray(body.governments) ? body.governments : [];
  let governmentsUpserted = 0;
  const syncedGovUuids: string[] = [];
  for (const raw of govRows) {
    const row = record(raw);
    const accountUuid = normalizeMinecraftUuid(str(row.account_uuid));
    if (!accountUuid) continue;
    syncedGovUuids.push(accountUuid);
    await env.DB.prepare(
      `INSERT INTO rootmc_bonds_government_stats
         (server_id, account_uuid, account_name, kind, display_name, principal_g, lifetime_earned_g, weight_pct, synced_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(server_id, account_uuid) DO UPDATE SET
         account_name = excluded.account_name,
         kind = excluded.kind,
         display_name = excluded.display_name,
         principal_g = excluded.principal_g,
         lifetime_earned_g = excluded.lifetime_earned_g,
         weight_pct = excluded.weight_pct,
         synced_at = excluded.synced_at`,
    )
      .bind(
        server.serverId,
        accountUuid,
        str(row.account_name) || "?",
        str(row.kind) || "town",
        str(row.display_name) || "?",
        num(row.principal_g),
        num(row.lifetime_earned_g),
        num(row.weight_pct),
        syncedAt,
      )
      .run();
    governmentsUpserted++;
  }
  const governmentsPurged = await purgeStaleRows(
    env.DB,
    "rootmc_bonds_government_stats",
    "account_uuid",
    server.serverId,
    syncedGovUuids,
  );

  const dailyRows = Array.isArray(body.daily_settlements) ? body.daily_settlements : [];
  let dailyUpserted = 0;
  for (const raw of dailyRows) {
    const row = record(raw);
    const mcDayId = Math.floor(num(row.mc_day_id));
    if (mcDayId <= 0) continue;
    const settledAt = str(row.settled_at) || syncedAt;
    await env.DB.prepare(
      `INSERT INTO rootmc_bonds_daily
         (server_id, mc_day_id, gross_inflow_g, bond_pool_g, income_share, total_principal_g, active_bonds, settled_at, synced_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(server_id, mc_day_id) DO UPDATE SET
         gross_inflow_g = excluded.gross_inflow_g,
         bond_pool_g = excluded.bond_pool_g,
         income_share = excluded.income_share,
         total_principal_g = excluded.total_principal_g,
         active_bonds = excluded.active_bonds,
         settled_at = excluded.settled_at,
         synced_at = excluded.synced_at`,
    )
      .bind(
        server.serverId,
        mcDayId,
        num(row.gross_inflow_g),
        num(row.bond_pool_g),
        num(row.income_share, incomeShare),
        num(row.total_principal_g),
        Math.max(0, Math.floor(num(row.active_bonds))),
        settledAt,
        syncedAt,
      )
      .run();
    dailyUpserted++;
  }

  const payoutRows = Array.isArray(body.daily_payouts) ? body.daily_payouts : [];
  let payoutsUpserted = 0;
  for (const raw of payoutRows) {
    const row = record(raw);
    const mcDayId = Math.floor(num(row.mc_day_id));
    const ownerUuid = normalizeMinecraftUuid(str(row.owner_uuid));
    if (mcDayId <= 0 || !ownerUuid) continue;
    const settledAt = str(row.settled_at) || syncedAt;
    const existing = await env.DB.prepare(
      `SELECT id FROM rootmc_bonds_daily_payout
       WHERE server_id = ? AND mc_day_id = ? AND owner_uuid = ? LIMIT 1`,
    )
      .bind(server.serverId, mcDayId, ownerUuid)
      .first<{ id: number }>();
    if (existing?.id) {
      await env.DB.prepare(
        `UPDATE rootmc_bonds_daily_payout SET
           owner_name = ?, amount_g = ?, weight_pct = ?, principal_g = ?, settled_at = ?, synced_at = ?
         WHERE id = ?`,
      )
        .bind(
          str(row.owner_name) || "?",
          num(row.amount_g),
          num(row.weight_pct),
          num(row.principal_g),
          settledAt,
          syncedAt,
          existing.id,
        )
        .run();
    } else {
      await env.DB.prepare(
        `INSERT INTO rootmc_bonds_daily_payout
           (server_id, mc_day_id, owner_uuid, owner_name, amount_g, weight_pct, principal_g, settled_at, synced_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
        .bind(
          server.serverId,
          mcDayId,
          ownerUuid,
          str(row.owner_name) || "?",
          num(row.amount_g),
          num(row.weight_pct),
          num(row.principal_g),
          settledAt,
          syncedAt,
        )
        .run();
    }
    payoutsUpserted++;
  }

  const CANONICAL_ROOTMC = "rootmc";
  if (server.serverId !== CANONICAL_ROOTMC && (bondsUpserted > 0 || playersUpserted > 0)) {
    await mirrorBondsSnapshot(env.DB, server.serverId, CANONICAL_ROOTMC, syncedAt);
  }

  await env.DB.prepare(
    `INSERT INTO rootmc_bonds_live_state
       (server_id, current_mc_day_id, pending_gross_inflow_g, pending_estimated_pool_g, synced_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(server_id) DO UPDATE SET
       current_mc_day_id = excluded.current_mc_day_id,
       pending_gross_inflow_g = excluded.pending_gross_inflow_g,
       pending_estimated_pool_g = excluded.pending_estimated_pool_g,
       synced_at = excluded.synced_at`,
  )
    .bind(server.serverId, pendingMcDayId, pendingGrossInflow, pendingEstimatedPool, syncedAt)
    .run();

  return json({
    ok: true,
    server_id: server.serverId,
    bonds_upserted: bondsUpserted,
    bonds_purged: bondsPurged,
    players_upserted: playersUpserted,
    players_purged: playersPurged,
    governments_upserted: governmentsUpserted,
    governments_purged: governmentsPurged,
    daily_upserted: dailyUpserted,
    payouts_upserted: payoutsUpserted,
    synced_at: syncedAt,
  });
}

async function mirrorBondsSnapshot(
  db: D1Database,
  fromServer: string,
  toServer: string,
  syncedAt: string,
): Promise<void> {
  const bonds = await db
    .prepare(`SELECT * FROM rootmc_bonds WHERE server_id = ?`)
    .bind(fromServer)
    .all<Record<string, unknown>>();
  for (const row of bonds.results ?? []) {
    await db
      .prepare(
        `INSERT INTO rootmc_bonds
           (server_id, bond_id, owner_uuid, owner_name, display_name, principal_g, issued_at, redeemed_at, synced_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(server_id, bond_id) DO UPDATE SET
           owner_uuid = excluded.owner_uuid,
           owner_name = excluded.owner_name,
           display_name = excluded.display_name,
           principal_g = excluded.principal_g,
           issued_at = excluded.issued_at,
           redeemed_at = excluded.redeemed_at,
           synced_at = excluded.synced_at`,
      )
      .bind(
        toServer,
        str(row.bond_id),
        str(row.owner_uuid),
        str(row.owner_name),
        str(row.display_name),
        num(row.principal_g),
        str(row.issued_at),
        row.redeemed_at == null ? null : str(row.redeemed_at),
        syncedAt,
      )
      .run();
  }

  const players = await db
    .prepare(`SELECT * FROM rootmc_bonds_player_stats WHERE server_id = ?`)
    .bind(fromServer)
    .all<Record<string, unknown>>();
  for (const row of players.results ?? []) {
    await db
      .prepare(
        `INSERT INTO rootmc_bonds_player_stats
           (server_id, owner_uuid, owner_name, active_bonds, principal_g, uncollected_g, lifetime_earned_g, weight_pct, avg_24h_g, synced_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(server_id, owner_uuid) DO UPDATE SET
           owner_name = excluded.owner_name,
           active_bonds = excluded.active_bonds,
           principal_g = excluded.principal_g,
           uncollected_g = excluded.uncollected_g,
           lifetime_earned_g = excluded.lifetime_earned_g,
           weight_pct = excluded.weight_pct,
           avg_24h_g = excluded.avg_24h_g,
           synced_at = excluded.synced_at`,
      )
      .bind(
        toServer,
        str(row.owner_uuid),
        str(row.owner_name),
        Math.floor(num(row.active_bonds)),
        num(row.principal_g),
        num(row.uncollected_g),
        num(row.lifetime_earned_g),
        num(row.weight_pct),
        num(row.avg_24h_g),
        syncedAt,
      )
      .run();
  }
}

async function bondsSummary(db: D1Database, serverId: string) {
  const active = await db
    .prepare(
      `SELECT COUNT(*) AS active_bonds, COALESCE(SUM(principal_g), 0) AS total_principal_g
       FROM rootmc_bonds WHERE server_id = ? AND redeemed_at IS NULL`,
    )
    .bind(serverId)
    .first<{ active_bonds: number; total_principal_g: number }>();

  const holders = await db
    .prepare(
      `SELECT COUNT(DISTINCT owner_uuid) AS holder_count
       FROM rootmc_bonds WHERE server_id = ? AND redeemed_at IS NULL`,
    )
    .bind(serverId)
    .first<{ holder_count: number }>();

  const accrued = await db
    .prepare(
      `SELECT COALESCE(SUM(uncollected_g), 0) AS uncollected_g,
              COALESCE(SUM(lifetime_earned_g), 0) AS lifetime_earned_g
       FROM rootmc_bonds_player_stats WHERE server_id = ?`,
    )
    .bind(serverId)
    .first<{ uncollected_g: number; lifetime_earned_g: number }>();

  const gov = await db
    .prepare(
      `SELECT COALESCE(SUM(principal_g), 0) AS gov_principal_g,
              COALESCE(SUM(lifetime_earned_g), 0) AS gov_lifetime_g
       FROM rootmc_bonds_government_stats WHERE server_id = ?`,
    )
    .bind(serverId)
    .first<{ gov_principal_g: number; gov_lifetime_g: number }>();

  const lastDay = await db
    .prepare(
      `SELECT mc_day_id, gross_inflow_g, bond_pool_g, income_share, total_principal_g, active_bonds, settled_at
       FROM rootmc_bonds_daily WHERE server_id = ?
       ORDER BY mc_day_id DESC LIMIT 1`,
    )
    .bind(serverId)
    .first<Record<string, unknown>>();

  const dayCount = await db
    .prepare(`SELECT COUNT(*) AS c FROM rootmc_bonds_daily WHERE server_id = ?`)
    .bind(serverId)
    .first<{ c: number }>();

  const pool7d = await db
    .prepare(
      `SELECT COALESCE(SUM(bond_pool_g), 0) AS pool_7d
       FROM rootmc_bonds_daily
       WHERE server_id = ? AND settled_at >= datetime('now', '-7 days')`,
    )
    .bind(serverId)
    .first<{ pool_7d: number }>();

  const pool24h = await db
    .prepare(
      `SELECT COALESCE(SUM(bond_pool_g), 0) AS pool_24h
       FROM rootmc_bonds_daily
       WHERE server_id = ? AND settled_at >= datetime('now', '-1 day')`,
    )
    .bind(serverId)
    .first<{ pool_24h: number }>();

  const yieldRows = await db
    .prepare(
      `SELECT bond_pool_g, total_principal_g
       FROM rootmc_bonds_daily
       WHERE server_id = ? AND total_principal_g >= 0.001
       ORDER BY mc_day_id DESC
       LIMIT 48`,
    )
    .bind(serverId)
    .all<{ bond_pool_g: number; total_principal_g: number }>();

  let avgYieldPct = 0;
  let yieldSampleDays = 0;
  const yieldList = yieldRows.results || [];
  for (const row of yieldList) {
    const principal = num(row.total_principal_g);
    if (principal < 0.001) continue;
    avgYieldPct += (num(row.bond_pool_g) / principal) * 100;
    yieldSampleDays += 1;
  }
  if (yieldSampleDays > 0) {
    avgYieldPct /= yieldSampleDays;
  }

  const liveState = await db
    .prepare(
      `SELECT current_mc_day_id, pending_gross_inflow_g, pending_estimated_pool_g, synced_at
       FROM rootmc_bonds_live_state WHERE server_id = ? LIMIT 1`,
    )
    .bind(serverId)
    .first<Record<string, unknown>>();

  const incomeShare = lastDay ? num(lastDay.income_share, 0.25) : 0.25;
  const activePrincipal = num(active?.total_principal_g);
  const govPrincipal = num(gov?.gov_principal_g);
  // rootmc_bonds is personal /bonds paper; town/nation auto-bonds live in town/nation banks.
  const playerPrincipal =
    govPrincipal > activePrincipal + 0.01
      ? activePrincipal
      : Math.max(0, activePrincipal - govPrincipal);
  const totalPrincipal = activePrincipal;

  return {
    active_bonds: Math.floor(num(active?.active_bonds)),
    holder_count: Math.floor(num(holders?.holder_count)),
    total_principal_g: totalPrincipal,
    player_principal_g: playerPrincipal,
    government_principal_g: govPrincipal,
    uncollected_g: num(accrued?.uncollected_g),
    lifetime_earned_g: num(accrued?.lifetime_earned_g) + num(gov?.gov_lifetime_g),
    income_share: incomeShare,
    income_share_pct: Math.round(incomeShare * 1000) / 10,
    settlement_days: Math.floor(num(dayCount?.c)),
    pool_7d_g: num(pool7d?.pool_7d),
    pool_24h_g: num(pool24h?.pool_24h),
    avg_pool_per_mc_day_7d:
      num(pool7d?.pool_7d) / Math.max(1, Math.min(7, Math.floor(num(dayCount?.c)))),
    avg_daily_yield_pct: Math.round(avgYieldPct * 10000) / 10000,
    avg_daily_yield_g_per_g: Math.round((avgYieldPct / 100) * 1e8) / 1e8,
    avg_daily_yield_sample_days: yieldSampleDays,
    last_settlement: lastDay
      ? {
          mc_day_id: Math.floor(num(lastDay.mc_day_id)),
          gross_inflow_g: num(lastDay.gross_inflow_g),
          bond_pool_g: num(lastDay.bond_pool_g),
          total_principal_g: num(lastDay.total_principal_g),
          active_bonds: Math.floor(num(lastDay.active_bonds)),
          settled_at: str(lastDay.settled_at),
        }
      : null,
    pending_day: liveState
      ? {
          mc_day_id: Math.floor(num(liveState.current_mc_day_id)),
          gross_inflow_g: num(liveState.pending_gross_inflow_g),
          estimated_pool_g: num(liveState.pending_estimated_pool_g),
          synced_at: str(liveState.synced_at),
        }
      : null,
  };
}

export async function readBondsSummary(db: D1Database, serverId: string) {
  return bondsSummary(db, serverId);
}

async function mysqlBondsSummary(
  connection: Connection,
  prefix: string,
  dailyLimit: number,
) {
  const [activeRows] = await connection.query<Array<RowDataPacket & Record<string, unknown>>>(
    `SELECT COUNT(*) AS active_bonds,
            COUNT(DISTINCT owner_uuid) AS holder_count,
            COALESCE(SUM(principal), 0) AS total_principal_g
     FROM ${prefix}bonds WHERE redeemed_at IS NULL`,
  );
  const [accruedRows] = await connection.query<Array<RowDataPacket & Record<string, unknown>>>(
    `SELECT COALESCE(SUM(accrued_g), 0) AS uncollected_g,
            COALESCE(SUM(lifetime_earned_g), 0) AS lifetime_earned_g
     FROM ${prefix}bonds_accrued`,
  );
  const [daily] = await connection.query<Array<RowDataPacket & Record<string, unknown>>>(
    `SELECT mc_day_id, gross_inflow_g, bond_pool_g, total_principal_g,
            active_bonds, settled_at
     FROM ${prefix}bonds_daily ORDER BY mc_day_id DESC LIMIT ?`,
    [dailyLimit],
  );
  const [pendingRows] = await connection.query<Array<RowDataPacket & Record<string, unknown>>>(
    `SELECT mc_day_id, gross_inflow_g
     FROM ${prefix}bonds_day_inflow ORDER BY mc_day_id DESC LIMIT 1`,
  );
  const [players] = await connection.query<Array<RowDataPacket & Record<string, unknown>>>(
    `SELECT b.owner_uuid, MAX(b.owner_name) AS owner_name,
            COUNT(*) AS active_bonds, SUM(b.principal) AS principal_g,
            COALESCE(a.accrued_g, 0) AS uncollected_g,
            COALESCE(a.lifetime_earned_g, 0) AS lifetime_earned_g
     FROM ${prefix}bonds b
     LEFT JOIN ${prefix}bonds_accrued a ON a.owner_uuid = b.owner_uuid
     WHERE b.redeemed_at IS NULL
     GROUP BY b.owner_uuid, a.accrued_g, a.lifetime_earned_g
     ORDER BY principal_g DESC LIMIT 100`,
  );
  const [governments] = await connection.query<Array<RowDataPacket & Record<string, unknown>>>(
    `SELECT g.account_uuid, g.display_name AS account_name, g.kind, g.display_name,
            COALESCE(e.balance, 0) AS principal_g,
            COALESCE(a.lifetime_earned_g, 0) AS lifetime_earned_g
     FROM ${prefix}bonds_government_settings g
     LEFT JOIN ${prefix}economy_balances e ON e.minecraft_uuid = g.account_uuid
     LEFT JOIN ${prefix}bonds_accrued a ON a.owner_uuid = g.account_uuid
     WHERE g.auto_bond_enabled = 1
     ORDER BY principal_g DESC LIMIT 100`,
  );
  const active = activeRows[0] || {};
  const accrued = accruedRows[0] || {};
  const last = daily[0] || null;
  const pool7d = daily
    .filter((row) => Date.now() - new Date(String(row.settled_at)).getTime() <= 7 * 86400000)
    .reduce((sum, row) => sum + num(row.bond_pool_g), 0);
  const pool24h = daily
    .filter((row) => Date.now() - new Date(String(row.settled_at)).getTime() <= 86400000)
    .reduce((sum, row) => sum + num(row.bond_pool_g), 0);
  const yieldRows = daily.filter((row) => num(row.total_principal_g) >= 0.001).slice(0, 48);
  const avgYieldPct =
    yieldRows.length === 0
      ? 0
      : yieldRows.reduce(
          (sum, row) => sum + (num(row.bond_pool_g) / num(row.total_principal_g)) * 100,
          0,
        ) / yieldRows.length;
  const totalPrincipal = num(active.total_principal_g);
  const govPrincipal = governments.reduce((sum, row) => sum + num(row.principal_g), 0);
  const pending = pendingRows[0];
  return {
    summary: {
      active_bonds: Math.floor(num(active.active_bonds)),
      holder_count:
        Math.floor(num(active.holder_count)) +
        governments.filter((row) => num(row.principal_g) > 0).length,
      total_principal_g: totalPrincipal + govPrincipal,
      player_principal_g: totalPrincipal,
      government_principal_g: govPrincipal,
      uncollected_g: num(accrued.uncollected_g),
      lifetime_earned_g: num(accrued.lifetime_earned_g),
      income_share: 0.25,
      income_share_pct: 25,
      settlement_days: daily.length,
      pool_7d_g: pool7d,
      pool_24h_g: pool24h,
      avg_pool_per_mc_day_7d: pool7d / Math.max(1, Math.min(7, daily.length)),
      avg_daily_yield_pct: Math.round(avgYieldPct * 10000) / 10000,
      avg_daily_yield_g_per_g: Math.round((avgYieldPct / 100) * 1e8) / 1e8,
      avg_daily_yield_sample_days: yieldRows.length,
      last_settlement: last,
      pending_day: pending
        ? {
            mc_day_id: Math.floor(num(pending.mc_day_id)),
            gross_inflow_g: num(pending.gross_inflow_g),
            estimated_pool_g: num(pending.gross_inflow_g) * 0.25,
          }
        : null,
    },
    daily,
    players,
    governments,
  };
}

async function mysqlPlayerBonds(
  connection: Connection,
  prefix: string,
  playerUuid: string,
) {
  const [bonds] = await connection.query<Array<RowDataPacket & Record<string, unknown>>>(
    `SELECT id AS bond_id, display_name, principal AS principal_g, issued_at, redeemed_at
     FROM ${prefix}bonds WHERE owner_uuid = ?
     ORDER BY issued_at DESC LIMIT 200`,
    [playerUuid],
  );
  const [accrued] = await connection.query<Array<RowDataPacket & Record<string, unknown>>>(
    `SELECT accrued_g AS uncollected_g, lifetime_earned_g
     FROM ${prefix}bonds_accrued WHERE owner_uuid = ? LIMIT 1`,
    [playerUuid],
  );
  const [payouts] = await connection.query<Array<RowDataPacket & Record<string, unknown>>>(
    `SELECT mc_day_id, amount_g, weight_pct, principal_g, settled_at
     FROM ${prefix}bonds_daily_payout
     WHERE owner_uuid = ? ORDER BY settled_at DESC LIMIT 120`,
    [playerUuid],
  );
  const active = bonds.filter((row) => !row.redeemed_at);
  const principal = active.reduce((sum, row) => sum + num(row.principal_g), 0);
  const earned24h = payouts
    .filter((row) => Date.now() - new Date(String(row.settled_at)).getTime() <= 86400000)
    .reduce((sum, row) => sum + num(row.amount_g), 0);
  return {
    stats: {
      owner_uuid: playerUuid,
      owner_name: active[0]?.owner_name || null,
      active_bonds: active.length,
      principal_g: principal,
      uncollected_g: num(accrued[0]?.uncollected_g),
      lifetime_earned_g: num(accrued[0]?.lifetime_earned_g),
    },
    bonds,
    payouts,
    earned24h,
  };
}

export async function handleBondsPublicRoutes(
  request: Request,
  env: RootStatEnv,
  subpath: string,
  method: string,
): Promise<Response | null> {
  if (!subpath.startsWith("/rootmc/server")) return null;
  const rest = subpath.slice("/rootmc/server".length) || "/";

  const summaryMatch = rest.match(/^\/([^/]+)\/bonds$/);
  if (method === "GET" && summaryMatch) {
    const serverId = await resolveEconomyServerId(env.DB, decodeURIComponent(summaryMatch[1]));
    const url = new URL(request.url);
    const dailyLimit = Math.min(120, Math.max(1, Number(url.searchParams.get("daily_limit")) || 30));
    const mysql = await openRootMcMysql(env);
    if (mysql) {
      try {
        const direct = await mysqlBondsSummary(mysql, rootMcMysqlTablePrefix(env), dailyLimit);
        return withShortPublicCache(json({
          server_id: serverId,
          summary: direct.summary,
          daily_settlements: direct.daily,
          players: direct.players,
          governments: direct.governments,
          synced_at: nowIso(),
        }));
      } catch (error) {
        console.warn("bonds_hyperdrive_fallback", String(error).slice(0, 300));
      } finally {
        await mysql.end();
      }
    }
    const summary = await bondsSummary(env.DB, serverId);
    const daily = await env.DB
      .prepare(
        `SELECT mc_day_id, gross_inflow_g, bond_pool_g, income_share, total_principal_g, active_bonds, settled_at
         FROM rootmc_bonds_daily WHERE server_id = ?
         ORDER BY mc_day_id DESC LIMIT ?`,
      )
      .bind(serverId, dailyLimit)
      .all<Record<string, unknown>>();

    const players = await env.DB
      .prepare(
        `SELECT owner_uuid, owner_name, active_bonds, principal_g, uncollected_g, lifetime_earned_g, weight_pct, avg_24h_g, synced_at
         FROM rootmc_bonds_player_stats WHERE server_id = ?
         ORDER BY principal_g DESC LIMIT 100`,
      )
      .bind(serverId)
      .all<Record<string, unknown>>();

    const governments = await env.DB
      .prepare(
        `SELECT account_uuid, account_name, kind, display_name, principal_g, lifetime_earned_g, weight_pct, synced_at
         FROM rootmc_bonds_government_stats WHERE server_id = ?
         ORDER BY principal_g DESC LIMIT 100`,
      )
      .bind(serverId)
      .all<Record<string, unknown>>();

    return json({
      server_id: serverId,
      summary,
      daily_settlements: daily.results ?? [],
      players: players.results ?? [],
      governments: governments.results ?? [],
      synced_at: nowIso(),
    });
  }

  const playerMatch = rest.match(/^\/([^/]+)\/bonds\/player\/([^/]+)$/);
  if (method === "GET" && playerMatch) {
    const serverId = await resolveEconomyServerId(env.DB, decodeURIComponent(playerMatch[1]));
    const playerUuid = normalizeMinecraftUuid(decodeURIComponent(playerMatch[2]));
    if (!playerUuid) return json({ detail: "Invalid player UUID." }, 400);
    const mysql = await openRootMcMysql(env);
    if (mysql) {
      try {
        const direct = await mysqlPlayerBonds(mysql, rootMcMysqlTablePrefix(env), playerUuid);
        return withShortPublicCache(json({
          server_id: serverId,
          player_uuid: playerUuid,
          stats: direct.stats,
          bonds: direct.bonds,
          payouts: direct.payouts,
          earned_24h_g: direct.earned24h,
          synced_at: nowIso(),
        }));
      } catch (error) {
        console.warn("player_bonds_hyperdrive_fallback", String(error).slice(0, 300));
      } finally {
        await mysql.end();
      }
    }

    const stats = await env.DB
      .prepare(`SELECT * FROM rootmc_bonds_player_stats WHERE server_id = ? AND owner_uuid = ? LIMIT 1`)
      .bind(serverId, playerUuid)
      .first<Record<string, unknown>>();

    const bonds = await env.DB
      .prepare(
        `SELECT bond_id, display_name, principal_g, issued_at, redeemed_at
         FROM rootmc_bonds WHERE server_id = ? AND owner_uuid = ?
         ORDER BY issued_at DESC LIMIT 200`,
      )
      .bind(serverId, playerUuid)
      .all<Record<string, unknown>>();

    const payouts = await env.DB
      .prepare(
        `SELECT mc_day_id, amount_g, weight_pct, principal_g, settled_at
         FROM rootmc_bonds_daily_payout
         WHERE server_id = ? AND owner_uuid = ?
         ORDER BY settled_at DESC LIMIT 120`,
      )
      .bind(serverId, playerUuid)
      .all<Record<string, unknown>>();

    const earned24h = await env.DB
      .prepare(
        `SELECT COALESCE(SUM(amount_g), 0) AS earned_24h
         FROM rootmc_bonds_daily_payout
         WHERE server_id = ? AND owner_uuid = ? AND settled_at >= datetime('now', '-1 day')`,
      )
      .bind(serverId, playerUuid)
      .first<{ earned_24h: number }>();

    return json({
      server_id: serverId,
      player_uuid: playerUuid,
      stats: stats ?? null,
      bonds: bonds.results ?? [],
      payouts: payouts.results ?? [],
      earned_24h_g: num(earned24h?.earned_24h),
      synced_at: nowIso(),
    });
  }

  return null;
}
