import type { D1Database } from "@cloudflare/workers-types";

import { readUserAccountAccessFlags } from "./accounts";
import { buildKilaueaAnalysisDiscordBody, postKilaueaReportContent } from "./discord-kilauea-bot";
import { json, NWS_USER_AGENT } from "./cors";
import {
  attachEarthquakeActivity,
  eventsToLegacyRecords,
  fetchHawaiiEarthquakeEvents,
  formatEarthquakeActivitySection,
  KILAUEA_EQ_COUNT_MIN_MAG,
  slimEarthquakeContextForAi,
  type EarthquakeActivitySummary,
} from "./kilauea-earthquake-stats";
import { archiveContextJson } from "./kilauea-archive-context";
import {
  fetchOfficialKilaueaXUpdates,
  filterKilaueaRelevantOfficialXPosts,
  KILAUEA_BRIEF_SCOPE_INSTRUCTION,
} from "./kilauea-official-x";
import { sessionFromRequest } from "./primary-auth";
import { tsunamiBulletins } from "./weather";

const KILAUEA_SUMMIT_LAT = 19.4205;
const KILAUEA_SUMMIT_LON = -155.287;
const HAWAII_BBOX = {
  minlatitude: 18.8,
  maxlatitude: 22.6,
  minlongitude: -161.0,
  maxlongitude: -154.5,
};

const HANS_BASE = "https://volcanoes.usgs.gov/hans-public/api/volcano";
const VNUM_KILAUEA = "332010";
const EQ_CONTEXT_MIN_MAG = KILAUEA_EQ_COUNT_MIN_MAG;
const EQ_TRIGGER_MIN_MAG = 3.5;
const REPORT_LIMIT = 20;
const DISCORD_LIMIT = 1800;

type AiEnv = {
  DB: D1Database;
  JWT_SECRET: string;
  GROK_API_BEARER_TOKEN?: string;
  GROK_X_BEARER_TOKEN?: string;
  GROK_API_URL?: string;
  GROK_MODEL?: string;
  DISCORD_KILAUEA_USGS_WEBHOOK_URL?: string;
  DISCORD_GUILD_ID?: string;
  DISCORD_DEVELOPER_ROLE_ID?: string;
  DISCORD_KILAUEA_REPORT_CHANNEL_ID?: string;
  DISCORD_KILAUEA_AI_ARCHIVE_CHANNEL_ID?: string;
  DISCORD_KILAUEA_BOT_TOKEN?: string;
  DISCORD_BOT_TOKEN?: string;
};

type AnalysisRow = {
  id: string;
  source_type: string;
  source_id: string;
  source_time: string | null;
  severity: string | null;
  event: string | null;
  magnitude: number | null;
  headline: string | null;
  url: string | null;
  free_text: string;
  pro_text: string;
  model: string | null;
  prompt_json: string;
  response_json: string;
  prior_report_id: string | null;
  discord_posted_at: string | null;
  created_at: string;
};

type TriggerEvent = {
  source_type: "volcano" | "nws" | "earthquake" | "tsunami" | "manual";
  source_id: string;
  source_time?: string;
  severity?: string;
  event?: string;
  magnitude?: number;
  headline: string;
  url?: string;
  payload: Record<string, unknown>;
};

type OfficialContext = {
  generated_at: string;
  trigger: TriggerEvent;
  previous_report: Record<string, unknown> | null;
  volcano: Record<string, unknown>;
  active_warning_advisories: Array<Record<string, unknown>>;
  hawaii_earthquakes: Array<Record<string, unknown>>;
  earthquake_activity?: Record<string, unknown>;
  pacific_tsunami_bulletins: Record<string, unknown>;
  official_x_updates: Record<string, unknown>;
};

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

