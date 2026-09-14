type D1PreparedStatement = {
  bind: (...args: unknown[]) => D1PreparedStatement;
  first: <T>() => Promise<T | null>;
  all: <T>() => Promise<{ results?: T[] }>;
  run: () => Promise<unknown>;
};
type D1Database = { prepare: (sql: string) => D1PreparedStatement };

export const CIRCULATION_SQL = `SELECT COALESCE(SUM(b.balance), 0) AS total_circulation,
       COUNT(*) AS account_count
       FROM rr_earn_balance b
       INNER JOIN license_accounts la ON b.user_id = ('user:' || lower(la.email))
       WHERE b.balance > 0`;

export type CirculationTotals = { total_circulation: number; account_count: number };

export async function readCirculationTotals(db: D1Database): Promise<CirculationTotals> {
  const row = await db.prepare(CIRCULATION_SQL).first<{ total_circulation: number; account_count: number }>();
  return {
    total_circulation: Math.max(0, Math.floor(Number(row?.total_circulation) || 0)),
    account_count: Math.max(0, Math.floor(Number(row?.account_count) || 0)),
  };
}

export type EconomyDailyRow = {
  day: string;
  total_circulation: number;
  account_count: number;
};

/** Upsert today's rollup + optional snapshot when circulation changes or throttle elapsed. */
export async function touchRootEconomy(db: D1Database, triggerKind = "update"): Promise<CirculationTotals> {
  const nowIso = new Date().toISOString();
  const day = nowIso.slice(0, 10);
  const { total_circulation, account_count } = await readCirculationTotals(db);

  await db
    .prepare(
      `INSERT INTO root_economy_daily (day, total_circulation, account_count, updated_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(day) DO UPDATE SET
         total_circulation = excluded.total_circulation,
         account_count = excluded.account_count,
         updated_at = excluded.updated_at`,
    )
    .bind(day, total_circulation, account_count, nowIso)
    .run();

  const last = await db
    .prepare(
      `SELECT total_circulation, recorded_at FROM root_economy_snapshot
       ORDER BY id DESC LIMIT 1`,
    )
    .first<{ total_circulation: number; recorded_at: string }>();

  const lastMs = last?.recorded_at ? Date.parse(last.recorded_at) : 0;
  const changed = !last || Math.floor(Number(last.total_circulation) || 0) !== total_circulation;
  const stale = !lastMs || Date.now() - lastMs > 5 * 60 * 1000;
  if (changed || stale) {
    await db
      .prepare(
        `INSERT INTO root_economy_snapshot (recorded_at, total_circulation, account_count, trigger_kind)
         VALUES (?, ?, ?, ?)`,
      )
      .bind(nowIso, total_circulation, account_count, String(triggerKind || "update").slice(0, 48))
      .run();
  }

  return { total_circulation, account_count };
}

async function loadEconomySnapshotByDay(
  db: D1Database,
  startStr: string,
): Promise<EconomyDailyRow[]> {
  const rows = await db
    .prepare(
      `SELECT substr(recorded_at, 1, 10) AS day,
              MAX(total_circulation) AS total_circulation,
              MAX(account_count) AS account_count
       FROM root_economy_snapshot
       WHERE substr(recorded_at, 1, 10) >= ?
       GROUP BY substr(recorded_at, 1, 10)
       ORDER BY day ASC`,
    )
    .bind(startStr)
    .all<{ day: string; total_circulation: number; account_count: number }>();

  return (rows.results || []).map((r) => ({
    day: String(r.day || ""),
    total_circulation: Math.max(0, Math.floor(Number(r.total_circulation) || 0)),
    account_count: Math.max(0, Math.floor(Number(r.account_count) || 0)),
  }));
}

export async function loadEconomyDailySeries(db: D1Database, days: number): Promise<EconomyDailyRow[]> {
  const n = Math.min(365, Math.max(1, Math.floor(days) || 90));
  const start = new Date();
  start.setUTCHours(0, 0, 0, 0);
  start.setUTCDate(start.getUTCDate() - (n - 1));
  const startStr = start.toISOString().slice(0, 10);

  const [dailyRows, snapRows] = await Promise.all([
    db
      .prepare(
        `SELECT day, total_circulation, account_count FROM root_economy_daily
         WHERE day >= ? ORDER BY day ASC`,
      )
      .bind(startStr)
      .all<{ day: string; total_circulation: number; account_count: number }>(),
    loadEconomySnapshotByDay(db, startStr),
  ]);

  const byDay = new Map<string, EconomyDailyRow>();
  for (const r of snapRows) {
    if (r.day) byDay.set(r.day, r);
  }
  for (const r of dailyRows.results || []) {
    const day = String(r.day || "");
    if (!day) continue;
    byDay.set(day, {
      day,
      total_circulation: Math.max(0, Math.floor(Number(r.total_circulation) || 0)),
      account_count: Math.max(0, Math.floor(Number(r.account_count) || 0)),
    });
  }

  return Array.from(byDay.values()).sort((a, b) => a.day.localeCompare(b.day));
}

export async function maybeTouchRootEconomyAfterEarn(
  db: D1Database,
  grantedUnits: number,
  triggerKind: string,
): Promise<void> {
  if (grantedUnits > 0) {
    try {
      await touchRootEconomy(db, triggerKind);
    } catch {
      /* chart must not block earn */
    }
  }
}
