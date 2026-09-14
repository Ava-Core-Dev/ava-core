import type { D1Database, Fetcher } from "@cloudflare/workers-types";

import { TOWNY_SERVER_USERNAME, TOWNY_SERVER_UUID } from "./rootmc-economy-accounts";
import { resolveEconomyServerId } from "./realm-lib";
import { FEATURED_SERVER_DEFAULTS } from "./rootmc-server";
import { roundGold } from "./gold-format";

export {
  GOLD_DECIMALS,
  GOLD_MIN_AMOUNT,
  GOLD_SCALE,
  formatGold,
  formatGoldCompact,
  formatGoldDailyReport,
  formatGoldG,
  roundGold,
} from "./gold-format";

export const DISCORD_LINK_BONUS_GOLD = 100;
export const DISCORD_ACTIVITY_REWARD_GOLD = 5;
export const DISCORD_FIRST_MESSAGE_REWARD_GOLD = 20;
export const DISCORD_ACTIVITY_REWARD_COOLDOWN_MS = 12 * 60 * 60 * 1000;

export type LinkedMcPlayer = {
  discordUserId: string;
  accountId: string;
  minecraftUuid: string;
  minecraftUsername: string | null;
};

function nowIso(): string {
  return new Date().toISOString();
}

function str(v: unknown): string {
  return v == null ? "" : String(v).trim();
}

export async function resolveLinkedPlayerByDiscord(
  db: D1Database,
  discordUserId: string,
): Promise<LinkedMcPlayer | null> {
  const userId = str(discordUserId);
  if (!userId) return null;
  const row = await db
    .prepare(
      `SELECT d.discord_user_id, d.account_id, l.minecraft_uuid, l.minecraft_username
       FROM discord_account_links d
       INNER JOIN rootstat_minecraft_links l ON l.account_id = d.account_id
       WHERE d.discord_user_id = ?
       LIMIT 1`,
    )
    .bind(userId)
    .first<{
      discord_user_id: string;
      account_id: string;
      minecraft_uuid: string;
      minecraft_username: string | null;
    }>();
  if (!row?.minecraft_uuid) return null;
  return {
    discordUserId: str(row.discord_user_id),
    accountId: str(row.account_id),
    minecraftUuid: str(row.minecraft_uuid).toLowerCase(),
    minecraftUsername: str(row.minecraft_username) || null,
  };
}

export async function getPlayerBalance(
  db: D1Database,
  serverId: string,
  minecraftUuid: string,
): Promise<{ balance: number; username: string | null }> {
  const uuid = str(minecraftUuid).toLowerCase();
  const row = await db
    .prepare(
      `SELECT balance, minecraft_username
       FROM rootstat_player_balances
       WHERE server_id = ? AND minecraft_uuid = ?
       LIMIT 1`,
    )
    .bind(serverId, uuid)
    .first<{ balance: number; minecraft_username: string | null }>();
  return {
    balance: roundGold(Number(row?.balance) || 0),
    username: str(row?.minecraft_username) || null,
  };
}

export type G2BalanceFetchEnv = {
  /** @deprecated Gen 2 Worker retired — Claims balances live on main D1. */
  G2_API?: Fetcher;
};

/** @deprecated Use getPlayerBalance(db, CLAIMS_SERVER_ID, uuid). Gen 2 / api2 retired. */
export async function fetchG2PlayerBalance(
  _minecraftUuid: string,
  _env?: G2BalanceFetchEnv,
): Promise<{
  ok: boolean;
  balance: number;
  username: string | null;
  serverAddress: string;
  hasRow: boolean;
}> {
  return {
    ok: false,
    balance: 0,
    username: null,
    serverAddress: "51.81.176.61:24945",
    hasRow: false,
  };
}

export type DiscordPayResult =
  | { ok: true; transferId: string; amount: number; recipientName: string; newBalance: number }
  | { ok: false; error: string };

