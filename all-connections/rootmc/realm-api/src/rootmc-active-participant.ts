/**
 * Weekly Top Participator  -  message blocks, votes (x5), reactions, Root-AI judgment.
 * Award flow: rootmc-weekly-activity-awards.ts (combined with Top Active Player).
 */

import type { D1Database } from "@cloudflare/workers-types";

import {
  addGuildMemberRole,
  discordBotFetch,
  removeGuildMemberRole,
} from "./discord-rootmc-api";
import { judgeWeeklyParticipators } from "./rootmc-activity-ai-judge";
import {
  MIN_ACTIVITY_SCORE,
  TOP_PARTICIPATOR_N,
  gatherWeeklyActivityCandidates,
} from "./rootmc-activity-scoring";
import { isExiledDiscordUser } from "./rootmc-exiled-discord";
import { isActivityBotDiscordUser } from "./rootmc-activity-bots";
import { hstWeekBoundsMs, previousHstWeekKey } from "./rootmc-hst-week";

export type RootMcActiveParticipantEnv = {
  DB: D1Database;
  DISCORD_ROOTMC_BOT_TOKEN?: string;
  DISCORD_ROOTMC_GUILD_ID?: string;
  DISCORD_ROOTMC_GENERAL_CHAT_CHANNEL_ID?: string;
  DISCORD_ROOTMC_ACTIVE_PARTICIPANT_ROLE_ID?: string;
  DISCORD_ROOTMC_BOT_SPAM_CHANNEL_ID?: string;
  DISCORD_ROOTMC_DAILY_REPORT_CHANNEL_ID?: string;
  DISCORD_ROOTMC_AI_RAW_ARCHIVE_CHANNEL_ID?: string;
  GROK_API_BEARER_TOKEN?: string;
  GROK_API_URL?: string;
  GROK_MODEL?: string;
};

function str(v: unknown): string {
  return String(v ?? "").trim();
}

function nowIso(): string {
  return new Date().toISOString();
}

function mention(userId: string): string {
  return `<@${userId}>`;
}

export type ActiveParticipantWinner = {
  discord_user_id: string;
  display_name: string;
  /** Message blocks (consecutive runs until another user speaks). */
  message_count: number;
  vote_count: number;
  reaction_count: number;
  activity_score: number;
  channel_count: number;
};

export function formatParticipatorScoreLine(w: ActiveParticipantWinner): string {
  const votePts = w.vote_count * 5;
  return `**${w.activity_score}** pts (${w.message_count} blocks  -  ${w.vote_count} votes = ${votePts} pts  -  ${w.reaction_count} reactions)`;
}

export async function weeklyActiveParticipantWinners(
  db: D1Database,
  env: RootMcActiveParticipantEnv,
  weekKey: string,
): Promise<ActiveParticipantWinner[]> {
  const { startMs, endMs } = hstWeekBoundsMs(weekKey);
  const startIso = new Date(startMs).toISOString();
  const endIso = new Date(endMs).toISOString();

  const candidates = await gatherWeeklyActivityCandidates(db, env, startIso, endIso);
  if (candidates.length === 0) return [];

  const { winners } = await judgeWeeklyParticipators(env, weekKey, candidates);

  return winners
    .filter((w) => !isExiledDiscordUser(w.discord_user_id))
    .filter((w) => !isActivityBotDiscordUser(w.discord_user_id))
    .map((w) => ({
    discord_user_id: w.discord_user_id,
    display_name: w.display_name,
    message_count: w.message_blocks,
    vote_count: w.vote_count,
    reaction_count: w.reaction_count,
    activity_score: w.activity_score,
    channel_count: w.channel_count,
  }));
}

export async function activeParticipantAwardPosted(db: D1Database, weekKey: string): Promise<boolean> {
  const row = await db
    .prepare(`SELECT 1 FROM rootmc_active_participant_awards WHERE week_key = ? LIMIT 1`)
    .bind(weekKey)
    .first();
  return Boolean(row);
}

