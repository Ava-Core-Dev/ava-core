import type { D1Database, ExecutionContext } from "@cloudflare/workers-types";

import { resolveUserId } from "./auth";
import { json } from "./cors";
import {
  FREE_DAILY_AI_LIMIT,
  PRO_MONTHLY_AI_LIMIT,
  REPORT_LIST_LIMIT,
  loadProFlags,
  utcDayKey,
  utcMonthKey,
} from "./free-tier";
import { latestRootMcReportBefore, previousReportForPrompt } from "./rootmc-ai-report-store";
import { BLOCKNOTES_WORLD_AI_SYSTEM_PROMPT } from "./rootmc-grok-prompts";

export type RootMcAiEnv = {
  DB: D1Database;
  JWT_SECRET: string;
  GROK_API_BEARER_TOKEN?: string;
  GROK_ROOT_ASK_BEARER_TOKEN?: string;
  GROK_X_BEARER_TOKEN?: string;
  GROK_API_URL?: string;
  GROK_MODEL?: string;
  DISCORD_ROOTMC_BOT_TOKEN?: string;
  DISCORD_ROOTMC_AI_ARCHIVE_CHANNEL_ID?: string;
};

function grokChatBearerToken(env: Pick<RootMcAiEnv, "GROK_API_BEARER_TOKEN">): string {
  const raw = String(env.GROK_API_BEARER_TOKEN || "").trim();
  if (!raw) return "";
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

/** Dedicated xAI key for in-game /ask only (console name: root-ask). Falls back to GROK_API_BEARER_TOKEN. */
export function grokRootAskBearerToken(
  env: Pick<RootMcAiEnv, "GROK_ROOT_ASK_BEARER_TOKEN" | "GROK_API_BEARER_TOKEN">,
): string {
  const dedicated = String(env.GROK_ROOT_ASK_BEARER_TOKEN || "").trim();
  if (dedicated) {
    try {
      return decodeURIComponent(dedicated);
    } catch {
      return dedicated;
    }
  }
  return grokChatBearerToken(env);
}

type ReportRow = {
  id: string;
  user_id: string;
  world_key: string;
  world_name: string;
  day_utc: string;
  month_utc: string;
  summary_text: string;
  report_text: string;
  stats_json: string;
  source_data_json: string;
  model: string | null;
  prompt_json: string;
  response_json: string;
  created_at: string;
};

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

function record(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

function recordArray(v: unknown): Array<Record<string, unknown>> {
  return Array.isArray(v)
    ? v.filter((x): x is Record<string, unknown> => Boolean(x && typeof x === "object" && !Array.isArray(x)))
    : [];
}

function truncate(s: string, max: number): string {
  const t = s.trim();
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}...` : t;
}

function publicText(raw: unknown, max: number): string {
  return truncate(
    String(raw ?? "")
      .replace(/https?:\/\/console\.x\.ai[^\s]*/gi, "AI service")
      .replace(/\bapi\.x\.ai\b/gi, "AI service")
      .replace(/Incorrect API key[^.]*\./gi, "AI authentication failed.")
      .replace(/\bxAI\b/g, "AI")
      .replace(/\bGrok\b/gi, "AI")
      .replace(/\s+/g, " ")
      .trim(),
    max,
  );
}

function grokErrorForUser(status: number): string {
  if (status === 401 || status === 403) {
    return "AI authentication failed on the server. Try again later or contact support.";
  }
  if (status === 429) return "AI rate limit reached. Try again in a few minutes.";
  if (status >= 500) return "AI service error. Try again later.";
  return "Could not generate a report right now. Try again later.";
}

function jsonForArchive(v: unknown): string {
  return JSON.stringify(v, (_k, value) => (typeof value === "bigint" ? value.toString() : value));
}

function nextUtcReset(dayUtc: string): string {
  const [y, m, d] = dayUtc.split("-").map((part) => Number(part));
  if (!y || !m || !d) return new Date(Date.now() + 86400 * 1000).toISOString();
  return new Date(Date.UTC(y, m - 1, d + 1, 0, 0, 0)).toISOString();
}

function nextUtcMonthReset(monthUtc: string): string {
  const [y, m] = monthUtc.split("-").map((part) => Number(part));
  if (!y || !m) return new Date(Date.now() + 86400 * 1000 * 28).toISOString();
  return new Date(Date.UTC(y, m, 1, 0, 0, 0)).toISOString();
}

export function quotaPayload(
  pro: boolean,
  usedToday: number,
  usedMonth: number,
  dayUtc: string,
  monthUtc: string,
): Record<string, unknown> {
  if (pro) {
    const safeUsed = Math.max(0, Math.min(PRO_MONTHLY_AI_LIMIT, Math.floor(usedMonth)));
    return {
      tier: "pro",
      used_today: Math.max(0, Math.floor(usedToday)),
      used_this_month: safeUsed,
      remaining_today: null,
      remaining_this_month: Math.max(0, PRO_MONTHLY_AI_LIMIT - safeUsed),
      daily_limit: null,
      monthly_limit: PRO_MONTHLY_AI_LIMIT,
      reset_at: nextUtcMonthReset(monthUtc),
      day_utc: dayUtc,
      month_utc: monthUtc,
    };
  }
  const safeUsed = Math.max(0, Math.min(FREE_DAILY_AI_LIMIT, Math.floor(usedToday)));
  return {
    tier: "free",
    used_today: safeUsed,
    used_this_month: Math.max(0, Math.floor(usedMonth)),
    remaining_today: Math.max(0, FREE_DAILY_AI_LIMIT - safeUsed),
    remaining_this_month: null,
    daily_limit: FREE_DAILY_AI_LIMIT,
    monthly_limit: null,
    reset_at: nextUtcReset(dayUtc),
    day_utc: dayUtc,
    month_utc: monthUtc,
  };
}

export function reportPayload(row: ReportRow): Record<string, unknown> {
  let stats: Record<string, unknown> = {};
  try {
    stats = JSON.parse(row.stats_json || "{}") as Record<string, unknown>;
  } catch {
    stats = {};
  }
  return {
    id: row.id,
    world_key: row.world_key,
    world_name: row.world_name,
    summary_text: publicText(row.summary_text, 700),
    report_text: publicText(row.report_text, 2400),
    stats,
    created_at: row.created_at,
  };
}

export async function usedToday(db: D1Database, userId: string, dayUtc: string): Promise<number> {
  const row = await db
    .prepare(
      `SELECT COUNT(*) AS count FROM rootmc_world_ai_reports
       WHERE user_id = ? AND day_utc = ?
         AND report_text NOT LIKE '%AI report unavailable%'`,
    )
    .bind(userId, dayUtc)
    .first<{ count: number }>();
  return Math.max(0, Math.floor(Number(row?.count || 0)));
}

export async function usedThisMonth(db: D1Database, userId: string, monthUtc: string): Promise<number> {
  const row = await db
    .prepare(
      `SELECT COUNT(*) AS count FROM rootmc_world_ai_reports
       WHERE user_id = ? AND month_utc = ?
         AND report_text NOT LIKE '%AI report unavailable%'`,
    )
    .bind(userId, monthUtc)
    .first<{ count: number }>();
  return Math.max(0, Math.floor(Number(row?.count || 0)));
}

export async function latestReports(db: D1Database, userId: string, worldKey: string): Promise<ReportRow[]> {
  const { results } = await db
    .prepare(
      `SELECT * FROM rootmc_world_ai_reports
       WHERE user_id = ? AND world_key = ?
       ORDER BY created_at DESC LIMIT ?`,
    )
    .bind(userId, worldKey, REPORT_LIST_LIMIT)
    .all<ReportRow>();
  return results || [];
}

export function compactWorldPayload(body: Record<string, unknown>): Record<string, unknown> {
  const world = record(body.world);
  const stats = record(body.stats);
  const notebooks = recordArray(body.notebooks);
  const notes = recordArray(body.notes);
  const coordinates = recordArray(body.coordinates);
  const buildPlans = recordArray(body.build_plans);
  const timeline = recordArray(body.timeline);
  const media = recordArray(body.media);
  const player = record(body.minecraft_player);

  return {
    world: {
      local_id: world.local_id ?? world.id ?? null,
      name: str(world.name),
      seed: str(world.seed) || null,
      game_version: str(world.game_version) || str(world.gameVersion) || null,
      is_active: Boolean(world.is_active ?? world.isActive),
      play_mode: str(world.play_mode) || str(world.playMode) || null,
      server_address: str(world.server_address) || str(world.serverAddress) || null,
      map_url: str(world.map_url) || str(world.mapUrl) || null,
    },
    minecraft_player: Object.keys(player).length
      ? { username: str(player.username) || null, uuid: str(player.uuid) || null }
      : null,
    stats: {
      notebook_count: Number(stats.notebook_count ?? notebooks.length) || notebooks.length,
      note_count: Number(stats.note_count ?? notes.length) || notes.length,
      coord_count: Number(stats.coord_count ?? coordinates.length) || coordinates.length,
      build_plan_count: Number(stats.build_plan_count ?? buildPlans.length) || buildPlans.length,
      timeline_event_count: Number(stats.timeline_event_count ?? timeline.length) || timeline.length,
      media_count: Number(stats.media_count ?? media.length) || media.length,
    },
    notebooks: notebooks.slice(0, 24).map((nb) => ({
      name: str(nb.name),
      preset: str(nb.preset) || null,
      icon: str(nb.icon) || null,
    })),
    notes: notes.slice(0, 48).map((note) => ({
      title: truncate(str(note.title), 120),
      notebook: str(note.notebook_name) || str(note.notebook) || null,
      preview: truncate(str(note.preview ?? note.plain_text_preview ?? note.plainTextPreview), 900),
      body_excerpt: truncate(str(note.body_excerpt ?? note.markdown_body ?? note.markdownBody), 1800),
      pinned: Boolean(note.pinned),
      tags: Array.isArray(note.tags) ? note.tags.map((t) => String(t)).slice(0, 12) : [],
      linked_note_titles: Array.isArray(note.linked_note_titles)
        ? note.linked_note_titles.map((t) => String(t)).slice(0, 8)
        : [],
      updated_at: note.updated_at ?? note.updatedAt ?? null,
    })),
    coordinates: coordinates.slice(0, 40).map((c) => ({
      label: truncate(str(c.label), 80),
      x: c.x ?? null,
      y: c.y ?? null,
      z: c.z ?? null,
      dimension: str(c.dimension) || null,
      note_title: str(c.note_title) || null,
    })),
    build_plans: buildPlans.slice(0, 12).map((plan) => ({
      title: truncate(str(plan.title), 120),
      progress_percent: Number(plan.progress_percent ?? plan.progressPercent ?? 0) || 0,
      items: recordArray(plan.items)
        .slice(0, 40)
        .map((item) => ({
          material: str(item.material_name ?? item.materialName),
          quantity: Number(item.quantity ?? 0) || 0,
          obtained: Boolean(item.obtained),
        })),
    })),
    timeline: timeline.slice(0, 40).map((ev) => ({
      event_type: str(ev.event_type ?? ev.eventType),
      description: truncate(str(ev.description), 240),
      timestamp: ev.timestamp ?? null,
    })),
    media: media.slice(0, 24).map((m) => ({
      type: str(m.type),
      note_title: str(m.note_title) || null,
      mime_type: str(m.mime_type ?? m.mimeType) || null,
      ocr_text: truncate(str(m.ocr_text ?? m.ocrText), 400) || null,
    })),
  };
}

function buildPromptContext(
  worldKey: string,
  worldName: string,
  compact: Record<string, unknown>,
  priorReport: Record<string, unknown> | null,
): Record<string, unknown> {
  return {
    generated_at: new Date().toISOString(),
    app: "Block Notes",
    instruction:
      "Analyze this Minecraft world's saved notes, coordinates, build plans, timeline, and media metadata. " +
      "Give practical survival/build advice grounded only in the supplied data. " +
      "Highlight gaps, next steps, base/farm/redstone priorities, coordinate clusters, incomplete build plans, and stale todos. " +
      "Do not invent blocks, coords, or plans that are not in the payload.",
    world_key: worldKey,
    world_name: worldName,
    world_data: compact,
    previous_report: priorReport,
  };
}

function fallbackReport(ctx: Record<string, unknown>, detail: string): Record<string, unknown> {
  const worldData = record(ctx.world_data);
  const world = record(worldData.world);
  const stats = record(worldData.stats);
  const name = str(world.name) || str(ctx.world_name) || "this world";
  const summary = `Summary for ${name}: ${Number(stats.note_count || 0)} notes, ${Number(stats.coord_count || 0)} coords, ${Number(stats.build_plan_count || 0)} build plans in payload.`;
  const report = [summary, "AI report unavailable  -  review notebooks and build planner in the app.", detail].filter(Boolean).join(" ");
  return {
    ok: false,
    fallback_report: true,
    detail,
    summary_text: publicText(summary, 700),
    report_text: publicText(report, 2400),
  };
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

function parseAiJson(content: string, summaryMax = 700, reportMax = 2400): { summary_text: string; report_text: string } {
  const cleaned = content.replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  const candidate = start >= 0 && end > start ? cleaned.slice(start, end + 1) : cleaned;
  const obj = JSON.parse(candidate) as Record<string, unknown>;
  return {
    summary_text: publicText(str(obj.summary_text), summaryMax),
    report_text: publicText(str(obj.report_text), reportMax),
  };
}

function grokErrorText(_response: Record<string, unknown>, status: number): string {
  return grokErrorForUser(status);
}

function parseJsonObject(content: string): Record<string, unknown> {
  const cleaned = content.replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  const candidate = start >= 0 && end > start ? cleaned.slice(start, end + 1) : cleaned;
  return JSON.parse(candidate) as Record<string, unknown>;
}

export async function callGrokJsonObject(
  env: RootMcAiEnv,
  systemPrompt: string,
  ctx: Record<string, unknown>,
  opts?: { temperature?: number; bearerToken?: string },
): Promise<Record<string, unknown>> {
  const token = String(opts?.bearerToken || "").trim() || grokChatBearerToken(env);
  const apiUrl = String(env.GROK_API_URL || "https://api.x.ai/v1/chat/completions").trim();
  const model = String(env.GROK_MODEL || "grok-3-latest").trim();
  const temperature = opts?.temperature ?? 0.2;
  const body = {
    model,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: jsonForArchive(ctx) },
    ],
    temperature,
    response_format: { type: "json_object" },
  };
  if (!token) {
    return { ok: false, detail: "World AI is not configured on the server.", model, request: body };
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
      return { ok: false, detail: grokErrorText(response, res.status), status: res.status, model, request: body, response };
    }
    try {
      const parsed = parseJsonObject(content);
      return { ok: true, status: res.status, model, request: body, response, content, ...parsed };
    } catch (e) {
      const detail = `Parse error: ${e instanceof Error ? e.message : String(e)}`;
      return { ok: false, detail, status: res.status, model, request: body, response, content };
    }
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    return { ok: false, detail, model, request: body };
  }
}

export async function callGrokRootMcReport(
  env: RootMcAiEnv,
  systemPrompt: string,
  ctx: Record<string, unknown>,
  opts?: { temperature?: number; summaryMax?: number; reportMax?: number },
): Promise<Record<string, unknown>> {
  const token = grokChatBearerToken(env);
  const apiUrl = String(env.GROK_API_URL || "https://api.x.ai/v1/chat/completions").trim();
  const model = String(env.GROK_MODEL || "grok-3-latest").trim();
  const temperature = opts?.temperature ?? 0.25;
  const summaryMax = opts?.summaryMax ?? 700;
  const reportMax = opts?.reportMax ?? 2400;
  const body = {
    model,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: jsonForArchive(ctx) },
    ],
    temperature,
    response_format: { type: "json_object" },
  };
  if (!token) {
    const detail = "World AI is not configured on the server.";
    return { ok: false, fallback_report: true, detail, model, request: body, ...fallbackReport(ctx, detail) };
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
      const detail = grokErrorText(response, res.status);
      return { ok: false, fallback_report: true, detail, status: res.status, model, request: body, response, ...fallbackReport(ctx, detail) };
    }
    try {
      const parsed = parseAiJson(content, summaryMax, reportMax);
      return { ok: true, status: res.status, model, request: body, response, content, ...parsed };
    } catch (e) {
      const detail = `Parse error: ${e instanceof Error ? e.message : String(e)}`;
      return { ok: false, fallback_report: true, detail, status: res.status, model, request: body, response, content, ...fallbackReport(ctx, detail) };
    }
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    return { ok: false, fallback_report: true, detail, model, request: body, ...fallbackReport(ctx, detail) };
  }
}

const WORLD_AI_SYSTEM_PROMPT = BLOCKNOTES_WORLD_AI_SYSTEM_PROMPT;

async function callRootMcWorldAi(
  env: RootMcAiEnv,
  ctx: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  return callGrokRootMcReport(env, WORLD_AI_SYSTEM_PROMPT, ctx);
}

export async function insertReport(
  env: RootMcAiEnv,
  userId: string,
  worldKey: string,
  worldName: string,
  compact: Record<string, unknown>,
  promptContext: Record<string, unknown>,
  ai: Record<string, unknown>,
  dayUtc: string,
  monthUtc: string,
  priorReportId?: string | null,
): Promise<ReportRow | null> {
  const id = crypto.randomUUID();
  const createdAt = new Date().toISOString();
  const stats = record(compact.stats);
  await env.DB.prepare(
    `INSERT INTO rootmc_world_ai_reports
     (id, user_id, world_key, world_name, day_utc, month_utc, summary_text, report_text,
      stats_json, source_data_json, model, prompt_json, response_json, prior_report_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      id,
      userId,
      worldKey,
      worldName,
      dayUtc,
      monthUtc,
      str(ai.summary_text) || "AI summary was not available.",
      str(ai.report_text) || "AI report was not available.",
      jsonForArchive(stats),
      jsonForArchive(compact),
      str(ai.model) || null,
      jsonForArchive(promptContext),
      jsonForArchive(ai),
      priorReportId || null,
      createdAt,
    )
    .run();
  return (
    (await env.DB.prepare("SELECT * FROM rootmc_world_ai_reports WHERE id = ? LIMIT 1")
      .bind(id)
      .first<ReportRow>()) || null
  );
}

const DEFAULT_BLOCKNOTES_AI_ARCHIVE_CHANNEL_ID = "1511922772983545947";

async function postWorldAiReportToDiscord(
  env: RootMcAiEnv,
  row: ReportRow,
  userId: string,
  promptContext: Record<string, unknown>,
  ai: Record<string, unknown>,
): Promise<void> {
  const channelId = String(
    env.DISCORD_ROOTMC_AI_ARCHIVE_CHANNEL_ID || DEFAULT_BLOCKNOTES_AI_ARCHIVE_CHANNEL_ID,
  ).trim();
  const token = String(env.DISCORD_ROOTMC_BOT_TOKEN || "")
    .replace(/^bot\s+/i, "")
    .trim();
  if (!/^\d{10,}$/.test(channelId) || token.length < 40) {
    console.warn("rootmc_world_ai_discord_skip", "bot token or archive channel not configured");
    return;
  }

  let stats: Record<string, unknown> = {};
  try {
    stats = JSON.parse(row.stats_json || "{}") as Record<string, unknown>;
  } catch {
    stats = {};
  }

  const summary = publicText(row.summary_text, 700);
  const report = publicText(row.report_text, 2400);
  const statsLine = [
    stats.note_count != null ? `${stats.note_count} notes` : null,
    stats.coord_count != null ? `${stats.coord_count} coords` : null,
    stats.build_plan_count != null ? `${stats.build_plan_count} build plans` : null,
  ]
    .filter(Boolean)
    .join("  -  ");

  const embed = {
    title: truncate(`RootMC world AI  -  ${row.world_name}`, 256),
    description: truncate(summary || " - ", 4000),
    color: 0x55aa55,
    fields: [
      { name: "World", value: truncate(row.world_name, 256), inline: true },
      { name: "World key", value: truncate(row.world_key, 256), inline: true },
      { name: "Account", value: truncate(userId, 256), inline: true },
      { name: "Model", value: truncate(str(row.model) || " - ", 256), inline: true },
      ...(statsLine ? [{ name: "Payload stats", value: statsLine, inline: true }] : []),
      { name: "Full report", value: truncate(report || " - ", 1024), inline: false },
    ],
    timestamp: row.created_at,
    footer: { text: `Report ${row.id.slice(0, 8)}` },
  };

  const archivePayload = {
    id: row.id,
    user_id: userId,
    world_key: row.world_key,
    world_name: row.world_name,
    created_at: row.created_at,
    summary_text: row.summary_text,
    report_text: row.report_text,
    stats,
    prompt: promptContext,
    ai,
  };

  const form = new FormData();
  form.set(
    "payload_json",
    JSON.stringify({
      content: `RootMC world AI copy  -  **${row.world_name}** (\`${row.id.slice(0, 8)}\`)`,
      embeds: [embed],
      allowed_mentions: { parse: [] },
    }),
  );
  form.set(
    "files[0]",
    new Blob([jsonForArchive(archivePayload)], { type: "application/json" }),
    `rootmc-world-ai-${row.id}.json`,
  );

  const res = await fetch(`https://discord.com/api/v10/channels/${encodeURIComponent(channelId)}/messages`, {
    method: "POST",
    headers: { Authorization: `Bot ${token}` },
    body: form,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    console.warn("rootmc_world_ai_discord", res.status, text.slice(0, 400));
  }
}

export function grokUserErrorMessage(detail: string, status?: number): string {
  if (detail.includes("HTTP ")) return grokErrorForUser(status || 503);
  return publicText(detail, 500);
}

async function responseForWorld(
  env: RootMcAiEnv,
  userId: string,
  worldKey: string,
  worldName: string,
  pro: boolean,
  dayUtc: string,
  monthUtc: string,
  status = 200,
): Promise<Response> {
  const usedDay = await usedToday(env.DB, userId, dayUtc);
  const usedMonth = await usedThisMonth(env.DB, userId, monthUtc);
  const reports = await latestReports(env.DB, userId, worldKey);
  return json(
    {
      world_key: worldKey,
      world_name: worldName,
      reports: reports.map(reportPayload),
      quota: quotaPayload(pro, usedDay, usedMonth, dayUtc, monthUtc),
      pro_unlocked: pro,
    },
    status,
  );
}

export async function handleRootMcWorldAi(
  request: Request,
  env: RootMcAiEnv,
  subpath: string,
  method: string,
  ctx?: ExecutionContext,
): Promise<Response | null> {
  if (subpath !== "/rootmc/world-ai") return null;

  const user = await resolveUserId(request, env);
  if (user instanceof Response) return user;

  const { pro } = await loadProFlags(env.DB, user);
  const dayUtc = utcDayKey();
  const monthUtc = utcMonthKey();

  let worldKey = "";
  let worldName = "";
  let worldPayload: Record<string, unknown> = {};

  if (method === "GET") {
    worldKey = new URL(request.url).searchParams.get("world_key") || "";
    worldName = new URL(request.url).searchParams.get("world_name") || "";
  } else if (method === "POST") {
    let body: { world_key?: string; world_name?: string; world_payload?: Record<string, unknown> };
    try {
      body = (await request.json()) as typeof body;
    } catch {
      return json({ detail: "Invalid JSON" }, 400);
    }
    worldKey = body.world_key || "";
    worldName = body.world_name || "";
    worldPayload = record(body.world_payload);
  } else {
    return null;
  }

  worldKey = worldKey.trim().slice(0, 128);
  worldName = truncate(worldName.trim() || "World", 120);
  if (!worldKey) return json({ detail: "world_key is required." }, 400);

  if (method === "GET") {
    return responseForWorld(env, user, worldKey, worldName || "World", pro, dayUtc, monthUtc);
  }

  const usedDay = await usedToday(env.DB, user, dayUtc);
  const usedMonth = await usedThisMonth(env.DB, user, monthUtc);

  if (pro) {
    if (usedMonth >= PRO_MONTHLY_AI_LIMIT) {
      return json(
        {
          detail: "quota_exceeded",
          message: `Pro members can generate up to ${PRO_MONTHLY_AI_LIMIT} world AI reports per month.`,
          quota: quotaPayload(pro, usedDay, usedMonth, dayUtc, monthUtc),
          pro_unlocked: true,
        },
        429,
      );
    }
  } else if (usedDay >= FREE_DAILY_AI_LIMIT) {
    return json(
      {
        detail: "quota_exceeded",
        message: "Free accounts can generate 1 world AI report per day. Upgrade for up to 100 per month.",
        quota: quotaPayload(pro, usedDay, usedMonth, dayUtc, monthUtc),
        pro_unlocked: false,
      },
      429,
    );
  }

  if (!Object.keys(worldPayload).length) {
    return json({ detail: "world_payload_required", message: "Send world data in world_payload." }, 400);
  }

  const compact = compactWorldPayload(worldPayload);
  const noteCount = Number(record(compact.stats).note_count || 0);
  if (
    noteCount <= 0 &&
    recordArray(compact.coordinates).length <= 0 &&
    recordArray(compact.build_plans).length <= 0
  ) {
    return json(
      {
        detail: "world_data_empty",
        message: "Add notes, coordinates, or build plans before generating a report.",
      },
      409,
    );
  }

  if (!worldName || worldName === "World") {
    worldName = truncate(str(record(compact.world).name) || "World", 120);
  }

  const priorRow = await latestRootMcReportBefore(env.DB, user, worldKey);
  const priorReport = previousReportForPrompt(priorRow);
  const promptContext = buildPromptContext(worldKey, worldName, compact, priorReport);
  const ai = await callRootMcWorldAi(env, promptContext);
  if (ai.fallback_report || ai.ok !== true) {
    const detail = str(ai.detail) || "World AI report is temporarily unavailable.";
    return json(
      {
        detail: "ai_unavailable",
        message: grokUserErrorMessage(detail, Number(ai.status) || 503),
        quota: quotaPayload(pro, usedDay, usedMonth, dayUtc, monthUtc),
        pro_unlocked: pro,
      },
      503,
    );
  }

  const row = await insertReport(
    env,
    user,
    worldKey,
    worldName,
    compact,
    promptContext,
    ai,
    dayUtc,
    monthUtc,
    priorRow?.id || null,
  );
  if (!row) return json({ detail: "Could not save AI report." }, 500);

  const discordJob = postWorldAiReportToDiscord(env, row, user, promptContext, ai).catch((e) =>
    console.warn("rootmc_world_ai_discord", String(e)),
  );
  if (ctx) ctx.waitUntil(discordJob);
  else await discordJob;

  const nextDay = await usedToday(env.DB, user, dayUtc);
  const nextMonth = await usedThisMonth(env.DB, user, monthUtc);
  const reports = await latestReports(env.DB, user, worldKey);

  return json(
    {
      world_key: worldKey,
      world_name: worldName,
      report: reportPayload(row),
      reports: reports.map(reportPayload),
      quota: quotaPayload(pro, nextDay, nextMonth, dayUtc, monthUtc),
      pro_unlocked: pro,
    },
    200,
  );
}
