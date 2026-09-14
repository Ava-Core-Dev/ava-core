import type { D1Database, ExecutionContext, R2Bucket } from "@cloudflare/workers-types";

import { json } from "./cors";
import { scheduleGoalsAiDiscordNotify, type GoalsDiscordAiEnv } from "./goals-discord-ai";
import {
  AI_DISCLAIMER,
  assertAiRefreshAllowed,
  bumpAiRefreshCounters,
  insertAiRun,
  listGoalActions,
  listGoalSuggestions,
  replaceGoalActionsFromAi,
  replaceGoalSuggestionsFromAi,
  runGoalPlanAi,
  type GoalsAiEnv,
} from "./goals-ai";
import { activeGoalCount, canPostPublicGoals, loadMemberFlags } from "./goals-limits";
import { emailFromUserId, isServerGoalUser, SERVER_GOAL_EMAIL } from "./goal-constants";
import { ensureProfile } from "./profiles";
import {
  fundingPublicFields,
  parseImagePayload,
  provisionGoalFunding,
  storeGoalImage,
} from "./goal-funding";
import { fundingFlags } from "./goal-payout";

export type GoalsEnv = GoalsAiEnv &
  GoalsDiscordAiEnv & {
    DB: D1Database;
    SITE_URL?: string;
    GOAL_MEDIA?: R2Bucket;
    STRIPE_SECRET_KEY?: string;
    INTERNAL_WALLET_ENC_KEY_B64?: string;
    SOLANA_RPC_URL?: string;
    SOLANA_CLUSTER?: string;
    RRTT_TREASURY_SECRET_KEY_B58?: string;
    GOAL_TOKEN_RPC_URL?: string;
    GOAL_TOKEN_CLUSTER?: string;
  };

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

function num(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function bool01(v: unknown): number {
  return v === true || v === 1 || v === "1" ? 1 : 0;
}

function record(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

function slugify(title: string): string {
  const base = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
  return base || "goal";
}

function estimateTargetDate(minDays: number | null, maxDays: number | null): string | null {
  if (minDays == null && maxDays == null) return null;
  const lo = Math.max(0, minDays ?? 0);
  const hi = Math.max(lo, maxDays ?? lo);
  const mid = Math.round((lo + hi) / 2);
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + mid);
  return d.toISOString().slice(0, 10);
}

function clampPercent(v: unknown, fallback = 0): number {
  const n = Math.floor(Number(v));
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.min(100, n));
}

function parseTargetDate(v: unknown): string | null {
  const raw = str(v);
  if (!raw) return null;
  const m = raw.match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1]! : null;
}

/** Creators may raise a published target, never lower or clear it. */
export function raisedOrSameTargetCents(
  current: unknown,
  incoming: unknown,
): { ok: true; cents: number | null } | { ok: false; detail: string } {
  const currentCents = Math.max(0, Math.floor(Number(current) || 0));
  if (incoming == null || incoming === "") {
    return { ok: true, cents: currentCents > 0 ? currentCents : null };
  }
  const next = num(incoming);
  if (next == null || next < 0) {
    return { ok: false, detail: "Goal target must be a non-negative number." };
  }
  const nextCents = Math.floor(next);
  if (nextCents < currentCents) {
    return { ok: false, detail: "Goal target can only be raised, not lowered." };
  }
  return { ok: true, cents: nextCents };
}

function ownerKey(userId: string, guestId: string): string {
  if (userId.startsWith("user:")) return userId;
  if (guestId) return `guest:${guestId}`;
  return userId;
}

function goalPayload(row: Record<string, unknown>, env: GoalsEnv = {} as GoalsEnv) {
  let aiOk = true;
  let aiErrorDetail: string | null = null;
  if (row.ai_response_json) {
    try {
      const ai = JSON.parse(String(row.ai_response_json)) as Record<string, unknown>;
      if (ai.ok === false) {
        aiOk = false;
        aiErrorDetail = str(ai.detail) || str(ai.parse_error) || null;
      }
    } catch {
      /* ignore */
    }
  }
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    category_id: row.category_id,
    purpose: row.purpose,
    requires_money: Boolean(row.requires_money),
    estimated_cost_cents: row.estimated_cost_cents,
    percent_complete: clampPercent(row.percent_complete, 0),
    user_steps_summary: row.user_steps_summary,
    min_days: row.min_days,
    max_days: row.max_days,
    target_date_est: row.target_date_est,
    user_input: JSON.parse(String(row.user_input_json || "{}")),
    ai_summary_text: row.ai_summary_text,
    ai_plan: row.ai_plan_json ? JSON.parse(String(row.ai_plan_json)) : null,
    ai_generated_at: row.ai_generated_at,
    ai_ok: aiOk,
    ai_error_detail: aiErrorDetail,
    public_enabled: Boolean(row.public_enabled),
    created_at: row.created_at,
    updated_at: row.updated_at,
    ...fundingPublicFields(row, env),
  };
}