function num(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function isoFromMs(v: unknown): string | undefined {
  const n = num(v);
  return n != null && n > 0 ? new Date(n).toISOString() : undefined;
}

function jsonForArchive(v: unknown): string {
  return JSON.stringify(v, (_k, value) => (typeof value === "bigint" ? value.toString() : value));
}

function truncate(s: string, max: number): string {
  const t = s.trim();
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
}

function publicReportText(raw: unknown, max: number): string {
  return truncate(
    String(raw ?? "")
      .replace(/\bGrok\b/gi, "AI")
      .replace(/\bxAI\b/g, "AI")
      .replace(/\bAva Ivy\b/gi, "")
      .replace(/\bAva\b/g, "")
      .replace(/\bOptiPlex\b/gi, "")
      .replace(/\bRoot Server\b/gi, "")
      .replace(/\bMariaDB\b/gi, "")
      .replace(/\bCursor\b/g, "")
      .replace(/\s{2,}/g, " ")
      .trim(),
    max,
  );
}

function cleanDisplayText(raw: unknown, max = 700): string {
  const s = String(raw ?? "")
    .replace(/&mdash;/g, "—")
    .replace(/&ndash;/g, "–")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<\/p>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return truncate(s, max);
}

function synopsisWithoutHeadlineForFallback(headline: string, synopsis: string): string {
  if (!synopsis) return "";
  const h = headline.toLowerCase();
  let s = synopsis;
  if (h && s.toLowerCase().startsWith(h)) {
    s = s.slice(h.length).replace(/^[\s:—-]+/, "").trim();
  }
  return s || synopsis;
}

function recordArray(raw: unknown): Array<Record<string, unknown>> {
  return Array.isArray(raw) ? raw.filter((x): x is Record<string, unknown> => Boolean(x && typeof x === "object" && !Array.isArray(x))) : [];
}

function fmtIso(raw: unknown): string {
  const s = str(raw);
  if (s) return s.replace("T", " ").replace(/\.\d{3}Z$/, " UTC");
  const n = num(raw);
  return n && n > 0 ? new Date(n).toISOString().replace("T", " ").replace(/\.\d{3}Z$/, " UTC") : "";
}

async function sha256Short(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 24);
}

async function fetchJson(url: string): Promise<Record<string, unknown>> {
  const r = await fetch(url, {
    headers: { "User-Agent": NWS_USER_AGENT, Accept: "application/json" },
  });
  if (!r.ok) throw new Error(`fetch_${r.status}`);
  return (await r.json()) as Record<string, unknown>;
}

async function fetchVolcanoContext(): Promise<Record<string, unknown>> {
  const [volcano, newest, recent] = await Promise.all([
    fetchJson(`${HANS_BASE}/getVolcano/${VNUM_KILAUEA}`).catch((e) => ({ error: String(e) })),
    fetchJson(`${HANS_BASE}/newestForVolcano/${VNUM_KILAUEA}`).catch((e) => ({ error: String(e) })),
    fetchJson(`${HANS_BASE}/recentForVolcano/${VNUM_KILAUEA}?limit=10`).catch((e) => ({ error: String(e) })),
  ]);
  return { volcano, newest, recent };
}

async function fetchWarningAdvisories(): Promise<Array<Record<string, unknown>>> {
  const url = "https://api.weather.gov/alerts/active?area=HI&status=actual";
  const data = await fetchJson(url).catch(() => ({ features: [] }));
  const features = Array.isArray(data.features) ? (data.features as Array<Record<string, unknown>>) : [];
  return features
    .map((f) => {
      const p = (f.properties as Record<string, unknown>) || {};
      return {
        id: str(f.id) || str(p.id) || str(p.uri),
        event: str(p.event),
        severity: str(p.severity),
        headline: str(p.headline) || str(p.event),
        description: truncate(str(p.description), 1200),
        instruction: truncate(str(p.instruction), 800),
        areaDesc: str(p.areaDesc),
        effective: p.effective || p.sent || null,
        expires: p.expires || null,
        uri: str(p.uri),
      };
    })
    .filter((a) => /warning|advisory/i.test(`${a.event} ${a.severity} ${a.headline}`));
}

async function fetchHawaiiEarthquakes(minMag: number): Promise<Array<Record<string, unknown>>> {
  const result = await fetchHawaiiEarthquakeEvents(minMag);
  return eventsToLegacyRecords(result.events);
}

async function fetchHawaiiEarthquakeBundle(minMag: number): Promise<{
  earthquakes: Array<Record<string, unknown>>;
  source: Record<string, unknown>;
}> {
  const result = await fetchHawaiiEarthquakeEvents(minMag);
  return {
    earthquakes: eventsToLegacyRecords(result.events),
    source: {
      ok: result.ok,
      url: result.url,
      count: result.events.length,
      error: result.error || null,
    },
  };
}

async function fetchOfficialXUpdates(env: Pick<AiEnv, "GROK_X_BEARER_TOKEN">): Promise<Record<string, unknown>> {
  return fetchOfficialKilaueaXUpdates(env);
}

