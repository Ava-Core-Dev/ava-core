import { roundGold } from "./discord-rootmc-economy";
import {
  economySystemAccountSqlFilter,
  isEconomySystemAccount,
  TOWNY_SERVER_USERNAME,
  TOWNY_SERVER_UUID,
} from "./rootmc-economy-accounts";
import { readReserveLedgerNetG } from "./rootmc-treasury";
import { record, str } from "./realm-lib";

export type GoldBreakdownG = {
  nugget_g: number;
  ingot_g: number;
  block_g: number;
  other_g: number;
  total_g: number;
};

export type GoldSupplyAccountRow = {
  account_kind: "player" | "reserve" | "town" | "nation" | "unattributed";
  minecraft_uuid: string | null;
  minecraft_username: string | null;
  display_name: string;
  notes_g: number;
  inventory_g: number;
  ender_g: number;
  chest_nugget_g: number;
  chest_ingot_g: number;
  chest_block_g: number;
  chest_other_g: number;
  chest_g: number;
  shop_g: number;
  towny_placed_g: number;
  physical_g: number;
  /** Ore + blocks from gold-found tracker (since July baseline). */
  found_physical_g: number;
  /** Loot chests / mobs / pickups from tracker  -  not proof of items held. */
  found_loot_g: number;
  /** Per-item gold receipts synced from live server. */
  item_events: number;
  item_events_g: number;
  total_g: number;
};

export type GoldSupplyReport = {
  server_id: string;
  synced_at: string | null;
  physical_scanned_at: string | null;
  scan_meta: {
    shops_scanned: number;
    chunks_scanned: number;
    towny_blocks_scanned: number;
    player_count: number;
  };
  totals: {
    notes_g: number;
    physical_g: number;
    grand_total_g: number;
    by_location: {
      inventory_g: number;
      ender_g: number;
      chest_g: number;
      shop_g: number;
      towny_placed_g: number;
      unattributed_g: number;
    };
    by_material: GoldBreakdownG;
    found_physical_g: number;
    found_loot_g: number;
    item_events: number;
  };
  chart: {
    labels: string[];
    notes_g: number[];
    inventory_g: number[];
    ender_g: number[];
    chest_g: number[];
    shop_g: number[];
    towny_placed_g: number[];
  };
  system_accounts: GoldSupplyAccountRow[];
  players: GoldSupplyAccountRow[];
  unattributed: GoldBreakdownG & { total_g: number };
};

