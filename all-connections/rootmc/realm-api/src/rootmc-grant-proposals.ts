/**
 * Treasury grant proposals  -  any linked player may submit; Council votes with weighted shares.
 * A weighted majority must hold unchanged for 24h before auto-pass (treasury payout) or veto.
 */

import type { D1Database } from "@cloudflare/workers-types";

import { TOWNY_SERVER_USERNAME, TOWNY_SERVER_UUID } from "./rootmc-economy-accounts";
import { resolveDiscordEconomyServerId } from "./discord-rootmc-economy";
import { resolveServerId } from "./rootmc-daily-report";
import type { ProposalEnv } from "./rootmc-community-proposals";

export const GRANT_MAJORITY_HOLD_MS = 24 * 60 * 60 * 1000;
export const GRANT_MAX_OPEN_DAYS = 30;
export const GRANT_MIN_AMOUNT = 1;
export const GRANT_MAX_AMOUNT = 10_000;

function str(v: unknown): string {
  return String(v ?? "").trim();
}

function nowIso(): string {
  return new Date().toISOString();
}

function roundGold(n: number): number {
  return Math.round(Math.max(0, n) * 100) / 100;
}

export function isGrantProposal(row: Record<string, unknown> | null | undefined): boolean {
  return str(row?.kind) === "grant";
}

export type GrantMajorityDirection = "for" | "against";

export function computeGrantMajorityDirection(tallies: {
  weightedFor: number;
  weightedAgainst: number;
}): GrantMajorityDirection | null {
  if (tallies.weightedFor > tallies.weightedAgainst) return "for";
  if (tallies.weightedAgainst > tallies.weightedFor) return "against";
  return null;
}

export async function syncGrantMajorityState(
  db: D1Database,
  proposalId: string,
  tallies: { weightedFor: number; weightedAgainst: number },
): Promise<void> {
  const direction = computeGrantMajorityDirection(tallies);
  const row = await db
    .prepare(`SELECT majority_direction, majority_since FROM rootmc_community_proposals WHERE id = ? LIMIT 1`)
    .bind(proposalId)
    .first<{ majority_direction: string | null; majority_since: string | null }>();
  if (!row) return;

  const prevDir = str(row.majority_direction) || null;
  const prevSince = str(row.majority_since) || null;

  if (!direction) {
    if (prevDir || prevSince) {
      await db
        .prepare(
          `UPDATE rootmc_community_proposals SET majority_direction = NULL, majority_since = NULL WHERE id = ?`,
        )
        .bind(proposalId)
        .run();
    }
    return;
  }

  if (direction === prevDir && prevSince) return;

  await db
    .prepare(
      `UPDATE rootmc_community_proposals SET majority_direction = ?, majority_since = ? WHERE id = ?`,
    )
    .bind(direction, nowIso(), proposalId)
    .run();
}

async function resolveGrantRecipient(
  db: D1Database,
  serverId: string,
  recipient: string,
): Promise<{ uuid: string; username: string } | null> {
  const q = str(recipient);
  if (!q) return null;

  const uuidLike = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(q);
  if (uuidLike) {
    const uuid = q.toLowerCase();
    const row = await db
      .prepare(
        `SELECT minecraft_uuid, minecraft_username FROM rootstat_player_balances
         WHERE server_id = ? AND minecraft_uuid = ? LIMIT 1`,
      )
      .bind(serverId, uuid)
      .first<{ minecraft_uuid: string; minecraft_username: string | null }>();
    if (row?.minecraft_uuid) {
      return { uuid: str(row.minecraft_uuid).toLowerCase(), username: str(row.minecraft_username) || uuid.slice(0, 8) };
    }
    const link = await db
      .prepare(`SELECT minecraft_uuid, minecraft_username FROM rootstat_minecraft_links WHERE minecraft_uuid = ? LIMIT 1`)
      .bind(uuid)
      .first<{ minecraft_uuid: string; minecraft_username: string | null }>();
    if (link?.minecraft_uuid) {
      return { uuid: str(link.minecraft_uuid).toLowerCase(), username: str(link.minecraft_username) || uuid.slice(0, 8) };
    }
    return null;
  }

  const row = await db
    .prepare(
      `SELECT minecraft_uuid, minecraft_username FROM rootstat_player_balances
       WHERE server_id = ? AND LOWER(minecraft_username) = LOWER(?) LIMIT 1`,
    )
    .bind(serverId, q)
    .first<{ minecraft_uuid: string; minecraft_username: string | null }>();
  if (row?.minecraft_uuid) {
    return {
      uuid: str(row.minecraft_uuid).toLowerCase(),
      username: str(row.minecraft_username) || q,
    };
  }

  const link = await db
    .prepare(
      `SELECT minecraft_uuid, minecraft_username FROM rootstat_minecraft_links
       WHERE LOWER(minecraft_username) = LOWER(?) LIMIT 1`,
    )
    .bind(q)
    .first<{ minecraft_uuid: string; minecraft_username: string | null }>();
  if (link?.minecraft_uuid) {
    return {
      uuid: str(link.minecraft_uuid).toLowerCase(),
      username: str(link.minecraft_username) || q,
    };
  }

  return null;
}

