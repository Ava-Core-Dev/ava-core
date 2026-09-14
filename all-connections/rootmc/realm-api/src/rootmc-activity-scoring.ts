/**
 * Weekly Discord activity scoring  -  message blocks, weighted points, spam heuristics.
 * A message block = consecutive posts by one user in a channel until someone else speaks.
 */

import type { D1Database } from "@cloudflare/workers-types";

import { activityScoringChannelFilter } from "./rootmc-discord-activity-sync";
import { isExiledDiscordUser } from "./rootmc-exiled-discord";
import { isActivityBotDiscordUser } from "./rootmc-activity-bots";

export const POINTS_PER_MESSAGE_BLOCK = 1;
export const POINTS_PER_VOTE = 5;
export const POINTS_PER_REACTION = 1;
export const MIN_ACTIVITY_SCORE = 5;
export const TOP_PARTICIPATOR_N = 5;

export type WeeklyActivityCandidate = {
  discord_user_id: string;
  display_name: string;
  message_blocks: number;
  raw_message_count: number;
  vote_count: number;
  reaction_count: number;
  channel_count: number;
  activity_score: number;
  burst_ratio: number;
  spam_risk: "low" | "medium" | "high";
};

type MessageRow = {
  discord_user_id: string;
  channel_id: string;
  created_at: string;
  username: string | null;
  global_name: string | null;
};

function str(v: unknown): string {
  return String(v ?? "").trim();
}

/** Count interruption-based blocks for one user in a channel timeline (sorted by time). */
export function countMessageBlocksInChannel(
  ordered: { discord_user_id: string }[],
  userId: string,
): number {
  let blocks = 0;
  let prevAuthor: string | null = null;
  for (const msg of ordered) {
    const author = str(msg.discord_user_id);
    if (author === userId && prevAuthor !== userId) {
      blocks += 1;
    }
    prevAuthor = author;
  }
  return blocks;
}

export function computeWeightedActivityScore(
  messageBlocks: number,
  voteCount: number,
  reactionCount: number,
): number {
  return (
    Math.max(0, messageBlocks) * POINTS_PER_MESSAGE_BLOCK +
    Math.max(0, voteCount) * POINTS_PER_VOTE +
    Math.max(0, reactionCount) * POINTS_PER_REACTION
  );
}

function spamRisk(blocks: number, rawMessages: number): "low" | "medium" | "high" {
  if (rawMessages < 8) return "low";
  const ratio = blocks > 0 ? rawMessages / blocks : rawMessages;
  if (ratio >= 25 || (rawMessages >= 40 && blocks <= 2)) return "high";
  if (ratio >= 12 || (rawMessages >= 20 && blocks <= 2)) return "medium";
  return "low";
}

async function weeklyMessageBlockStats(
  db: D1Database,
  env: { DISCORD_ROOTMC_BOT_SPAM_CHANNEL_ID?: string; DISCORD_ROOTMC_DAILY_REPORT_CHANNEL_ID?: string; DISCORD_ROOTMC_AI_RAW_ARCHIVE_CHANNEL_ID?: string },
  startIso: string,
  endIso: string,
): Promise<
  Map<
    string,
    { display_name: string; message_blocks: number; raw_message_count: number; channel_count: number }
  >
> {
  const skip = [...activityScoringChannelFilter(env)];
  let query = `SELECT discord_user_id, channel_id, created_at, username, global_name
       FROM discord_message_activity
       WHERE created_at >= ? AND created_at <= ?`;
  const binds: unknown[] = [startIso, endIso];
  if (skip.length) {
    query += ` AND channel_id NOT IN (${skip.map(() => "?").join(",")})`;
    binds.push(...skip);
  }
  query += ` ORDER BY channel_id ASC, created_at ASC`;

  const rows = await db.prepare(query).bind(...binds).all<MessageRow>();
  const byChannel = new Map<string, MessageRow[]>();
  for (const r of rows.results || []) {
    const ch = str(r.channel_id);
    if (!ch) continue;
    const list = byChannel.get(ch) || [];
    list.push(r);
    byChannel.set(ch, list);
  }

  const perUser = new Map<
    string,
    { display_name: string; message_blocks: number; raw_message_count: number; channels: Set<string> }
  >();

  for (const [channelId, msgs] of byChannel) {
    const userIds = new Set(msgs.map((m) => str(m.discord_user_id)).filter(Boolean));
    for (const uid of userIds) {
      if (isExiledDiscordUser(uid)) continue;
      const blocks = countMessageBlocksInChannel(msgs, uid);
      if (blocks <= 0) continue;
      const raw = msgs.filter((m) => str(m.discord_user_id) === uid).length;
      const sample = msgs.find((m) => str(m.discord_user_id) === uid);
      const display =
        str(sample?.global_name) || str(sample?.username) || uid;
      const cur = perUser.get(uid) || {
        display_name: display,
        message_blocks: 0,
        raw_message_count: 0,
        channels: new Set<string>(),
      };
      cur.message_blocks += blocks;
      cur.raw_message_count += raw;
      cur.channels.add(channelId);
      if (!cur.display_name || cur.display_name === uid) {
        cur.display_name = display;
      }
      perUser.set(uid, cur);
    }
  }

  const out = new Map<
    string,
    { display_name: string; message_blocks: number; raw_message_count: number; channel_count: number }
  >();
  for (const [uid, v] of perUser) {
    out.set(uid, {
      display_name: v.display_name,
      message_blocks: v.message_blocks,
      raw_message_count: v.raw_message_count,
      channel_count: v.channels.size,
    });
  }
  return out;
}