function newestVolcanoTrigger(volcano: Record<string, unknown>): TriggerEvent | null {
  const newest = (volcano.newest as Record<string, unknown>) || {};
  if (!newest || Object.keys(newest).length === 0 || newest.error) return null;
  const title =
    str(newest.Subject) ||
    str(newest.title) ||
    str(newest.Title) ||
    str(newest.MessageType) ||
    "USGS Kīlauea volcano notice";
  return {
    source_type: "volcano",
    source_id: "",
    source_time: str(newest.SentUTC) || str(newest.sent) || str(newest.Date) || undefined,
    severity: str(newest.AlertLevel) || str(newest.ColorCode) || undefined,
    event: "USGS volcano notice",
    headline: title,
    url: "https://www.usgs.gov/volcanoes/kilauea",
    payload: newest,
  };
}

async function buildTriggers(ctx: Omit<OfficialContext, "trigger" | "previous_report">): Promise<TriggerEvent[]> {
  const out: TriggerEvent[] = [];
  const volcano = newestVolcanoTrigger(ctx.volcano);
  if (volcano) {
    volcano.source_id = await sha256Short(jsonForArchive(volcano.payload));
    out.push(volcano);
  }
  for (const a of ctx.active_warning_advisories) {
    const sourceId = str(a.id) || (await sha256Short(jsonForArchive(a)));
    out.push({
      source_type: "nws",
      source_id: sourceId,
      source_time: str(a.effective) || undefined,
      severity: str(a.severity),
      event: str(a.event),
      headline: str(a.headline) || "NWS Hawaiʻi Warning/Advisory",
      url: str(a.uri),
      payload: a,
    });
  }
  for (const q of ctx.hawaii_earthquakes) {
    const mag = num(q.magnitude);
    if (mag == null || mag < EQ_TRIGGER_MIN_MAG) continue;
    const when = Date.parse(String(q.time_iso || q.time || ""));
    if (!Number.isFinite(when) || when < Date.now() - 14 * 86400000) continue;
    out.push({
      source_type: "earthquake",
      source_id: str(q.id) || await sha256Short(jsonForArchive(q)),
      source_time: str(q.time_iso) || undefined,
      magnitude: mag,
      event: mag >= 4 ? "M4+ Hawaiʻi earthquake" : "M3.5+ Hawaiʻi earthquake",
      headline: `M ${mag.toFixed(1)} — ${str(q.place) || "Hawaiʻi region"}`,
      url: str(q.url),
      payload: q,
    });
  }
  const tsunami = ctx.pacific_tsunami_bulletins;
  const bulletins = Array.isArray(tsunami.bulletins) ? (tsunami.bulletins as Array<Record<string, unknown>>) : [];
  for (const b of bulletins) {
    const sourceId = str(b.id) || await sha256Short(jsonForArchive(b));
    out.push({
      source_type: "tsunami",
      source_id: sourceId,
      source_time: isoFromMs(b.time) || undefined,
      severity: str(b.alert),
      event: "Pacific tsunami bulletin",
      headline: str(b.title) || str(b.place) || "Pacific tsunami bulletin",
      url: str(b.url),
      payload: b,
    });
  }
  return out;
}

async function latestReport(db: D1Database): Promise<AnalysisRow | null> {
  const row = await db
    .prepare(`SELECT * FROM kilauea_ai_analyses ORDER BY created_at DESC LIMIT 1`)
    .first<AnalysisRow>();
  return row || null;
}

async function reportExists(db: D1Database, sourceType: string, sourceId: string): Promise<boolean> {
  const row = await db
    .prepare(`SELECT id FROM kilauea_ai_analyses WHERE source_type = ? AND source_id = ? LIMIT 1`)
    .bind(sourceType, sourceId)
    .first<{ id: string }>();
  return Boolean(row?.id);
}

function previousReportForPrompt(row: AnalysisRow | null): Record<string, unknown> | null {
  if (!row) return null;
  return {
    id: row.id,
    created_at: row.created_at,
    source_type: row.source_type,
    headline: row.headline,
    free_text: row.free_text,
    pro_text: row.pro_text,
  };
}