export async function queueGrantTreasuryPayout(
  env: ProposalEnv,
  proposalId: string,
  row: Record<string, unknown>,
): Promise<{ ok: boolean; detail: string; transferId?: string }> {
  if (str(row.grant_transfer_id)) {
    return { ok: true, detail: "Treasury payout already queued." };
  }

  const amount = roundGold(Number(row.grant_amount));
  const toUuid = str(row.grant_recipient_uuid).toLowerCase();
  const toName = str(row.grant_recipient_username) || toUuid.slice(0, 8);
  if (!toUuid || amount < GRANT_MIN_AMOUNT) {
    return { ok: false, detail: "Invalid grant amount or recipient." };
  }

  const serverId = await resolveDiscordEconomyServerId(env.DB);
  const transferId = crypto.randomUUID();
  const ts = nowIso();

  await env.DB.batch([
    env.DB
      .prepare(
        `INSERT INTO rootmc_gold_transfers (
           id, server_id, from_uuid, from_username, to_uuid, to_username, amount,
           source, discord_from_user_id, discord_to_user_id, status, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, 'grant_proposal', NULL, NULL, 'pending', ?)`,
      )
      .bind(transferId, serverId, TOWNY_SERVER_UUID, TOWNY_SERVER_USERNAME, toUuid, toName, amount, ts),
    env.DB
      .prepare(`UPDATE rootmc_community_proposals SET grant_transfer_id = ? WHERE id = ?`)
      .bind(transferId, proposalId),
  ]);

  return { ok: true, detail: `Queued **${amount} G** treasury grant to **${toName}**.`, transferId };
}

export async function submitGrantProposal(
  env: ProposalEnv,
  params: {
    title: string;
    description: string;
    amount: number;
    recipient: string;
    createdByDiscordId: string;
  },
): Promise<{ ok: boolean; detail: string; proposalId?: string }> {
  const title = str(params.title).slice(0, 200);
  const description = str(params.description).slice(0, 4000);
  const amount = roundGold(Number(params.amount));
  if (!title || !description) {
    return { ok: false, detail: "Title and description are required." };
  }
  if (amount < GRANT_MIN_AMOUNT || amount > GRANT_MAX_AMOUNT) {
    return { ok: false, detail: `Amount must be between ${GRANT_MIN_AMOUNT} and ${GRANT_MAX_AMOUNT} Gold.` };
  }

  const serverId = await resolveServerId(env.DB);
  const recipient = await resolveGrantRecipient(env.DB, serverId, params.recipient);
  if (!recipient) {
    return { ok: false, detail: "Recipient not found  -  use an in-game username or UUID." };
  }

  const grantNote =
    `\n\n---\n**Treasury grant:** **${amount} G** -> **${recipient.username}**\n` +
    `_Weighted majority must hold for 24 hours to pass or veto. Proposer cannot vote._`;

  const { createCommunityProposal } = await import("./rootmc-community-proposals");
  const result = await createCommunityProposal(env, {
    title,
    description: description + grantNote,
    days: GRANT_MAX_OPEN_DAYS,
    createdByDiscordId: params.createdByDiscordId,
    kind: "grant",
    pollChannel: "voting",
    grantAmount: amount,
    grantRecipientUuid: recipient.uuid,
    grantRecipientUsername: recipient.username,
  });

  return result;
}

export function grantProposalEmbedNote(): string {
  return "24h sustained weighted majority  -  treasury payout on pass  -  proposer cannot vote";
}
