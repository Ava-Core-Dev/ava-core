/**
 * Free-tier daily-cap helpers for the Weather Manager dashboard.
 *
 * Free accounts may trigger at most `FREE_DAILY_FRESH_FETCH_CAP` outside-data fetches
 * (AccuWeather / Open-Meteo / NWS network calls) per UTC day. Cached reads from D1 are
 * unrestricted — the cap only fires on the cache-miss / `refresh=1` external fetch path.
 *
 * Pro and Lifetime users bypass the cap entirely. The counter table is keyed on the same
 * `userId` value emitted by `resolveUserId()` (e.g. `user:<email>` or `guest:<gid>`), so
 * guests are capped too.
 */
import { readUserAccountAccessFlags } from "./accounts";

export const FREE_DAILY_FRESH_FETCH_CAP = 2;

/** ISO `YYYY-MM-DD` in UTC, used as the daily bucket key. */
export function utcDayKey(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

/**
 * Returns `{ pro: true }` for Pro/Lifetime users, `{ pro: false }` for free users
 * (including guests and users with no `user_accounts` row yet).
 */
export async function loadProFlags(
  db: D1Database,
  userId: string
): Promise<{ pro: boolean }> {
  if (!userId.startsWith("user:")) return { pro: false };
  const email = userId.slice("user:".length).trim().toLowerCase();
  if (!email) return { pro: false };
  try {
    const flags = await readUserAccountAccessFlags(db, email);
    if (!flags) return { pro: false };
    return { pro: Boolean(flags.pro_unlocked || flags.life_member) };
  } catch {
    return { pro: false };
  }
}

export async function freeFreshFetchesToday(
  db: D1Database,
  userId: string,
  day: string = utcDayKey()
): Promise<number> {
  try {
    const row = await db
      .prepare(
        `SELECT count FROM weather_free_fresh_fetches WHERE user_id = ? AND day_utc = ?`
      )
      .bind(userId, day)
      .first<{ count: number }>();
    return row && Number.isFinite(row.count) ? Number(row.count) : 0;
  } catch {
    return 0;
  }
}

export async function bumpFreeFreshFetch(
  db: D1Database,
  userId: string,
  day: string = utcDayKey()
): Promise<void> {
  try {
    await db
      .prepare(
        `INSERT INTO weather_free_fresh_fetches (user_id, day_utc, count)
         VALUES (?, ?, 1)
         ON CONFLICT(user_id, day_utc) DO UPDATE SET count = count + 1`
      )
      .bind(userId, day)
      .run();
  } catch {
    /* counter failure must never block weather response */
  }
}

/**
 * Latest grid bundle for (lat, lon) regardless of age. Used as a fallback when a free
 * user has burned their daily fresh-fetch budget — better to serve stale truth than to
 * return an empty bundle.
 */
export async function staleAnyAgeBundle(
  db: D1Database,
  gridKey: string
): Promise<Record<string, unknown> | null> {
  try {
    const row = await db
      .prepare(
        `SELECT bundle_json, fetched_at FROM weather_data
         WHERE grid_key = ?
         ORDER BY fetched_at DESC LIMIT 1`
      )
      .bind(gridKey)
      .first<{ bundle_json: string; fetched_at: string }>();
    if (!row?.bundle_json) return null;
    return JSON.parse(row.bundle_json) as Record<string, unknown>;
  } catch {
    return null;
  }
}