async function mergeGuestDraft(env: GoalsEnv, userId: string, guestId: string): Promise<void> {
  if (!guestId || !userId.startsWith("user:")) return;
  const guestKey = `guest:${guestId}`;
  const userKey = userId;
  const guestRow = await env.DB.prepare(`SELECT draft_json, updated_at FROM rg_onboarding_drafts WHERE owner_key = ?`)
    .bind(guestKey)
    .first<{ draft_json: string; updated_at: string }>();
  if (!guestRow) return;
  const userRow = await env.DB.prepare(`SELECT draft_json FROM rg_onboarding_drafts WHERE owner_key = ?`)
    .bind(userKey)
    .first<{ draft_json: string }>();
  if (!userRow) {
    await env.DB.prepare(
      `INSERT INTO rg_onboarding_drafts (owner_key, draft_json, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(owner_key) DO UPDATE SET draft_json = excluded.draft_json, updated_at = excluded.updated_at`,
    )
      .bind(userKey, guestRow.draft_json, guestRow.updated_at)
      .run();
  }
}

async function applyAiToGoal(
  env: GoalsEnv,
  userId: string,
  goalId: string,
  goalRow: Record<string, unknown>,
  reason: string | null,
  ctx?: ExecutionContext,
): Promise<{ payload: Record<string, unknown>; aiOk: boolean }> {
  const ai = await runGoalPlanAi(env, env.DB, userId, goalRow, reason);
  const now = new Date().toISOString();
  const passNumber = Number(ai.pass_number) || 1;
  const aiOk = ai.ok !== false;

  await env.DB.prepare(
    `UPDATE rg_goals SET ai_summary_text = ?, ai_plan_json = ?, ai_model = ?, ai_prompt_json = ?, ai_response_json = ?, ai_generated_at = ?, updated_at = ?
     WHERE id = ?`,
  )
    .bind(
      String(ai.summary_text ?? ""),
      JSON.stringify(ai.plan ?? {}),
      String(ai.model ?? "") || null,
      JSON.stringify(ai.goal_context ?? ai.request ?? {}),
      JSON.stringify(ai),
      aiOk ? now : goalRow.ai_generated_at ?? null,
      now,
      goalId,
    )
    .run();

  await insertAiRun(env.DB, goalId, passNumber, reason, (ai.goal_context as Record<string, unknown>) ?? {}, ai);
  await replaceGoalActionsFromAi(env.DB, goalId, (ai.actions as Array<Record<string, unknown>>) ?? []);
  await replaceGoalSuggestionsFromAi(env.DB, goalId, (ai.suggestions as Array<Record<string, unknown>>) ?? []);

  scheduleGoalsAiDiscordNotify(ctx, env, {
    goalId,
    userId,
    title: str(goalRow.title) || "Untitled goal",
    reason,
    passNumber,
    promptContext: (ai.goal_context as Record<string, unknown>) ?? {},
    ai: ai as Record<string, unknown>,
  });

  const next = await env.DB.prepare(`SELECT * FROM rg_goals WHERE id = ?`).bind(goalId).first<Record<string, unknown>>();
  return { payload: next ? goalPayload(next, env) : goalPayload(goalRow, env), aiOk };
}

async function uniqueSlug(db: D1Database, userId: string, title: string, excludeId?: string): Promise<string> {
  let slug = slugify(title);
  for (let i = 0; i < 20; i++) {
    const candidate = i === 0 ? slug : `${slug}-${i + 1}`;
    const row = await db
      .prepare(
        `SELECT id FROM rg_goals WHERE user_id = ? AND slug = ? AND deleted_at IS NULL` +
          (excludeId ? ` AND id != ?` : ""),
      )
      .bind(...(excludeId ? [userId, candidate, excludeId] : [userId, candidate]))
      .first();
    if (!row) return candidate;
  }
  return `${slug}-${crypto.randomUUID().slice(0, 8)}`;
}

export async function handleCategories(request: Request, env: GoalsEnv, userId: string): Promise<Response> {
  if (request.method === "GET") {
    const rows = await env.DB.prepare(`SELECT id, name, created_at FROM rg_categories WHERE user_id = ? ORDER BY name`)
      .bind(userId)
      .all();
    return json({ categories: rows.results ?? [] });
  }
  if (request.method === "POST") {
    const body = record(await request.json().catch(() => ({})));
    const name = str(body.name);
    if (!name) return json({ detail: "Category name is required." }, 400);
    const id = crypto.randomUUID();
    const createdAt = new Date().toISOString();
    await env.DB.prepare(`INSERT INTO rg_categories (id, user_id, name, created_at) VALUES (?, ?, ?, ?)`)
      .bind(id, userId, name, createdAt)
      .run();
    return json({ category: { id, name, created_at: createdAt } }, 201);
  }
  return json({ detail: "Method not allowed" }, 405);
}

