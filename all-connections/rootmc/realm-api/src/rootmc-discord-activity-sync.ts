/**
 * Incremental RootMC Discord ingest for weekly Top Participator scoring.
 * Messages, emoji reactions, and community proposal votes (votes stored on cast).
 */

import type { D1Database } from "@cloudflare/workers-types";

import { discordBotFetch, listGuildTextChannels } from "./discord-rootmc-api";
import { queueDiscordActivityReward, queueDiscordFirstMessageReward, resolveDiscordEconomyServerId } from "./discord-rootmc-economy";
import { isExiledDiscordUser } from "./rootmc-exiled-discord";

export type RootMcDiscordActivitySyncEnv = {
  DB: D1Database;
  DISCORD_ROOTMC_BOT_TOKEN?: string;
  DISCORD_ROOTMC_GUILD_ID?: string;
  DISCORD_ROOTMC_BOT_SPAM_CHANNEL_ID?: string;
  DISCORD_ROOTMC_DAILY_REPORT_CHANNEL_ID?: string;
  DISCORD_ROOTMC_AI_RAW_ARCHIVE_CHANNEL_ID?: string;
  DISCORD_ROOTMC_AI_ARCHIVE_CHANNEL_ID?: string;
  DISCORD_ROOTMC_RULES_CHANNEL_ID?: string;
  DISCORD_ROOTMC_UNVERIFIED_CHANNEL_ID?: string;
  DISCORD_ROOTMC_CONSTITUTION_CHANNEL_ID?: string;
  DISCORD_ROOTMC_ECONOMY_ANNOUNCE_CHANNEL_ID?: string;
  DISCORD_ROOTMC_AUTOMATED_REPORTS_CHANNEL_ID?: string;
  DISCORD_ROOTMC_HOURLY_SNAPSHOT_CHANNEL_ID?: string;
  DISCORD_ROOTMC_LOGS_CHANNEL_ID?: string;
  DISCORD_ROOTMC_INGAME_CHAT_CHANNEL_ID?: string;
};

type DiscordEmoji = {
  id?: string | null;
  name?: string;
};

type DiscordAuthor = {
  id?: string;
  username?: string;
  global_name?: string | null;
  bot?: boolean;
};

type DiscordReaction = {
  count?: number;
  emoji?: DiscordEmoji;
};

type DiscordMessage = {
  id?: string;
  type?: number;
  timestamp?: string;
  content?: string;
  author?: DiscordAuthor;
  reactions?: DiscordReaction[];
};

function str(v: unknown): string {
  return String(v ?? "").trim();
}

function nowIso(): string {
  return new Date().toISOString();
}

function emojiKey(emoji: DiscordEmoji): string {
  const name = str(emoji.name);
  const id = str(emoji.id);
  return id ? `${name}:${id}` : name;
}

function emojiPathSegment(emoji: DiscordEmoji): string {
  const name = str(emoji.name);
  const id = str(emoji.id);
  if (id) return `${encodeURIComponent(name)}:${id}`;
  return encodeURIComponent(name);
}

function excludedChannelIds(env: RootMcDiscordActivitySyncEnv): Set<string> {
  return new Set(
    [
      env.DISCORD_ROOTMC_BOT_SPAM_CHANNEL_ID,
      env.DISCORD_ROOTMC_DAILY_REPORT_CHANNEL_ID,
      env.DISCORD_ROOTMC_AI_RAW_ARCHIVE_CHANNEL_ID,
      env.DISCORD_ROOTMC_AI_ARCHIVE_CHANNEL_ID,
      env.DISCORD_ROOTMC_RULES_CHANNEL_ID,
      env.DISCORD_ROOTMC_UNVERIFIED_CHANNEL_ID,
      env.DISCORD_ROOTMC_CONSTITUTION_CHANNEL_ID,
      env.DISCORD_ROOTMC_ECONOMY_ANNOUNCE_CHANNEL_ID,
      env.DISCORD_ROOTMC_AUTOMATED_REPORTS_CHANNEL_ID,
      env.DISCORD_ROOTMC_HOURLY_SNAPSHOT_CHANNEL_ID,
      env.DISCORD_ROOTMC_LOGS_CHANNEL_ID,
      env.DISCORD_ROOTMC_INGAME_CHAT_CHANNEL_ID,
    ]
      .map((v) => str(v))
      .filter(Boolean),
  );
}

