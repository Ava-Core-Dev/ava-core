import { FIRST_APP_OPEN_UNITS } from "./earn-program-constants";

type D1PreparedStatement = {
  bind: (...args: unknown[]) => D1PreparedStatement;
  first: <T>() => Promise<T | null>;
  all: <T>() => Promise<{ results?: T[] }>;
  run: () => Promise<unknown>;
};
type D1Database = { prepare: (sql: string) => D1PreparedStatement };

export { FIRST_APP_OPEN_UNITS };

/** One-time per app (signed-in users only). Excludes Token Manager (main RU generator). */

export const TOKEN_MANAGER_APP_ID = "rootrecord_token_manager_android";

export function isEarnFirstOpenEligibleApp(appId: string): boolean {
  const id = String(appId || "")
    .trim()
    .toLowerCase();
  if (!id || id === TOKEN_MANAGER_APP_ID) return false;
  return /^[a-z0-9][a-z0-9_-]{0,79}$/i.test(id);
}

async function ensureBalanceRow(db: D1Database, userId: string, nowIso: string) {
  await db
    .prepare("INSERT OR IGNORE INTO rr_earn_balance (user_id, balance, updated_at) VALUES (?, 0, ?)")
    .bind(userId, nowIso)
    .run();
}

export async function getFirstAppOpenRow(
  db: D1Database,
  userId: string,
  appId: string,
): Promise<{ units: number; granted_at: string } | null> {
  const aid = String(appId || "")
    .trim()
    .toLowerCase();
  if (!userId.startsWith("user:") || !aid) return null;
  const row = await db
    .prepare("SELECT units, granted_at FROM rr_earn_app_first_open WHERE user_id = ? AND app_id = ?")
    .bind(userId, aid)
    .first<{ units: number; granted_at: string }>();
  if (!row) return null;
  return {
    units: Math.max(0, Math.floor(Number(row.units) || 0)),
    granted_at: String(row.granted_at || ""),
  };
}

/**
 * Idempotent: first signed-in open per `app_id` credits FIRST_APP_OPEN_UNITS to rr_earn_balance.
 * Caller should pass units into `incAppTotals` when `granted` is true.
 */
export async function grantFirstAppOpenBonus(
  db: D1Database,
  userId: string,
  appId: string,
  nowIso: string,
): Promise<{ granted: boolean; units: number }> {
  if (!userId.startsWith("user:")) return { granted: false, units: 0 };
  const aid = String(appId || "")
    .trim()
    .toLowerCase();
  if (!isEarnFirstOpenEligibleApp(aid)) return { granted: false, units: 0 };

  try {
    await db
      .prepare(
        "INSERT INTO rr_earn_app_first_open (user_id, app_id, units, granted_at) VALUES (?, ?, ?, ?)",
      )
      .bind(userId, aid, FIRST_APP_OPEN_UNITS, nowIso)
      .run();
  } catch (e) {
    const msg = String(e && typeof e === "object" && "message" in e ? (e as Error).message : e);
    if (/UNIQUE constraint failed|unique constraint/i.test(msg)) {
      return { granted: false, units: 0 };
    }
    throw e;
  }

  await ensureBalanceRow(db, userId, nowIso);
  await db
    .prepare("UPDATE rr_earn_balance SET balance = balance + ?, updated_at = ? WHERE user_id = ?")
    .bind(FIRST_APP_OPEN_UNITS, nowIso, userId)
    .run();

  const ymd = nowIso.slice(0, 10);
  await incAppEarnTotals(db, userId, aid, ymd, FIRST_APP_OPEN_UNITS, nowIso);

  const { touchRootEconomy } = await import("./root-economy-snapshot");
  await touchRootEconomy(db, "first_open").catch(() => {});

  return { granted: true, units: FIRST_APP_OPEN_UNITS };
}

async function incAppEarnTotals(
  db: D1Database,
  userId: string,
  appId: string,
  ymd: string,
  units: number,
  nowIso: string,
) {
  const iu = Math.floor(units);
  if (iu <= 0) return;
  const rowT = await db
    .prepare("SELECT total_units FROM rr_earn_app_total WHERE user_id = ? AND app_id = ?")
    .bind(userId, appId)
    .first<{ total_units: number }>();
  const start = rowT ? Math.max(0, Math.floor(Number(rowT.total_units) || 0)) : 0;
  await db
    .prepare(
      `INSERT INTO rr_earn_app_total (user_id, app_id, total_units, updated_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(user_id, app_id) DO UPDATE SET total_units = excluded.total_units, updated_at = excluded.updated_at`,
    )
    .bind(userId, appId, start + iu, nowIso)
    .run();
  const rowD = await db
    .prepare("SELECT units_earned FROM rr_earn_app_day WHERE user_id = ? AND app_id = ? AND ymd = ?")
    .bind(userId, appId, ymd)
    .first<{ units_earned: number }>();
  const startD = rowD ? Math.max(0, Math.floor(Number(rowD.units_earned) || 0)) : 0;
  await db
    .prepare(
      `INSERT INTO rr_earn_app_day (user_id, app_id, ymd, units_earned, updated_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(user_id, app_id, ymd) DO UPDATE SET units_earned = excluded.units_earned, updated_at = excluded.updated_at`,
    )
    .bind(userId, appId, ymd, startD + iu, nowIso)
    .run();
}
