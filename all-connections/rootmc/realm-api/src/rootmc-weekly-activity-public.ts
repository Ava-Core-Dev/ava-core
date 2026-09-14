/**
 * Public weekly activity highlights for rootmc.net  -  only after Sunday awards post.
 */

import type { D1Database } from "@cloudflare/workers-types";

import { json } from "./cors";
import { discordBotFetch } from "./discord-rootmc-api";
import { formatPlaytime } from "./rootmc-daily-report";
import { isExiledDiscordUser } from "./rootmc-exiled-discord";
import { hstWeekBoundsMs } from "./rootmc-hst-week";

function str(v: unknown): string {
  return String(v ?? "").trim();
}

export type WeeklyParticipatorPublic = {
  rank: number;
  displayName: string;
  activityScore: number;
  messageCount: number;
  voteCount: number;
  reactionCount: number;
};

export type WeeklyTopPlayerPublic = {
  rank: number;
  minecraftUsername: string;
  displayName: string;
  weeklyPlaytimeSeconds: number;
  weeklyPlaytimeLabel: string;
  proGranted?: boolean;
};

export type WeeklyActivityHighlights = {
  posted: boolean;
  weekKey?: string;
  weekLabel?: string;
  postedAt?: string;
  participators?: WeeklyParticipatorPublic[];
  topActivePlayer?: WeeklyTopPlayerPublic | null;
  topActivePlayers?: WeeklyTopPlayerPublic[];
  currentTopParticipatorRole?: string[];
  currentTopActivePlayerRole?: string[];
};

type WeeklyHighlightsEnv = {
  DISCORD_ROOTMC_BOT_TOKEN?: string;
  DISCORD_ROOTMC_GUILD_ID?: string;
  DISCORD_ROOTMC_ACTIVE_PARTICIPANT_ROLE_ID?: string;
  DISCORD_ROOTMC_TOP_ACTIVE_PLAYER_ROLE_ID?: string;
};

function weekLabel(weekKey: string): string {
  const { startMs, endMs } = hstWeekBoundsMs(weekKey);
  const opts: Intl.DateTimeFormatOptions = {
    timeZone: "Pacific/Honolulu",
    month: "short",
    day: "numeric",
    year: "numeric",
  };
  const start = new Date(startMs).toLocaleDateString("en-US", opts);
  const end = new Date(endMs).toLocaleDateString("en-US", opts);
  return `${start} - ${end} HST`;
}

export async function fetchWeeklyActivityHighlights(db: D1Database): Promise<WeeklyActivityHighlights> {
  const latest = await db
    .prepare(
      `SELECT week_key, posted_at FROM rootmc_weekly_activity_awards ORDER BY posted_at DESC LIMIT 1`,
    )
    .first<{ week_key: string; posted_at: string }>();

  if (!latest) {
    return { posted: false };
  }

  const weekKey = str(latest.week_key);
  if (!weekKey) {
    return { posted: false };
  }

  const participatorRows = await db
    .prepare(
      `SELECT rank, username, message_count, vote_count, reaction_count, activity_score, discord_user_id
       FROM rootmc_active_participant_awards
       WHERE week_key = ?
       ORDER BY rank ASC`,
    )
    .bind(weekKey)
    .all<{
      rank: number;
      username: string | null;
      message_count: number;
      vote_count: number;
      reaction_count: number;
      activity_score: number;
      discord_user_id: string;
    }>();

  const participators: WeeklyParticipatorPublic[] = (participatorRows.results || [])
    .filter((r) => !isExiledDiscordUser(r.discord_user_id))
    .map((r) => {
    const messageCount = Number(r.message_count) || 0;
    const voteCount = Number(r.vote_count) || 0;
    const reactionCount = Number(r.reaction_count) || 0;
    const activityScore =
      Number(r.activity_score) ||
      messageCount + voteCount * 5 + reactionCount;
    return {
      rank: Number(r.rank) || 0,
      displayName: str(r.username) || "Player",
      activityScore,
      messageCount,
      voteCount,
      reactionCount,
    };
  });

  const topRows = await db
    .prepare(
      `SELECT rank, minecraft_username, discord_display_name, weekly_playtime_seconds, pro_granted, discord_user_id
       FROM rootmc_top_active_player_awards
       WHERE week_key = ?
       ORDER BY rank ASC, weekly_playtime_seconds DESC`,
    )
    .bind(weekKey)
    .all<{
      rank: number;
      minecraft_username: string | null;
      discord_display_name: string | null;
      weekly_playtime_seconds: number;
      pro_granted: number;
      discord_user_id: string;
    }>();

  const topActivePlayers: WeeklyTopPlayerPublic[] = (topRows.results || [])
    .filter((row) => !isExiledDiscordUser(row.discord_user_id))
    .map((row, idx) => {
    const seconds = Math.max(0, Math.floor(Number(row.weekly_playtime_seconds) || 0));
    return {
      rank: Number(row.rank) || idx + 1,
      minecraftUsername: str(row.minecraft_username) || "Unknown",
      displayName: str(row.discord_display_name) || str(row.minecraft_username) || "Player",
      weeklyPlaytimeSeconds: seconds,
      weeklyPlaytimeLabel: formatPlaytime(seconds),
      proGranted: Number(row.pro_granted) === 1,
    };
  });

  const topActivePlayer = topActivePlayers[0] || null;

  return {
    posted: true,
    weekKey,
    weekLabel: weekLabel(weekKey),
    postedAt: str(latest.posted_at) || undefined,
    participators,
    topActivePlayer,
    topActivePlayers,
  };
}

