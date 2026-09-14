/**
 * Paid Vote Shards — vote value only. $1 = 100. Not weekly awards. Not P&L.
 * Pro 500/mo · Lifetime 500/mo for life · Lifetime listing-site ×2.
 */
import type { D1Database } from "@cloudflare/workers-types";

export const SHARDS_PER_USD = 100;
export const PRO_SHARDS_PER_MONTH = 500;
export const LIFETIME_SHARDS_PER_MONTH = 500;
/** @deprecated Lifetime is monthly. */
export const LIFETIME_SHARDS_ONE_TIME = LIFETIME_SHARDS_PER_MONTH;
export const LIFETIME_VOTE_SITE_MULTIPLIER = 2;

function str(v: unknown): string {
  return String(v ?? "").trim();
}

function normalizeUuid(raw: unknown): string {
  return str(raw).toLowerCase();
}

export function shardsFromUsd(usd: number): number {
  return Math.max(0, Math.round((Number(usd) || 0) * SHARDS_PER_USD));
}

export async function loadPaidVoteShardBalances(db: D1Database): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  try {
    const { results } = await db
      .prepare(`SELECT minecraft_uuid, shards FROM rootmc_paid_vote_shards`)
      .all<{ minecraft_uuid: string; shards: number }>();
    for (const row of results || []) {
      const uuid = normalizeUuid(row.minecraft_uuid);
      const n = Math.max(0, Math.floor(Number(row.shards) || 0));
      if (uuid && n > 0) out.set(uuid, n);
    }
  } catch {
    /* table may not exist yet */
  }
  return out;
}

export async function creditPaidVoteShards(
  db: D1Database,
  opts: {
    id: string;
    minecraftUuid: string;
    kind: string;
    shards: number;
    usd?: number | null;
    note?: string;
  },
): Promise<{ ok: true; duplicate?: boolean; shards: number } | { ok: false; detail: string }> {
  const id = str(opts.id);
  const uuid = normalizeUuid(opts.minecraftUuid);
  const shards = Math.max(0, Math.floor(Number(opts.shards) || 0));
  if (!id || !uuid) return { ok: false, detail: "missing_id_or_uuid" };
  if (!shards) return { ok: false, detail: "no_shards" };
  try {
    const existing = await db
      .prepare(`SELECT id FROM rootmc_paid_vote_shard_ledger WHERE id = ? LIMIT 1`)
      .bind(id)
      .first<{ id: string }>();
    if (existing?.id) return { ok: true, duplicate: true, shards };
    await db
      .prepare(
        `INSERT INTO rootmc_paid_vote_shard_ledger
           (id, minecraft_uuid, kind, usd, shards, note, include_in_pnl, created_at)
         VALUES (?, ?, ?, ?, ?, ?, 0, datetime('now'))`,
      )
      .bind(id, uuid, str(opts.kind) || "purchase", opts.usd ?? null, shards, str(opts.note) || null)
      .run();
    await db
      .prepare(
        `INSERT INTO rootmc_paid_vote_shards (minecraft_uuid, shards, updated_at)
         VALUES (?, ?, datetime('now'))
         ON CONFLICT(minecraft_uuid) DO UPDATE SET
           shards = shards + excluded.shards,
           updated_at = excluded.updated_at`,
      )
      .bind(uuid, shards)
      .run();
    return { ok: true, shards };
  } catch (err) {
    return { ok: false, detail: String((err as Error)?.message || err) };
  }
}

export async function minecraftUuidForAccountId(
  db: D1Database,
  accountId: string,
): Promise<string | null> {
  const aid = str(accountId);
  if (!aid) return null;
  const row = await db
    .prepare(
      `SELECT minecraft_uuid FROM rootstat_minecraft_links WHERE account_id = ? LIMIT 1`,
    )
    .bind(aid)
    .first<{ minecraft_uuid: string }>();
  const uuid = normalizeUuid(row?.minecraft_uuid);
  return uuid || null;
}