export async function handleOnboardingDraft(
  request: Request,
  env: GoalsEnv,
  userId: string,
  guestId: string,
): Promise<Response> {
  const key = ownerKey(userId, guestId);
  if (request.method === "GET") {
    const row = await env.DB.prepare(`SELECT draft_json, updated_at FROM rg_onboarding_drafts WHERE owner_key = ?`)
      .bind(key)
      .first<{ draft_json: string; updated_at: string }>();
    if (!row) return json({ draft: null });
    return json({ draft: JSON.parse(row.draft_json), updated_at: row.updated_at });
  }
  if (request.method === "PUT") {
    const body = record(await request.json().catch(() => ({})));
    const draft = body.draft ?? body;
    const updatedAt = new Date().toISOString();
    await env.DB.prepare(
      `INSERT INTO rg_onboarding_drafts (owner_key, draft_json, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(owner_key) DO UPDATE SET draft_json = excluded.draft_json, updated_at = excluded.updated_at`,
    )
      .bind(key, JSON.stringify(draft), updatedAt)
      .run();
    return json({ ok: true, updated_at: updatedAt });
  }
  return json({ detail: "Method not allowed" }, 405);
}

async function createGoalFromDraft(
  env: GoalsEnv,
  userId: string,
  draft: Record<string, unknown>,
  ctx?: ExecutionContext,
): Promise<Record<string, unknown>> {
  const { maxGoals } = await loadMemberFlags(env.DB, userId);
  const count = await activeGoalCount(env.DB, userId);
  if (count >= maxGoals) {
    throw new Error(`Goal limit reached (${maxGoals} active goals).`);
  }

  const title = str(draft.title) || "Untitled goal";
  const id = crypto.randomUUID();
  const slug = await uniqueSlug(env.DB, userId, title);
  const now = new Date().toISOString();
  const minDays = num(draft.min_days);
  const maxDays = num(draft.max_days);
  const wantPublic = bool01(draft.public_enabled) === 1 || bool01(draft.public) === 1;
  if (wantPublic && !(await canPostPublicGoals(env.DB, userId))) {
    throw new Error("Only Root Record members can post public goals.");
  }
  const costCents = num(draft.estimated_cost_cents);
  const requiresMoney =
    draft.requires_money != null
      ? bool01(draft.requires_money) === 1
      : costCents != null && costCents > 0;
  const targetDate =
    parseTargetDate(draft.target_date_est) ?? estimateTargetDate(minDays, maxDays);
  const percentComplete = clampPercent(draft.percent_complete, 0);
  const { image_base64: _b64, image: _img, image_content_type: _ct, ...draftRest } = draft;
  const userInput = { ...draftRest, captured_at: now };
  const preRow = {
    id,
    user_input_json: JSON.stringify(userInput),
    title,
    purpose: str(draft.purpose),
    requires_money: requiresMoney ? 1 : 0,
    estimated_cost_cents: requiresMoney ? costCents : null,
    percent_complete: percentComplete,
    user_steps_summary: str(draft.user_steps_summary),
    min_days: minDays,
    max_days: maxDays,
    target_date_est: targetDate,
    ai_response_json: null,
  };

  await env.DB.prepare(
    `INSERT INTO rg_goals (
      id, user_id, slug, title, category_id, purpose, requires_money, estimated_cost_cents,
      percent_complete, user_steps_summary, min_days, max_days, target_date_est, user_input_json,
      ai_summary_text, ai_plan_json, ai_model, ai_prompt_json, ai_response_json, ai_generated_at,
      public_enabled, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '', '{}', NULL, '{}', '{}', NULL, ?, ?, ?)`,
  )
    .bind(
      id,
      userId,
      slug,
      title,
      str(draft.category_id) || null,
      str(draft.purpose),
      requiresMoney ? 1 : 0,
      requiresMoney ? costCents : null,
      percentComplete,
      str(draft.user_steps_summary),
      minDays,
      maxDays,
      targetDate,
      JSON.stringify(userInput),
      wantPublic ? 1 : 0,
      now,
      now,
    )
    .run();

  const tokenSymbol = str(draft.token_symbol).toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8);
  if (tokenSymbol) {
    await env.DB.prepare(`UPDATE rg_goals SET token_symbol = ? WHERE id = ?`).bind(tokenSymbol, id).run();
  }
  const posterEmail = isServerGoalUser(userId) ? SERVER_GOAL_EMAIL : emailFromUserId(userId);
  if (posterEmail) {
    await ensureProfile(env, posterEmail);
    await env.DB.prepare(`UPDATE rg_goals SET posted_by_email = ? WHERE id = ?`).bind(posterEmail, id).run();
  }

  const img = parseImagePayload(draft);
  if (img) {
    await storeGoalImage(env, id, img.bytes, img.contentType);
  }

  await applyAiToGoal(env, userId, id, preRow as Record<string, unknown>, "initial_plan", ctx);

  if (wantPublic) {
    await provisionGoalFunding(env, userId, id, ctx);
  }

  const row = await env.DB.prepare(`SELECT * FROM rg_goals WHERE id = ?`).bind(id).first<Record<string, unknown>>();
  return row ? goalPayload(row, env) : { id, slug, title };
}

