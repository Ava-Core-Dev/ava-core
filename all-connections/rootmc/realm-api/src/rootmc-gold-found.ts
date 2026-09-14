import { roundGold } from "./discord-rootmc-economy";
import { record, str } from "./realm-lib";

export type GoldFoundLeaderboardRow = {
  rank: number;
  minecraft_uuid: string;
  minecraft_username: string | null;
  total_gold_g: number;
  mined_ore_g: number;
  mined_block_g: number;
  loot_chest_g: number;
  loot_mob_g: number;
  pickup_g: number;
  find_events: number;
  baseline_total_gold_g: number;
  baseline_mined_ore_g: number;
  baseline_mined_block_g: number;
  mined_since_july_g: number;
  mined_ore_since_july_g: number;
  mined_block_since_july_g: number;
  physical_mined_since_july_g: number;
  loot_since_july_g: number;
  synced_at: string | null;
};

export type GoldFoundSummary = {
  player_count: number;
  total_gold_g: number;
  average_gold_g: number;
  mined_ore_g: number;
  mined_block_g: number;
  loot_chest_g: number;
  loot_mob_g: number;
  pickup_g: number;
  find_events: number;
  baseline_total_gold_g: number;
  mined_since_july_g: number;
  mined_ore_since_july_g: number;
  mined_block_since_july_g: number;
  physical_mined_since_july_g: number;
  loot_since_july_g: number;
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

function sinceJuly(current: number, baseline: number): number {
  return roundGold(Math.max(0, current - baseline));
}

function mapGoldFoundRow(row: Record<string, unknown>, rank?: number): GoldFoundLeaderboardRow {
  const total = num(row.total_gold_g);
  const minedOre = num(row.mined_ore_g);
  const minedBlock = num(row.mined_block_g);
  const baselineTotal = num(row.baseline_total_gold_g);
  const baselineOre = num(row.baseline_mined_ore_g);
  const baselineBlock = num(row.baseline_mined_block_g);
  const minedSinceJuly = sinceJuly(total, baselineTotal);
  const minedOreSinceJuly = sinceJuly(minedOre, baselineOre);
  const minedBlockSinceJuly = sinceJuly(minedBlock, baselineBlock);
  const physicalSinceJuly = roundGold(minedOreSinceJuly + minedBlockSinceJuly);
  return {
    rank: rank ?? 0,
    minecraft_uuid: str(row.minecraft_uuid),
    minecraft_username: (row.minecraft_username as string) || null,
    total_gold_g: total,
    mined_ore_g: minedOre,
    mined_block_g: minedBlock,
    loot_chest_g: num(row.loot_chest_g),
    loot_mob_g: num(row.loot_mob_g),
    pickup_g: num(row.pickup_g),
    find_events: Math.floor(num(row.find_events)),
    baseline_total_gold_g: baselineTotal,
    baseline_mined_ore_g: baselineOre,
    baseline_mined_block_g: baselineBlock,
    mined_since_july_g: minedSinceJuly,
    mined_ore_since_july_g: minedOreSinceJuly,
    mined_block_since_july_g: minedBlockSinceJuly,
    physical_mined_since_july_g: physicalSinceJuly,
    loot_since_july_g: roundGold(Math.max(0, minedSinceJuly - physicalSinceJuly)),
    synced_at: (row.synced_at as string) || null,
  };
}

export async function upsertGoldFoundRows(
  db: D1Database,
  serverId: string,
  rows: Record<string, unknown>[],
  syncedAt: string,
): Promise<number> {
  let count = 0;
  for (const raw of rows) {
    const row = record(raw);
    const uuid = normalizeMinecraftUuid(str(row.minecraft_uuid));
    if (!uuid) continue;
    const total = num(row.total_gold_g);
    if (total <= 0) continue;
    await db
      .prepare(
        `INSERT INTO rootstat_player_gold_found
           (server_id, minecraft_uuid, minecraft_username, total_gold_g,
            mined_ore_g, mined_block_g, loot_chest_g, loot_mob_g, pickup_g,
            find_events, baseline_total_gold_g, baseline_mined_ore_g, baseline_mined_block_g,
            baseline_locked_at, synced_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 0, NULL, ?, ?)
         ON CONFLICT(server_id, minecraft_uuid) DO UPDATE SET
           minecraft_username = excluded.minecraft_username,
           total_gold_g = excluded.total_gold_g,
           mined_ore_g = excluded.mined_ore_g,
           mined_block_g = excluded.mined_block_g,
           loot_chest_g = excluded.loot_chest_g,
           loot_mob_g = excluded.loot_mob_g,
           pickup_g = excluded.pickup_g,
           find_events = excluded.find_events,
           synced_at = excluded.synced_at,
           updated_at = excluded.updated_at`,
      )
      .bind(
        serverId,
        uuid,
        str(row.minecraft_username) || null,
        total,
        num(row.mined_ore_g),
        num(row.mined_block_g),
        num(row.loot_chest_g),
        num(row.loot_mob_g),
        num(row.pickup_g),
        Math.max(0, Math.floor(num(row.find_events))),
        syncedAt,
        syncedAt,
      )
      .run();
    count++;
  }
  return count;
}

export async function goldFoundSummaryForServer(
  db: D1Database,
  serverId: string,
): Promise<GoldFoundSummary> {
  const row = await db
    .prepare(
      `SELECT COUNT(*) AS player_count,
              COALESCE(SUM(total_gold_g), 0) AS total_gold_g,
              COALESCE(SUM(mined_ore_g), 0) AS mined_ore_g,
              COALESCE(SUM(mined_block_g), 0) AS mined_block_g,
              COALESCE(SUM(loot_chest_g), 0) AS loot_chest_g,
              COALESCE(SUM(loot_mob_g), 0) AS loot_mob_g,
              COALESCE(SUM(pickup_g), 0) AS pickup_g,
              COALESCE(SUM(find_events), 0) AS find_events,
              COALESCE(SUM(baseline_total_gold_g), 0) AS baseline_total_gold_g,
              COALESCE(SUM(total_gold_g - baseline_total_gold_g), 0) AS mined_since_july_g,
              COALESCE(SUM(mined_ore_g - baseline_mined_ore_g), 0) AS mined_ore_since_july_g,
              COALESCE(SUM(mined_block_g - baseline_mined_block_g), 0) AS mined_block_since_july_g
       FROM rootstat_player_gold_found
       WHERE server_id = ? AND total_gold_g > 0`,
    )
    .bind(serverId)
    .first<Record<string, unknown>>();

  const playerCount = Math.max(0, Math.floor(num(row?.player_count)));
  const totalGoldG = num(row?.total_gold_g);
  const minedOreSinceJuly = roundGold(Math.max(0, num(row?.mined_ore_since_july_g)));
  const minedBlockSinceJuly = roundGold(Math.max(0, num(row?.mined_block_since_july_g)));
  const minedSinceJuly = roundGold(Math.max(0, num(row?.mined_since_july_g)));
  return {
    player_count: playerCount,
    total_gold_g: totalGoldG,
    average_gold_g: playerCount > 0 ? totalGoldG / playerCount : 0,
    mined_ore_g: num(row?.mined_ore_g),
    mined_block_g: num(row?.mined_block_g),
    loot_chest_g: num(row?.loot_chest_g),
    loot_mob_g: num(row?.loot_mob_g),
    pickup_g: num(row?.pickup_g),
    find_events: Math.floor(num(row?.find_events)),
    baseline_total_gold_g: num(row?.baseline_total_gold_g),
    mined_since_july_g: minedSinceJuly,
    mined_ore_since_july_g: minedOreSinceJuly,
    mined_block_since_july_g: minedBlockSinceJuly,
    physical_mined_since_july_g: roundGold(minedOreSinceJuly + minedBlockSinceJuly),
    loot_since_july_g: roundGold(Math.max(0, minedSinceJuly - minedOreSinceJuly - minedBlockSinceJuly)),
  };
}

export async function goldFoundLeaderboardForServer(
  db: D1Database,
  serverId: string,
  limit = 25,
  orderBy: "total" | "since_july" = "since_july",
): Promise<GoldFoundLeaderboardRow[]> {
  const orderClause =
    orderBy === "since_july"
      ? `(total_gold_g - baseline_total_gold_g) DESC, total_gold_g DESC`
      : `total_gold_g DESC`;
  const { results } = await db
    .prepare(
      `SELECT minecraft_uuid, minecraft_username, total_gold_g,
              mined_ore_g, mined_block_g, loot_chest_g, loot_mob_g, pickup_g,
              find_events, baseline_total_gold_g, baseline_mined_ore_g, baseline_mined_block_g,
              synced_at
       FROM rootstat_player_gold_found
       WHERE server_id = ? AND total_gold_g > 0
       ORDER BY ${orderClause}
       LIMIT ?`,
    )
    .bind(serverId, Math.min(100, Math.max(1, limit)))
    .all<Record<string, unknown>>();

  return (results || []).map((row, idx) => ({
    ...mapGoldFoundRow(row),
    rank: idx + 1,
  }));
}

export async function latestGoldFoundSyncedAt(
  db: D1Database,
  serverId: string,
): Promise<string | null> {
  const row = await db
    .prepare(
      `SELECT MAX(synced_at) AS synced_at
       FROM rootstat_player_gold_found
       WHERE server_id = ?`,
    )
    .bind(serverId)
    .first<{ synced_at?: string }>();
  return row?.synced_at || null;
}
