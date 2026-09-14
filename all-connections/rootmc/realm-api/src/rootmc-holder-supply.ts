import { roundGold } from "./discord-rootmc-economy";
import { economySystemAccountSqlFilter } from "./rootmc-economy-accounts";
import { HST_OFFSET_MS } from "./rootmc-hst-week";
import { str } from "./realm-lib";

export type HolderSupplyDailyRow = {
  day: string;
  player_notes_g: number;
  physical_gold_g: number;
  holder_combined_g: number;
};

function ledgerHstDayKey(createdAt: string): string {
  const s = str(createdAt);
  if (!s) return "";
  const norm = s.includes("T") ? s : s.replace(" ", "T");
  const iso = /Z$/i.test(norm) || /[+-]\d{2}:?\d{2}$/.test(norm) ? norm : norm + "Z";
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return "";
  const hst = new Date(at.getTime() - HST_OFFSET_MS);
  return `${hst.getUTCFullYear()}-${String(hst.getUTCMonth() + 1).padStart(2, "0")}-${String(hst.getUTCDate()).padStart(2, "0")}`;
}

function addHstDays(dayKey: string, delta: number): string {
  const ms = Date.parse(`${dayKey}T12:00:00-10:00`) + delta * 86400000;
  return ledgerHstDayKey(new Date(ms).toISOString());
}

/** Upsert measured wallet and/or physical gold for an HST day (defaults to today). */
export async function recordHolderSupplyDaily(
  db: D1Database,
  serverId: string,
  patch: { player_notes_g?: number; physical_gold_g?: number },
  syncedAt: string,
  dayKey?: string,
): Promise<void> {
  const day = str(dayKey) || ledgerHstDayKey(syncedAt);
  if (!day) return;

  const existing = await db
    .prepare(
      `SELECT player_notes_g, physical_gold_g
       FROM rootmc_holder_supply_daily
       WHERE server_id = ? AND day = ?
       LIMIT 1`,
    )
    .bind(serverId, day)
    .first<{ player_notes_g: number; physical_gold_g: number }>();

  const playerNotes =
    patch.player_notes_g != null
      ? roundGold(Math.max(0, Number(patch.player_notes_g) || 0))
      : roundGold(Math.max(0, Number(existing?.player_notes_g) || 0));
  const physicalGold =
    patch.physical_gold_g != null
      ? roundGold(Math.max(0, Number(patch.physical_gold_g) || 0))
      : roundGold(Math.max(0, Number(existing?.physical_gold_g) || 0));

  await db
    .prepare(
      `INSERT INTO rootmc_holder_supply_daily
         (server_id, day, player_notes_g, physical_gold_g, updated_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(server_id, day) DO UPDATE SET
         player_notes_g = excluded.player_notes_g,
         physical_gold_g = excluded.physical_gold_g,
         updated_at = excluded.updated_at`,
    )
    .bind(serverId, day, playerNotes, physicalGold, syncedAt)
    .run();
}

export async function readPlayerWalletNotesTotal(db: D1Database, serverId: string): Promise<number> {
  const row = await db
    .prepare(
      `SELECT COALESCE(SUM(balance_value), 0) AS total
       FROM rootstat_player_net_worth
       WHERE server_id = ?
       ${economySystemAccountSqlFilter}`,
    )
    .bind(serverId)
    .first<{ total: number }>();
  return roundGold(Math.max(0, Number(row?.total) || 0));
}

async function readMeasuredHolderSupplyByDay(
  db: D1Database,
  serverId: string,
  sinceDay: string,
): Promise<Map<string, { player_notes_g: number; physical_gold_g: number }>> {
  const { results } = await db
    .prepare(
      `SELECT day, player_notes_g, physical_gold_g
       FROM rootmc_holder_supply_daily
       WHERE server_id = ? AND day >= ?
       ORDER BY day ASC`,
    )
    .bind(serverId, sinceDay)
    .all<{ day: string; player_notes_g: number; physical_gold_g: number }>();

  const map = new Map<string, { player_notes_g: number; physical_gold_g: number }>();
  for (const row of results ?? []) {
    const day = str(row.day);
    if (!day) continue;
    map.set(day, {
      player_notes_g: roundGold(Math.max(0, Number(row.player_notes_g) || 0)),
      physical_gold_g: roundGold(Math.max(0, Number(row.physical_gold_g) || 0)),
    });
  }
  return map;
}

/**
 * Align holder supply with reserve balance_daily HST days.
 * Uses measured wallet snapshots from economy sync  -  not ledger reconstruction
 * (ledger sums miss Towny sinks, bonds, and other player debits).
 */
export function buildHolderSupplyDailySeries(
  balanceDaily: { day: string; balance: number }[],
  measuredByDay: Map<string, { player_notes_g: number; physical_gold_g: number }>,
): HolderSupplyDailyRow[] {
  let lastPhysical = 0;
  let lastWallet = 0;
  const out: HolderSupplyDailyRow[] = [];

  for (const row of balanceDaily) {
    const day = str(row.day);
    if (!day) continue;

    const measured = measuredByDay.get(day);
    if (measured) {
      lastWallet = measured.player_notes_g;
      lastPhysical = measured.physical_gold_g;
    }

    const wallet = measured ? measured.player_notes_g : lastWallet;
    const physical = measured ? measured.physical_gold_g : lastPhysical;
    // Circulating Notes ≈ player wallets; reserve vault is tracked separately.
    const combined = roundGold(wallet);
    out.push({
      day,
      player_notes_g: roundGold(wallet),
      physical_gold_g: roundGold(physical),
      holder_combined_g: combined,
    });
  }

  return out;
}

export async function loadMeasuredHolderSupplyForRange(
  db: D1Database,
  serverId: string,
  startDay: string,
): Promise<Map<string, { player_notes_g: number; physical_gold_g: number }>> {
  return readMeasuredHolderSupplyByDay(db, serverId, startDay);
}

export { ledgerHstDayKey, addHstDays };