export async function handleOnboardingFinalize(
  request: Request,
  env: GoalsEnv,
  userId: string,
  guestId: string,
  ctx?: ExecutionContext,
): Promise<Response> {
  if (request.method !== "POST") return json({ detail: "Method not allowed" }, 405);
  if (!userId.startsWith("user:")) {
    return json({ detail: "Sign in to finalize your goal and generate your plan." }, 401);
  }

  const body = record(await request.json().catch(() => ({})));
  let draft = record(body.draft);
  if (!Object.keys(draft).length) {
    const key = ownerKey(userId, guestId);
    const row = await env.DB.prepare(`SELECT draft_json FROM rg_onboarding_drafts WHERE owner_key = ?`)
      .bind(key)
      .first<{ draft_json: string }>();
    if (row) draft = record(JSON.parse(row.draft_json));
  }
  await mergeGuestDraft(env, userId, guestId);
  if (!str(draft.title)) {
    const key = ownerKey(userId, guestId);
    const row = await env.DB.prepare(`SELECT draft_json FROM rg_onboarding_drafts WHERE owner_key = ?`)
      .bind(key)
      .first<{ draft_json: string }>();
    if (row) draft = record(JSON.parse(row.draft_json));
  }
  if (!str(draft.title)) return json({ detail: "Draft is missing a goal title." }, 400);

  try {
    const goal = await createGoalFromDraft(env, userId, draft, ctx);
    const key = ownerKey(userId, guestId);
    await env.DB.prepare(`DELETE FROM rg_onboarding_drafts WHERE owner_key = ?`).bind(key).run();
    if (guestId) {
      await env.DB.prepare(`DELETE FROM rg_onboarding_drafts WHERE owner_key = ?`).bind(`guest:${guestId}`).run();
    }
    const actions = await listGoalActions(env.DB, String(goal.id));
    const suggestions = await listGoalSuggestions(env.DB, String(goal.id));
    return json({ goal, actions, suggestions, disclaimer: AI_DISCLAIMER, generating: false }, 201);
  } catch (e) {
    return json({ detail: e instanceof Error ? e.message : String(e) }, 400);
  }
}

export async function handleGoalsList(
  request: Request,
  env: GoalsEnv,
  userId: string,
  ctx?: ExecutionContext,
): Promise<Response> {
  if (request.method === "GET") {
    const rows = await env.DB.prepare(
      `SELECT * FROM rg_goals WHERE user_id = ? AND deleted_at IS NULL ORDER BY updated_at DESC`,
    )
      .bind(userId)
      .all();
    const goals = (rows.results ?? []).map((r) => goalPayload(r as Record<string, unknown>, env));
    const { member, maxGoals } = await loadMemberFlags(env.DB, userId);
    return json({ goals, limits: { member, max_goals: maxGoals, active: goals.length } });
  }
  if (request.method === "POST") {
    if (!userId.startsWith("user:")) {
      return json({ detail: "Sign in to create a goal." }, 401);
    }
    if (!(await canPostPublicGoals(env.DB, userId))) {
      return json({ detail: "Only Root Record members can post public goals." }, 403);
    }
    const body = record(await request.json().catch(() => ({})));
    try {
      const goal = await createGoalFromDraft(env, userId, body, ctx);
      return json({ goal }, 201);
    } catch (e) {
      return json({ detail: e instanceof Error ? e.message : String(e) }, 400);
    }
  }
  return json({ detail: "Method not allowed" }, 405);
}

