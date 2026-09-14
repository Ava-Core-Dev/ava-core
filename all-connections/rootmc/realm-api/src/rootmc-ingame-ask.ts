import { json } from "./cors";

import { utcDayKey } from "./free-tier";

import {

  ASK_DUPLICATE_MESSAGE,

  ASK_GIVE_UP_MESSAGE,

  ASK_OFF_TOPIC_MESSAGE,

  buildTrainingJson,

  extractKeywords,

  findCannedAnswer,

  findRecentDuplicateTurn,

  getAskTurn,

  hashQuestion,

  insertAskTurn,

  isRootMcOnTopic,

  normalizeQuestion,

  parseLinesJson,

  promoteToCanned,

  touchCannedUsage,

  updateTurnFeedback,

  type AskTurnRow,

} from "./rootmc-ask-store";
import {
  askWikiHintForQuestion,
  loadAskTownyContext,
  rootMcAskServerKnowledge,
  rootMcAskWikiTopicLinks,
  suggestAskWikiLink,
} from "./rootmc-ask-knowledge";
import {

  computeNetWorthTotal,

  netWorthForPlayer,

  netWorthLeaderboard,

  shopListingsForPlayer,

} from "./rootmc-economy";

import {

  ROOTMC_INGAME_ASK_FOLLOWUP_SYSTEM_PROMPT,

  ROOTMC_INGAME_ASK_SYSTEM_PROMPT,

} from "./rootmc-grok-prompts";

import {

  formatReportGold,

  sanitizePlayerFacingReport,

} from "./rootmc-player-facing";

import {

  ROOTMC_MAP_URL,

  ROOTMC_WIKI_COMMANDS,

  ROOTMC_WIKI_ECONOMY,

  ROOTMC_WIKI_PLAYER,

  siteUrl,

} from "./rootmc-site";

import { publicServerAddress } from "./rootmc-server";

import { record, resolveEconomyServerId, str } from "./realm-lib";

import type { RootStatEnv } from "./rootstat-minecraft";

import {

  mcmmoStatsForPlayer,

  playtimeStatsForPlayer,

  validateServerAuth,

} from "./rootstat-minecraft";

import { callGrokJsonObject, grokRootAskBearerToken, grokUserErrorMessage, type RootMcAiEnv } from "./rootmc-world-ai";



const DEFAULT_DAILY_LIMIT = 30;

const MAX_QUESTION_LEN = 240;

const MAX_LINE_LEN = 220;

const MAX_LINES = 3;



type AskEnv = RootStatEnv & RootMcAiEnv & { SITE_URL?: string };



function stripMcColors(text: string): string {

  return text.replace(/§[0-9a-fk-or]/gi, "").replace(/&[0-9a-fk-or]/gi, "").trim();

}



function truncate(s: string, max: number): string {

  const t = s.trim();

  if (t.length <= max) return t;

  return t.slice(0, Math.max(0, max - 1)).trimEnd() + "...";

}



function normalizeUuid(raw: string): string | null {

  const t = stripMcColors(raw).toLowerCase().replace(/[^0-9a-f-]/g, "");

  if (t.length === 32) {

    return `${t.slice(0, 8)}-${t.slice(8, 12)}-${t.slice(12, 16)}-${t.slice(16, 20)}-${t.slice(20)}`;

  }

  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(t)) {

    return t;

  }

  return null;

}



function sanitizeLines(raw: unknown): string[] {

  if (!Array.isArray(raw)) return [];

  const out: string[] = [];

  for (const line of raw) {

    const text = sanitizePlayerFacingReport(stripMcColors(str(line)));

    if (!text) continue;

    out.push(truncate(text.replace(/\s+/g, " "), MAX_LINE_LEN));

    if (out.length >= MAX_LINES) break;

  }

  return out;

}



