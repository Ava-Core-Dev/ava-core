import type { Connection, RowDataPacket } from "mysql2/promise";

import { roundGold } from "./discord-rootmc-economy";
import { recordHolderSupplyDaily, readPlayerWalletNotesTotal } from "./rootmc-holder-supply";
import { record, str } from "./realm-lib";
import { rootMcMysqlTablePrefix, type RootMcHyperdriveEnv } from "./rootmc-hyperdrive";

export type PhysicalGoldPlayerRow = {
  minecraft_uuid: string;
  minecraft_username: string | null;
  inventory_g: number;
  ender_g: number;
  shop_g: number;
  chest_g: number;
  towny_placed_g: number;
  total_g: number;
  scanned_at: string | null;
};

export type PhysicalGoldStorageSummary = {
  total_storage_g: number;
  unattributed_g: number;
  player_count: number;
  attributed_g: number;
  shops_scanned: number;
  chunks_scanned: number;
  towny_blocks_scanned: number;
  scanned_at: string | null;
};

function normalizeMinecraftUuid(raw: string): string | null {
  const uuid = str(raw).toLowerCase();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(uuid)) {
    return null;
  }
  return uuid;
}

function num(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function readBreakdown(row: Record<string, unknown>, prefix: string, fallbackG: number) {
  const nugget = roundGold(Math.max(0, num(row[`${prefix}_nugget_g`])));
  const ingot = roundGold(Math.max(0, num(row[`${prefix}_ingot_g`])));
  const block = roundGold(Math.max(0, num(row[`${prefix}_block_g`])));
  const other = roundGold(Math.max(0, num(row[`${prefix}_other_g`])));
  const summed = roundGold(nugget + ingot + block + other);
  return {
    nugget,
    ingot,
    block,
    other,
    total: summed > 0.0001 ? summed : roundGold(Math.max(0, fallbackG)),
  };
}

export async function upsertPhysicalGoldScan(
  db: D1Database,
  serverId: string,
  body: Record<string, unknown>,
  syncedAt: string,
): Promise<{ players: number; totalStorageG: number }> {
  const playersRaw = Array.isArray(body.players) ? body.players : [];
  const totalG = roundGold(Math.max(0, num(body.total_g)));
  const unattributed = readBreakdown(body, "unattributed", num(body.unattributed_g));
  const unattributedG = unattributed.total;
  const shopsScanned = Math.max(0, Math.floor(num(body.shops_scanned)));
  const chunksScanned = Math.max(0, Math.floor(num(body.chunks_scanned)));
  const townyBlocksScanned = Math.max(0, Math.floor(num(body.towny_blocks_scanned)));

  await db.prepare(`DELETE FROM rootstat_player_physical_gold WHERE server_id = ?`).bind(serverId).run();

  let playerCount = 0;
  let attributedG = 0;
  for (const raw of playersRaw) {
    const row = record(raw);
    const uuid = normalizeMinecraftUuid(str(row.minecraft_uuid));
    if (!uuid) continue;
    const inv = readBreakdown(row, "inv", num(row.inventory_g));
    const ender = readBreakdown(row, "ender", num(row.ender_g));
    const chest = readBreakdown(row, "chest", num(row.chest_g));
    const shop = readBreakdown(row, "shop", num(row.shop_g));
    const towny = readBreakdown(row, "towny", num(row.towny_placed_g));
    const rowTotal = roundGold(
      Math.max(
        0,
        num(row.total_g) || inv.total + ender.total + chest.total + shop.total + towny.total,
      ),
    );
    if (rowTotal <= 0.0001) continue;
    await db
      .prepare(
        `INSERT INTO rootstat_player_physical_gold
           (server_id, minecraft_uuid, minecraft_username,
            inventory_g, ender_g, shop_g, chest_g, total_g,
            inv_nugget_g, inv_ingot_g, inv_block_g, inv_other_g,
            ender_nugget_g, ender_ingot_g, ender_block_g, ender_other_g,
            chest_nugget_g, chest_ingot_g, chest_block_g, chest_other_g,
            shop_nugget_g, shop_ingot_g, shop_block_g, shop_other_g,
            towny_nugget_g, towny_ingot_g, towny_block_g, towny_other_g,
            scanned_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        serverId,
        uuid,
        str(row.minecraft_username) || null,
        inv.total,
        ender.total,
        shop.total,
        chest.total,
        rowTotal,
        inv.nugget,
        inv.ingot,
        inv.block,
        inv.other,
        ender.nugget,
        ender.ingot,
        ender.block,
        ender.other,
        chest.nugget,
        chest.ingot,
        chest.block,
        chest.other,
        shop.nugget,
        shop.ingot,
        shop.block,
        shop.other,
        towny.nugget,
        towny.ingot,
        towny.block,
        towny.other,
        syncedAt,
        syncedAt,
      )
      .run();
    playerCount++;
    attributedG = roundGold(attributedG + rowTotal);
  }

  const totalStorageG = roundGold(Math.max(totalG, attributedG + unattributedG));
  await db
    .prepare(
      `INSERT INTO rootstat_physical_gold_summary
         (server_id, total_storage_g, unattributed_g, player_count, shops_scanned, chunks_scanned,
          towny_blocks_scanned, unattributed_nugget_g, unattributed_ingot_g,
          unattributed_block_g, unattributed_other_g, scanned_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(server_id) DO UPDATE SET
         total_storage_g = excluded.total_storage_g,
         unattributed_g = excluded.unattributed_g,
         player_count = excluded.player_count,
         shops_scanned = excluded.shops_scanned,
         chunks_scanned = excluded.chunks_scanned,
         towny_blocks_scanned = excluded.towny_blocks_scanned,
         unattributed_nugget_g = excluded.unattributed_nugget_g,
         unattributed_ingot_g = excluded.unattributed_ingot_g,
         unattributed_block_g = excluded.unattributed_block_g,
         unattributed_other_g = excluded.unattributed_other_g,
         scanned_at = excluded.scanned_at,
         updated_at = excluded.updated_at`,
    )
    .bind(
      serverId,
      totalStorageG,
      unattributedG,
      playerCount,
      shopsScanned,
      chunksScanned,
      townyBlocksScanned,
      unattributed.nugget,
      unattributed.ingot,
      unattributed.block,
      unattributed.other,
      syncedAt,
      syncedAt,
    )
    .run();

  await recordHolderSupplyDaily(
    db,
    serverId,
    { physical_gold_g: totalStorageG, player_notes_g: await readPlayerWalletNotesTotal(db, serverId) },
    syncedAt,
  );

  return { players: playerCount, totalStorageG };
}

export async function physicalGoldSummaryForServer(
  db: D1Database,
  serverId: string,
  mysqlConn?: Connection,
  mysqlPrefix?: string,
): Promise<PhysicalGoldStorageSummary> {
  if (mysqlConn) {
    const prefix = mysqlPrefix ?? rootMcMysqlTablePrefix({} as RootMcHyperdriveEnv);
    const [rows] = await mysqlConn.query<(RowDataPacket & Record<string, unknown>)[]>(
      `SELECT total_storage_g, unattributed_g, player_count, shops_scanned,
              chunks_scanned, towny_blocks_scanned, scanned_at
       FROM ${prefix}physical_gold_summary WHERE server_id = ? LIMIT 1`,
      [serverId],
    );
    const row = rows[0];
    if (row) {
      const totalStorageG = roundGold(Math.max(0, num(row.total_storage_g)));
      const unattributedG = roundGold(Math.max(0, num(row.unattributed_g)));
      return {
        total_storage_g: totalStorageG,
        unattributed_g: unattributedG,
        player_count: Math.max(0, Math.floor(num(row.player_count))),
        attributed_g: roundGold(Math.max(0, totalStorageG - unattributedG)),
        shops_scanned: Math.max(0, Math.floor(num(row.shops_scanned))),
        chunks_scanned: Math.max(0, Math.floor(num(row.chunks_scanned))),
        towny_blocks_scanned: Math.max(0, Math.floor(num(row.towny_blocks_scanned))),
        scanned_at: str(row.scanned_at) || null,
      };
    }
  }
  const row = await db
    .prepare(
      `SELECT total_storage_g, unattributed_g, player_count, shops_scanned, chunks_scanned,
              towny_blocks_scanned, scanned_at
       FROM rootstat_physical_gold_summary
       WHERE server_id = ?
       LIMIT 1`,
    )
    .bind(serverId)
    .first<Record<string, unknown>>();

  const totalStorageG = roundGold(Math.max(0, num(row?.total_storage_g)));
  const unattributedG = roundGold(Math.max(0, num(row?.unattributed_g)));
  const playerCount = Math.max(0, Math.floor(num(row?.player_count)));
  return {
    total_storage_g: totalStorageG,
    unattributed_g: unattributedG,
    player_count: playerCount,
    attributed_g: roundGold(Math.max(0, totalStorageG - unattributedG)),
    shops_scanned: Math.max(0, Math.floor(num(row?.shops_scanned))),
    chunks_scanned: Math.max(0, Math.floor(num(row?.chunks_scanned))),
    towny_blocks_scanned: Math.max(0, Math.floor(num(row?.towny_blocks_scanned))),
    scanned_at: (row?.scanned_at as string) || null,
  };
}

export async function physicalGoldLeaderboardForServer(
  db: D1Database,
  serverId: string,
  limit = 15,
  mysqlConn?: Connection,
  mysqlPrefix?: string,
): Promise<PhysicalGoldPlayerRow[]> {
  if (mysqlConn) {
    const prefix = mysqlPrefix ?? rootMcMysqlTablePrefix({} as RootMcHyperdriveEnv);
    const [rows] = await mysqlConn.query<(RowDataPacket & Record<string, unknown>)[]>(
      `SELECT minecraft_uuid, minecraft_username, inventory_g, ender_g, shop_g,
              chest_g, towny_placed_g, total_g, scanned_at
       FROM ${prefix}player_physical_gold
       WHERE server_id = ? AND total_g > 0
       ORDER BY total_g DESC LIMIT ?`,
      [serverId, Math.min(100, Math.max(1, limit))],
    );
    return rows.map((row) => ({
      minecraft_uuid: str(row.minecraft_uuid),
      minecraft_username: str(row.minecraft_username) || null,
      inventory_g: roundGold(num(row.inventory_g)),
      ender_g: roundGold(num(row.ender_g)),
      shop_g: roundGold(num(row.shop_g)),
      chest_g: roundGold(num(row.chest_g)),
      towny_placed_g: roundGold(num(row.towny_placed_g)),
      total_g: roundGold(num(row.total_g)),
      scanned_at: str(row.scanned_at) || null,
    }));
  }
  const { results } = await db
    .prepare(
      `SELECT minecraft_uuid, minecraft_username, inventory_g, ender_g, shop_g, chest_g, total_g, scanned_at,
              towny_nugget_g, towny_ingot_g, towny_block_g, towny_other_g
       FROM rootstat_player_physical_gold
       WHERE server_id = ? AND total_g > 0
       ORDER BY total_g DESC
       LIMIT ?`,
    )
    .bind(serverId, Math.min(100, Math.max(1, limit)))
    .all<Record<string, unknown>>();

  return (results || []).map((row) => {
    const towny = readBreakdown(row, "towny", 0);
    return {
      minecraft_uuid: str(row.minecraft_uuid),
      minecraft_username: (row.minecraft_username as string) || null,
      inventory_g: roundGold(num(row.inventory_g)),
      ender_g: roundGold(num(row.ender_g)),
      shop_g: roundGold(num(row.shop_g)),
      chest_g: roundGold(num(row.chest_g)),
      towny_placed_g: towny.total,
      total_g: roundGold(num(row.total_g)),
      scanned_at: (row.scanned_at as string) || null,
    };
  });
}