export async function executeDiscordPay(
  db: D1Database,
  serverId: string,
  sender: LinkedMcPlayer,
  recipient: LinkedMcPlayer,
  rawAmount: number,
): Promise<DiscordPayResult> {
  const amount = roundGold(rawAmount);
  if (amount < GOLD_MIN_AMOUNT) {
    return { ok: false, error: `Minimum payment is ${formatGold(GOLD_MIN_AMOUNT)}.` };
  }
  if (sender.discordUserId === recipient.discordUserId) {
    return { ok: false, error: "You cannot pay yourself." };
  }

  const senderBal = await getPlayerBalance(db, serverId, sender.minecraftUuid);
  if (senderBal.balance < amount) {
    return {
      ok: false,
      error: `Insufficient balance. You have **${formatGold(senderBal.balance)}**.`,
    };
  }

  const transferId = crypto.randomUUID();
  const ts = nowIso();
  const toName = recipient.minecraftUsername || recipient.minecraftUuid.slice(0, 8);
  const fromName = sender.minecraftUsername || sender.minecraftUuid.slice(0, 8);

  const deduct = await db
    .prepare(
      `UPDATE rootstat_player_balances
       SET balance = balance - ?, updated_at = ?, synced_at = ?
       WHERE server_id = ? AND minecraft_uuid = ? AND balance >= ?`,
    )
    .bind(amount, ts, ts, serverId, sender.minecraftUuid, amount)
    .run();

  if ((deduct.meta?.changes ?? 0) < 1) {
    return { ok: false, error: `Insufficient balance. You have **${formatGold(senderBal.balance)}**.` };
  }

  await db.batch([
    db
      .prepare(
        `INSERT INTO rootstat_player_balances
           (server_id, minecraft_uuid, minecraft_username, balance, currency, synced_at, updated_at)
         VALUES (?, ?, ?, ?, 'gold', ?, ?)
         ON CONFLICT(server_id, minecraft_uuid) DO UPDATE SET
           balance = rootstat_player_balances.balance + excluded.balance,
           minecraft_username = COALESCE(excluded.minecraft_username, rootstat_player_balances.minecraft_username),
           updated_at = excluded.updated_at,
           synced_at = excluded.synced_at`,
      )
      .bind(serverId, recipient.minecraftUuid, toName, amount, ts, ts),
    db
      .prepare(
        `INSERT INTO rootmc_gold_transfers (
           id, server_id, from_uuid, from_username, to_uuid, to_username, amount,
           source, discord_from_user_id, discord_to_user_id, status, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, 'discord', ?, ?, 'pending', ?)`,
      )
      .bind(
        transferId,
        serverId,
        sender.minecraftUuid,
        fromName,
        recipient.minecraftUuid,
        toName,
        amount,
        sender.discordUserId,
        recipient.discordUserId,
        ts,
      ),
    db
      .prepare(
        `UPDATE rootstat_player_net_worth
         SET balance_value = MAX(0, balance_value - ?), total_value = MAX(0, total_value - ?), synced_at = ?
         WHERE server_id = ? AND minecraft_uuid = ?`,
      )
      .bind(amount, amount, ts, serverId, sender.minecraftUuid),
    db
      .prepare(
        `INSERT INTO rootstat_player_net_worth
           (server_id, minecraft_uuid, minecraft_username, balance_value, inventory_value,
            chest_value, shop_stock_value, total_value, ranked_at, synced_at)
         VALUES (?, ?, ?, ?, 0, 0, 0, ?, ?, ?)
         ON CONFLICT(server_id, minecraft_uuid) DO UPDATE SET
           balance_value = rootstat_player_net_worth.balance_value + excluded.balance_value,
           total_value = rootstat_player_net_worth.total_value + excluded.total_value,
           minecraft_username = COALESCE(excluded.minecraft_username, rootstat_player_net_worth.minecraft_username),
           synced_at = excluded.synced_at`,
      )
      .bind(serverId, recipient.minecraftUuid, toName, amount, amount, ts, ts),
  ]);

  const newBalance = roundGold(senderBal.balance - amount);
  return { ok: true, transferId, amount, recipientName: toName, newBalance };
}

export function defaultRootMcServerId(): string {
  return FEATURED_SERVER_DEFAULTS.server_id;
}

/** Economy server for Discord/public — always singular live production (`rootmc`). */
export async function resolveDiscordEconomyServerId(db: D1Database): Promise<string> {
  return resolveEconomyServerId(db, FEATURED_SERVER_DEFAULTS.server_id, FEATURED_SERVER_DEFAULTS.server_id);
}

export type DiscordLinkBonusResult =
  | { queued: true; transferId: string; amount: number }
  | { queued: false; reason: "already_paid" | "invalid_player" };

function normalizeMcUuid(raw: unknown): string {
  return str(raw).toLowerCase().replace(/[^a-f0-9]/g, "");
}

function dashedMcUuid(compactOrAny: string): string {
  const c = normalizeMcUuid(compactOrAny);
  if (c.length !== 32) return str(compactOrAny).toLowerCase();
  return `${c.slice(0, 8)}-${c.slice(8, 12)}-${c.slice(12, 16)}-${c.slice(16, 20)}-${c.slice(20)}`;
}

/** One-time welcome bonus: towny-server -> player when Discord OAuth link completes. */
export async function queueDiscordLinkBonus(
  db: D1Database,
  serverId: string,
  minecraftUuid: string,
  minecraftUsername: string,
  discordUserId: string,
): Promise<DiscordLinkBonusResult> {
  const uuid = dashedMcUuid(minecraftUuid);
  const compact = normalizeMcUuid(minecraftUuid);
  const discordId = str(discordUserId);
  if (!uuid || !discordId) {
    return { queued: false, reason: "invalid_player" };
  }

  // Lifetime once per Minecraft UUID *or* Discord user  -  any status (prevents re-link farms).
  const existing = await db
    .prepare(
      `SELECT id FROM rootmc_gold_transfers
       WHERE source = 'discord_link'
         AND (
           discord_to_user_id = ?
           OR REPLACE(LOWER(to_uuid), '-', '') = ?
         )
       LIMIT 1`,
    )
    .bind(discordId, compact)
    .first<{ id: string }>();
  if (existing?.id) {
    return { queued: false, reason: "already_paid" };
  }

  const transferId = crypto.randomUUID();
  const ts = nowIso();
  const toName = str(minecraftUsername) || uuid.slice(0, 8);
  const amount = DISCORD_LINK_BONUS_GOLD;

  await db
    .prepare(
      `INSERT INTO rootmc_gold_transfers (
         id, server_id, from_uuid, from_username, to_uuid, to_username, amount,
         source, discord_from_user_id, discord_to_user_id, status, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, 'discord_link', NULL, ?, 'pending', ?)`,
    )
    .bind(
      transferId,
      serverId,
      TOWNY_SERVER_UUID,
      TOWNY_SERVER_USERNAME,
      uuid,
      toName,
      amount,
      discordId,
      ts,
    )
    .run();

  return { queued: true, transferId, amount };
}