function sanitizeLink(raw: unknown, env: AskEnv): string | null {

  const link = stripMcColors(str(raw));

  if (!link) return null;

  const base = siteUrl(env);

  if (!link.startsWith("https://")) return null;

  if (!link.startsWith(base) && !link.startsWith("https://rootmc.net")) return null;

  return link;

}



function resolveAskLink(question: string, env: AskEnv, raw: unknown): string | null {
  const fromAi = sanitizeLink(raw, env);
  if (fromAi) return fromAi;
  return suggestAskWikiLink(question, siteUrl(env));
}

async function readDailyUsage(

  db: D1Database,

  serverId: string,

  uuid: string,

  dayUtc: string,

): Promise<number> {

  const row = await db

    .prepare(

      `SELECT ask_count FROM rootmc_ingame_ask_usage

       WHERE server_id = ? AND minecraft_uuid = ? AND day_utc = ?`,

    )

    .bind(serverId, uuid, dayUtc)

    .first<{ ask_count: number }>();

  return Math.max(0, Number(row?.ask_count) || 0);

}



async function bumpDailyUsage(

  db: D1Database,

  serverId: string,

  uuid: string,

  dayUtc: string,

): Promise<number> {

  const now = new Date().toISOString();

  await db

    .prepare(

      `INSERT INTO rootmc_ingame_ask_usage (server_id, minecraft_uuid, day_utc, ask_count, last_ask_at)

       VALUES (?, ?, ?, 1, ?)

       ON CONFLICT(server_id, minecraft_uuid, day_utc) DO UPDATE SET

         ask_count = ask_count + 1,

         last_ask_at = excluded.last_ask_at`,

    )

    .bind(serverId, uuid, dayUtc, now)

    .run();

  return (await readDailyUsage(db, serverId, uuid, dayUtc)) || 1;

}



async function buildAskContext(

  env: AskEnv,

  economyServerId: string,

  authServerId: string,

  uuid: string,

  username: string,

  question: string,

): Promise<Record<string, unknown>> {

  const serverRow = await env.DB.prepare(

    `SELECT server_name, server_address, game_version, map_url, rootmc_last_seen_at

     FROM rootstat_servers WHERE server_id = ? LIMIT 1`,

  )

    .bind(authServerId)

    .first<Record<string, unknown>>();



  const netWorth = await netWorthForPlayer(env.DB, economyServerId, uuid);

  const playtime = await playtimeStatsForPlayer(env.DB, economyServerId, uuid);

  const mcmmo = await mcmmoStatsForPlayer(env.DB, economyServerId, uuid);

  const listings = await shopListingsForPlayer(env.DB, economyServerId, uuid, 6);

  const topWealth = await netWorthLeaderboard(env.DB, economyServerId, 5);

  const base = siteUrl(env);
  const towny = await loadAskTownyContext(env.DB, authServerId, uuid);

  const playerUrl = `${base}/player/?player=${encodeURIComponent(username)}`;

  const leaderboardUrl = `${base}/leaderboard/?server=${encodeURIComponent(authServerId)}`;
  const suggestedLink = suggestAskWikiLink(question, base);

  return {

    question: truncate(question, MAX_QUESTION_LEN),

    asker: { username, minecraft_uuid: uuid },

    server: {

      name: str(serverRow?.server_name) || "RootMC",

      address: publicServerAddress(str(serverRow?.server_address)),

      game_version: str(serverRow?.game_version) || null,

      last_seen_at: str(serverRow?.rootmc_last_seen_at) || null,

    },

    player_stats: netWorth

      ? {

          wallet_gold: formatReportGold(Number(netWorth.balance_value) || 0),

          net_worth: formatReportGold(computeNetWorthTotal(netWorth)),

          inventory_value: formatReportGold(Number(netWorth.inventory_value) || 0),

          shop_stock_value: formatReportGold(Number(netWorth.shop_stock_value) || 0),

          synced_at: netWorth.synced_at || null,

        }

      : null,

    playtime: playtime

      ? {

          total_seconds: Number(playtime.total_playtime_seconds) || 0,

          first_join_at: playtime.first_join_at || null,

          last_login_at: playtime.last_login_at || null,

        }

      : null,

    mcmmo: mcmmo

      ? {

          power_level: Number(mcmmo.power_level) || 0,

        }

      : null,

    my_shop_listings: listings.slice(0, 6).map((row) => ({

      item: str(row.item_key),

      type: str(row.listing_type),

      price_gold: Number(row.price) || 0,

    })),

    top_net_worth: topWealth.map((row) => ({

      player: str(row.minecraft_username) || "?",

      net_worth: formatReportGold(computeNetWorthTotal(row)),

      wallet_gold: formatReportGold(Number(row.balance_value) || 0),

    })),

    server_knowledge: rootMcAskServerKnowledge(base),

    wiki_topic_links: rootMcAskWikiTopicLinks(base),

    towny: towny,

    suggested_wiki_link: suggestedLink,

    site_links: {

      wiki_player: ROOTMC_WIKI_PLAYER,

      wiki_commands: ROOTMC_WIKI_COMMANDS,

      wiki_economy: ROOTMC_WIKI_ECONOMY,

      wiki_towny: `${base}/wiki/player/#towny`,

      wiki_shops: `${base}/wiki/player/#shops`,

      wiki_loans: `${base}/wiki/player/#loans`,

      map: str(serverRow?.map_url) || ROOTMC_MAP_URL,

      leaderboard: leaderboardUrl,

      player_profile: playerUrl,

      market: `${base}/market/?server=${encodeURIComponent(authServerId)}`,

      reserve: `${base}/economy/#server-reserve`,

      verify: `${base}/verify`,

      discord: "https://discord.gg/rFFQYrNaqS",

    },

    guide_hint: askWikiHintForQuestion(question, env),

    notes:

      "Use server_knowledge first for commands and gold costs. " +

      "Shops: /buy and /sell split at tied prices; shop sign click quotes that shop only. " +

      "Towns: /town new <name> = 400 G. Ranks: /rank. Link: /link + verify on site.",

  };

}



