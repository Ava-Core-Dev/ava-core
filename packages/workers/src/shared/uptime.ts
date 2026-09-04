/**
 * Origin up/down log, kept at the edge so the holding page can still tell
 * visitors when the desk was last seen.
 *
 * Every value on the public page comes from this log. Nothing is estimated:
 * an outage is only recorded once a failed probe is followed by a good one.
 * If D1 is unavailable the readers return nulls and the page says so.
 */

export interface UptimeEnv {
  AVA_HEARTBEAT_DB?: D1Database;
}

export interface UptimeFacts {
  last_up_ms: number | null;
  avg_recovery_s: number | null;
  outages: number;
}

export const NO_UPTIME: UptimeFacts = {
  last_up_ms: null,
  avg_recovery_s: null,
  outages: 0,
};

/** Averages over the most recent outages, so an old migration cannot skew it. */
const AVG_WINDOW = 20;
const KEEP_ROWS = 200;
const HOST = "ava-core";

interface StateRow {
  last_up: number | null;
  down_since: number | null;
}

async function ensureTables(db: D1Database): Promise<void> {
  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS ava_uptime (
         host       TEXT PRIMARY KEY,
         last_up    INTEGER,
         down_since INTEGER
       )`,
    )
    .run();
  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS ava_outages (
         started_at INTEGER PRIMARY KEY,
         ended_at   INTEGER NOT NULL,
         seconds    INTEGER NOT NULL
       )`,
    )
    .run();
}

async function state(db: D1Database): Promise<StateRow> {
  const row = await db
    .prepare("SELECT last_up, down_since FROM ava_uptime WHERE host = ?")
    .bind(HOST)
    .first<StateRow>();
  return { last_up: row?.last_up ?? null, down_since: row?.down_since ?? null };
}

/** Origin answered. Closes any open outage and stamps the last-seen time. */
export async function recordOriginUp(env: UptimeEnv, now = Date.now()): Promise<void> {
  const db = env.AVA_HEARTBEAT_DB;
  if (!db) return;
  try {
    await ensureTables(db);
    const prev = await state(db);

    if (prev.down_since && now > prev.down_since) {
      const seconds = Math.round((now - prev.down_since) / 1000);
      await db
        .prepare(
          `INSERT OR REPLACE INTO ava_outages (started_at, ended_at, seconds)
           VALUES (?, ?, ?)`,
        )
        .bind(prev.down_since, now, seconds)
        .run();
      await db
        .prepare(
          `DELETE FROM ava_outages WHERE started_at NOT IN (
             SELECT started_at FROM ava_outages ORDER BY started_at DESC LIMIT ?
           )`,
        )
        .bind(KEEP_ROWS)
        .run();
    }

    await db
      .prepare(
        `INSERT INTO ava_uptime (host, last_up, down_since) VALUES (?, ?, NULL)
         ON CONFLICT(host) DO UPDATE SET last_up = excluded.last_up, down_since = NULL`,
      )
      .bind(HOST, now)
      .run();
  } catch {
    // A missing or unreachable D1 must never break the public door.
  }
}

/** Origin did not answer. Opens an outage, keeping the earlier last-seen time. */
export async function recordOriginDown(env: UptimeEnv, now = Date.now()): Promise<void> {
  const db = env.AVA_HEARTBEAT_DB;
  if (!db) return;
  try {
    await ensureTables(db);
    const prev = await state(db);
    if (prev.down_since) return;
    await db
      .prepare(
        `INSERT INTO ava_uptime (host, last_up, down_since) VALUES (?, NULL, ?)
         ON CONFLICT(host) DO UPDATE SET down_since = excluded.down_since`,
      )
      .bind(HOST, prev.last_up ?? now, now)
      .run();
  } catch {
    // ignore
  }
}

/** What the holding page needs. Nulls mean "not measured", not "zero". */
export async function readUptime(env: UptimeEnv): Promise<UptimeFacts> {
  const db = env.AVA_HEARTBEAT_DB;
  if (!db) return NO_UPTIME;
  try {
    await ensureTables(db);
    const cur = await state(db);
    const agg = await db
      .prepare(
        `SELECT COUNT(*) AS n, AVG(seconds) AS avg_s FROM (
           SELECT seconds FROM ava_outages ORDER BY started_at DESC LIMIT ?
         )`,
      )
      .bind(AVG_WINDOW)
      .first<{ n: number | null; avg_s: number | null }>();

    const n = Number(agg?.n ?? 0);
    const avg = agg?.avg_s == null ? null : Math.round(Number(agg.avg_s));
    return {
      last_up_ms: cur.last_up ?? null,
      avg_recovery_s: n > 0 && avg && avg > 0 ? avg : null,
      outages: n,
    };
  } catch {
    return NO_UPTIME;
  }
}

/** Probe the origin through the tunnel and log the result. */
export async function probeOrigin(
  env: UptimeEnv,
  originUrl: string,
  timeoutMs = 6000,
): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let ok = false;
  try {
    const res = await fetch(originUrl.replace(/\/$/, "") + "/health", {
      signal: controller.signal,
      redirect: "manual",
    });
    ok = res.ok;
  } catch {
    ok = false;
  } finally {
    clearTimeout(timer);
  }
  if (ok) await recordOriginUp(env);
  else await recordOriginDown(env);
  return ok;
}