export async function handleGoalById(
  request: Request,
  env: GoalsEnv,
  userId: string,
  goalId: string,
): Promise<Response> {
  const row = await env.DB.prepare(`SELECT * FROM rg_goals WHERE id = ? AND user_id = ? AND deleted_at IS NULL`)
    .bind(goalId, userId)
    .first<Record<string, unknown>>();
  if (!row) return json({ detail: "Goal not found." }, 404);

  if (request.method === "GET") {
    const achievements = await env.DB.prepare(
      `SELECT id, title, completed_at, sort_order, created_at, updated_at FROM rg_goal_achievements WHERE goal_id = ? ORDER BY sort_order, created_at`,
    )
      .bind(goalId)
      .all();
    const entries = await env.DB.prepare(
      `SELECT id, kind, body, amount_cents, created_at, updated_at FROM rg_goal_entries WHERE goal_id = ? ORDER BY created_at DESC`,
    )
      .bind(goalId)
      .all();
    const actions = await listGoalActions(env.DB, goalId);
    const suggestions = await listGoalSuggestions(env.DB, goalId);
    const { member, maxGoals } = await loadMemberFlags(env.DB, userId);
    return json({
      goal: goalPayload(row, env),
      funding: fundingFlags(row),
      achievements: achievements.results ?? [],
      entries: entries.results ?? [],
      actions,
      suggestions,
      disclaimer: AI_DISCLAIMER,
      limits: { member, max_goals: maxGoals },
    });
  }

  if (request.method === "PATCH") {
    const body = record(await request.json().catch(() => ({})));
    const title = body.title != null ? str(body.title) : str(row.title);
    const slug =
      body.title != null ? await uniqueSlug(env.DB, userId, title, goalId) : str(row.slug);
    const updatedAt = new Date().toISOString();
    let nextCost = row.estimated_cost_cents;
    if (Object.prototype.hasOwnProperty.call(body, "estimated_cost_cents")) {
      const raised = raisedOrSameTargetCents(row.estimated_cost_cents, body.estimated_cost_cents);
      if (!raised.ok) return json({ detail: raised.detail }, 400);
      nextCost = raised.cents;
    }
    const nextRequiresMoney =
      body.requires_money != null ? bool01(body.requires_money) : row.requires_money;
    if (!nextRequiresMoney) {
      // Non-monetary goals do not keep a fundraising target.
      nextCost = null;
    }
    let nextTargetDate = row.target_date_est;
    if (Object.prototype.hasOwnProperty.call(body, "target_date_est")) {
      nextTargetDate = parseTargetDate(body.target_date_est);
    } else if (body.min_days != null || body.max_days != null) {
      nextTargetDate = estimateTargetDate(
        num(body.min_days ?? row.min_days),
        num(body.max_days ?? row.max_days),
      );
    }
    const nextPct = Object.prototype.hasOwnProperty.call(body, "percent_complete")
      ? clampPercent(body.percent_complete, clampPercent(row.percent_complete, 0))
      : clampPercent(row.percent_complete, 0);
    await env.DB.prepare(
      `UPDATE rg_goals SET
        title = ?, slug = ?, category_id = ?, purpose = ?, requires_money = ?,
        estimated_cost_cents = ?, percent_complete = ?, user_steps_summary = ?, min_days = ?, max_days = ?,
        target_date_est = ?, public_enabled = ?, token_symbol = ?, updated_at = ?
       WHERE id = ? AND user_id = ?`,
    )
      .bind(
        title,
        slug,
        body.category_id != null ? str(body.category_id) || null : row.category_id,
        body.purpose != null ? str(body.purpose) : row.purpose,
        nextRequiresMoney,
        nextCost,
        nextPct,
        body.user_steps_summary != null ? str(body.user_steps_summary) : row.user_steps_summary,
        body.min_days != null ? num(body.min_days) : row.min_days,
        body.max_days != null ? num(body.max_days) : row.max_days,
        nextTargetDate,
        body.public_enabled != null ? bool01(body.public_enabled) : row.public_enabled,
        body.token_symbol != null
          ? str(body.token_symbol).toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8) || row.token_symbol
          : row.token_symbol,
        updatedAt,
        goalId,
        userId,
      )
      .run();
    const img = parseImagePayload(body);
    if (img) await storeGoalImage(env, goalId, img.bytes, img.contentType);
    if (body.public_enabled != null && bool01(body.public_enabled) === 1) {
      await provisionGoalFunding(env, userId, goalId);
    }
    const next = await env.DB.prepare(`SELECT * FROM rg_goals WHERE id = ?`).bind(goalId).first<Record<string, unknown>>();
    return json({ goal: next ? goalPayload(next, env) : null });
  }

  if (request.method === "DELETE") {
    const raised = Math.max(0, Math.floor(Number(row.raised_cents) || 0));
    const status = String(row.funding_status || "open").toLowerCase();
    if (status === "open" && raised > 0) {
      return json(
        { detail: "Refund donors or wait until you can withdraw before deleting a funded goal." },
        409,
      );
    }
    await env.DB.prepare(`UPDATE rg_goals SET deleted_at = ?, updated_at = ? WHERE id = ? AND user_id = ?`)
      .bind(new Date().toISOString(), new Date().toISOString(), goalId, userId)
      .run();
    return json({ ok: true });
  }

  return json({ detail: "Method not allowed" }, 405);
}