function trim(v: unknown): string {
  return String(v ?? "").trim();
}

async function fetchGuildRoleMemberNames(
  token: string,
  guildId: string,
  roleId: string,
  max = 8,
): Promise<string[]> {
  const names: string[] = [];
  let after = "0";
  for (let i = 0; i < 5 && names.length < max; i++) {
    const res = await discordBotFetch(
      token,
      `/guilds/${encodeURIComponent(guildId)}/members?limit=200&after=${encodeURIComponent(after)}`,
    );
    if (!res.ok) {
      return [];
    }
    const rows = (await res.json()) as Array<{
      user?: { id?: string; username?: string; global_name?: string };
      nick?: string;
      roles?: string[];
    }>;
    if (!Array.isArray(rows) || rows.length === 0) break;
    for (const m of rows) {
      const roles = Array.isArray(m.roles) ? m.roles : [];
      if (!roles.includes(roleId)) continue;
      if (isExiledDiscordUser(m.user?.id)) continue;
      const name = trim(m.nick) || trim(m.user?.global_name) || trim(m.user?.username);
      if (name) names.push(name);
      if (names.length >= max) break;
    }
    const last = rows[rows.length - 1];
    const nextAfter = trim(last?.user?.id);
    if (!nextAfter) break;
    after = nextAfter;
  }
  return names;
}

async function fetchCurrentRoleHolders(env: WeeklyHighlightsEnv): Promise<{
  currentTopParticipatorRole: string[];
  currentTopActivePlayerRole: string[];
}> {
  const token = trim(env.DISCORD_ROOTMC_BOT_TOKEN);
  const guildId = trim(env.DISCORD_ROOTMC_GUILD_ID);
  const participatorRoleId = trim(env.DISCORD_ROOTMC_ACTIVE_PARTICIPANT_ROLE_ID);
  const activePlayerRoleId = trim(env.DISCORD_ROOTMC_TOP_ACTIVE_PLAYER_ROLE_ID);
  if (!token || !guildId) {
    return { currentTopParticipatorRole: [], currentTopActivePlayerRole: [] };
  }
  const [part, active] = await Promise.all([
    participatorRoleId ? fetchGuildRoleMemberNames(token, guildId, participatorRoleId, 8) : Promise.resolve([]),
    activePlayerRoleId ? fetchGuildRoleMemberNames(token, guildId, activePlayerRoleId, 8) : Promise.resolve([]),
  ]);
  return {
    currentTopParticipatorRole: part,
    currentTopActivePlayerRole: active,
  };
}

export async function handleWeeklyActivityHighlights(db: D1Database, env: WeeklyHighlightsEnv): Promise<Response> {
  const [data, current] = await Promise.all([fetchWeeklyActivityHighlights(db), fetchCurrentRoleHolders(env)]);
  const merged: WeeklyActivityHighlights = { ...data, ...current };
  return json(merged, 200, {
    "Cache-Control": merged.posted ? "public, max-age=300" : "public, max-age=60",
  });
}
