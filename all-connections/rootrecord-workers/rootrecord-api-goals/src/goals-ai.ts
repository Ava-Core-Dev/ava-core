import type { D1Database } from "@cloudflare/workers-types";

import {
  FREE_AI_REFRESH_DAYS,
  MEMBER_AI_GOALS_PER_DAY,
  MEMBER_AI_REFRESH_PER_GOAL_PER_DAY,
  loadMemberFlags,
  utcDayKey,
} from "./goals-limits";

export type GoalsAiEnv = {
  DB: D1Database;
  GROK_API_BEARER_TOKEN?: string;
  GROK_X_BEARER_TOKEN?: string;
  GROK_API_URL?: string;
  GROK_MODEL?: string;
};

export const AI_DISCLAIMER =
  "Root Record does not provide financial support or advice. Actions and Suggestions are AI-generated and may not reflect Root Record's core beliefs. Use your own judgment.";

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

function jsonForArchive(v: unknown): string {
  return JSON.stringify(v, (_k, value) => (typeof value === "bigint" ? value.toString() : value));
}

function publicText(raw: unknown, max: number): string {
  const t = String(raw ?? "")
    .replace(/\bGrok\b/gi, "AI")
    .replace(/\bxAI\b/g, "AI")
    .replace(/\s+/g, " ")
    .trim();
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
}

function grokResponseText(response: Record<string, unknown>): string {
  const message = (response.choices as Array<Record<string, unknown>> | undefined)?.[0]?.message as
    | Record<string, unknown>
    | undefined;
  const content = message?.content;
  if (typeof content === "string") return content.trim();
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === "string") return part;
        if (part && typeof part === "object") {
          const obj = part as Record<string, unknown>;
          return String(obj.text || obj.content || "");
        }
        return "";
      })
      .join("")
      .trim();
  }
  return "";
}

function sanitizeAiDetailForUser(detail: string): string {
  const d = detail.trim();
  if (!d) return d;
  if (/incorrect api key/i.test(d) || /obtain an api key/i.test(d)) {
    return "Grok chat key rejected. Use GROK_API_BEARER_TOKEN from console.x.ai (GROK_X_BEARER_TOKEN is X/social only).";
  }
  return d.replace(/\b(sk-|AA)[A-Za-z0-9_%./-]{8,}/gi, "[redacted]");
}

function grokErrorText(response: Record<string, unknown>, status: number): string {
  const error = response.error as Record<string, unknown> | string | undefined;
  if (typeof error === "string" && error.trim()) return sanitizeAiDetailForUser(`HTTP ${status}: ${error.trim()}`);
  if (error && typeof error === "object") {
    const message = String(error.message || error.detail || error.code || "").trim();
    if (message) return sanitizeAiDetailForUser(`HTTP ${status}: ${message}`);
  }
  const detail = String(response.detail || response.message || "").trim();
  return detail
    ? sanitizeAiDetailForUser(`HTTP ${status}: ${detail}`)
    : `HTTP ${status}: empty Grok response`;
}

export type ParsedGoalAi = {
  summary_text: string;
  plan: Record<string, unknown>;
  actions: Array<Record<string, unknown>>;
  suggestions: Array<Record<string, unknown>>;
};

function parseGoalAiJson(content: string): ParsedGoalAi {
  const cleaned = content.replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  const candidate = start >= 0 && end > start ? cleaned.slice(start, end + 1) : cleaned;
  const obj = JSON.parse(candidate) as Record<string, unknown>;
  const planRaw = obj.plan && typeof obj.plan === "object" ? (obj.plan as Record<string, unknown>) : obj;
  const steps = Array.isArray(planRaw.steps) ? planRaw.steps : Array.isArray(obj.steps) ? obj.steps : [];
  const actions = Array.isArray(obj.actions) ? obj.actions : [];
  const suggestions = Array.isArray(obj.suggestions) ? obj.suggestions : [];
  return {
    summary_text: publicText(str(obj.summary_text), 1200),
    plan: {
      summary_text: publicText(str(obj.summary_text), 1200),
      steps,
      milestones: Array.isArray(planRaw.milestones) ? planRaw.milestones : [],
      cost_notes: publicText(str(planRaw.cost_notes ?? obj.cost_notes), 800),
      timeline_notes: publicText(str(planRaw.timeline_notes ?? obj.timeline_notes), 800),
      risks: Array.isArray(planRaw.risks) ? planRaw.risks : [],
    },
    actions: actions.filter((x) => x && typeof x === "object") as Array<Record<string, unknown>>,
    suggestions: suggestions.filter((x) => x && typeof x === "object") as Array<Record<string, unknown>>,
  };
}

