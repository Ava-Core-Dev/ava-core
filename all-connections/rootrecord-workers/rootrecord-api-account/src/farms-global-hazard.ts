import type { D1Database } from "@cloudflare/workers-types";

const LIGHTNING_ROW_KEY = "lightning_row_index";

export async function getGlobalLightningRowIndex(db: D1Database): Promise<number> {
  const row = await db
    .prepare("SELECT value_json FROM rr_farms_global_state WHERE state_key = ?")
    .bind(LIGHTNING_ROW_KEY)
    .first<{ value_json: string }>();
  if (!row?.value_json) return 1;
  try {
    const o = JSON.parse(row.value_json) as { row_index?: number };
    const n = Math.floor(Number(o.row_index) || 1);
    return Math.min(10, Math.max(1, n));
  } catch {
    return 1;
  }
}

export async function setGlobalLightningRowIndex(db: D1Database, rowIndex: number): Promise<void> {
  const row = Math.min(10, Math.max(1, Math.floor(rowIndex)));
  const now = new Date().toISOString();
  await db
    .prepare(
      `INSERT INTO rr_farms_global_state (state_key, value_json, updated_at)
       VALUES (?, ?, ?)
       ON CONFLICT(state_key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at`,
    )
    .bind(LIGHTNING_ROW_KEY, JSON.stringify({ row_index: row }), now)
    .run();
}

/** ~1/500 cron ticks pick a new shared row (1–10) for lightning strikes. */
export async function maybeRollGlobalLightningRow(db: D1Database): Promise<number> {
  const current = await getGlobalLightningRowIndex(db);
  if (Math.random() >= 1 / 500) return current;
  const next = 1 + Math.floor(Math.random() * 10);
  await setGlobalLightningRowIndex(db, next);
  return next;
}
