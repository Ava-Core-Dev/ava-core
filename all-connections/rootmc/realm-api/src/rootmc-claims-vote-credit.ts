/**
 * Mirror Towny Votifier payouts onto Claims via pending gold transfers,
 * and backfill 1–20 G per historical listing vote that Claims has not paid yet.
 */

import type { D1Database } from "@cloudflare/workers-types";

import { json } from "./cors";
import { roundGold } from "./discord-rootmc-economy";
import { TOWNY_SERVER_UUID, TOWNY_SERVER_USERNAME } from "./rootmc-economy-accounts";
import { canonicalListingSiteId } from "./rootmc-listing-sites";
import type { RootStatEnv } from "./rootstat-minecraft";
import { validateServerAuth } from "./rootstat-minecraft";

/** Live Claims host cloud.server-id */
export const CLAIMS_SERVER_ID = "4963895e-0964-48b8-81b7-1f40a966e8be";

const VOTE_GOLD_MIN = 1;
const VOTE_GOLD_MAX = 20;

function str(v: unknown): string {
  return v == null ? "" : String(v).trim();
}

function nowIso(): string {
  return new Date().toISOString();
}

function rollVoteGold(): number {
  return VOTE_GOLD_MIN + Math.floor(Math.random() * (VOTE_GOLD_MAX - VOTE_GOLD_MIN + 1));
}

function claimsVoteTransferId(minecraftUuid: string, service: string, votedAtIso: string): string {
  const uuid = str(minecraftUuid).toLowerCase();
  const svc = (canonicalListingSiteId(service) ?? str(service).toLowerCase()).replace(/[^a-z0-9._-]+/gi, "_");
  const epoch = Number.isFinite(Date.parse(votedAtIso))
    ? Math.floor(Date.parse(votedAtIso) / 1000)
    : Math.floor(Date.now() / 1000);
  return `vote-claims:${uuid}:${svc}:${epoch}`;
}

async function transferExists(db: D1Database, id: string): Promise<boolean> {
  const row = await db
    .prepare(`SELECT id FROM rootmc_gold_transfers WHERE id = ? LIMIT 1`)
    .bind(id)
    .first<{ id: string }>();
  return !!row?.id;
}

async function queueClaimsVoteGrant(
  db: D1Database,
  transferId: string,
  toUuid: string,
  toName: string,
  amount: number,
  source: "vote" | "vote_backfill",
): Promise<boolean> {
  if (await transferExists(db, transferId)) {
    return false;
  }
  const gold = roundGold(amount);
  if (gold < 0.01) return false;
  const ts = nowIso();
  try {
    await db
      .prepare(
        `INSERT INTO rootmc_gold_transfers (
           id, server_id, from_uuid, from_username, to_uuid, to_username, amount,
           source, discord_from_user_id, discord_to_user_id, status, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, 'pending', ?)`,
      )
      .bind(
        transferId,
        CLAIMS_SERVER_ID,
        TOWNY_SERVER_UUID,
        TOWNY_SERVER_USERNAME,
        toUuid.toLowerCase(),
        toName || "Player",
        gold,
        source,
        ts,
      )
      .run();
    return true;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/UNIQUE|unique|constraint/i.test(msg)) return false;
    throw e;
  }
}

/** Towny (or any host) queues a Claims mirror credit after a live Votifier payout. */
export async function queueClaimsVoteCredit(request: Request, env: RootStatEnv): Promise<Response> {
  const server = await validateServerAuth(env, request);
  if (server instanceof Response) return server;

  let body: {
    minecraft_uuid?: string;
    minecraft_username?: string;
    service?: string;
    amount?: number;
    voted_at?: string;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return json({ detail: "Invalid JSON" }, 400);
  }

  const uuid = str(body.minecraft_uuid).toLowerCase();
  const name = str(body.minecraft_username) || "Player";
  const service = str(body.service) || "default";
  const votedAt = str(body.voted_at) || nowIso();
  const amount = Number(body.amount);
  if (!uuid || !/^[0-9a-f-]{36}$/i.test(uuid)) {
    return json({ detail: "minecraft_uuid required" }, 400);
  }
  if (!Number.isFinite(amount) || amount < 0.01) {
    return json({ detail: "amount must be >= 0.01" }, 400);
  }

  const transferId = claimsVoteTransferId(uuid, service, votedAt);
  const queued = await queueClaimsVoteGrant(env.DB, transferId, uuid, name, amount, "vote");
  return json({ ok: true, queued, transfer_id: transferId, server_id: CLAIMS_SERVER_ID });
}

async function resolvePlayerName(db: D1Database, uuid: string): Promise<string> {
  try {
    const row = await db
      .prepare(
        `SELECT minecraft_username FROM rootstat_player_playtime
         WHERE LOWER(REPLACE(minecraft_uuid, '-', '')) = LOWER(REPLACE(?, '-', ''))
           AND minecraft_username IS NOT NULL AND TRIM(minecraft_username) != ''
         ORDER BY updated_at DESC
         LIMIT 1`,
      )
      .bind(uuid)
      .first<{ minecraft_username: string }>();
    const name = str(row?.minecraft_username);
    if (name) return name;
  } catch {
    // optional enrichment
  }
  return "Player";
}

/**
 * Backfill: every historical listing vote gets one Claims treasury grant (1–20 G)
 * if not already queued/paid under vote-claims:* ids. Pages through all rows
 * (not just the oldest 5000) so later votes are not stuck unpaid.
 */
export async function runClaimsVoteBackfill(env: { DB: D1Database }): Promise<{
  scanned: number;
  queued: number;
}> {
  let scanned = 0;
  let queued = 0;
  const pageSize = 500;
  let offset = 0;
  const nameCache = new Map<string, string>();

  for (;;) {
    const { results } = await env.DB.prepare(
      `SELECT minecraft_uuid, service, voted_at
       FROM rootmc_listing_votes
       ORDER BY voted_at ASC, minecraft_uuid ASC, service ASC
       LIMIT ? OFFSET ?`,
    )
      .bind(pageSize, offset)
      .all<{ minecraft_uuid: string; service: string; voted_at: string }>();

    const rows = results || [];
    if (rows.length === 0) {
      break;
    }

    for (const row of rows) {
      scanned++;
      const uuid = str(row.minecraft_uuid).toLowerCase();
      const service = str(row.service) || "default";
      const votedAt = str(row.voted_at) || nowIso();
      if (!uuid) continue;
      const transferId = claimsVoteTransferId(uuid, service, votedAt);
      let name = nameCache.get(uuid);
      if (!name) {
        name = await resolvePlayerName(env.DB, uuid);
        nameCache.set(uuid, name);
      }
      const did = await queueClaimsVoteGrant(
        env.DB,
        transferId,
        uuid,
        name,
        rollVoteGold(),
        "vote_backfill",
      );
      if (did) queued++;
    }

    offset += rows.length;
    if (rows.length < pageSize || offset >= 100_000) {
      break;
    }
  }
  return { scanned, queued };
}

export async function handleClaimsVoteBackfill(request: Request, env: RootStatEnv): Promise<Response> {
  const server = await validateServerAuth(env, request);
  if (server instanceof Response) return server;
  const result = await runClaimsVoteBackfill(env);
  return json({ ok: true, ...result, claims_server_id: CLAIMS_SERVER_ID });
}