function parseAiJson(content: string): { free_text: string; pro_text: string } {
  const cleaned = content.replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  const candidate = start >= 0 && end > start ? cleaned.slice(start, end + 1) : cleaned;
  const obj = JSON.parse(candidate) as Record<string, unknown>;
  return {
    free_text: publicReportText(str(obj.free_text), 6000),
    pro_text: publicReportText(str(obj.pro_text), 14000),
  };
}

function fallbackAnalysis(ctx: OfficialContext, detail: string): Record<string, unknown> {
  const trigger = ctx.trigger;
  const prior = ctx.previous_report;
  const payload = trigger.payload || {};
  const quakes = [...ctx.hawaii_earthquakes]
    .filter((q) => num(q.magnitude) != null)
    .sort((a, b) => (num(b.magnitude) || 0) - (num(a.magnitude) || 0));
  const top = quakes[0];
  const mag = trigger.magnitude ?? num(payload.magnitude);
  const place = str(payload.place) || str(trigger.headline).replace(/^M\s*[\d.]+\s*[—-]\s*/i, "") || "Hawaiʻi region";
  const triggerTime = fmtIso(trigger.source_time || payload.time_iso || payload.time);
  const depth = num(payload.depth_km);
  const tsunamiFlag =
    payload.tsunami === true || payload.tsunami === 1
      ? "The USGS event payload includes a tsunami flag; verify PTWC/official tsunami products for coastal hazard details."
      : "The USGS event payload did not set a tsunami flag.";
  const previousLine = prior
    ? `Since the previous report (${str(prior.id).slice(0, 8) || "previous"}, ${fmtIso(prior.created_at)}), this report adds ${trigger.event || trigger.source_type}: ${trigger.headline}.`
    : `This is the first stored comparison report for this trigger stream.`;
  const relatedQuakes = quakes
    .slice(0, 4)
    .map((q) => {
      const qMag = num(q.magnitude);
      return `M${qMag != null ? qMag.toFixed(1) : "?"} ${str(q.place) || "Hawaiʻi region"}${fmtIso(q.time_iso || q.time) ? ` (${fmtIso(q.time_iso || q.time)})` : ""}`;
    })
    .join("; ");
  const warnings = ctx.active_warning_advisories.length
    ? `${ctx.active_warning_advisories.length} active NWS warning/advisory item(s) are in the current context.`
    : "No active Hawaiʻi NWS warning/advisory item was returned in this pull.";
  const tsunami = recordArray(ctx.pacific_tsunami_bulletins.bulletins).length
    ? `${recordArray(ctx.pacific_tsunami_bulletins.bulletins).length} tsunami-flagged significant earthquake item(s) were returned in the Pacific context.`
    : "No tsunami-flagged significant earthquake item was returned in the Pacific context.";
  const xUpdates = filterKilaueaRelevantOfficialXPosts(
    recordArray((ctx.official_x_updates as Record<string, unknown> | undefined)?.posts),
  ).slice(0, 6);
  const volcanoNote = synopsisWithoutHeadlineForFallback(
    cleanDisplayText(
      (ctx.volcano.newest as Record<string, unknown> | undefined)?.noticeTitle ||
        (ctx.volcano.newest as Record<string, unknown> | undefined)?.Subject ||
        "",
      200,
    ),
    cleanDisplayText(
      (ctx.volcano.newest as Record<string, unknown> | undefined)?.noticeSynopsis ||
        (ctx.volcano.newest as Record<string, unknown> | undefined)?.Synopsis ||
        (ctx.volcano.newest as Record<string, unknown> | undefined)?.summary ||
        "",
      1400,
    ),
  );

  const free = [
    "AI-assisted brief; not an official USGS/HVO/NWS release.",
    previousLine,
    trigger.source_type === "earthquake"
      ? `Trigger: M${mag != null ? mag.toFixed(1) : "?"} near ${place}${triggerTime ? ` (${triggerTime})` : ""}.`
      : `Trigger: ${trigger.headline}.`,
    volcanoNote ? `Volcano: ${volcanoNote}` : "",
    warnings.includes("No active") ? "" : warnings,
  ].filter(Boolean).join(" ");

  const proParts = [
    ctx.earthquake_activity
      ? formatEarthquakeActivitySection(ctx.earthquake_activity as EarthquakeActivitySummary)
      : top
        ? `**Seismic context:** ${relatedQuakes}.`
        : "",
    tsunami.includes("No tsunami") ? "" : tsunami,
  ].filter(Boolean);
  const socialBlock = xUpdates.length
    ? [
        "**Official social**",
        ...xUpdates.map((p) => {
          const text = cleanDisplayText(p.text, 500);
          return text ? `• ${str(p.account) || "Official"}: ${text}` : "";
        }).filter(Boolean),
      ].join("\n")
    : "";

  return {
    ok: false,
    fallback_report: true,
    detail,
    free_text: publicReportText(free, 4000),
    pro_text: publicReportText([...proParts, socialBlock].filter(Boolean).join("\n\n"), 16000),
  };
}