async function persistTurn(

  env: AskEnv,

  opts: {

    serverId: string;

    uuid: string;

    username: string;

    questionRaw: string;

    questionNormalized: string;

    questionHash: string;

    keywords: string[];

    lines: string[];

    linkUrl: string | null;

    source: "canned" | "grok" | "followup_grok" | "duplicate_block" | "off_topic_block" | "give_up";

    parentTurnId?: number | null;

    grokModel?: string | null;

    promptContext?: Record<string, unknown>;

    grokResponse?: Record<string, unknown>;

    feedback?: string | null;

    goodAnswer?: boolean;

  },

): Promise<number> {

  const turnId = await insertAskTurn(env.DB, {

    serverId: opts.serverId,

    uuid: opts.uuid,

    username: opts.username,

    questionRaw: opts.questionRaw,

    questionNormalized: opts.questionNormalized,

    questionHash: opts.questionHash,

    lines: opts.lines,

    linkUrl: opts.linkUrl,

    source: opts.source,

    parentTurnId: opts.parentTurnId,

    grokModel: opts.grokModel ?? null,

    promptJson: opts.promptContext ? JSON.stringify(opts.promptContext) : null,

    responseJson: opts.grokResponse ? JSON.stringify(opts.grokResponse) : null,

    feedback: opts.feedback ?? null,

    goodAnswer: opts.goodAnswer ?? false,

  });

  const trainingJson = buildTrainingJson({

    turnId,

    serverId: opts.serverId,

    uuid: opts.uuid,

    username: opts.username,

    questionRaw: opts.questionRaw,

    questionNormalized: opts.questionNormalized,

    keywords: opts.keywords,

    source: opts.source,

    lines: opts.lines,

    linkUrl: opts.linkUrl,

    feedback: opts.feedback ?? null,

    grokModel: opts.grokModel ?? null,

    promptContext: opts.promptContext,

    grokResponse: opts.grokResponse,

  });

  await env.DB.prepare(`UPDATE rootmc_ask_turns SET training_json = ? WHERE id = ?`)

    .bind(trainingJson, turnId)

    .run();

  return turnId;

}



