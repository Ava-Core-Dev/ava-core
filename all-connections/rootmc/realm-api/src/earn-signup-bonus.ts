import type { D1Database } from "@cloudflare/workers-types";

/** One-time, account-wide, granted when the license account is created (all apps share balance). */
export const SIGNUP_BONUS_UNITS = 50_000;

async function ensureBalanceRow(db: D1Database, userId: string, nowIso: string) {
  await db
    .prepare("INSERT OR IGNORE INTO rr_earn_balance (user_id, balance, updated_at) VALUES (?, 0, ?)")
    .bind(userId, nowIso)
    .run();
}

/**
 * Call once after a new `license_accounts` row is created. Idempotent: duplicate user_id is ignored
 * and balance is not increased again.
 */
export async function grantSignupBonusOnRegistration(
  db: D1Database,
  userId: string,
  nowIso: string
): Promise<void> {
  if (!userId.startsWith("user:")) return;
  try {
    await db
      .prepare("INSERT INTO rr_earn_signup_bonus (user_id, units, granted_at) VALUES (?, ?, ?)")
      .bind(userId, SIGNUP_BONUS_UNITS, nowIso)
      .run();
  } catch (e) {
    const msg = String(e && typeof e === "object" && "message" in e ? (e as Error).message : e);
    if (/UNIQUE constraint failed|unique constraint/i.test(msg)) return;
    throw e;
  }
  await ensureBalanceRow(db, userId, nowIso);
  await db
    .prepare("UPDATE rr_earn_balance SET balance = balance + ?, updated_at = ? WHERE user_id = ?")
    .bind(SIGNUP_BONUS_UNITS, nowIso, userId)
    .run();
}

export async function getSignupBonusRow(
  db: D1Database,
  userId: string
): Promise<{ units: number; granted_at: string } | null> {
  const row = await db
    .prepare("SELECT units, granted_at FROM rr_earn_signup_bonus WHERE user_id = ?")
    .bind(userId)
    .first<{ units: number; granted_at: string }>();
  if (!row) return null;
  return {
    units: Math.max(0, Math.floor(Number(row.units) || 0)),
    granted_at: String(row.granted_at || ""),
  };
}