function grokResponseText(response: Record<string, unknown>): string {
  const message = (response.choices as Array<Record<string, unknown>> | undefined)?.[0]?.message as Record<string, unknown> | undefined;
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

function grokErrorText(response: Record<string, unknown>, status: number): string {
  const error = response.error as Record<string, unknown> | string | undefined;
  if (typeof error === "string" && error.trim()) return `HTTP ${status}: ${error.trim()}`;
  if (error && typeof error === "object") {
    const message = String(error.message || error.detail || error.code || "").trim();
    if (message) return `HTTP ${status}: ${message}`;
  }
  const detail = String(response.detail || response.message || "").trim();
  return detail ? `HTTP ${status}: ${detail}` : `HTTP ${status}: empty Grok response`;
}

async function callGrok(env: AiEnv, ctx: OfficialContext): Promise<Record<string, unknown>> {
  const token = String(env.GROK_API_BEARER_TOKEN || "").trim();
  const apiUrl = String(env.GROK_API_URL || "https://api.x.ai/v1/chat/completions").trim();
  const model = String(env.GROK_MODEL || "grok-3-latest").trim();
  const body = {
    model,
    messages: [
      {
        role: "system",
        content:
          "You write Kīlauea Alerts hazard briefs for a public safety-adjacent app. Synthesize all provided official feeds into one professional situation report. " +
          `${KILAUEA_BRIEF_SCOPE_INSTRUCTION} ` +
          "Do NOT repeat the same HVO/USGS notice text in multiple fields. State alert level and aviation color once, summarize volcano activity briefly (no weather in activity), then use earthquake_activity: recent rolling windows for current seismic context; counts are M1.0+ USGS events in the Hawaiʻi region — include the count requirements description under seismic headers. Calendar year totals are historical only. " +
          "Do not cite prior-calendar-year events as current activity. Skip empty or off-topic official social posts. " +
          "Compare to previous_report in one sentence when present. Be calm and specific; cite agencies by name. " +
          "Do not give evacuation, medical, legal, or emergency instructions beyond directing users to official agencies. " +
          "Never mention Grok, xAI, model names, API keys, or provider errors in public text. " +
          'Return JSON only: {"free_text":"public brief, no repetition","pro_text":"seismic windows, watch items, official social — details not repeated from free_text"}',
      },
      { role: "user", content: jsonForArchive(slimEarthquakeContextForAi(ctx as unknown as Record<string, unknown>)) },
    ],
    temperature: 0.2,
  };
  if (!token) {
    return { ...fallbackAnalysis(ctx, "Grok API bearer token is not configured."), model, request: body };
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
      return {
        ...fallbackAnalysis(ctx, detail),
        status: res.status,
        model,
        detail,
        request: body,
        response,
        content: "",
      };
    }
    try {
      const parsed = parseAiJson(content);
      return { ok: res.ok, status: res.status, model, request: body, response, content, ...parsed };
    } catch (e) {
      const detail = `Grok response was not parseable JSON: ${e instanceof Error ? e.message : String(e)}`;
      return { ...fallbackAnalysis(ctx, detail), status: res.status, model, request: body, response, content };
    }
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    return { ...fallbackAnalysis(ctx, detail), model, detail, request: body };
  }
}