function buildPost(weekKey: string, winners: ActiveParticipantWinner[], roleId: string): string {
  const { startMs, endMs } = hstWeekBoundsMs(weekKey);
  const startLabel = new Date(startMs).toLocaleDateString("en-US", {
    timeZone: "Pacific/Honolulu",
    month: "short",
    day: "numeric",
  });
  const endLabel = new Date(endMs).toLocaleDateString("en-US", {
    timeZone: "Pacific/Honolulu",
    month: "short",
    day: "numeric",
    year: "numeric",
  });

  const lines = [
    `# 🏅 Top Participator  -  Week of ${weekKey}`,
    "",
    "Thanks for keeping RootMC chat and in-game bridge traffic alive this week.",
    "",
    "**How we measured it**",
    `- **Period:** ${startLabel} - ${endLabel} (Mon-Sun, **HST / Pacific/Honolulu**)`,
    "- **Message blocks**  -  1 pt each (your consecutive messages until someone else speaks; back-to-back posts = one block)",
    "- **Votes**  -  5 pts each (`/proposal` community votes)",
    "- **Reactions**  -  1 pt each (emoji on community messages)",
    "- Root-AI reviews saved activity and excludes obvious spam before final ranks",
    `- **Minimum ${MIN_ACTIVITY_SCORE} weighted points**; **top ${TOP_PARTICIPATOR_N}** earn the role`,
    "",
    "**This week's top voices**",
  ];

  winners.forEach((w, i) => {
    lines.push(`${i + 1}. ${mention(w.discord_user_id)} (**${w.display_name}**)  -  ${formatParticipatorScoreLine(w)}`);
  });

  lines.push(
    "",
    `You've been given **Top Participator** (<@&${roleId}>). Role refreshes each **Sunday 10:00 HST** with the new weekly leaders.`,
    "",
    "_Activity stored in D1; Root-AI judges weekly winners._",
  );

  return lines.join("\n");
}

async function revokePreviousWeekRoles(
  env: RootMcActiveParticipantEnv,
  token: string,
  guildId: string,
  roleId: string,
  previousWeekKey: string,
): Promise<void> {
  const rows = await env.DB.prepare(
    `SELECT discord_user_id FROM rootmc_active_participant_awards WHERE week_key = ? AND role_granted = 1`,
  )
    .bind(previousWeekKey)
    .all<{ discord_user_id: string }>();

  for (const row of rows.results || []) {
    const uid = str(row.discord_user_id);
    if (!uid) continue;
    await removeGuildMemberRole(token, guildId, uid, roleId);
  }
}

export async function runRootMcActiveParticipantAward(
  env: RootMcActiveParticipantEnv,
  weekKey: string,
): Promise<{ ok: boolean; detail?: string; messageId?: string; winners?: ActiveParticipantWinner[] }> {
  const token = str(env.DISCORD_ROOTMC_BOT_TOKEN);
  const guildId = str(env.DISCORD_ROOTMC_GUILD_ID);
  const channelId = str(env.DISCORD_ROOTMC_GENERAL_CHAT_CHANNEL_ID);
  const roleId = str(env.DISCORD_ROOTMC_ACTIVE_PARTICIPANT_ROLE_ID);

  if (!token || !guildId || !channelId || !roleId) {
    return { ok: false, detail: "missing bot token, guild, general-chat, or active-participant role id" };
  }

  if (await activeParticipantAwardPosted(env.DB, weekKey)) {
    return { ok: true, detail: "already posted" };
  }

  const winners = await weeklyActiveParticipantWinners(env.DB, env, weekKey);
  if (winners.length === 0) {
    return { ok: false, detail: "no qualifying members this week" };
  }

  const prevWeek = previousHstWeekKey(weekKey);
  await revokePreviousWeekRoles(env, token, guildId, roleId, prevWeek);

  const content = buildPost(weekKey, winners, roleId);
  const postRes = await discordBotFetch(token, `/channels/${encodeURIComponent(channelId)}/messages`, {
    method: "POST",
    body: JSON.stringify({ content: content.slice(0, 2000) }),
  });
  if (!postRes.ok) {
    return { ok: false, detail: `discord post failed ${postRes.status}` };
  }
  const posted = (await postRes.json().catch(() => ({}))) as { id?: string };
  const messageId = str(posted.id) || null;

  for (let i = 0; i < winners.length; i++) {
    const w = winners[i];
    await addGuildMemberRole(token, guildId, w.discord_user_id, roleId);
    await env.DB.prepare(
      `INSERT INTO rootmc_active_participant_awards
         (week_key, discord_user_id, rank, message_count, vote_count, reaction_count, activity_score,
          username, role_granted, posted_at, message_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
    )
      .bind(
        weekKey,
        w.discord_user_id,
        i + 1,
        w.message_count,
        w.vote_count,
        w.reaction_count,
        w.activity_score,
        w.display_name,
        nowIso(),
        messageId,
      )
      .run();
  }

  return { ok: true, detail: "posted", messageId: messageId || undefined, winners };
}