const SYSTEM_PROMPT =
  "You help users achieve personal goals. Use ONLY the provided goal_context JSON. " +
  "Return JSON ONLY with this exact shape: " +
  '{"summary_text":"detailed overview","plan":{"steps":[{"title":"","detail":"","order":1}],"milestones":[],"cost_notes":"","timeline_notes":"","risks":[]},' +
  '"actions":[{"id_hint":"stable-slug","title":"","detail":"","priority":"high|medium|low","order":1}],' +
  '"suggestions":[{"id_hint":"","title":"","detail":"","category":""}]}. ' +
  "Do NOT re-propose items listed in deleted_action_ids or deleted_suggestion_ids. " +
  "Actions are concrete next steps; Suggestions are optional ideas—not financial advice. " +
  "Do not mention AI vendors, APIs, or Root Record policies in the output.";

export async function buildGoalContext(
  db: D1Database,
  userId: string,
  goalRow: Record<string, unknown>,
  opts: {
    pass_number?: number;
    reason_for_reprompt?: string | null;
    previous_ai_output?: Record<string, unknown> | null;
  } = {},
): Promise<Record<string, unknown>> {
  const goalId = str(goalRow.id);
  const { member, maxGoals } = await loadMemberFlags(db, userId);
  const userInput = JSON.parse(String(goalRow.user_input_json || "{}")) as Record<string, unknown>;

  const entries = await db
    .prepare(`SELECT id, kind, body, amount_cents, created_at FROM rg_goal_entries WHERE goal_id = ? ORDER BY created_at DESC LIMIT 50`)
    .bind(goalId)
    .all();
  const achievements = await db
    .prepare(`SELECT id, title, completed_at FROM rg_goal_achievements WHERE goal_id = ? ORDER BY sort_order`)
    .bind(goalId)
    .all();
  const deletedActions = await db
    .prepare(`SELECT id FROM rg_goal_actions WHERE goal_id = ? AND deleted_at IS NOT NULL`)
    .bind(goalId)
    .all();
  const deletedSuggestions = await db
    .prepare(`SELECT id FROM rg_goal_suggestions WHERE goal_id = ? AND deleted_at IS NOT NULL`)
    .bind(goalId)
    .all();

  const activeActions = await db
    .prepare(
      `SELECT id, id_hint, title, detail, priority, sort_order FROM rg_goal_actions WHERE goal_id = ? AND deleted_at IS NULL ORDER BY sort_order`,
    )
    .bind(goalId)
    .all();
  const activeSuggestions = await db
    .prepare(
      `SELECT id, id_hint, title, detail, category FROM rg_goal_suggestions WHERE goal_id = ? AND deleted_at IS NULL ORDER BY created_at`,
    )
    .bind(goalId)
    .all();

  return {
    schema_version: 1,
    pass_number: opts.pass_number ?? 1,
    reason_for_reprompt: opts.reason_for_reprompt ?? null,
    goal: {
      title: goalRow.title,
      category_name: userInput.category_name ?? "",
      purpose: goalRow.purpose,
      requires_money: Boolean(goalRow.requires_money),
      estimated_cost_cents: goalRow.estimated_cost_cents,
      user_steps_summary: goalRow.user_steps_summary,
      min_days: goalRow.min_days,
      max_days: goalRow.max_days,
      target_date_est: goalRow.target_date_est,
    },
    user_entries: entries.results ?? [],
    user_achievements: achievements.results ?? [],
    deleted_action_ids: (deletedActions.results ?? []).map((r) => (r as Record<string, unknown>).id),
    deleted_suggestion_ids: (deletedSuggestions.results ?? []).map((r) => (r as Record<string, unknown>).id),
    current_actions: activeActions.results ?? [],
    current_suggestions: activeSuggestions.results ?? [],
    previous_ai_output: opts.previous_ai_output ?? null,
    tier: { member, max_goals: maxGoals },
    response_format: {
      type: "json_only",
      fields: ["summary_text", "plan", "actions", "suggestions"],
    },
    disclaimer: AI_DISCLAIMER,
  };
}

