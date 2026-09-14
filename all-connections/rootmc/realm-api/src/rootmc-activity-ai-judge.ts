/**
 * Root-AI final judgment for weekly Top Participator  -  ranks winners and excludes spam.
 */

import type { D1Database } from "@cloudflare/workers-types";

import { callGrokJsonObject } from "./rootmc-world-ai";
import { ROOTMC_WEEKLY_ACTIVITY_JUDGE_PROMPT } from "./rootmc-grok-prompts";
import {
  TOP_PARTICIPATOR_N,
  deterministicExcludeSpam,
  type WeeklyActivityCandidate,
} from "./rootmc-activity-scoring";
import { isExiledDiscordUser } from "./rootmc-exiled-discord";

export type ActivityAiJudgeEnv = {
  DB: D1Database;
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

export type ActivityJudgeWinner = {
  discord_user_id: string;
  display_name: string;
  message_blocks: number;
  vote_count: number;
  reaction_count: number;
  activity_score: number;
  channel_count: number;
  ai_note?: string;
};

type AiJudgeResponse = {
  winners?: Array<{ discord_user_id?: string; rank?: number; note?: string }>;
  excluded?: Array<{ discord_user_id?: string; reason?: string }>;
};

function candidateMap(candidates: WeeklyActivityCandidate[]): Map<string, WeeklyActivityCandidate> {
  return new Map(candidates.map((c) => [c.discord_user_id, c]));
}

function fallbackWinners(
  candidates: WeeklyActivityCandidate[],
  excluded: Set<string>,
): ActivityJudgeWinner[] {
  const out: ActivityJudgeWinner[] = [];
  for (const c of candidates) {
    if (excluded.has(c.discord_user_id)) continue;
    out.push({
      discord_user_id: c.discord_user_id,
      display_name: c.display_name,
      message_blocks: c.message_blocks,
      vote_count: c.vote_count,
      reaction_count: c.reaction_count,
      activity_score: c.activity_score,
      channel_count: c.channel_count,
    });
    if (out.length >= TOP_PARTICIPATOR_N) break;
  }
  return out;
}

async function persistAiRun(
  db: D1Database,
  weekKey: string,
  grokOk: boolean,
  grokModel: string | null,
  prompt: Record<string, unknown>,
  response: Record<string, unknown>,
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO rootmc_weekly_activity_ai_runs
         (week_key, kind, grok_model, grok_ok, prompt_json, response_json, created_at)
       VALUES (?, 'discord_participator', ?, ?, ?, ?, ?)
       ON CONFLICT(week_key, kind) DO UPDATE SET
         grok_model = excluded.grok_model,
         grok_ok = excluded.grok_ok,
         prompt_json = excluded.prompt_json,
         response_json = excluded.response_json,
         created_at = excluded.created_at`,
    )
    .bind(
      weekKey,
      grokModel,
      grokOk ? 1 : 0,
      JSON.stringify(prompt),
      JSON.stringify(response),
      nowIso(),
    )
    .run();
}

export async function judgeWeeklyParticipators(
  env: ActivityAiJudgeEnv,
  weekKey: string,
  candidates: WeeklyActivityCandidate[],
): Promise<{ winners: ActivityJudgeWinner[]; excludedIds: Set<string>; aiUsed: boolean }> {
  const heuristicExcluded = deterministicExcludeSpam(candidates);
  for (const c of candidates) {
    if (isExiledDiscordUser(c.discord_user_id)) heuristicExcluded.add(c.discord_user_id);
  }
  const pool = candidates.filter((c) => !isExiledDiscordUser(c.discord_user_id)).slice(0, 20);

  const promptCtx = {
    week_key: weekKey,
    scoring_rules: {
      message_block_points: 1,
      vote_points_each: 5,
      reaction_points: 1,
      message_block_definition:
        "One block = consecutive messages by the same user in a channel until another user speaks (back-to-back posts do not add extra blocks).",
    },
    candidates: pool.map((c) => ({
      discord_user_id: c.discord_user_id,
      display_name: c.display_name,
      message_blocks: c.message_blocks,
      raw_message_count: c.raw_message_count,
      burst_ratio: c.burst_ratio,
      spam_risk: c.spam_risk,
      vote_count: c.vote_count,
      reaction_count: c.reaction_count,
      weighted_score: c.activity_score,
      channel_count: c.channel_count,
    })),
    task: `Pick up to ${TOP_PARTICIPATOR_N} winners. Exclude obvious spam (letter floods, filler-only bursts).`,
  };

  const aiRes = await callGrokJsonObject(env, ROOTMC_WEEKLY_ACTIVITY_JUDGE_PROMPT, promptCtx, {
    temperature: 0.15,
  });

  const grokOk = Boolean(aiRes.ok);
  await persistAiRun(env.DB, weekKey, grokOk, str(aiRes.model) || null, promptCtx, aiRes);

  if (!grokOk) {
    return {
      winners: fallbackWinners(candidates, heuristicExcluded),
      excludedIds: heuristicExcluded,
      aiUsed: false,
    };
  }

  const parsed: AiJudgeResponse = {
    winners: Array.isArray(aiRes.winners)
      ? (aiRes.winners as AiJudgeResponse["winners"])
      : undefined,
    excluded: Array.isArray(aiRes.excluded)
      ? (aiRes.excluded as AiJudgeResponse["excluded"])
      : undefined,
  };

  const byId = candidateMap(candidates);
  const excludedIds = new Set(heuristicExcluded);

  for (const row of parsed.excluded || []) {
    const uid = str(row.discord_user_id);
    if (uid) excludedIds.add(uid);
  }

  const winners: ActivityJudgeWinner[] = [];
  const seen = new Set<string>();

  const ranked = [...(parsed.winners || [])].sort(
    (a, b) => (Number(a.rank) || 999) - (Number(b.rank) || 999),
  );

  for (const row of ranked) {
    const uid = str(row.discord_user_id);
    if (!uid || excludedIds.has(uid) || seen.has(uid)) continue;
    const c = byId.get(uid);
    if (!c) continue;
    seen.add(uid);
    winners.push({
      discord_user_id: c.discord_user_id,
      display_name: c.display_name,
      message_blocks: c.message_blocks,
      vote_count: c.vote_count,
      reaction_count: c.reaction_count,
      activity_score: c.activity_score,
      channel_count: c.channel_count,
      ai_note: str(row.note) || undefined,
    });
    if (winners.length >= TOP_PARTICIPATOR_N) break;
  }

  if (winners.length === 0) {
    return {
      winners: fallbackWinners(candidates, excludedIds),
      excludedIds,
      aiUsed: false,
    };
  }

  // AI may return a short list — fill remaining slots by score order (up to top N).
  if (winners.length < TOP_PARTICIPATOR_N) {
    for (const c of candidates) {
      if (winners.length >= TOP_PARTICIPATOR_N) break;
      if (excludedIds.has(c.discord_user_id) || seen.has(c.discord_user_id)) continue;
      seen.add(c.discord_user_id);
      winners.push({
        discord_user_id: c.discord_user_id,
        display_name: c.display_name,
        message_blocks: c.message_blocks,
        vote_count: c.vote_count,
        reaction_count: c.reaction_count,
        activity_score: c.activity_score,
        channel_count: c.channel_count,
      });
    }
  }

  return { winners, excludedIds, aiUsed: true };
}