async function insertReport(
  env: AiEnv,
  trigger: TriggerEvent,
  prior: AnalysisRow | null,
  ctx: OfficialContext,
  ai: Record<string, unknown>,
): Promise<AnalysisRow | null> {
  const id = crypto.randomUUID();
  const nowIso = ctx.generated_at;
  const freeText = str(ai.free_text) || "AI analysis did not return a public preview.";
  const proText = str(ai.pro_text) || "AI analysis did not return a Pro continuation.";
  // Bounded copy only — the same context is stored once per trigger, and the unslimmed blobs
  // filled D1 to its 500MB cap twice. Full payload goes to the Discord raw archive instead.
  const archiveJson = archiveContextJson(ctx as unknown as Record<string, unknown>);
  await env.DB.prepare(
    `INSERT INTO kilauea_ai_analyses
     (id, source_type, source_id, source_time, severity, event, magnitude, headline, url,
      free_text, pro_text, model, prompt_json, response_json, prior_report_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(source_type, source_id) DO NOTHING`,
  )
    .bind(
      id,
      trigger.source_type,
      trigger.source_id,
      trigger.source_time || null,
      trigger.severity || null,
      trigger.event || null,
      trigger.magnitude ?? null,
      trigger.headline,
      trigger.url || null,
      freeText,
      proText,
      str(ai.model) || null,
      archiveJson,
      jsonForArchive(ai),
      prior?.id || null,
      nowIso,
    )
    .run();
  const row = await env.DB
    .prepare(`SELECT * FROM kilauea_ai_analyses WHERE source_type = ? AND source_id = ? LIMIT 1`)
    .bind(trigger.source_type, trigger.source_id)
    .first<AnalysisRow>();
  return row || null;
}

function officialPostsFromPromptJson(raw: string | null | undefined): Array<Record<string, unknown>> {
  try {
    const prompt = JSON.parse(String(raw || "{}")) as Record<string, unknown>;
    const officialX = (prompt.official_x_updates as Record<string, unknown> | undefined) || {};
    return filterKilaueaRelevantOfficialXPosts(recordArray(officialX.posts));
  } catch {
    return [];
  }
}

async function postReportToDiscord(env: AiEnv, row: AnalysisRow): Promise<void> {
  if (row.discord_posted_at) return;
  const officialPosts = officialPostsFromPromptJson(row.prompt_json);
  const content = buildKilaueaAnalysisDiscordBody(row, { officialPosts });
  const posted = await postKilaueaReportContent(env, content, { sourceId: row.id });
  if (posted) {
    await env.DB.prepare(`UPDATE kilauea_ai_analyses SET discord_posted_at = ? WHERE id = ?`)
      .bind(new Date().toISOString(), row.id)
      .run();
  }
}

async function archiveRawAiDataToDiscord(
  env: AiEnv,
  row: AnalysisRow,
  fullPrompt?: unknown,
): Promise<void> {
  const channelId = String(env.DISCORD_KILAUEA_AI_ARCHIVE_CHANNEL_ID || "1545283818146242642").trim();
  const token = String(env.DISCORD_KILAUEA_BOT_TOKEN || env.DISCORD_BOT_TOKEN || "").replace(/^bot\s+/i, "").trim();
  if (!/^\d{10,}$/.test(channelId) || token.length < 40) return;
  const payload = {
    id: row.id,
    source_type: row.source_type,
    source_id: row.source_id,
    headline: row.headline,
    created_at: row.created_at,
    // D1 stores a capped context, so archive the caller's full context when it is available.
    prompt: fullPrompt ?? JSON.parse(row.prompt_json || "{}"),
    response: JSON.parse(row.response_json || "{}"),
  };
  const form = new FormData();
  form.set(
    "payload_json",
    JSON.stringify({
      content: `Kīlauea AI raw archive ${row.id.slice(0, 8)} — ${row.headline || row.source_type}`,
      allowed_mentions: { parse: [] },
    }),
  );
  form.set("files[0]", new Blob([jsonForArchive(payload)], { type: "application/json" }), `kilauea-ai-${row.id}.json`);
  await fetch(`https://discord.com/api/v10/channels/${channelId}/messages`, {
    method: "POST",
    headers: { Authorization: `Bot ${token}` },
    body: form,
  }).catch((e) => console.warn("kilauea_ai_raw_archive_discord", String(e)));
}

