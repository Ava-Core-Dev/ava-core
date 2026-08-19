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

export async function avaIsAwake(env: HeartbeatEnv): Promise<boolean> {
  try {
    const row = await env.AVA_HEARTBEAT_DB
      .prepare("SELECT ts FROM ava_heartbeat WHERE host = 'ava-core' LIMIT 1")
      .first<{ ts: string }>();

    if (!row?.ts) return false;

    const age = Date.now() - new Date(row.ts).getTime();
    return age < STALE_MS;
  } catch {
    // If D1 is unavailable, assume Ava is offline → run
    return false;
  }
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
