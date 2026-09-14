import { roundGold } from "./discord-rootmc-economy";
import { economySystemAccountSqlFilter } from "./rootmc-economy-accounts";
import { str } from "./realm-lib";

export type CirculatingBalanceRow = {
  rank: number;
  minecraft_uuid: string | null;
  minecraft_username: string | null;
  display_name: string;
  notes_g: number;
};

export type CirculatingTownRow = CirculatingBalanceRow & {
  town_uuid: string | null;
  mayor_name: string | null;
  nation_name: string | null;
  resident_count: number;
  bonded_g: number;
  bond_earnings_g: number;
};

export type CirculatingNationRow = CirculatingBalanceRow & {
  nation_uuid: string | null;
  leader_name: string | null;
  town_count: number;
  bonded_g: number;
  bond_earnings_g: number;
};

export type CirculatingBalancesReport = {
  server_id: string;
  synced_at: string | null;
  totals: {
    player_notes_g: number;
    town_notes_g: number;
    nation_notes_g: number;
    circulating_notes_g: number;
    player_count: number;
    town_count: number;
    nation_count: number;
  };
  players: CirculatingBalanceRow[];
  towns: CirculatingTownRow[];
  nations: CirculatingNationRow[];
};

function displayNameFromUsername(username: string, kind: "town" | "nation"): string {
  const name = str(username);
  if (kind === "town" && name.toLowerCase().startsWith("town-")) return name.slice(5);
  if (kind === "nation" && name.toLowerCase().startsWith("nation-")) return name.slice(7);
  return name || " - ";
}