export async function runKilaueaAiAnalysisCron(env: AiEnv): Promise<void> {
  const eqBundle = await fetchHawaiiEarthquakeBundle(EQ_CONTEXT_MIN_MAG);
  const baseContext = {
    generated_at: new Date().toISOString(),
    volcano: await fetchVolcanoContext(),
    active_warning_advisories: await fetchWarningAdvisories(),
    hawaii_earthquakes: eqBundle.earthquakes,
    pacific_tsunami_bulletins: await tsunamiBulletins().catch((e) => ({ available: false, error: String(e), bulletins: [] })),
    official_x_updates: await fetchOfficialXUpdates(env),
  };
  const triggers = await buildTriggers(baseContext);
  for (const trigger of triggers) {
    if (await reportExists(env.DB, trigger.source_type, trigger.source_id)) continue;
    const prior = await latestReport(env.DB);
    const ctx: OfficialContext = {
      ...baseContext,
      trigger,
      previous_report: previousReportForPrompt(prior),
    };
    ctx.earthquake_activity = attachEarthquakeActivity(ctx as unknown as Record<string, unknown>, prior?.created_at ?? null);
    const ai = await callGrok(env, ctx);
    const row = await insertReport(env, trigger, prior, ctx, ai);
    if (row) {
      await postReportToDiscord(env, row).catch((e) => console.warn("kilauea_ai_discord", String(e)));
      await archiveRawAiDataToDiscord(env, row, ctx).catch((e) => console.warn("kilauea_ai_archive", String(e)));
    }
  }
}

export async function runKilaueaAiManualReport(
  env: AiEnv,
  requestedByDiscordId: string,
): Promise<AnalysisRow | null> {
  const now = new Date();
  const ymd = now.toISOString().slice(0, 10);
  const requester = requestedByDiscordId.replace(/[^0-9]/g, "").slice(0, 32) || "unknown";
  const manualRunId = crypto.randomUUID();
  const eqBundle = await fetchHawaiiEarthquakeBundle(EQ_CONTEXT_MIN_MAG);
  const baseContext = {
    generated_at: now.toISOString(),
    volcano: await fetchVolcanoContext(),
    active_warning_advisories: await fetchWarningAdvisories(),
    hawaii_earthquakes: eqBundle.earthquakes,
    pacific_tsunami_bulletins: await tsunamiBulletins().catch((e) => ({ available: false, error: String(e), bulletins: [] })),
    official_x_updates: await fetchOfficialXUpdates(env),
  };
  const trigger: TriggerEvent = {
    source_type: "manual",
    source_id: `manual:${ymd}:${requester}:${manualRunId}`,
    source_time: now.toISOString(),
    event: "Manual /kilauea report",
    headline: "Manual Kīlauea AI analysis",
    payload: { requested_by_discord_id: requester, requested_at: now.toISOString() },
  };
  const existing = await env.DB
    .prepare(`SELECT * FROM kilauea_ai_analyses WHERE source_type = ? AND source_id = ? LIMIT 1`)
    .bind(trigger.source_type, trigger.source_id)
    .first<AnalysisRow>();
  if (existing) return existing;
  const prior = await latestReport(env.DB);
  const ctx: OfficialContext = {
    ...baseContext,
    trigger,
    previous_report: previousReportForPrompt(prior),
  };
  ctx.earthquake_activity = attachEarthquakeActivity(ctx as unknown as Record<string, unknown>, prior?.created_at ?? null);
  const ai = await callGrok(env, ctx);
  const row = await insertReport(env, trigger, prior, ctx, ai);
  if (row) {
    await postReportToDiscord(env, row).catch((e) => console.warn("kilauea_ai_manual_discord", String(e)));
    await archiveRawAiDataToDiscord(env, row, ctx).catch((e) => console.warn("kilauea_ai_manual_archive", String(e)));
  }
  return row;
}

export async function handleKilaueaAiManualRun(request: Request, env: AiEnv): Promise<Response> {
  let body: { requested_by_discord_id?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    body = {};
  }
  try {
    const row = await runKilaueaAiManualReport(env, String(body.requested_by_discord_id || ""));
    return json(
      {
        ok: Boolean(row),
        report: row
          ? {
              id: row.id,
              headline: row.headline,
              source_type: row.source_type,
              created_at: row.created_at,
              discord_posted_at: row.discord_posted_at,
            }
          : null,
      },
      row ? 200 : 500,
    );
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    console.error(JSON.stringify({ msg: "kilauea_ai_manual_run_failed", v: 1, err: detail.slice(0, 800) }));
    return json({ ok: false, detail: detail.slice(0, 500) }, 500);
  }
}