async function callGrokOnce(
  env: GoalsAiEnv,
  goalContext: Record<string, unknown>,
): Promise<{
  ok: boolean;
  model: string;
  status?: number;
  request: Record<string, unknown>;
  response?: Record<string, unknown>;
  content?: string;
  parse_error?: string;
  detail?: string;
}> {
  // Grok chat bearer on worker secret GROK_API_BEARER_TOKEN (not GROK_X_BEARER_TOKEN — that is X API only).
  const token = String(env.GROK_API_BEARER_TOKEN || "").trim();
  const apiUrl = String(env.GROK_API_URL || "https://api.x.ai/v1/chat/completions").trim();
  const model = String(env.GROK_MODEL || "grok-3-latest").trim();
  const body = {
    model,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: jsonForArchive(goalContext) },
    ],
    temperature: 0.2,
    response_format: { type: "json_object" },
  };
  if (!token) {
    return {
      ok: false,
      model,
      request: body,
      detail: "Grok API bearer token is not configured.",
    };
  }
  try {
    const res = await fetch(apiUrl, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const response = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    const content = grokResponseText(response);
    if (!content) {
      return {
        ok: false,
        model,
        status: res.status,
        request: body,
        response,
        detail: grokErrorText(response, res.status),
      };
    }
    try {
      parseGoalAiJson(content);
      return { ok: true, model, status: res.status, request: body, response, content };
    } catch (e) {
      return {
        ok: false,
        model,
        status: res.status,
        request: body,
        response,
        content,
        parse_error: e instanceof Error ? e.message : String(e),
      };
    }
  } catch (e) {
    return {
      ok: false,
      model,
      request: body,
      detail: e instanceof Error ? e.message : String(e),
    };
  }
}

export async function runGoalPlanAi(
  env: GoalsAiEnv,
  db: D1Database,
  userId: string,
  goalRow: Record<string, unknown>,
  reason: string | null = null,
): Promise<Record<string, unknown>> {
  const model = String(env.GROK_MODEL || "grok-3-latest").trim();
  const previousOutput = goalRow.ai_response_json
    ? (JSON.parse(String(goalRow.ai_response_json)) as Record<string, unknown>)
    : null;

  let pass = 1;
  let ctx = await buildGoalContext(db, userId, goalRow, {
    pass_number: pass,
    reason_for_reprompt: reason,
    previous_ai_output: previousOutput,
  });

  let result = await callGrokOnce(env, ctx);
  if ((result.parse_error || (!result.content && result.detail)) && pass < 2) {
    pass = 2;
    ctx = await buildGoalContext(db, userId, goalRow, {
      pass_number: pass,
      reason_for_reprompt: result.parse_error
        ? `JSON parse failed: ${result.parse_error}. Return valid JSON only.`
        : `Previous attempt failed: ${result.detail}. Return valid JSON only.`,
      previous_ai_output: previousOutput,
    });
    if (result.content) {
      ctx = {
        ...ctx,
        previous_invalid_response: result.content.slice(0, 4000),
      };
    }
    result = await callGrokOnce(env, ctx);
  }

  if (!result.content) {
    const detail = str(result.detail) || "The AI service returned an empty response.";
    return {
      ok: false,
      model,
      detail,
      summary_text: "AI plan could not be generated. Use Retry AI plan in the app to try again.",
      plan: { steps: [] },
      actions: [],
      suggestions: [],
      request: result.request,
      response: result.response,
      pass_number: pass,
      goal_context: ctx,
    };
  }

  try {
    const parsed = parseGoalAiJson(result.content);
    return {
      ok: true,
      model: result.model,
      summary_text: parsed.summary_text,
      plan: parsed.plan,
      actions: parsed.actions,
      suggestions: parsed.suggestions,
      request: result.request,
      response: result.response,
      content: result.content,
      pass_number: pass,
      goal_context: ctx,
    };
  } catch (e) {
    const detail = `Parse error: ${e instanceof Error ? e.message : String(e)}`;
    return {
      ok: false,
      model: result.model,
      detail,
      summary_text: "AI plan could not be parsed. Use Retry AI plan in the app to try again.",
      plan: { steps: [], raw: result.content },
      actions: [],
      suggestions: [],
      request: result.request,
      response: result.response,
      parse_error: e instanceof Error ? e.message : String(e),
      pass_number: pass,
      goal_context: ctx,
    };
  }
}

