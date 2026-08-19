/**
 * CF Worker presence gate — checks Ava's D1 heartbeat before running crons.
 * Fresh heartbeat (< 2 min) = Ava is awake → stand down.
 * Stale or missing = Ava is offline → run normally.
 *
 * Usage in scheduled() handler:
 *   if (await avaIsAwake(env)) return; // Ava owns this job
 *   // ... run the job
 */

export interface HeartbeatEnv {
  AVA_HEARTBEAT_DB: D1Database;
}

const STALE_MS = 2 * 60 * 1000; // 2 minutes

export interface Heartbeat {
  ts: string;
  ageMs: number;
  fresh: boolean;
}

/** Read Ava's last heartbeat, or null if never written / D1 unavailable. */
export async function getHeartbeat(env: HeartbeatEnv): Promise<Heartbeat | null> {
  try {
    const row = await env.AVA_HEARTBEAT_DB
      .prepare("SELECT ts FROM ava_heartbeat WHERE host = 'ava-core' LIMIT 1")
      .first<{ ts: string }>();

    if (!row?.ts) return null;

    const ageMs = Date.now() - new Date(row.ts).getTime();
    return { ts: row.ts, ageMs, fresh: ageMs < STALE_MS };
  } catch {
    return null;
  }
}

export async function avaIsAwake(env: HeartbeatEnv): Promise<boolean> {
  // If D1 is unavailable, assume Ava is offline → run
  return (await getHeartbeat(env))?.fresh ?? false;
}

/** Initialize the heartbeat table if it doesn't exist. */
export async function initHeartbeatTable(env: HeartbeatEnv): Promise<void> {
  await env.AVA_HEARTBEAT_DB.exec(
    `CREATE TABLE IF NOT EXISTS ava_heartbeat (
      host TEXT PRIMARY KEY,
      ts   TEXT NOT NULL
    )`
  );
}