async function weeklyVoteCounts(
  db: D1Database,
  startIso: string,
  endIso: string,
): Promise<Map<string, number>> {
  const rows = await db
    .prepare(
      `SELECT discord_user_id, COUNT(*) AS vote_count
       FROM rootmc_community_proposal_votes
       WHERE voted_at >= ? AND voted_at <= ?
       GROUP BY discord_user_id`,
    )
    .bind(startIso, endIso)
    .all<{ discord_user_id: string; vote_count: number }>();

  const map = new Map<string, number>();
  for (const r of rows.results || []) {
    const uid = str(r.discord_user_id);
    if (!uid || isExiledDiscordUser(uid)) continue;
    map.set(uid, Number(r.vote_count) || 0);
  }
  return map;
}

async function weeklyReactionCounts(
  db: D1Database,
  env: { DISCORD_ROOTMC_BOT_SPAM_CHANNEL_ID?: string; DISCORD_ROOTMC_DAILY_REPORT_CHANNEL_ID?: string; DISCORD_ROOTMC_AI_RAW_ARCHIVE_CHANNEL_ID?: string },
  startIso: string,
  endIso: string,
): Promise<Map<string, { reaction_count: number; display_name: string }>> {
  const skip = [...activityScoringChannelFilter(env)];
  let query = `SELECT discord_user_id,
              COALESCE(MAX(global_name), MAX(username), discord_user_id) AS display_name,
              COUNT(*) AS reaction_count
       FROM discord_reaction_activity
       WHERE created_at >= ? AND created_at <= ?`;
  const binds: unknown[] = [startIso, endIso];
  if (skip.length) {
    query += ` AND channel_id NOT IN (${skip.map(() => "?").join(",")})`;
    binds.push(...skip);
  }
  query += ` GROUP BY discord_user_id`;

  const rows = await db.prepare(query).bind(...binds).all<{
    discord_user_id: string;
    display_name: string;
    reaction_count: number;
  }>();

  const map = new Map<string, { reaction_count: number; display_name: string }>();
  for (const r of rows.results || []) {
    const uid = str(r.discord_user_id);
    if (!uid || isExiledDiscordUser(uid)) continue;
    map.set(uid, {
      reaction_count: Number(r.reaction_count) || 0,
      display_name: str(r.display_name) || uid,
    });
  }
  return map;
}

export async function gatherWeeklyActivityCandidates(
  db: D1Database,
  env: { DISCORD_ROOTMC_BOT_SPAM_CHANNEL_ID?: string; DISCORD_ROOTMC_DAILY_REPORT_CHANNEL_ID?: string; DISCORD_ROOTMC_AI_RAW_ARCHIVE_CHANNEL_ID?: string },
  startIso: string,
  endIso: string,
): Promise<WeeklyActivityCandidate[]> {
  const [messages, votes, reactions] = await Promise.all([
    weeklyMessageBlockStats(db, env, startIso, endIso),
    weeklyVoteCounts(db, startIso, endIso),
    weeklyReactionCounts(db, env, startIso, endIso),
  ]);

  const userIds = new Set<string>([...messages.keys(), ...votes.keys(), ...reactions.keys()]);
  const merged: WeeklyActivityCandidate[] = [];

  for (const uid of userIds) {
    if (isExiledDiscordUser(uid)) continue;
    if (isActivityBotDiscordUser(uid)) continue;
    const msg = messages.get(uid);
    const voteCount = votes.get(uid) || 0;
    const react = reactions.get(uid);
    const messageBlocks = msg?.message_blocks || 0;
    const rawMessageCount = msg?.raw_message_count || 0;
    const reactionCount = react?.reaction_count || 0;
    const activityScore = computeWeightedActivityScore(messageBlocks, voteCount, reactionCount);
    // Rank anyone with scored activity; role eligibility still uses MIN_ACTIVITY_SCORE.
    if (activityScore < 1) continue;

    const burstRatio =
      messageBlocks > 0 ? Math.round((rawMessageCount / messageBlocks) * 10) / 10 : rawMessageCount;

    merged.push({
      discord_user_id: uid,
      display_name: msg?.display_name || react?.display_name || uid,
      message_blocks: messageBlocks,
      raw_message_count: rawMessageCount,
      vote_count: voteCount,
      reaction_count: reactionCount,
      channel_count: msg?.channel_count || 0,
      activity_score: activityScore,
      burst_ratio: burstRatio,
      spam_risk: spamRisk(messageBlocks, rawMessageCount),
    });
  }

  merged.sort((a, b) => {
    if (b.activity_score !== a.activity_score) return b.activity_score - a.activity_score;
    if (b.message_blocks !== a.message_blocks) return b.message_blocks - a.message_blocks;
    if (b.channel_count !== a.channel_count) return b.channel_count - a.channel_count;
    return a.discord_user_id.localeCompare(b.discord_user_id);
  });

  return merged;
}

export function deterministicExcludeSpam(candidates: WeeklyActivityCandidate[]): Set<string> {
  const excluded = new Set<string>();
  for (const c of candidates) {
    if (c.spam_risk === "high" && c.vote_count === 0 && c.reaction_count <= 1) {
      excluded.add(c.discord_user_id);
    }
  }
  return excluded;
}