function isFollowupTurn(turn: AskTurnRow): boolean {

  return turn.source === "followup_grok" || Boolean(turn.parent_turn_id);

}



async function handleAskPost(request: Request, env: AskEnv, server: { serverId: string }): Promise<Response> {

  let body: Record<string, unknown>;

  try {

    body = record(JSON.parse(await request.text()));

  } catch {

    return json({ detail: "Invalid JSON body." }, 400);

  }



  const uuid = normalizeUuid(str(body.uuid));

  const username = stripMcColors(str(body.username));

  const question = stripMcColors(str(body.question));



  if (!uuid || !username) {

    return json({ detail: "uuid and username are required." }, 400);

  }

  if (!question || question.length < 2) {

    return json({ detail: "question is required." }, 400);

  }

  if (question.length > MAX_QUESTION_LEN) {

    return json({ detail: `question max ${MAX_QUESTION_LEN} characters.` }, 400);

  }



  const questionNormalized = normalizeQuestion(question);

  const questionHash = await hashQuestion(questionNormalized);

  const keywords = extractKeywords(questionNormalized);



  if (!isRootMcOnTopic(questionNormalized)) {

    const lines = [ASK_OFF_TOPIC_MESSAGE];

    await persistTurn(env, {

      serverId: server.serverId,

      uuid,

      username,

      questionRaw: question,

      questionNormalized,

      questionHash,

      keywords,

      lines,

      linkUrl: null,

      source: "off_topic_block",

    });

    return json({

      ok: true,

      off_topic: true,

      duplicate: false,

      lines,

      link_url: null,

      turn_id: null,

      needs_feedback: false,

    });

  }



  const duplicate = await findRecentDuplicateTurn(env.DB, server.serverId, uuid, questionHash);

  if (duplicate) {

    const lines = [ASK_DUPLICATE_MESSAGE];

    await persistTurn(env, {

      serverId: server.serverId,

      uuid,

      username,

      questionRaw: question,

      questionNormalized,

      questionHash,

      keywords,

      lines,

      linkUrl: null,

      source: "duplicate_block",

    });

    return json({

      ok: true,

      duplicate: true,

      lines,

      link_url: null,

      turn_id: null,

      needs_feedback: false,

    });

  }



  const dayUtc = utcDayKey();

  const used = await readDailyUsage(env.DB, server.serverId, uuid, dayUtc);

  if (used >= DEFAULT_DAILY_LIMIT) {

    return json(

      {

        detail: "quota_exceeded",

        message: `Daily guide limit reached (${DEFAULT_DAILY_LIMIT}/day). Try again tomorrow or ask staff on Discord.`,

        daily_limit: DEFAULT_DAILY_LIMIT,

        used_today: used,

      },

      429,

    );

  }



  const canned = await findCannedAnswer(env.DB, questionHash, keywords);

  if (canned && canned.lines.length > 0) {

    await touchCannedUsage(env.DB, canned.cannedId);

    const turnId = await persistTurn(env, {

      serverId: server.serverId,

      uuid,

      username,

      questionRaw: question,

      questionNormalized,

      questionHash,

      keywords,

      lines: canned.lines,

      linkUrl: canned.linkUrl,

      source: "canned",

    });

    const usedAfter = await bumpDailyUsage(env.DB, server.serverId, uuid, dayUtc);

    return json({

      ok: true,

      duplicate: false,

      lines: canned.lines,

      link_url: canned.linkUrl,

      turn_id: turnId,

      needs_feedback: true,

      source: "canned",

      daily_limit: DEFAULT_DAILY_LIMIT,

      used_today: usedAfter,

      remaining_today: Math.max(0, DEFAULT_DAILY_LIMIT - usedAfter),

    });

  }



  const economyServerId = await resolveEconomyServerId(env.DB, server.serverId);

  const context = await buildAskContext(env, economyServerId, server.serverId, uuid, username, question);



  const ai = await callGrokJsonObject(env, ROOTMC_INGAME_ASK_SYSTEM_PROMPT, context, {
    temperature: 0.25,
    bearerToken: grokRootAskBearerToken(env),
  });

  if (ai.ok !== true) {

    const detail = str(ai.detail) || "Guide is temporarily unavailable.";

    return json(

      {

        detail: "ai_unavailable",

        message: grokUserErrorMessage(detail, Number(ai.status) || 503),

      },

      503,

    );

  }



  let lines = sanitizeLines(ai.lines);

  if (lines.length === 0) {

    const fallback = sanitizePlayerFacingReport(stripMcColors(str(ai.reply) || str(ai.content)));

    if (fallback) {

      lines = [truncate(fallback, MAX_LINE_LEN)];

    }

  }

  if (lines.length === 0) {

    lines = [

      "I'm not sure  -  check the wiki at rootmc.net/wiki/player/ or ask staff on Discord.",

    ];

  }



  const linkUrl = resolveAskLink(question, env, ai.link_url);

  const turnId = await persistTurn(env, {

    serverId: server.serverId,

    uuid,

    username,

    questionRaw: question,

    questionNormalized,

    questionHash,

    keywords,

    lines,

    linkUrl,

    source: "grok",

    grokModel: str(env.GROK_MODEL) || null,

    promptContext: context,

    grokResponse: record(ai),

  });

  const usedAfter = await bumpDailyUsage(env.DB, server.serverId, uuid, dayUtc);



  return json({

    ok: true,

    duplicate: false,

    lines,

    link_url: linkUrl,

    turn_id: turnId,

    needs_feedback: true,

    source: "grok",

    daily_limit: DEFAULT_DAILY_LIMIT,

    used_today: usedAfter,

    remaining_today: Math.max(0, DEFAULT_DAILY_LIMIT - usedAfter),

  });

}