function num(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function breakdownFromRow(
  prefix: string,
  row: Record<string, unknown>,
  fallbackG = 0,
): GoldBreakdownG {
  const nugget = roundGold(Math.max(0, num(row[`${prefix}_nugget_g`])));
  const ingot = roundGold(Math.max(0, num(row[`${prefix}_ingot_g`])));
  const block = roundGold(Math.max(0, num(row[`${prefix}_block_g`])));
  const other = roundGold(Math.max(0, num(row[`${prefix}_other_g`])));
  const summed = roundGold(nugget + ingot + block + other);
  const total = summed > 0.0001 ? summed : roundGold(Math.max(0, fallbackG));
  return { nugget_g: nugget, ingot_g: ingot, block_g: block, other_g: other, total_g: total };
}

function sumBreakdowns(parts: GoldBreakdownG[]): GoldBreakdownG {
  let nugget = 0;
  let ingot = 0;
  let block = 0;
  let other = 0;
  for (const part of parts) {
    nugget += part.nugget_g;
    ingot += part.ingot_g;
    block += part.block_g;
    other += part.other_g;
  }
  return {
    nugget_g: roundGold(nugget),
    ingot_g: roundGold(ingot),
    block_g: roundGold(block),
    other_g: roundGold(other),
    total_g: roundGold(nugget + ingot + block + other),
  };
}

function displayNameForSystem(username: string, accountType: string): string {
  const name = str(username);
  if (accountType === "town" && name.toLowerCase().startsWith("town-")) {
    return name.slice(5);
  }
  if (accountType === "nation" && name.toLowerCase().startsWith("nation-")) {
    return name.slice(7);
  }
  if (accountType === "reserve") return "Server Reserve";
  return name || " - ";
}

function accountKindFromType(accountType: string): GoldSupplyAccountRow["account_kind"] {
  if (accountType === "reserve") return "reserve";
  if (accountType === "town") return "town";
  if (accountType === "nation") return "nation";
  return "player";
}

function physicalRowFromDb(row: Record<string, unknown> | null | undefined): {
  inventory_g: number;
  ender_g: number;
  chest: GoldBreakdownG;
  shop_g: number;
  towny_placed_g: number;
  physical_g: number;
} {
  if (!row) {
    return {
      inventory_g: 0,
      ender_g: 0,
      chest: { nugget_g: 0, ingot_g: 0, block_g: 0, other_g: 0, total_g: 0 },
      shop_g: 0,
      towny_placed_g: 0,
      physical_g: 0,
    };
  }
  const inv = breakdownFromRow("inv", row, num(row.inventory_g));
  const ender = breakdownFromRow("ender", row, num(row.ender_g));
  const chest = breakdownFromRow("chest", row, num(row.chest_g));
  const shop = breakdownFromRow("shop", row, num(row.shop_g));
  const towny = breakdownFromRow("towny", row, num(row.towny_placed_g));
  const inventoryG = inv.total_g;
  const enderG = ender.total_g;
  const chestG = chest.total_g;
  const shopG = shop.total_g;
  const townyG = towny.total_g;
  const physicalG = roundGold(
    inventoryG + enderG + chestG + shopG + townyG || num(row.total_g),
  );
  return {
    inventory_g: inventoryG,
    ender_g: enderG,
    chest,
    shop_g: shopG,
    towny_placed_g: townyG,
    physical_g: physicalG,
  };
}

function foundSinceJuly(row: Record<string, unknown>): {
  physical: number;
  loot: number;
  tracker: number;
} {
  const total = num(row.total_gold_g);
  const baselineTotal = num(row.baseline_total_gold_g);
  const minedOre = num(row.mined_ore_g);
  const minedBlock = num(row.mined_block_g);
  const baselineOre = num(row.baseline_mined_ore_g);
  const baselineBlock = num(row.baseline_mined_block_g);
  const physical = roundGold(
    Math.max(0, minedOre - baselineOre) + Math.max(0, minedBlock - baselineBlock),
  );
  const tracker = roundGold(Math.max(0, total - baselineTotal));
  return {
    physical,
    loot: roundGold(Math.max(0, tracker - physical)),
    tracker,
  };
}

function toAccountRow(
  kind: GoldSupplyAccountRow["account_kind"],
  uuid: string | null,
  username: string | null,
  displayName: string,
  notesG: number,
  physical: ReturnType<typeof physicalRowFromDb>,
  provenance?: { found_physical_g: number; found_loot_g: number; item_events: number; item_events_g: number },
): GoldSupplyAccountRow {
  const prov = provenance || {
    found_physical_g: 0,
    found_loot_g: 0,
    item_events: 0,
    item_events_g: 0,
  };
  const signedNotes = kind === "reserve" ? roundGold(notesG) : roundGold(Math.max(0, notesG));
  return {
    account_kind: kind,
    minecraft_uuid: uuid,
    minecraft_username: username,
    display_name: displayName,
    notes_g: signedNotes,
    inventory_g: physical.inventory_g,
    ender_g: physical.ender_g,
    chest_nugget_g: physical.chest.nugget_g,
    chest_ingot_g: physical.chest.ingot_g,
    chest_block_g: physical.chest.block_g,
    chest_other_g: physical.chest.other_g,
    chest_g: physical.chest.total_g,
    shop_g: physical.shop_g,
    towny_placed_g: physical.towny_placed_g,
    physical_g: physical.physical_g,
    found_physical_g: prov.found_physical_g,
    found_loot_g: prov.found_loot_g,
    item_events: prov.item_events,
    item_events_g: prov.item_events_g,
    total_g: roundGold(signedNotes + physical.physical_g),
  };
}

export async function goldSupplyReport(
  db: D1Database,
  serverId: string,
  options?: { playerLimit?: number },
): Promise<GoldSupplyReport> {
  const limit = Math.min(500, Math.max(1, options?.playerLimit ?? 200));

  const [balances, physicalRows, physicalSummary, systemAccounts, syncRow, goldFoundRows, itemEventRows, reserveLedgerNetG] =
    await Promise.all([
    db
      .prepare(
        `SELECT minecraft_uuid, minecraft_username, balance, synced_at
         FROM rootstat_player_balances
         WHERE server_id = ?
         ${economySystemAccountSqlFilter}
         ORDER BY balance DESC`,
      )
      .bind(serverId)
      .all<Record<string, unknown>>(),
    db
      .prepare(
        `SELECT minecraft_uuid, minecraft_username,
                inventory_g, ender_g, shop_g, chest_g, total_g,
                inv_nugget_g, inv_ingot_g, inv_block_g, inv_other_g,
                ender_nugget_g, ender_ingot_g, ender_block_g, ender_other_g,
                chest_nugget_g, chest_ingot_g, chest_block_g, chest_other_g,
                shop_nugget_g, shop_ingot_g, shop_block_g, shop_other_g,
                towny_nugget_g, towny_ingot_g, towny_block_g, towny_other_g,
                scanned_at
         FROM rootstat_player_physical_gold
         WHERE server_id = ?
         ORDER BY total_g DESC`,
      )
      .bind(serverId)
      .all<Record<string, unknown>>(),
    db
      .prepare(
        `SELECT total_storage_g, unattributed_g, player_count,
                shops_scanned, chunks_scanned, towny_blocks_scanned, scanned_at,
                unattributed_nugget_g, unattributed_ingot_g,
                unattributed_block_g, unattributed_other_g
         FROM rootstat_physical_gold_summary
         WHERE server_id = ?
         LIMIT 1`,
      )
      .bind(serverId)
      .first<Record<string, unknown>>(),
    db
      .prepare(
        `SELECT minecraft_uuid, minecraft_username, account_type, notes_g, synced_at
         FROM rootstat_system_account_balances
         WHERE server_id = ?
         ORDER BY notes_g DESC`,
      )
      .bind(serverId)
      .all<Record<string, unknown>>(),
    db
      .prepare(
        `SELECT MAX(synced_at) AS synced_at
         FROM rootstat_player_balances
         WHERE server_id = ?`,
      )
      .bind(serverId)
      .first<{ synced_at: string }>(),
    db
      .prepare(
        `SELECT minecraft_uuid, minecraft_username, total_gold_g,
                mined_ore_g, mined_block_g, loot_chest_g, loot_mob_g, pickup_g,
                baseline_total_gold_g, baseline_mined_ore_g, baseline_mined_block_g
         FROM rootstat_player_gold_found
         WHERE server_id = ? AND total_gold_g > 0`,
      )
      .bind(serverId)
      .all<Record<string, unknown>>(),
    db
      .prepare(
        `SELECT minecraft_uuid,
                COUNT(*) AS item_events,
                COALESCE(SUM(gold_g), 0) AS item_events_g
         FROM rootstat_gold_item_events
         WHERE server_id = ?
         GROUP BY minecraft_uuid`,
      )
      .bind(serverId)
      .all<Record<string, unknown>>(),
    readReserveLedgerNetG(db, serverId),
  ]);

  const physicalByUuid = new Map<string, Record<string, unknown>>();
  for (const row of physicalRows.results || []) {
    const uuid = str(row.minecraft_uuid).toLowerCase();
    if (uuid) physicalByUuid.set(uuid, row);
  }

  const balanceByUuid = new Map<string, Record<string, unknown>>();
  for (const row of balances.results || []) {
    const uuid = str(row.minecraft_uuid).toLowerCase();
    if (uuid) balanceByUuid.set(uuid, row);
  }

  const foundByUuid = new Map<string, ReturnType<typeof foundSinceJuly>>();
  for (const row of goldFoundRows.results || []) {
    const uuid = str(row.minecraft_uuid).toLowerCase();
    if (uuid) foundByUuid.set(uuid, foundSinceJuly(row));
  }

  const eventsByUuid = new Map<string, { item_events: number; item_events_g: number }>();
  for (const row of itemEventRows.results || []) {
    const uuid = str(row.minecraft_uuid).toLowerCase();
    if (!uuid) continue;
    eventsByUuid.set(uuid, {
      item_events: Math.max(0, Math.floor(num(row.item_events))),
      item_events_g: roundGold(Math.max(0, num(row.item_events_g))),
    });
  }

  const allUuids = new Set<string>([
    ...balanceByUuid.keys(),
    ...physicalByUuid.keys(),
    ...foundByUuid.keys(),
    ...eventsByUuid.keys(),
  ]);
  const players: GoldSupplyAccountRow[] = [];

  for (const uuid of allUuids) {
    const bal = balanceByUuid.get(uuid);
    const phys = physicalByUuid.get(uuid);
    const notesG = roundGold(Math.max(0, num(bal?.balance)));
    const physical = physicalRowFromDb(phys);
    const found = foundByUuid.get(uuid);
    const events = eventsByUuid.get(uuid);
    const prov = {
      found_physical_g: found?.physical ?? 0,
      found_loot_g: found?.loot ?? 0,
      item_events: events?.item_events ?? 0,
      item_events_g: events?.item_events_g ?? 0,
    };
    if (
      notesG <= 0.0001 &&
      physical.physical_g <= 0.0001 &&
      prov.found_physical_g <= 0.0001 &&
      prov.found_loot_g <= 0.0001 &&
      prov.item_events <= 0
    ) {
      continue;
    }
    const username = str(bal?.minecraft_username || phys?.minecraft_username) || null;
    players.push(
      toAccountRow(
        "player",
        uuid,
        username,
        username || uuid.slice(0, 8),
        notesG,
        physical,
        prov,
      ),
    );
  }

  players.sort((a, b) => b.total_g - a.total_g);
  const playerRows = players.slice(0, limit);

  const systemRows: GoldSupplyAccountRow[] = (systemAccounts.results || [])
    .filter((row) => str(row.account_type) !== "reserve")
    .map((row) => {
    const username = str(row.minecraft_username);
    const accountType = str(row.account_type) || "system";
    const kind = accountKindFromType(accountType);
    const uuid = str(row.minecraft_uuid) || null;
    const notesG = roundGold(Math.max(0, num(row.notes_g)));
    return toAccountRow(
      kind,
      uuid,
      username || null,
      displayNameForSystem(username, accountType),
      notesG,
      physicalRowFromDb(null),
    );
  });

  systemRows.unshift(
    toAccountRow(
      "reserve",
      TOWNY_SERVER_UUID,
      TOWNY_SERVER_USERNAME,
      "Server Reserve",
      reserveLedgerNetG,
      physicalRowFromDb(null),
    ),
  );

  systemRows.sort((a, b) => {
    const order = { reserve: 0, nation: 1, town: 2, unattributed: 3, player: 4 };
    const ao = order[a.account_kind] ?? 9;
    const bo = order[b.account_kind] ?? 9;
    if (ao !== bo) return ao - bo;
    return b.notes_g - a.notes_g;
  });

  const unattributed: GoldBreakdownG & { total_g: number } = {
    ...breakdownFromRow("unattributed", physicalSummary || {}, num(physicalSummary?.unattributed_g)),
  };
  unattributed.total_g = unattributed.total_g || roundGold(num(physicalSummary?.unattributed_g));

  let notesTotal = 0;
  let inventoryTotal = 0;
  let enderTotal = 0;
  let chestTotal = 0;
  let shopTotal = 0;
  let townyTotal = 0;
  let foundPhysicalTotal = 0;
  let foundLootTotal = 0;
  let itemEventsTotal = 0;
  const materialParts: GoldBreakdownG[] = [];

  for (const row of players) {
    notesTotal += row.notes_g;
    inventoryTotal += row.inventory_g;
    enderTotal += row.ender_g;
    chestTotal += row.chest_g;
    shopTotal += row.shop_g;
    townyTotal += row.towny_placed_g;
    foundPhysicalTotal += row.found_physical_g;
    foundLootTotal += row.found_loot_g;
    itemEventsTotal += row.item_events;
  }
  for (const phys of physicalByUuid.values()) {
    materialParts.push(breakdownFromRow("inv", phys, num(phys.inventory_g)));
    materialParts.push(breakdownFromRow("ender", phys, num(phys.ender_g)));
    materialParts.push(breakdownFromRow("chest", phys, num(phys.chest_g)));
    materialParts.push(breakdownFromRow("shop", phys, num(phys.shop_g)));
    materialParts.push(breakdownFromRow("towny", phys, 0));
  }
  for (const row of systemRows) {
    notesTotal += row.notes_g;
  }
  materialParts.push(unattributed);

  const physicalTotal = roundGold(
    inventoryTotal + enderTotal + chestTotal + shopTotal + townyTotal + unattributed.total_g,
  );
  notesTotal = roundGold(notesTotal);

  const chartLabels = ["Notes", "Inventory", "Ender", "Chests", "Shops", "Towny placed", "Unattributed"];
  const chart = {
    labels: chartLabels,
    notes_g: [notesTotal, 0, 0, 0, 0, 0, 0],
    inventory_g: [0, roundGold(inventoryTotal), 0, 0, 0, 0, 0],
    ender_g: [0, 0, roundGold(enderTotal), 0, 0, 0, 0],
    chest_g: [0, 0, 0, roundGold(chestTotal), 0, 0, 0],
    shop_g: [0, 0, 0, 0, roundGold(shopTotal), 0, 0],
    towny_placed_g: [0, 0, 0, 0, 0, roundGold(townyTotal), 0],
    unattributed_g: [0, 0, 0, 0, 0, 0, unattributed.total_g],
  };

  return {
    server_id: serverId,
    synced_at: str(syncRow?.synced_at) || (physicalSummary?.scanned_at as string) || null,
    physical_scanned_at: (physicalSummary?.scanned_at as string) || null,
    scan_meta: {
      shops_scanned: Math.max(0, Math.floor(num(physicalSummary?.shops_scanned))),
      chunks_scanned: Math.max(0, Math.floor(num(physicalSummary?.chunks_scanned))),
      towny_blocks_scanned: Math.max(0, Math.floor(num(physicalSummary?.towny_blocks_scanned))),
      player_count: Math.max(0, Math.floor(num(physicalSummary?.player_count))),
    },
    totals: {
      notes_g: notesTotal,
      physical_g: physicalTotal,
      grand_total_g: roundGold(notesTotal + physicalTotal),
      by_location: {
        inventory_g: roundGold(inventoryTotal),
        ender_g: roundGold(enderTotal),
        chest_g: roundGold(chestTotal),
        shop_g: roundGold(shopTotal),
        towny_placed_g: roundGold(townyTotal),
        unattributed_g: unattributed.total_g,
      },
      by_material: sumBreakdowns(materialParts),
      found_physical_g: roundGold(foundPhysicalTotal),
      found_loot_g: roundGold(foundLootTotal),
      item_events: itemEventsTotal,
    },
    chart,
    system_accounts: systemRows,
    players: playerRows,
    unattributed,
  };
}

export async function upsertSystemAccountBalances(
  db: D1Database,
  serverId: string,
  rows: Record<string, unknown>[],
  syncedAt: string,
): Promise<number> {
  await db
    .prepare(`DELETE FROM rootstat_system_account_balances WHERE server_id = ?`)
    .bind(serverId)
    .run();

  let count = 0;
  for (const raw of rows) {
    const row = record(raw);
    const uuid = str(row.minecraft_uuid).toLowerCase();
    const username = str(row.minecraft_username);
    const accountType = str(row.account_type) || "system";
    const notesG = roundGold(num(row.balance ?? row.notes_g));
    if (!uuid || !username) continue;
    if (accountType !== "reserve" && notesG <= 0.0001) continue;
    if (!isEconomySystemAccount(uuid, username) && accountType === "system") continue;
    await db
      .prepare(
        `INSERT INTO rootstat_system_account_balances
           (server_id, minecraft_uuid, minecraft_username, account_type, notes_g, synced_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(serverId, uuid, username, accountType, notesG, syncedAt, syncedAt)
      .run();
    count++;
  }
  return count;
}