export async function handleGoalProvision(
  request: Request,
  env: GoalsEnv,
  userId: string,
  goalId: string,
  ctx?: ExecutionContext,
): Promise<Response> {
  if (request.method !== "POST") return json({ detail: "Method not allowed" }, 405);
  const body = record(await request.json().catch(() => ({})));
  const img = parseImagePayload(body);
  if (img) {
    await storeGoalImage(env, goalId, img.bytes, img.contentType);
  }
  try {
    const row = await provisionGoalFunding(env, userId, goalId, ctx);
    return json({ goal: goalPayload(row, env) });
  } catch (e) {
    return json({ detail: e instanceof Error ? e.message : String(e) }, 400);
  }
}

export async function handleGoalImagePost(
  request: Request,
  env: GoalsEnv,
  userId: string,
  goalId: string,
): Promise<Response> {
  if (request.method !== "POST") return json({ detail: "Method not allowed" }, 405);
  const owned = await env.DB.prepare(`SELECT id FROM rg_goals WHERE id = ? AND user_id = ? AND deleted_at IS NULL`)
    .bind(goalId, userId)
    .first();
  if (!owned) return json({ detail: "Goal not found." }, 404);
  const body = record(await request.json().catch(() => ({})));
  const img = parseImagePayload(body);
  if (!img) return json({ detail: "image_base64 required (image/*, max ~400KB)." }, 400);
  const url = await storeGoalImage(env, goalId, img.bytes, img.contentType);
  return json({ ok: true, image_url: url });
}

export async function handleGoalAiRefresh(
  request: Request,
  env: GoalsEnv,
  userId: string,
  goalId: string,
  ctx?: ExecutionContext,
): Promise<Response> {
  if (request.method !== "POST") return json({ detail: "Method not allowed" }, 405);
  const row = await env.DB.prepare(`SELECT * FROM rg_goals WHERE id = ? AND user_id = ? AND deleted_at IS NULL`)
    .bind(goalId, userId)
    .first<Record<string, unknown>>();
  if (!row) return json({ detail: "Goal not found." }, 404);

  const gate = await assertAiRefreshAllowed(env.DB, userId, goalId, row);
  if (!gate.ok) return json({ detail: gate.detail }, 429);

  const { payload: goal, aiOk } = await applyAiToGoal(env, userId, goalId, row, "user_refresh", ctx);
  if (aiOk) await bumpAiRefreshCounters(env.DB, userId, goalId);
  const actions = await listGoalActions(env.DB, goalId);
  const suggestions = await listGoalSuggestions(env.DB, goalId);
  return json({ goal, actions, suggestions, disclaimer: AI_DISCLAIMER });
}