async function handleFeedbackPost(request: Request, env: AskEnv, server: { serverId: string }): Promise<Response> {

  let body: Record<string, unknown>;

  try {

    body = record(JSON.parse(await request.text()));

  } catch {

    return json({ detail: "Invalid JSON body." }, 400);

  }



  const uuid = normalizeUuid(str(body.uuid));

  const username = stripMcColors(str(body.username));

  const feedback = stripMcColors(str(body.feedback)).toLowerCase();

  const turnId = Number(body.turn_id);



  if (!uuid || !username) {

    return json({ detail: "uuid and username are required." }, 400);

  }

  if (!Number.isFinite(turnId) || turnId < 1) {

    return json({ detail: "turn_id is required." }, 400);

  }

  if (feedback !== "yes" && feedback !== "no") {

    return json({ detail: "feedback must be yes or no." }, 400);

  }



  const turn = await getAskTurn(env.DB, turnId);

  if (!turn || turn.minecraft_uuid !== uuid || turn.server_id !== server.serverId) {

    return json({ detail: "turn not found." }, 404);

  }



  const keywords = extractKeywords(turn.question_normalized);



  if (feedback === "yes") {

    const trainingJson = buildTrainingJson({

      turnId: turn.id,

      serverId: turn.server_id,

      uuid: turn.minecraft_uuid,

      username: turn.minecraft_username || username,

      questionRaw: turn.question_raw,

      questionNormalized: turn.question_normalized,

      keywords,

      source: turn.source as "canned" | "grok" | "followup_grok",

      lines: parseLinesJson(turn.response_lines_json),

      linkUrl: turn.link_url,

      feedback: "yes",

      grokModel: turn.grok_model,

    });

    await updateTurnFeedback(env.DB, turnId, "yes", true, trainingJson);

    const updated = await getAskTurn(env.DB, turnId);

    if (updated && updated.source !== "duplicate_block" && updated.source !== "off_topic_block" && updated.source !== "give_up") {

      await promoteToCanned(env.DB, updated, keywords);

    }

    return json({ ok: true, action: "closed", marked_good: true });

  }



  if (isFollowupTurn(turn)) {

    const lines = [ASK_GIVE_UP_MESSAGE];

    const giveUpId = await persistTurn(env, {

      serverId: server.serverId,

      uuid,

      username,

      questionRaw: turn.question_raw,

      questionNormalized: turn.question_normalized,

      questionHash: turn.question_hash,

      keywords,

      lines,

      linkUrl: null,

      source: "give_up",

      parentTurnId: turn.id,

      feedback: "no",

    });

    await updateTurnFeedback(env.DB, turnId, "no", false);

    return json({

      ok: true,

      action: "give_up",

      turn_id: giveUpId,

      lines,

      link_url: null,

      needs_feedback: false,

    });

  }



  const priorLines = parseLinesJson(turn.response_lines_json);

  const economyServerId = await resolveEconomyServerId(env.DB, server.serverId);

  const baseContext = await buildAskContext(

    env,

    economyServerId,

    server.serverId,

    uuid,

    username,

    turn.question_raw,

  );

  const followupContext = {

    ...baseContext,

    original_question: turn.question_raw,

    prior_answer_lines: priorLines,

    player_feedback: "no",

  };



  const ai = await callGrokJsonObject(env, ROOTMC_INGAME_ASK_FOLLOWUP_SYSTEM_PROMPT, followupContext, {
    temperature: 0.2,
    bearerToken: grokRootAskBearerToken(env),
  });

  if (ai.ok !== true) {

    const detail = str(ai.detail) || "Guide is temporarily unavailable.";

    return json(

      {

        detail: "ai_unavailable",

        message: grokUserErrorMessage(detail, Number(ai.status) || 503),

      },

      503,

    );

  }



  let lines = sanitizeLines(ai.lines);

  if (lines.length === 0) {

    lines = [

      "Check rootmc.net/wiki/player/ for more detail, or ask a player or staff in-game.",

    ];

  }

  const linkUrl = resolveAskLink(turn.question_raw, env, ai.link_url);

  await updateTurnFeedback(env.DB, turnId, "no", false);



  const followupId = await persistTurn(env, {

    serverId: server.serverId,

    uuid,

    username,

    questionRaw: turn.question_raw,

    questionNormalized: turn.question_normalized,

    questionHash: turn.question_hash,

    keywords,

    lines,

    linkUrl,

    source: "followup_grok",

    parentTurnId: turn.id,

    grokModel: str(env.GROK_MODEL) || null,

    promptContext: followupContext,

    grokResponse: record(ai),

    feedback: null,

  });



  return json({

    ok: true,

    action: "followup",

    turn_id: followupId,

    lines,

    link_url: linkUrl,

    needs_feedback: true,

  });

}



/**

 * POST /api/rootmc/ingame-ask  -  server-authenticated in-game AI guide.

 * POST /api/rootmc/ingame-ask/feedback  -  yes/no feedback on a turn.

 */

export async function handleRootMcIngameAsk(

  request: Request,

  env: AskEnv,

  subpath: string,

  method: string,

): Promise<Response | null> {

  if (!subpath.startsWith("/rootmc/ingame-ask")) return null;

  if (method !== "POST") {

    return json({ detail: "Not Found" }, 404);

  }



  const server = await validateServerAuth(env, request);

  if (server instanceof Response) return server;



  if (subpath === "/rootmc/ingame-ask/feedback") {

    return handleFeedbackPost(request, env, server);

  }

  if (subpath === "/rootmc/ingame-ask") {

    return handleAskPost(request, env, server);

  }



  return json({ detail: "Not Found" }, 404);

}


