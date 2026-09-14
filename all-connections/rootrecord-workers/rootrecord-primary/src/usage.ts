import type { D1Database } from "@cloudflare/workers-types";

function utcDay(date = new Date()): string {
  return date.toISOString().slice(0, 10);
}

export async function bumpUsageMetric(db: D1Database | undefined, metric: string, inc = 1): Promise<void> {
  if (!db) return;
  const m = String(metric || "").trim().slice(0, 96);
  if (!m) return;
  const n = Number.isFinite(inc) ? Math.max(1, Math.floor(inc)) : 1;
  try {
    await db
      .prepare(
        `INSERT INTO weather_usage_daily (day_utc, metric, count)
         VALUES (?, ?, ?)
         ON CONFLICT(day_utc, metric) DO UPDATE SET count = count + excluded.count`
      )
      .bind(utcDay(), m, n)
      .run();
  } catch {
    /* do not block request path */
  }
}

export interface UsageDailyRow {
  day_utc: string;
  metric: string;
  count: number;
}

export async function readUsageDaily(db: D1Database, days: number): Promise<UsageDailyRow[]> {
  const safeDays = Math.min(120, Math.max(1, Math.floor(days)));
  const cutoff = new Date(Date.now() - safeDays * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const res = await db
    .prepare(
      `SELECT day_utc, metric, count
       FROM weather_usage_daily
       WHERE day_utc >= ?
       ORDER BY day_utc ASC, metric ASC`
    )
    .bind(cutoff)
    .all<UsageDailyRow>();
  return (res.results || []) as UsageDailyRow[];
}