export async function circulatingBalancesReport(
  db: D1Database,
  serverId: string,
  options?: { limit?: number },
): Promise<CirculatingBalancesReport> {
  const limit = Math.min(1000, Math.max(1, options?.limit ?? 500));

  const [playerRows, systemRows, townMeta, nationMeta, govBondRows, syncPlayer, syncSystem] = await Promise.all([
    db
      .prepare(
        `SELECT minecraft_uuid, minecraft_username, balance, synced_at
         FROM rootstat_player_balances
         WHERE server_id = ?
           AND balance > 0.0001
         ${economySystemAccountSqlFilter}
         ORDER BY balance DESC`,
      )
      .bind(serverId)
      .all<{ minecraft_uuid: string; minecraft_username: string | null; balance: number; synced_at: string }>(),
    db
      .prepare(
        `SELECT minecraft_uuid, minecraft_username, account_type, notes_g, synced_at
         FROM rootstat_system_account_balances
         WHERE server_id = ?
           AND account_type IN ('town', 'nation')
           AND notes_g > 0.0001
         ORDER BY notes_g DESC`,
      )
      .bind(serverId)
      .all<{ minecraft_uuid: string; minecraft_username: string; account_type: string; notes_g: number; synced_at: string }>(),
    db
      .prepare(
        `SELECT town_uuid, town_name, mayor_name, nation_name, resident_count, town_balance_gold
         FROM rootmc_towny_towns
         WHERE server_id = ? AND is_active = 1`,
      )
      .bind(serverId)
      .all<Record<string, unknown>>(),
    db
      .prepare(
        `SELECT nation_uuid, nation_name, leader_name, town_count
         FROM rootmc_towny_nations
         WHERE server_id = ? AND is_active = 1`,
      )
      .bind(serverId)
      .all<Record<string, unknown>>(),
    db
      .prepare(
        `SELECT account_uuid, kind, display_name, principal_g, lifetime_earned_g
         FROM rootmc_bonds_government_stats
         WHERE server_id = ?`,
      )
      .bind(serverId)
      .all<{ account_uuid: string; principal_g: number; lifetime_earned_g: number }>(),
    db
      .prepare(`SELECT MAX(synced_at) AS synced_at FROM rootstat_player_balances WHERE server_id = ?`)
      .bind(serverId)
      .first<{ synced_at: string }>(),
    db
      .prepare(`SELECT MAX(synced_at) AS synced_at FROM rootstat_system_account_balances WHERE server_id = ?`)
      .bind(serverId)
      .first<{ synced_at: string }>(),
  ]);

  const townByUuid = new Map<string, Record<string, unknown>>();
  const townByName = new Map<string, Record<string, unknown>>();
  for (const row of townMeta.results ?? []) {
    const uuid = str(row.town_uuid).toLowerCase();
    const name = str(row.town_name);
    if (uuid) townByUuid.set(uuid, row);
    if (name) townByName.set(name.toLowerCase(), row);
  }

  const nationByUuid = new Map<string, Record<string, unknown>>();
  const nationByName = new Map<string, Record<string, unknown>>();
  for (const row of nationMeta.results ?? []) {
    const uuid = str(row.nation_uuid).toLowerCase();
    const name = str(row.nation_name);
    if (uuid) nationByUuid.set(uuid, row);
    if (name) nationByName.set(name.toLowerCase(), row);
  }

  const govByUuid = new Map<string, { principal_g: number; lifetime_earned_g: number }>();
  for (const row of govBondRows.results ?? []) {
    const uuid = str(row.account_uuid).toLowerCase();
    if (!uuid) continue;
    govByUuid.set(uuid, {
      principal_g: Number(row.principal_g) || 0,
      lifetime_earned_g: Number(row.lifetime_earned_g) || 0,
    });
  }

  function bondFields(uuid: string | null, notes: number) {
    const gov = uuid ? govByUuid.get(uuid.toLowerCase()) : undefined;
    return {
      bonded_g: roundGold(Math.max(0, gov?.principal_g ?? notes)),
      bond_earnings_g: roundGold(Math.max(0, gov?.lifetime_earned_g ?? 0)),
    };
  }

  let playerTotal = 0;
  const players: CirculatingBalanceRow[] = (playerRows.results ?? []).map((row, idx) => {
    const notes = roundGold(Math.max(0, Number(row.balance) || 0));
    playerTotal += notes;
    const username = str(row.minecraft_username) || null;
    return {
      rank: idx + 1,
      minecraft_uuid: str(row.minecraft_uuid) || null,
      minecraft_username: username,
      display_name: username || str(row.minecraft_uuid).slice(0, 8) || " - ",
      notes_g: notes,
    };
  });

  const townsRaw: CirculatingTownRow[] = [];
  const nationsRaw: CirculatingNationRow[] = [];
  const seenTownUuids = new Set<string>();
  const seenNationUuids = new Set<string>();

  for (const row of systemRows.results ?? []) {
    const accountType = str(row.account_type);
    const uuid = str(row.minecraft_uuid).toLowerCase();
    const username = str(row.minecraft_username);
    const notes = roundGold(Math.max(0, Number(row.notes_g) || 0));
    if (accountType === "town") {
      const display = displayNameFromUsername(username, "town");
      const meta = (uuid && townByUuid.get(uuid)) || townByName.get(display.toLowerCase()) || null;
      townsRaw.push({
        rank: 0,
        minecraft_uuid: uuid || null,
        minecraft_username: username || null,
        display_name: str(meta?.town_name) || display,
        notes_g: notes,
        town_uuid: str(meta?.town_uuid) || uuid || null,
        mayor_name: str(meta?.mayor_name) || null,
        nation_name: str(meta?.nation_name) || null,
        resident_count: Math.max(0, Math.floor(Number(meta?.resident_count) || 0)),
        ...bondFields(uuid || str(meta?.town_uuid) || null, notes),
      });
      if (uuid) seenTownUuids.add(uuid);
    } else if (accountType === "nation") {
      const display = displayNameFromUsername(username, "nation");
      const meta = (uuid && nationByUuid.get(uuid)) || nationByName.get(display.toLowerCase()) || null;
      nationsRaw.push({
        rank: 0,
        minecraft_uuid: uuid || null,
        minecraft_username: username || null,
        display_name: str(meta?.nation_name) || display,
        notes_g: notes,
        nation_uuid: str(meta?.nation_uuid) || uuid || null,
        leader_name: str(meta?.leader_name) || null,
        town_count: Math.max(0, Math.floor(Number(meta?.town_count) || 0)),
        ...bondFields(uuid || str(meta?.nation_uuid) || null, notes),
      });
      if (uuid) seenNationUuids.add(uuid);
    }
  }

  // Fallback: Towny snapshot balances when system-account sync has not run yet.
  for (const row of townMeta.results ?? []) {
    const uuid = str(row.town_uuid).toLowerCase();
    if (!uuid || seenTownUuids.has(uuid)) continue;
    const notes = roundGold(Math.max(0, Number(row.town_balance_gold) || 0));
    if (notes <= 0.0001) continue;
    townsRaw.push({
      rank: 0,
      minecraft_uuid: uuid,
      minecraft_username: "town-" + str(row.town_name),
      display_name: str(row.town_name) || " - ",
      notes_g: notes,
      town_uuid: uuid,
      mayor_name: str(row.mayor_name) || null,
      nation_name: str(row.nation_name) || null,
      resident_count: Math.max(0, Math.floor(Number(row.resident_count) || 0)),
      ...bondFields(uuid, notes),
    });
  }

  townsRaw.sort((a, b) => b.notes_g - a.notes_g);
  nationsRaw.sort((a, b) => b.notes_g - a.notes_g);
  const towns = townsRaw.slice(0, limit).map((row, idx) => ({ ...row, rank: idx + 1 }));
  const nations = nationsRaw.slice(0, limit).map((row, idx) => ({ ...row, rank: idx + 1 }));

  const townTotal = roundGold(townsRaw.reduce((sum, row) => sum + row.notes_g, 0));
  const nationTotal = roundGold(nationsRaw.reduce((sum, row) => sum + row.notes_g, 0));
  playerTotal = roundGold(playerTotal);

  const syncedAt = str(syncPlayer?.synced_at) || str(syncSystem?.synced_at) || null;

  return {
    server_id: serverId,
    synced_at: syncedAt,
    totals: {
      player_notes_g: playerTotal,
      town_notes_g: townTotal,
      nation_notes_g: nationTotal,
      circulating_notes_g: roundGold(playerTotal + townTotal + nationTotal),
      player_count: players.length,
      town_count: townsRaw.length,
      nation_count: nationsRaw.length,
    },
    players: players.slice(0, limit),
    towns,
    nations,
  };
}
