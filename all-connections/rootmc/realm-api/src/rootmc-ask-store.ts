import { str } from "./realm-lib";

export const ASK_OFF_TOPIC_MESSAGE =
  "I only cover RootMC stuff  -  shops, ranks, towns, commands, that kind of thing. What do you need on the server?";

export const ASK_DUPLICATE_MESSAGE =
  "You already asked that in the last 12 hours. Talk to someone in-game if you still need help.";

export const ASK_GIVE_UP_MESSAGE = "Maybe you should play single player or something... idk";

const STOP_WORDS = new Set([
  "a", "an", "the", "is", "are", "was", "were", "be", "been", "being",
  "have", "has", "had", "do", "does", "did", "will", "would", "could",
  "should", "may", "might", "must", "shall", "can", "need", "dare",
  "ought", "used", "to", "of", "in", "for", "on", "with", "at", "by",
  "from", "up", "about", "into", "through", "during", "before", "after",
  "above", "below", "between", "out", "off", "over", "under", "again",
  "further", "then", "once", "here", "there", "when", "where", "why",
  "how", "all", "each", "few", "more", "most", "other", "some", "such",
  "no", "nor", "not", "only", "own", "same", "so", "than", "too", "very",
  "just", "and", "but", "if", "or", "because", "as", "until", "while",
  "i", "me", "my", "we", "our", "you", "your", "he", "him", "his", "she",
  "her", "it", "its", "they", "them", "their", "what", "which", "who",
  "whom", "this", "that", "these", "those", "am", "im", "dont", "doesnt",
]);

export type AskTurnSource =
  | "canned"
  | "grok"
  | "followup_grok"
  | "duplicate_block"
  | "off_topic_block"
  | "give_up";

export type AskTurnRow = {
  id: number;
  server_id: string;
  minecraft_uuid: string;
  minecraft_username: string | null;
  question_raw: string;
  question_normalized: string;
  question_hash: string;
  response_lines_json: string;
  link_url: string | null;
  source: string;
  parent_turn_id: number | null;
  feedback: string | null;
  grok_model: string | null;
  prompt_json: string | null;
  response_json: string | null;
  training_json: string | null;
  good_answer: number;
  created_at: string;
};

export function normalizeQuestion(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/§[0-9a-fk-or]/gi, "")
    .replace(/&[0-9a-fk-or]/gi, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function extractKeywords(normalized: string): string[] {
  const words = normalized.split(" ").filter((w) => w.length >= 3 && !STOP_WORDS.has(w));
  return [...new Set(words)].slice(0, 12);
}

export async function hashQuestion(normalized: string): Promise<string> {
  const data = new TextEncoder().encode(normalized);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash), (b) => b.toString(16).padStart(2, "0")).join("");
}

export function buildTrainingJson(opts: {
  turnId: number;
  serverId: string;
  uuid: string;
  username: string;
  questionRaw: string;
  questionNormalized: string;
  keywords: string[];
  source: AskTurnSource;
  lines: string[];
  linkUrl: string | null;
  feedback: string | null;
  grokModel: string | null;
  promptContext?: Record<string, unknown>;
  grokResponse?: Record<string, unknown>;
}): string {
  const assistant = opts.lines.join("\n");
  const payload = {
    schema: "rootmc.ask.training.v1",
    turn_id: opts.turnId,
    messages: [
      { role: "system", content: "RootMC in-game guide" },
      { role: "user", content: opts.questionRaw },
      { role: "assistant", content: assistant },
    ],
    metadata: {
      source: opts.source,
      feedback: opts.feedback,
      question_normalized: opts.questionNormalized,
      keywords: opts.keywords,
      link_url: opts.linkUrl,
      server_id: opts.serverId,
      minecraft_uuid: opts.uuid,
      minecraft_username: opts.username,
      grok_model: opts.grokModel,
      prompt_context: opts.promptContext || null,
      grok_response: opts.grokResponse || null,
      created_at: new Date().toISOString(),
    },
  };
  return JSON.stringify(payload);
}