export async function handleGoalAchievements(
  request: Request,
  env: GoalsEnv,
  userId: string,
  goalId: string,
): Promise<Response> {
  const goal = await env.DB.prepare(`SELECT id FROM rg_goals WHERE id = ? AND user_id = ? AND deleted_at IS NULL`)
    .bind(goalId, userId)
    .first();
  if (!goal) return json({ detail: "Goal not found." }, 404);

  if (request.method === "GET") {
    const rows = await env.DB.prepare(`SELECT * FROM rg_goal_achievements WHERE goal_id = ? ORDER BY sort_order, created_at`)
      .bind(goalId)
      .all();
    return json({ achievements: rows.results ?? [] });
  }

  if (request.method === "POST") {
    const body = record(await request.json().catch(() => ({})));
    const title = str(body.title);
    if (!title) return json({ detail: "Title is required." }, 400);
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const completedAt = body.completed ? now : null;
    await env.DB.prepare(
      `INSERT INTO rg_goal_achievements (id, goal_id, title, completed_at, sort_order, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(id, goalId, title, completedAt, num(body.sort_order) ?? 0, now, now)
      .run();
    return json({ achievement: { id, goal_id: goalId, title, completed_at: completedAt, sort_order: num(body.sort_order) ?? 0 } }, 201);
  }

  return json({ detail: "Method not allowed" }, 405);
}

export async function handleGoalEntries(
  request: Request,
  env: GoalsEnv,
  userId: string,
  goalId: string,
): Promise<Response> {
  const goal = await env.DB.prepare(`SELECT id FROM rg_goals WHERE id = ? AND user_id = ? AND deleted_at IS NULL`)
    .bind(goalId, userId)
    .first();
  if (!goal) return json({ detail: "Goal not found." }, 404);

  if (request.method === "GET") {
    const rows = await env.DB.prepare(`SELECT * FROM rg_goal_entries WHERE goal_id = ? ORDER BY created_at DESC`)
      .bind(goalId)
      .all();
    return json({ entries: rows.results ?? [] });
  }

  if (request.method === "POST") {
    const body = record(await request.json().catch(() => ({})));
    const kind = str(body.kind) || "note";
    if (!["note", "cost", "income", "achievement"].includes(kind)) {
      return json({ detail: "Invalid entry kind." }, 400);
    }
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    await env.DB.prepare(
      `INSERT INTO rg_goal_entries (id, goal_id, kind, body, amount_cents, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(id, goalId, kind, str(body.body), num(body.amount_cents), now, now)
      .run();
    return json({ entry: { id, goal_id: goalId, kind, body: str(body.body), amount_cents: num(body.amount_cents), created_at: now } }, 201);
  }

  return json({ detail: "Method not allowed" }, 405);
}

async function assertGoalOwner(env: GoalsEnv, userId: string, goalId: string): Promise<boolean> {
  const goal = await env.DB.prepare(`SELECT id FROM rg_goals WHERE id = ? AND user_id = ? AND deleted_at IS NULL`)
    .bind(goalId, userId)
    .first();
  return Boolean(goal);
}

export async function handleCategoryById(
  request: Request,
  env: GoalsEnv,
  userId: string,
  categoryId: string,
): Promise<Response> {
  const row = await env.DB.prepare(`SELECT id FROM rg_categories WHERE id = ? AND user_id = ?`)
    .bind(categoryId, userId)
    .first();
  if (!row) return json({ detail: "Category not found." }, 404);

  if (request.method === "PATCH") {
    const body = record(await request.json().catch(() => ({})));
    const name = body.name != null ? str(body.name) : null;
    if (name !== null && !name) return json({ detail: "Name cannot be empty." }, 400);
    if (name) {
      await env.DB.prepare(`UPDATE rg_categories SET name = ? WHERE id = ? AND user_id = ?`)
        .bind(name, categoryId, userId)
        .run();
    }
    const next = await env.DB.prepare(`SELECT id, name, created_at FROM rg_categories WHERE id = ?`)
      .bind(categoryId)
      .first();
    return json({ category: next });
  }

  if (request.method === "DELETE") {
    await env.DB.prepare(`UPDATE rg_goals SET category_id = NULL WHERE category_id = ? AND user_id = ?`)
      .bind(categoryId, userId)
      .run();
    await env.DB.prepare(`DELETE FROM rg_categories WHERE id = ? AND user_id = ?`).bind(categoryId, userId).run();
    return json({ ok: true });
  }

  return json({ detail: "Method not allowed" }, 405);
}

export async function handleGoalActions(
  request: Request,
  env: GoalsEnv,
  userId: string,
  goalId: string,
): Promise<Response> {
  if (!(await assertGoalOwner(env, userId, goalId))) return json({ detail: "Goal not found." }, 404);
  if (request.method === "GET") {
    const actions = await listGoalActions(env.DB, goalId);
    return json({ actions, disclaimer: AI_DISCLAIMER });
  }
  return json({ detail: "Method not allowed" }, 405);
}

export async function handleGoalActionById(
  request: Request,
  env: GoalsEnv,
  userId: string,
  goalId: string,
  actionId: string,
): Promise<Response> {
  if (!(await assertGoalOwner(env, userId, goalId))) return json({ detail: "Goal not found." }, 404);
  if (request.method === "DELETE") {
    const now = new Date().toISOString();
    await env.DB.prepare(
      `UPDATE rg_goal_actions SET deleted_at = ?, updated_at = ? WHERE id = ? AND goal_id = ? AND deleted_at IS NULL`,
    )
      .bind(now, now, actionId, goalId)
      .run();
    return json({ ok: true });
  }
  if (request.method === "PATCH") {
    const body = record(await request.json().catch(() => ({})));
    const now = new Date().toISOString();
    if (body.completed === true) {
      await env.DB.prepare(`UPDATE rg_goal_actions SET completed_at = ?, updated_at = ? WHERE id = ? AND goal_id = ?`)
        .bind(now, now, actionId, goalId)
        .run();
    } else if (body.completed === false) {
      await env.DB.prepare(`UPDATE rg_goal_actions SET completed_at = NULL, updated_at = ? WHERE id = ? AND goal_id = ?`)
        .bind(now, actionId, goalId)
        .run();
    }
    return json({ ok: true });
  }
  return json({ detail: "Method not allowed" }, 405);
}

export async function handleGoalSuggestions(
  request: Request,
  env: GoalsEnv,
  userId: string,
  goalId: string,
): Promise<Response> {
  if (!(await assertGoalOwner(env, userId, goalId))) return json({ detail: "Goal not found." }, 404);
  if (request.method === "GET") {
    const suggestions = await listGoalSuggestions(env.DB, goalId);
    return json({ suggestions, disclaimer: AI_DISCLAIMER });
  }
  return json({ detail: "Method not allowed" }, 405);
}

export async function handleGoalSuggestionById(
  request: Request,
  env: GoalsEnv,
  userId: string,
  goalId: string,
  suggestionId: string,
): Promise<Response> {
  if (!(await assertGoalOwner(env, userId, goalId))) return json({ detail: "Goal not found." }, 404);
  if (request.method === "DELETE") {
    const now = new Date().toISOString();
    await env.DB.prepare(
      `UPDATE rg_goal_suggestions SET deleted_at = ?, updated_at = ? WHERE id = ? AND goal_id = ? AND deleted_at IS NULL`,
    )
      .bind(now, now, suggestionId, goalId)
      .run();
    return json({ ok: true });
  }
  return json({ detail: "Method not allowed" }, 405);
}

export async function handleAchievementById(
  request: Request,
  env: GoalsEnv,
  userId: string,
  goalId: string,
  achievementId: string,
): Promise<Response> {
  if (!(await assertGoalOwner(env, userId, goalId))) return json({ detail: "Goal not found." }, 404);
  const row = await env.DB.prepare(`SELECT id FROM rg_goal_achievements WHERE id = ? AND goal_id = ?`)
    .bind(achievementId, goalId)
    .first();
  if (!row) return json({ detail: "Achievement not found." }, 404);

  if (request.method === "PATCH") {
    const body = record(await request.json().catch(() => ({})));
    const now = new Date().toISOString();
    const existing = await env.DB.prepare(`SELECT * FROM rg_goal_achievements WHERE id = ? AND goal_id = ?`)
      .bind(achievementId, goalId)
      .first<Record<string, unknown>>();
    if (!existing) return json({ detail: "Achievement not found." }, 404);
    const title = body.title != null ? str(body.title) : str(existing.title);
    let completedAt = existing.completed_at as string | null;
    if (body.completed === true) completedAt = now;
    else if (body.completed === false) completedAt = null;
    const sortOrder = body.sort_order != null ? num(body.sort_order) ?? 0 : Number(existing.sort_order) || 0;
    await env.DB.prepare(
      `UPDATE rg_goal_achievements SET title = ?, completed_at = ?, sort_order = ?, updated_at = ? WHERE id = ? AND goal_id = ?`,
    )
      .bind(title, completedAt, sortOrder, now, achievementId, goalId)
      .run();
    const next = await env.DB.prepare(`SELECT * FROM rg_goal_achievements WHERE id = ?`).bind(achievementId).first();
    return json({ achievement: next });
  }

  if (request.method === "DELETE") {
    await env.DB.prepare(`DELETE FROM rg_goal_achievements WHERE id = ? AND goal_id = ?`).bind(achievementId, goalId).run();
    return json({ ok: true });
  }

  return json({ detail: "Method not allowed" }, 405);
}

export async function handleEntryById(
  request: Request,
  env: GoalsEnv,
  userId: string,
  goalId: string,
  entryId: string,
): Promise<Response> {
  if (!(await assertGoalOwner(env, userId, goalId))) return json({ detail: "Goal not found." }, 404);
  const row = await env.DB.prepare(`SELECT id FROM rg_goal_entries WHERE id = ? AND goal_id = ?`)
    .bind(entryId, goalId)
    .first();
  if (!row) return json({ detail: "Entry not found." }, 404);

  if (request.method === "PATCH") {
    const body = record(await request.json().catch(() => ({})));
    const now = new Date().toISOString();
    await env.DB.prepare(
      `UPDATE rg_goal_entries SET body = COALESCE(?, body), amount_cents = COALESCE(?, amount_cents), updated_at = ? WHERE id = ?`,
    )
      .bind(body.body != null ? str(body.body) : null, body.amount_cents != null ? num(body.amount_cents) : null, now, entryId)
      .run();
    const next = await env.DB.prepare(`SELECT * FROM rg_goal_entries WHERE id = ?`).bind(entryId).first();
    return json({ entry: next });
  }

  if (request.method === "DELETE") {
    await env.DB.prepare(`DELETE FROM rg_goal_entries WHERE id = ? AND goal_id = ?`).bind(entryId, goalId).run();
    return json({ ok: true });
  }

  return json({ detail: "Method not allowed" }, 405);
}
