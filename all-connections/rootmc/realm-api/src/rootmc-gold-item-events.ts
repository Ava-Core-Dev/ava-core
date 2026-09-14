import { roundGold } from "./discord-rootmc-economy";
import { record, str } from "./realm-lib";

export type GoldItemEventRow = {
  event_id: number;
  minecraft_uuid: string;
  minecraft_username: string | null;
  event_type: string;
  obtained_via: string;
  material: string;
  stack_amount: number;
  gold_g: number;
  world: string | null;
  block_x: number | null;
  block_y: number | null;
  block_z: number | null;
  context_json: string | null;
  occurred_at: string;
};

function normalizeMinecraftUuid(raw: string): string | null {
  const uuid = str(raw).toLowerCase();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(uuid)) {
    return null;
  }
  return uuid;
}

function num(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function mapEventRow(row: Record<string, unknown>): GoldItemEventRow | null {
  const eventId = Math.floor(num(row.event_id));
  const uuid = normalizeMinecraftUuid(str(row.minecraft_uuid));
  if (!eventId || !uuid) return null;
  const material = str(row.material);
  const eventType = str(row.event_type);
  const obtainedVia = str(row.obtained_via);
  if (!material || !eventType || !obtainedVia) return null;
  const stackAmount = Math.max(1, Math.floor(num(row.stack_amount)));
  return {
    event_id: eventId,
    minecraft_uuid: uuid,
    minecraft_username: str(row.minecraft_username) || null,
    event_type: eventType,
    obtained_via: obtainedVia,
    material,
    stack_amount: stackAmount,
    gold_g: roundGold(num(row.gold_g)),
    world: str(row.world) || null,
    block_x: row.block_x == null ? null : Math.floor(num(row.block_x)),
    block_y: row.block_y == null ? null : Math.floor(num(row.block_y)),
    block_z: row.block_z == null ? null : Math.floor(num(row.block_z)),
    context_json: str(row.context_json) || null,
    occurred_at: str(row.occurred_at) || str(row.created_at),
  };
}

export async function upsertGoldItemEventRows(
  db: D1Database,
  serverId: string,
  rows: Record<string, unknown>[],
  syncedAt: string,
): Promise<number> {
  let count = 0;
  for (const raw of rows) {
    const mapped = mapEventRow(record(raw));
    if (!mapped) continue;
    await db
      .prepare(
        `INSERT INTO rootstat_gold_item_events
           (server_id, event_id, minecraft_uuid, minecraft_username, event_type, obtained_via,
            material, stack_amount, gold_g, world, block_x, block_y, block_z,
            context_json, occurred_at, synced_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(server_id, event_id) DO NOTHING`,
      )
      .bind(
        serverId,
        mapped.event_id,
        mapped.minecraft_uuid,
        mapped.minecraft_username,
        mapped.event_type,
        mapped.obtained_via,
        mapped.material,
        mapped.stack_amount,
        mapped.gold_g,
        mapped.world,
        mapped.block_x,
        mapped.block_y,
        mapped.block_z,
        mapped.context_json,
        mapped.occurred_at,
        syncedAt,
      )
      .run();
    count++;
  }
  return count;
}

export async function goldItemEventsForPlayer(
  db: D1Database,
  serverId: string,
  uuid: string,
  limit = 50,
): Promise<GoldItemEventRow[]> {
  uuid = normalizeMinecraftUuid(uuid) || uuid;
  const capped = Math.min(200, Math.max(1, Math.floor(limit)));
  const { results } = await db
    .prepare(
      `SELECT event_id, minecraft_uuid, minecraft_username, event_type, obtained_via,
              material, stack_amount, gold_g, world, block_x, block_y, block_z,
              context_json, occurred_at
       FROM rootstat_gold_item_events
       WHERE server_id = ? AND minecraft_uuid = ?
       ORDER BY event_id DESC
       LIMIT ?`,
    )
    .bind(serverId, uuid, capped)
    .all<Record<string, unknown>>();
  const out: GoldItemEventRow[] = [];
  for (const row of results || []) {
    const mapped = mapEventRow(row);
    if (mapped) out.push(mapped);
  }
  return out;
}

export async function latestGoldItemEventId(db: D1Database, serverId: string): Promise<number> {
  const row = await db
    .prepare(`SELECT MAX(event_id) AS max_id FROM rootstat_gold_item_events WHERE server_id = ?`)
    .bind(serverId)
    .first<{ max_id: number }>();
  return Math.floor(num(row?.max_id));
}

export async function goldItemEventCountForServer(db: D1Database, serverId: string): Promise<number> {
  const row = await db
    .prepare(`SELECT COUNT(*) AS event_count FROM rootstat_gold_item_events WHERE server_id = ?`)
    .bind(serverId)
    .first<{ event_count: number }>();
  return Math.max(0, Math.floor(num(row?.event_count)));
}

export async function recentGoldItemEventsForServer(
  db: D1Database,
  serverId: string,
  options?: { uuid?: string; limit?: number; offset?: number },
): Promise<{ events: GoldItemEventRow[]; total: number }> {
  const uuid = options?.uuid ? normalizeMinecraftUuid(options.uuid) : null;
  const limit = Math.min(200, Math.max(1, Math.floor(options?.limit ?? 50)));
  const offset = Math.max(0, Math.floor(options?.offset ?? 0));

  if (uuid) {
    const events = await goldItemEventsForPlayer(db, serverId, uuid, limit);
    return { events, total: events.length };
  }

  const countRow = await db
    .prepare(`SELECT COUNT(*) AS event_count FROM rootstat_gold_item_events WHERE server_id = ?`)
    .bind(serverId)
    .first<{ event_count: number }>();
  const total = Math.max(0, Math.floor(num(countRow?.event_count)));

  const { results } = await db
    .prepare(
      `SELECT event_id, minecraft_uuid, minecraft_username, event_type, obtained_via,
              material, stack_amount, gold_g, world, block_x, block_y, block_z,
              context_json, occurred_at
       FROM rootstat_gold_item_events
       WHERE server_id = ?
       ORDER BY event_id DESC
       LIMIT ? OFFSET ?`,
    )
    .bind(serverId, limit, offset)
    .all<Record<string, unknown>>();

  const events: GoldItemEventRow[] = [];
  for (const row of results || []) {
    const mapped = mapEventRow(row);
    if (mapped) events.push(mapped);
  }
  return { events, total };
}
