/**
 * Shared Gen1 MySQL playtime totals (Gen1 + Gen2 seconds) for governance /stats.
 */

import type { RowDataPacket } from "mysql2";

import { openRootMcMysql, rootMcMysqlTablePrefix, type RootMcHyperdriveEnv } from "./rootmc-hyperdrive";

export type SharedPlaytimeRow = {
  total_playtime_seconds: number;
  gen1_seconds: number;
  gen2_seconds: number;
  minecraft_username: string | null;
};

function str(v: unknown): string {
  return String(v ?? "").trim();
}

function normalizeUuid(raw: unknown): string {
  return str(raw).toLowerCase();
}

/** Load all shared playtime rows keyed by uuid (lowercase). */
export async function loadSharedPlaytimeMap(
  env: RootMcHyperdriveEnv,
): Promise<Map<string, SharedPlaytimeRow> | null> {
  const conn = await openRootMcMysql(env);
  if (!conn) return null;
  try {
    const prefix = rootMcMysqlTablePrefix(env);
    const table = `${prefix}rootmc_playtime`;
    const [rows] = await conn.query<
      Array<
        RowDataPacket & {
          uuid: string;
          username: string;
          total_playtime_seconds: number;
          gen1_seconds?: number;
          gen2_seconds?: number;
        }
      >
    >(
      `SELECT uuid, username, total_playtime_seconds,
              COALESCE(gen1_seconds, 0) AS gen1_seconds,
              COALESCE(gen2_seconds, 0) AS gen2_seconds
       FROM ${table}`,
    );
    const map = new Map<string, SharedPlaytimeRow>();
    for (const row of rows || []) {
      const uuid = normalizeUuid(row.uuid);
      if (!uuid) continue;
      map.set(uuid, {
        total_playtime_seconds: Math.max(0, Math.floor(Number(row.total_playtime_seconds) || 0)),
        gen1_seconds: Math.max(0, Math.floor(Number(row.gen1_seconds) || 0)),
        gen2_seconds: Math.max(0, Math.floor(Number(row.gen2_seconds) || 0)),
        minecraft_username: str(row.username) || null,
      });
    }
    return map;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("doesn't exist") || msg.includes("Unknown table") || msg.includes("Unknown column")) {
      return null;
    }
    console.warn("shared_playtime_map_failed", msg.slice(0, 300));
    return null;
  } finally {
    await conn.end().catch(() => undefined);
  }
}

export async function loadSharedPlaytimeForUuid(
  env: RootMcHyperdriveEnv,
  uuid: string,
): Promise<SharedPlaytimeRow | null> {
  const id = normalizeUuid(uuid);
  if (!id) return null;
  const conn = await openRootMcMysql(env);
  if (!conn) return null;
  try {
    const prefix = rootMcMysqlTablePrefix(env);
    const table = `${prefix}rootmc_playtime`;
    const [rows] = await conn.query<
      Array<
        RowDataPacket & {
          username: string;
          total_playtime_seconds: number;
          gen1_seconds?: number;
          gen2_seconds?: number;
        }
      >
    >(
      `SELECT username, total_playtime_seconds,
              COALESCE(gen1_seconds, 0) AS gen1_seconds,
              COALESCE(gen2_seconds, 0) AS gen2_seconds
       FROM ${table} WHERE uuid = ? LIMIT 1`,
      [id],
    );
    const row = rows?.[0];
    if (!row) return null;
    return {
      total_playtime_seconds: Math.max(0, Math.floor(Number(row.total_playtime_seconds) || 0)),
      gen1_seconds: Math.max(0, Math.floor(Number(row.gen1_seconds) || 0)),
      gen2_seconds: Math.max(0, Math.floor(Number(row.gen2_seconds) || 0)),
      minecraft_username: str(row.username) || null,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("doesn't exist") || msg.includes("Unknown table") || msg.includes("Unknown column")) {
      return null;
    }
    console.warn("shared_playtime_uuid_failed", msg.slice(0, 300));
    return null;
  } finally {
    await conn.end().catch(() => undefined);
  }
}