async function upsertDiscoveredChannels(
  db: D1Database,
  guildId: string,
  channels: { id: string; name: string; type: number; position?: number; parent_id?: string | null }[],
): Promise<void> {
  const ts = nowIso();
  for (const ch of channels.slice(0, 80)) {
    await db
      .prepare(
        `INSERT INTO discord_discovered_channels
           (channel_id, guild_id, name, type, position, parent_id, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(channel_id) DO UPDATE SET
           guild_id = excluded.guild_id,
           name = excluded.name,
           type = excluded.type,
           position = excluded.position,
           parent_id = excluded.parent_id,
           updated_at = excluded.updated_at`,
      )
      .bind(ch.id, guildId, ch.name, ch.type, Number(ch.position) || 0, ch.parent_id || null, ts)
      .run();
  }
}

async function persistReactionUsers(
  db: D1Database,
  token: string,
  guildId: string,
  channelId: string,
  messageId: string,
  emoji: DiscordEmoji,
): Promise<number> {
  const ek = emojiKey(emoji);
  if (!ek) return 0;

  let upserts = 0;
  let after = "";
  const pathBase = `/channels/${encodeURIComponent(channelId)}/messages/${encodeURIComponent(messageId)}/reactions/${emojiPathSegment(emoji)}`;

  while (true) {
    const params = new URLSearchParams({ limit: "100" });
    if (after) params.set("after", after);

    const res = await discordBotFetch(token, `${pathBase}?${params}`);
    if (!res.ok) break;

    const users = (await res.json().catch(() => [])) as DiscordAuthor[];
    if (!Array.isArray(users) || users.length === 0) break;

    const ts = nowIso();
    for (const user of users) {
      const uid = str(user.id);
      if (!uid || user.bot || isExiledDiscordUser(uid)) continue;
      const username = str(user.username) || null;
      const globalName = str(user.global_name) || null;
      const ins = await db
        .prepare(
          `INSERT OR IGNORE INTO discord_reaction_activity
             (discord_message_id, discord_user_id, emoji_key, channel_id, guild_id, username, global_name, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(messageId, uid, ek, channelId, guildId, username, globalName, ts)
        .run();
      if ((ins.meta?.changes ?? 0) === 1) upserts += 1;
    }

    if (users.length < 100) break;
    after = str(users[users.length - 1]?.id);
    if (!after) break;
  }

  return upserts;
}

async function syncMessageReactions(
  db: D1Database,
  token: string,
  guildId: string,
  channelId: string,
  msg: DiscordMessage,
): Promise<number> {
  const mid = str(msg.id);
  if (!mid || !msg.reactions?.length) return 0;

  let upserts = 0;
  for (const reaction of msg.reactions) {
    if (!reaction.emoji || (Number(reaction.count) || 0) <= 0) continue;
    upserts += await persistReactionUsers(db, token, guildId, channelId, mid, reaction.emoji);
  }
  return upserts;
}

async function persistMessageActivity(
  db: D1Database,
  guildId: string,
  channelId: string,
  msg: DiscordMessage,
): Promise<boolean> {
  const mid = str(msg.id);
  const authorId = str(msg.author?.id);
  if (!mid || !authorId || msg.author?.bot || isExiledDiscordUser(authorId)) return false;
  const createdAt = str(msg.timestamp) || nowIso();
  const username = str(msg.author?.username) || null;
  const globalName = str(msg.author?.global_name) || null;

  const ins = await db
    .prepare(
      `INSERT OR IGNORE INTO discord_message_activity
         (discord_message_id, channel_id, guild_id, discord_user_id, username, global_name, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(mid, channelId, guildId, authorId, username, globalName, createdAt)
    .run();
  if ((ins.meta?.changes ?? 0) !== 1) return false;

  await db
    .prepare(
      `INSERT INTO discord_user_activity
         (discord_user_id, username, global_name, last_message_at, last_message_id, message_count, updated_at)
       VALUES (?, ?, ?, ?, ?, 1, datetime('now'))
       ON CONFLICT(discord_user_id) DO UPDATE SET
         username = excluded.username,
         global_name = excluded.global_name,
         last_message_at = excluded.last_message_at,
         last_message_id = excluded.last_message_id,
         message_count = discord_user_activity.message_count + 1,
         updated_at = datetime('now')`,
    )
    .bind(authorId, username, globalName, createdAt, mid)
    .run();

  const day = createdAt.slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(day)) {
    await db
      .prepare(
        `INSERT INTO discord_activity_daily_by_channel (day, channel_id, message_count) VALUES (?, ?, 1)
         ON CONFLICT(day, channel_id) DO UPDATE SET message_count = discord_activity_daily_by_channel.message_count + 1`,
      )
      .bind(day, channelId)
      .run();
  }
  return true;
}

async function rescanRecentReactions(
  env: RootMcDiscordActivitySyncEnv,
  token: string,
  guildId: string,
  channelId: string,
): Promise<number> {
  const res = await discordBotFetch(
    token,
    `/channels/${encodeURIComponent(channelId)}/messages?${new URLSearchParams({ limit: "50" })}`,
  );
  if (!res.ok) return 0;

  const msgs = (await res.json().catch(() => [])) as DiscordMessage[];
  if (!Array.isArray(msgs) || msgs.length === 0) return 0;

  let upserts = 0;
  for (const msg of msgs) {
    if (!msg.reactions?.length) continue;
    upserts += await syncMessageReactions(env.DB, token, guildId, channelId, msg);
  }
  return upserts;
}

async function syncChannel(
  env: RootMcDiscordActivitySyncEnv,
  token: string,
  guildId: string,
  channelId: string,
): Promise<number> {
  const state = await env.DB.prepare(
    `SELECT last_message_id FROM discord_channel_sync_state WHERE channel_id = ? LIMIT 1`,
  )
    .bind(channelId)
    .first<{ last_message_id: string | null }>();

  const params = new URLSearchParams({ limit: "100" });
  const after = str(state?.last_message_id);
  if (after) params.set("after", after);

  const res = await discordBotFetch(
    token,
    `/channels/${encodeURIComponent(channelId)}/messages?${params}`,
  );
  if (!res.ok) return 0;

  const msgs = (await res.json().catch(() => [])) as DiscordMessage[];
  if (!Array.isArray(msgs) || msgs.length === 0) return 0;

  const ordered = [...msgs].reverse();
  let upserts = 0;
  let newestId = after || "";
  const economyServerId = await resolveDiscordEconomyServerId(env.DB);

  for (const msg of ordered) {
    if (msg.type != null && msg.type !== 0 && msg.type !== 19) continue;
    const authorId = str(msg.author?.id);
    if (await persistMessageActivity(env.DB, guildId, channelId, msg)) {
      upserts += 1;
      if (authorId) {
        const first = await queueDiscordFirstMessageReward(env.DB, economyServerId, authorId);
        if (first.queued) {
          console.info(
            "rootmc_discord_first_message_reward_queued",
            first.minecraftUsername,
            first.transferId,
          );
        } else {
          const reward = await queueDiscordActivityReward(env.DB, economyServerId, authorId);
          if (reward.queued) {
            console.info(
              "rootmc_discord_activity_reward_queued",
              reward.minecraftUsername,
              reward.transferId,
            );
          }
        }
      }
    }
    upserts += await syncMessageReactions(env.DB, token, guildId, channelId, msg);
    if (str(msg.id)) newestId = str(msg.id);
  }

  if (newestId && newestId !== after) {
    await env.DB.prepare(
      `INSERT INTO discord_channel_sync_state (channel_id, last_message_id, last_sync_at)
       VALUES (?, ?, ?)
       ON CONFLICT(channel_id) DO UPDATE SET last_message_id = excluded.last_message_id, last_sync_at = excluded.last_sync_at`,
    )
      .bind(channelId, newestId, nowIso())
      .run();
  }

  upserts += await rescanRecentReactions(env, token, guildId, channelId);
  return upserts;
}

export async function runRootMcDiscordActivitySync(env: RootMcDiscordActivitySyncEnv): Promise<{
  ok: boolean;
  upserts: number;
  channels: number;
}> {
  const token = str(env.DISCORD_ROOTMC_BOT_TOKEN);
  const guildId = str(env.DISCORD_ROOTMC_GUILD_ID);
  if (!token || !guildId) {
    return { ok: true, upserts: 0, channels: 0 };
  }

  const skip = excludedChannelIds(env);
  const channels = (await listGuildTextChannels(token, guildId)).filter((ch) => !skip.has(ch.id));
  await upsertDiscoveredChannels(env.DB, guildId, channels);

  let upserts = 0;
  for (const ch of channels.slice(0, 80)) {
    try {
      upserts += await syncChannel(env, token, guildId, ch.id);
    } catch (e) {
      console.warn("rootmc_discord_activity_sync_channel", ch.id, e instanceof Error ? e.message : String(e));
    }
  }

  if (upserts > 0) {
    console.log(JSON.stringify({ msg: "rootmc_discord_activity_sync_ok", upserts, channels: channels.length }));
  }
  return { ok: true, upserts, channels: channels.length };
}

/** Channels counted toward Top Participator (excludes bot-spam / report feeds). */
export function activityScoringChannelFilter(env: RootMcDiscordActivitySyncEnv): Set<string> {
  return excludedChannelIds(env);
}