export async function findRecentDuplicateTurn(
  db: D1Database,
  serverId: string,
  uuid: string,
  questionHash: string,
): Promise<boolean> {
  const row = await db
    .prepare(
      `SELECT id FROM rootmc_ask_turns
       WHERE server_id = ? AND minecraft_uuid = ? AND question_hash = ?
         AND datetime(created_at) > datetime('now', '-12 hours')
         AND source NOT IN ('duplicate_block', 'off_topic_block', 'give_up')
       LIMIT 1`,
    )
    .bind(serverId, uuid, questionHash)
    .first<{ id: number }>();
  return Boolean(row?.id);
}

export async function findCannedAnswer(
  db: D1Database,
  questionHash: string,
  keywords: string[],
): Promise<{ lines: string[]; linkUrl: string | null; cannedId: number } | null> {
  const exact = await db
    .prepare(
      `SELECT id, response_lines_json, link_url FROM rootmc_ask_canned
       WHERE question_hash = ?
       ORDER BY good_count DESC
       LIMIT 1`,
    )
    .bind(questionHash)
    .first<{ id: number; response_lines_json: string; link_url: string | null }>();

  if (exact?.id) {
    return {
      lines: parseLinesJson(exact.response_lines_json),
      linkUrl: exact.link_url || null,
      cannedId: exact.id,
    };
  }

  if (keywords.length === 0) return null;

  const { results } = await db
    .prepare(
      `SELECT id, keywords_json, response_lines_json, link_url, good_count
       FROM rootmc_ask_canned
       ORDER BY good_count DESC
       LIMIT 80`,
    )
    .all<{
      id: number;
      keywords_json: string;
      response_lines_json: string;
      link_url: string | null;
      good_count: number;
    }>();

  let best: { id: number; score: number; lines: string[]; linkUrl: string | null } | null = null;
  for (const row of results || []) {
    let cannedKeys: string[] = [];
    try {
      cannedKeys = JSON.parse(row.keywords_json || "[]") as string[];
    } catch {
      cannedKeys = [];
    }
    const overlap = keywords.filter((k) => cannedKeys.includes(k)).length;
    if (overlap < 2) continue;
    const score = overlap + (Number(row.good_count) || 0) * 0.1;
    if (!best || score > best.score) {
      best = {
        id: row.id,
        score,
        lines: parseLinesJson(row.response_lines_json),
        linkUrl: row.link_url || null,
      };
    }
  }
  if (!best || best.lines.length === 0) return null;
  return { lines: best.lines, linkUrl: best.linkUrl, cannedId: best.id };
}

export function parseLinesJson(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.map((x) => str(x)).filter(Boolean);
  } catch {
    return [];
  }
}