export async function insertAiRun(
  db: D1Database,
  goalId: string,
  passNumber: number,
  reason: string | null,
  promptContext: Record<string, unknown>,
  aiResult: Record<string, unknown>,
): Promise<void> {
  try {
    await db
      .prepare(
        `INSERT INTO rg_goal_ai_runs (id, goal_id, pass_number, reason, prompt_json, response_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        crypto.randomUUID(),
        goalId,
        passNumber,
        reason,
        jsonForArchive(promptContext),
        jsonForArchive(aiResult),
        new Date().toISOString(),
      )
      .run();
  } catch {
    /* audit log failure must not block goal save */
  }
}

export async function replaceGoalActionsFromAi(
  db: D1Database,
  goalId: string,
  actions: Array<Record<string, unknown>>,
): Promise<void> {
  const now = new Date().toISOString();
  await db.prepare(`DELETE FROM rg_goal_actions WHERE goal_id = ? AND deleted_at IS NULL`).bind(goalId).run();
  for (let i = 0; i < actions.length; i++) {
    const a = actions[i];
    const priority = ["high", "medium", "low"].includes(str(a.priority)) ? str(a.priority) : "medium";
    await db
      .prepare(
        `INSERT INTO rg_goal_actions (id, goal_id, id_hint, title, detail, priority, sort_order, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        crypto.randomUUID(),
        goalId,
        str(a.id_hint) || null,
        publicText(str(a.title), 200) || "Action",
        publicText(str(a.detail), 800),
        priority,
        numOrder(a.order, i),
        now,
        now,
      )
      .run();
  }
}

export async function replaceGoalSuggestionsFromAi(
  db: D1Database,
  goalId: string,
  suggestions: Array<Record<string, unknown>>,
): Promise<void> {
  const now = new Date().toISOString();
  await db.prepare(`DELETE FROM rg_goal_suggestions WHERE goal_id = ? AND deleted_at IS NULL`).bind(goalId).run();
  for (const s of suggestions) {
    await db
      .prepare(
        `INSERT INTO rg_goal_suggestions (id, goal_id, id_hint, title, detail, category, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        crypto.randomUUID(),
        goalId,
        str(s.id_hint) || null,
        publicText(str(s.title), 200) || "Suggestion",
        publicText(str(s.detail), 800),
        str(s.category) || null,
        now,
        now,
      )
      .run();
  }
}

function numOrder(v: unknown, fallback: number): number {
  const n = Number(v);
  return Number.isFinite(n) ? Math.floor(n) : fallback;
}

export async function listGoalActions(db: D1Database, goalId: string) {
  const rows = await db
    .prepare(
      `SELECT id, id_hint, title, detail, priority, sort_order, completed_at, created_at, updated_at
       FROM rg_goal_actions WHERE goal_id = ? AND deleted_at IS NULL ORDER BY sort_order, created_at`,
    )
    .bind(goalId)
    .all();
  return rows.results ?? [];
}

export async function listGoalSuggestions(db: D1Database, goalId: string) {
  const rows = await db
    .prepare(
      `SELECT id, id_hint, title, detail, category, created_at, updated_at
       FROM rg_goal_suggestions WHERE goal_id = ? AND deleted_at IS NULL ORDER BY created_at`,
    )
    .bind(goalId)
    .all();
  return rows.results ?? [];
}

export async function assertAiRefreshAllowed(
  db: D1Database,
  userId: string,
  goalId: string,
  goalRow: Record<string, unknown>,
): Promise<{ ok: true } | { ok: false; detail: string }> {
  if (goalRow.ai_response_json) {
    try {
      const ai = JSON.parse(String(goalRow.ai_response_json)) as Record<string, unknown>;
      if (ai.ok === false) return { ok: true };
    } catch {
      /* continue */
    }
  }

  const lastGeneratedAt = str(goalRow.ai_generated_at) || null;
  const day = utcDayKey();
  const { member } = await loadMemberFlags(db, userId);

  if (member) {
    const goalRow = await db
      .prepare(`SELECT refresh_count FROM rg_goal_ai_refresh_daily WHERE goal_id = ? AND day_utc = ?`)
      .bind(goalId, day)
      .first<{ refresh_count: number }>();
    const goalCount = goalRow?.refresh_count ?? 0;
    if (goalCount >= MEMBER_AI_REFRESH_PER_GOAL_PER_DAY) {
      return { ok: false, detail: `AI refresh limit reached for this goal today (${MEMBER_AI_REFRESH_PER_GOAL_PER_DAY}/day).` };
    }
    const userRow = await db
      .prepare(`SELECT goals_touched FROM rg_user_ai_refresh_daily WHERE user_id = ? AND day_utc = ?`)
      .bind(userId, day)
      .first<{ goals_touched: number }>();
    const touched = userRow?.goals_touched ?? 0;
    if (touched >= MEMBER_AI_GOALS_PER_DAY) {
      return { ok: false, detail: `Daily AI refresh limit across goals reached (${MEMBER_AI_GOALS_PER_DAY} goals/day).` };
    }
    return { ok: true };
  }

  if (lastGeneratedAt) {
    const last = new Date(lastGeneratedAt).getTime();
    const minMs = FREE_AI_REFRESH_DAYS * 24 * 60 * 60 * 1000;
    if (Date.now() - last < minMs) {
      return {
        ok: false,
        detail: `Free accounts can refresh the AI plan once every ${FREE_AI_REFRESH_DAYS} days per goal.`,
      };
    }
  }
  return { ok: true };
}

export async function bumpAiRefreshCounters(db: D1Database, userId: string, goalId: string): Promise<void> {
  const day = utcDayKey();
  const { member } = await loadMemberFlags(db, userId);
  if (member) {
    await db
      .prepare(
        `INSERT INTO rg_goal_ai_refresh_daily (goal_id, day_utc, refresh_count) VALUES (?, ?, 1)
         ON CONFLICT(goal_id, day_utc) DO UPDATE SET refresh_count = refresh_count + 1`,
      )
      .bind(goalId, day)
      .run();
    await db
      .prepare(
        `INSERT INTO rg_user_ai_refresh_daily (user_id, day_utc, goals_touched) VALUES (?, ?, 1)
         ON CONFLICT(user_id, day_utc) DO UPDATE SET goals_touched = goals_touched + 1`,
      )
      .bind(userId, day)
      .run();
  }
}

/** @deprecated use runGoalPlanAi */
export async function callGoalPlanAi(env: GoalsAiEnv, userInput: Record<string, unknown>): Promise<Record<string, unknown>> {
  const fakeRow = {
    id: "",
    user_input_json: JSON.stringify(userInput),
    title: userInput.title,
    purpose: userInput.purpose ?? "",
    requires_money: userInput.requires_money ? 1 : 0,
    estimated_cost_cents: userInput.estimated_cost_cents,
    user_steps_summary: userInput.user_steps_summary ?? "",
    min_days: userInput.min_days,
    max_days: userInput.max_days,
    target_date_est: null,
    ai_response_json: null,
  };
  return runGoalPlanAi(env, env.DB, "user:anonymous", fakeRow as Record<string, unknown>, null);
}