export type DiscordActivityRewardResult =
  | { queued: true; transferId: string; amount: number; minecraftUsername: string }
  | { queued: false; reason: "not_linked" | "cooldown" | "invalid_player" };

/** Recurring reward: any Discord message while linked queues 5 G (12 h cooldown). */
export async function queueDiscordActivityReward(
  db: D1Database,
  serverId: string,
  discordUserId: string,
): Promise<DiscordActivityRewardResult> {
  const discordId = str(discordUserId);
  if (!discordId) {
    return { queued: false, reason: "invalid_player" };
  }

  const linked = await resolveLinkedPlayerByDiscord(db, discordId);
  if (!linked?.minecraftUuid) {
    return { queued: false, reason: "not_linked" };
  }

  const cutoff = new Date(Date.now() - DISCORD_ACTIVITY_REWARD_COOLDOWN_MS).toISOString();
  const existing = await db
    .prepare(
      `SELECT id FROM rootmc_gold_transfers
       WHERE server_id = ? AND to_uuid = ? AND source = 'discord_activity'
         AND status IN ('pending', 'applied') AND created_at >= ?
       LIMIT 1`,
    )
    .bind(serverId, linked.minecraftUuid, cutoff)
    .first<{ id: string }>();
  if (existing?.id) {
    return { queued: false, reason: "cooldown" };
  }

  const transferId = crypto.randomUUID();
  const ts = nowIso();
  const toName = str(linked.minecraftUsername) || linked.minecraftUuid.slice(0, 8);
  const amount = DISCORD_ACTIVITY_REWARD_GOLD;

  await db
    .prepare(
      `INSERT INTO rootmc_gold_transfers (
         id, server_id, from_uuid, from_username, to_uuid, to_username, amount,
         source, discord_from_user_id, discord_to_user_id, status, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, 'discord_activity', NULL, ?, 'pending', ?)`,
    )
    .bind(
      transferId,
      serverId,
      TOWNY_SERVER_UUID,
      TOWNY_SERVER_USERNAME,
      linked.minecraftUuid,
      toName,
      amount,
      discordId,
      ts,
    )
    .run();

  return { queued: true, transferId, amount, minecraftUsername: toName };
}

export type DiscordFirstMessageRewardResult =
  | { queued: true; transferId: string; amount: number; minecraftUsername: string }
  | { queued: false; reason: "not_linked" | "already_paid" | "invalid_player" };

/** One-time reward when a linked player sends their first Discord guild message. */
export async function queueDiscordFirstMessageReward(
  db: D1Database,
  serverId: string,
  discordUserId: string,
): Promise<DiscordFirstMessageRewardResult> {
  const discordId = str(discordUserId);
  if (!discordId) {
    return { queued: false, reason: "invalid_player" };
  }

  const linked = await resolveLinkedPlayerByDiscord(db, discordId);
  if (!linked?.minecraftUuid) {
    return { queued: false, reason: "not_linked" };
  }

  const existing = await db
    .prepare(
      `SELECT id FROM rootmc_gold_transfers
       WHERE source = 'discord_first_message'
         AND (
           discord_to_user_id = ?
           OR REPLACE(LOWER(to_uuid), '-', '') = ?
         )
       LIMIT 1`,
    )
    .bind(discordId, normalizeMcUuid(linked.minecraftUuid))
    .first<{ id: string }>();
  if (existing?.id) {
    return { queued: false, reason: "already_paid" };
  }

  const transferId = crypto.randomUUID();
  const ts = nowIso();
  const toName = str(linked.minecraftUsername) || linked.minecraftUuid.slice(0, 8);
  const amount = DISCORD_FIRST_MESSAGE_REWARD_GOLD;
  const uuid = dashedMcUuid(linked.minecraftUuid);

  await db
    .prepare(
      `INSERT INTO rootmc_gold_transfers (
         id, server_id, from_uuid, from_username, to_uuid, to_username, amount,
         source, discord_from_user_id, discord_to_user_id, status, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, 'discord_first_message', NULL, ?, 'pending', ?)`,
    )
    .bind(
      transferId,
      serverId,
      TOWNY_SERVER_UUID,
      TOWNY_SERVER_USERNAME,
      uuid,
      toName,
      amount,
      discordId,
      ts,
    )
    .run();

  return { queued: true, transferId, amount, minecraftUsername: toName };
}