export async function insertAskTurn(
  db: D1Database,
  row: {
    serverId: string;
    uuid: string;
    username: string;
    questionRaw: string;
    questionNormalized: string;
    questionHash: string;
    lines: string[];
    linkUrl: string | null;
    source: AskTurnSource;
    parentTurnId?: number | null;
    grokModel?: string | null;
    promptJson?: string | null;
    responseJson?: string | null;
    trainingJson?: string | null;
    feedback?: string | null;
    goodAnswer?: boolean;
  },
): Promise<number> {
  const now = new Date().toISOString();
  const result = await db
    .prepare(
      `INSERT INTO rootmc_ask_turns
         (server_id, minecraft_uuid, minecraft_username, question_raw, question_normalized,
          question_hash, response_lines_json, link_url, source, parent_turn_id, feedback,
          grok_model, prompt_json, response_json, training_json, good_answer, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      row.serverId,
      row.uuid,
      row.username,
      row.questionRaw,
      row.questionNormalized,
      row.questionHash,
      JSON.stringify(row.lines),
      row.linkUrl,
      row.source,
      row.parentTurnId ?? null,
      row.feedback ?? null,
      row.grokModel ?? null,
      row.promptJson ?? null,
      row.responseJson ?? null,
      row.trainingJson ?? null,
      row.goodAnswer ? 1 : 0,
      now,
    )
    .run();
  return Number(result.meta.last_row_id) || 0;
}

export async function getAskTurn(db: D1Database, turnId: number): Promise<AskTurnRow | null> {
  const row = await db
    .prepare(`SELECT * FROM rootmc_ask_turns WHERE id = ? LIMIT 1`)
    .bind(turnId)
    .first<AskTurnRow>();
  return row || null;
}

export async function updateTurnFeedback(
  db: D1Database,
  turnId: number,
  feedback: string,
  goodAnswer: boolean,
  trainingJson?: string,
): Promise<void> {
  if (trainingJson) {
    await db
      .prepare(`UPDATE rootmc_ask_turns SET feedback = ?, good_answer = ?, training_json = ? WHERE id = ?`)
      .bind(feedback, goodAnswer ? 1 : 0, trainingJson, turnId)
      .run();
    return;
  }
  await db
    .prepare(`UPDATE rootmc_ask_turns SET feedback = ?, good_answer = ? WHERE id = ?`)
    .bind(feedback, goodAnswer ? 1 : 0, turnId)
    .run();
}

export async function promoteToCanned(db: D1Database, turn: AskTurnRow, keywords: string[]): Promise<void> {
  const now = new Date().toISOString();
  const lines = parseLinesJson(turn.response_lines_json);
  await db
    .prepare(
      `INSERT INTO rootmc_ask_canned
         (question_normalized, question_hash, keywords_json, response_lines_json, link_url,
          source_turn_id, good_count, last_used_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)
       ON CONFLICT(question_hash) DO UPDATE SET
         response_lines_json = excluded.response_lines_json,
         link_url = excluded.link_url,
         keywords_json = excluded.keywords_json,
         good_count = good_count + 1,
         last_used_at = excluded.last_used_at`,
    )
    .bind(
      turn.question_normalized,
      turn.question_hash,
      JSON.stringify(keywords),
      JSON.stringify(lines),
      turn.link_url,
      turn.id,
      now,
      now,
    )
    .run();
}

export async function touchCannedUsage(db: D1Database, cannedId: number): Promise<void> {
  await db
    .prepare(`UPDATE rootmc_ask_canned SET last_used_at = ?, good_count = good_count + 1 WHERE id = ?`)
    .bind(new Date().toISOString(), cannedId)
    .run();
}

const ON_TOPIC_HINTS = [
  "rootmc", "gold", "shop", "shops", "rank", "ranks", "town", "towns", "nation", "nations",
  "towny", "command", "commands", "link", "verify", "discord", "buy", "sell", "net worth",
  "networth", "mcmmo", "spawn", "chamber", "chest", "warp", "home", "claim", "mayor",
  "resident", "leaderboard", "wiki", "minecraft", "server", "economy", "inventory",
  "balance", "listing", "sign", "market", "playtime", "treasury", "vault", "blueprint",
  "realm", "afk", "mute", "ban", "appeal", "staff", "rules",
];

const OFF_TOPIC_HINTS = [
  "homework", "essay", "girlfriend", "boyfriend", "politics", "president", "trump", "biden",
  "recipe", "cooking", "fortnite", "roblox", "valorant", "league of legends", "genshin",
  "tell me a joke", "make me laugh", "who made you", "what are you", "are you ai",
  "bitcoin", "ethereum", "crypto", "stock market", "dating", "relationship advice",
  "write me a", "solve this math", "algebra", "calculus", "history homework",
];

/** Reject obvious non-RootMC chatter before spending Grok tokens. */
export function isRootMcOnTopic(normalized: string): boolean {
  const q = normalized.trim();
  if (!q) return false;

  let onHits = 0;
  let offHits = 0;
  for (const hint of ON_TOPIC_HINTS) {
    if (q.includes(hint)) onHits++;
  }
  for (const hint of OFF_TOPIC_HINTS) {
    if (q.includes(hint)) offHits++;
  }

  if (offHits > 0 && onHits === 0) return false;

  if (onHits > 0) return true;

  const gameQuestion =
    q.includes("?")
    || q.startsWith("how ")
    || q.startsWith("what ")
    || q.startsWith("where ")
    || q.startsWith("why ")
    || q.startsWith("can i ")
    || q.startsWith("does ");

  if (!gameQuestion) return false;

  // Bare "how are you" / small talk with no server hook.
  if (/^(how are you|whats up|what's up|hello|hi|hey|sup)\b/.test(q)) return false;

  return q.length >= 8;
}