async function isProRequest(request: Request, env: AiEnv): Promise<boolean | Response> {
  const sess = await sessionFromRequest(env, request);
  if (!sess) {
    return false;
  }
  const email = str(sess.email).toLowerCase();
  if (!email) return false;
  const flags = await readUserAccountAccessFlags(env.DB, email).catch(() => null);
  if (flags && (flags.pro_unlocked || flags.life_member)) return true;
  const developerUnlimited = await linkedDiscordUserHasRole(
    env,
    sess.accountId,
    env.DISCORD_DEVELOPER_ROLE_ID,
  ).catch(() => false);
  return developerUnlimited;
}

async function linkedDiscordUserHasRole(env: AiEnv, accountId: string, roleId: string | undefined): Promise<boolean> {
  const token = String(env.DISCORD_KILAUEA_BOT_TOKEN || env.DISCORD_BOT_TOKEN || "").replace(/^bot\s+/i, "").trim();
  const guildId = String(env.DISCORD_GUILD_ID || "").trim();
  const rid = String(roleId || "").trim();
  if (!token || !guildId || !accountId || !rid) return false;
  const link = await env.DB.prepare("SELECT discord_user_id FROM discord_account_links WHERE account_id = ?")
    .bind(accountId)
    .first<{ discord_user_id: string }>();
  const uid = String(link?.discord_user_id || "").trim();
  if (!uid) return false;
  const res = await fetch(`https://discord.com/api/v10/guilds/${encodeURIComponent(guildId)}/members/${encodeURIComponent(uid)}`, {
    headers: { Authorization: `Bot ${token}`, "User-Agent": "RootRecordKilaueaAI (developer role)" },
  });
  if (!res.ok) return false;
  const member = (await res.json().catch(() => ({}))) as { roles?: unknown };
  const roles = Array.isArray(member.roles) ? member.roles.map((r) => String(r)) : [];
  return roles.includes(rid);
}

export async function handleKilaueaAiAnalysesGet(request: Request, env: AiEnv): Promise<Response> {
  const pro = await isProRequest(request, env);
  if (pro instanceof Response) return pro;
  const url = new URL(request.url);
  const limit = Math.min(REPORT_LIMIT, Math.max(1, Math.floor(Number(url.searchParams.get("limit") || "10"))));
  const page = Math.max(1, Math.floor(Number(url.searchParams.get("page") || "1")));
  const skipFirst = url.searchParams.get("skip_first") === "1";
  const offset = skipFirst ? 1 + (page - 1) * limit : (page - 1) * limit;
  const fullText = url.searchParams.get("full") === "1" || (limit === 1 && page === 1 && !skipFirst);
  const freeMax = fullText ? 8000 : 1400;
  const proMax = fullText ? 8000 : 2400;

  const totalRow = await env.DB.prepare(`SELECT COUNT(*) AS total FROM kilauea_ai_analyses`)
    .first<{ total: number }>()
    .catch(() => null);
  const total = Number(totalRow?.total || 0);
  const listTotal = skipFirst ? Math.max(0, total - 1) : total;
  const totalPages = listTotal > 0 ? Math.ceil(listTotal / limit) : 1;

  const { results } = await env.DB.prepare(
    `SELECT * FROM kilauea_ai_analyses ORDER BY created_at DESC LIMIT ? OFFSET ?`,
  )
    .bind(limit, offset)
    .all<AnalysisRow>();

  const reports = (results || []).map((r) => {
    const free = publicReportText(r.free_text, freeMax);
    const proBody = pro ? publicReportText(r.pro_text, proMax) : null;
    const combined = [free, proBody].filter(Boolean).join("\n\n").trim();
    return {
      id: r.id,
      source_type: r.source_type,
      source_id: r.source_id,
      source_time: r.source_time,
      severity: r.severity,
      event: r.event,
      magnitude: r.magnitude,
      headline: r.headline,
      url: r.url,
      free_text: free,
      pro_text: proBody,
      body: combined,
      summary: publicReportText(combined || r.headline || r.event || "", fullText ? 8000 : 480),
      pro_locked: !pro,
      prior_report_id: r.prior_report_id,
      previous_summary: r.prior_report_id ? "Compared with the previous Kīlauea AI report." : null,
      created_at: r.created_at,
      discord_posted_at: r.discord_posted_at,
    };
  });

  return json(
    {
      reports,
      pro_unlocked: pro,
      page,
      limit,
      offset,
      skip_first: skipFirst,
      total,
      list_total: listTotal,
      total_pages: totalPages,
      has_prev: page > 1,
      has_next: page < totalPages,
    },
    200,
  );
}
