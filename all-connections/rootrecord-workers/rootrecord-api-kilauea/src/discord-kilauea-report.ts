import type { D1Database } from "@cloudflare/workers-types";
import { getFcmAccessToken, sendFcmNotification } from "./fcm-v1";
import {
  buildKilaueaAnalysisDiscordBody,
  formatOfficialSocialSection,
  kilaueaBotToken,
  postKilaueaDiscordMessage,
  postKilaueaReportContent,
  stripOfficialSocialSection,
} from "./discord-kilauea-bot";
import {
  attachEarthquakeActivity,
  eventsToLegacyRecords,
  fetchHawaiiEarthquakeEvents,
  formatEarthquakeActivitySection,
  KILAUEA_EQ_COUNT_MIN_MAG,
  peakMagnitude,
  slimEarthquakeContextForAi,
  type EarthquakeActivitySummary,
} from "./kilauea-earthquake-stats";
import { archiveContextJson } from "./kilauea-archive-context";
import {
  fetchOfficialKilaueaXUpdates,
  filterKilaueaRelevantOfficialXPosts,
  KILAUEA_BRIEF_SCOPE_INSTRUCTION,
} from "./kilauea-official-x";

export type KilaueaReportEnv = {
  DB: D1Database;
  GROK_API_BEARER_TOKEN?: string;
  GROK_X_BEARER_TOKEN?: string;
  GROK_API_URL?: string;
  GROK_MODEL?: string;
  DISCORD_KILAUEA_BOT_TOKEN?: string;
  DISCORD_BOT_TOKEN?: string;
  DISCORD_GUILD_ID?: string;
  DISCORD_DEVELOPER_ROLE_ID?: string;
  DISCORD_LIFETIME_MEMBER_ROLE_ID?: string;
  DISCORD_MONTHLY_MEMBER_ROLE_ID?: string;
  DISCORD_KILAUEA_REPORT_CHANNEL_ID?: string;
  DISCORD_KILAUEA_AI_ARCHIVE_CHANNEL_ID?: string;
  DISCORD_KILAUEA_USGS_WEBHOOK_URL?: string;
  FCM_SERVICE_ACCOUNT_JSON?: string;
  FCM_PROJECT_ID?: string;
  FCM_CLIENT_EMAIL?: string;
  FCM_PRIVATE_KEY?: string;
};

const HANS_BASE = "https://volcanoes.usgs.gov/hans-public/api/volcano";
const VNUM_KILAUEA = "332010";
const KILAUEA_SUMMIT_LAT = 19.4205;
const KILAUEA_SUMMIT_LON = -155.287;
const HAWAII_BBOX = {
  minlatitude: 18.8,
  maxlatitude: 22.6,
  minlongitude: -161.0,
  maxlongitude: -154.5,
};
const KILAUEA_ANDROID_APP_ID = "rootrecord_kilauea_alerts_android";

function memberRoleSet(member: Record<string, unknown> | undefined): Set<string> {
  const roles = Array.isArray(member?.roles) ? (member.roles as unknown[]) : [];
  return new Set(roles.map((r) => String(r)));
}

function interactionResponse(
  type: number,
  data?: { content?: string; flags?: number },
): Response {
  return new Response(JSON.stringify(data ? { type, data } : { type }), {
    status: 200,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

async function hasKilaueaCommandAccess(member: Record<string, unknown> | undefined, env: KilaueaReportEnv): Promise<boolean> {
  if (await hasDeveloperRole(member, env)) return true;
  const roles = memberRoleSet(member);
  const allowed = [
    env.DISCORD_LIFETIME_MEMBER_ROLE_ID,
    env.DISCORD_MONTHLY_MEMBER_ROLE_ID,
  ].map((x) => String(x || "").trim()).filter(Boolean);
  return allowed.some((roleId) => roles.has(roleId));
}

async function markKilaueaReportUsed(
  env: KilaueaReportEnv,
  discordUserId: string,
  interactionId: string,
  channelId: string,
  guildId: string,
  response: Record<string, unknown>,
): Promise<void> {
  const id = crypto.randomUUID();
  const nowIso = new Date().toISOString();
  await env.DB.prepare(
    `INSERT INTO discord_ai_reports
     (id, command_name, interaction_id, channel_id, guild_id, requested_by_discord_id, prompt_json, response_json, created_at)
     VALUES (?, '/kilauea', ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      id,
      interactionId,
      channelId,
      guildId,
      discordUserId,
      jsonForArchive({ requested_by_discord_id: discordUserId }),
      jsonForArchive(response),
      nowIso,
    )
    .run();
}

export async function handleKilaueaCommand(
  body: Record<string, unknown>,
  env: KilaueaReportEnv,
  member: Record<string, unknown> | undefined,
  requesterDiscordId: string,
): Promise<Response> {
  if (!(await hasKilaueaCommandAccess(member, env))) {
    return interactionResponse(4, { content: "You need RootRecord Discord access to use `/kilauea`.", flags: 64 });
  }
  let data: Record<string, unknown>;
  try {
    data = await generateKilaueaManualReport(env, requesterDiscordId, String(body.guild_id || "").trim());
  } catch (e) {
    return interactionResponse(4, {
      content: `Kīlauea report failed: ${e instanceof Error ? e.message : String(e)}`,
      flags: 64,
    });
  }
  await markKilaueaReportUsed(
    env,
    requesterDiscordId,
    String(body.id || ""),
    String(body.channel_id || ""),
    String(body.guild_id || ""),
    data,
  );
  const report = (data.report as Record<string, unknown> | undefined) || {};
  const reportId = String(report.id || "").slice(0, 8);
  const push = (report.push as Record<string, unknown> | undefined) || {};
  const pushTotal = Number(push.total_tokens || 0);
  const pushSuccess = Number(push.success || 0);
  const posted = Boolean(report.discord_posted);
  return interactionResponse(4, {
    content: posted
      ? `Kīlauea AI report requested${reportId ? ` (${reportId})` : ""}. Posted to the Kīlauea channel, archived raw AI data${pushTotal ? `, push ${pushSuccess}/${pushTotal}` : ""}.`
      : `Kīlauea report ${reportId || "saved"} was generated but **could not post to Discord**. Run \`/config set\` to pick an alerts channel and grant the bot **Send Messages** there.`,
    flags: 64,
  });
}
function truncateText(raw: unknown, max: number): string {
  const s = String(raw ?? "").replace(/\s+/g, " ").trim();
  return s.length > max ? `${s.slice(0, Math.max(0, max - 1))}…` : s;
}

function accountAnonId(raw: unknown): string {
  const clean = String(raw || "").replace(/[^a-zA-Z0-9]/g, "");
  return clean ? `acct_${clean.slice(0, 10)}` : "acct_unknown";
}

function emailDomain(raw: unknown): string {
  const email = String(raw || "").trim().toLowerCase();
  const i = email.lastIndexOf("@");
  return i > 0 && i < email.length - 1 ? email.slice(i + 1) : "unknown";
}

function userIdFromEmail(raw: unknown): string {
  const email = String(raw || "").trim().toLowerCase();
  return email.includes("@") ? `user:${email}` : "";
}

function jsonForArchive(value: unknown): string {
  return JSON.stringify(value, (_k, v) => (typeof v === "bigint" ? v.toString() : v), 2);
}

function grokChatBearerToken(env: KilaueaReportEnv): string {
  return String(env.GROK_API_BEARER_TOKEN || "").trim();
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

async function callGrokAnalysis(
  env: KilaueaReportEnv,
  title: string,
  instruction: string,
  data: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const token = grokChatBearerToken(env);
  const apiUrl = String(env.GROK_API_URL || "https://api.x.ai/v1/chat/completions").trim();
  const model = String(env.GROK_MODEL || "grok-3-latest").trim();
  const body = {
    model,
    messages: [
      {
        role: "system",
        content:
          `${instruction} Synthesize all feeds into one professional brief — never repeat the same HVO/USGS notice wording in multiple sections. ` +
          `${KILAUEA_BRIEF_SCOPE_INSTRUCTION} ` +
          "Use plain text with markdown bold section labels. Include complete detail in each section (full NWS alert summaries, full official social text, full seismic windows). " +
          "Under **Seismic activity — recent**, include the M1.0+ count requirements description line before the bullet counts. " +
          "Do not append per-section source attribution (e.g. 'Source: NWS…', 'USGS rolling windows'); the brief header disclaimer is sufficient. " +
          "Do not reveal secrets, provider names, model names, or API errors.",
      },
      { role: "user", content: jsonForArchive(data) },
    ],
    temperature: 0.25,
  };
  if (!token) {
    return { ok: false, title, detail: "Grok bearer token is not configured.", content: `${title}: AI unavailable; data archived.`, request: body };
  }
  try {
    const res = await fetch(apiUrl, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const response = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    const content = grokResponseText(response);
    const detail = content ? "" : grokErrorText(response, res.status);
    return {
      ok: res.ok && Boolean(content),
      title,
      status: res.status,
      detail,
      content: content || `${title}: ${detail}`,
      request: body,
      response,
    };
  } catch (e) {
    return { ok: false, title, detail: e instanceof Error ? e.message : String(e), content: `${title}: AI request failed.`, request: body };
  }
}

function decodeHtmlEntities(raw: unknown): string {
  return String(raw ?? "")
    .replace(/&mdash;/g, "—")
    .replace(/&ndash;/g, "–")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}
async function developerRoleIds(env: KilaueaReportEnv): Promise<Set<string>> {
  const configured = String(env.DISCORD_DEVELOPER_ROLE_ID || "").trim();
  if (configured) return new Set([configured]);

  const bot = kilaueaBotToken(env);
  const guildId = String(env.DISCORD_GUILD_ID || "").trim();
  if (!bot || !guildId) return new Set();

  try {
    const res = await fetch(`https://discord.com/api/v10/guilds/${encodeURIComponent(guildId)}/roles`, {
      headers: { Authorization: `Bot ${bot}`, "User-Agent": "RootRecord/discord-screenshot" },
    });
    if (!res.ok) return new Set();
    const roles = (await res.json()) as Array<Record<string, unknown>>;
    const match = roles.find((r) => String(r.name || "").trim().toLowerCase() === "developer");
    const id = String(match?.id || "").trim();
    return id ? new Set([id]) : new Set();
  } catch {
    return new Set();
  }
}

async function hasDeveloperRole(member: Record<string, unknown> | undefined, env: KilaueaReportEnv): Promise<boolean> {
  const memberRoles = Array.isArray(member?.roles) ? member!.roles.map((r) => String(r)) : [];
  if (!memberRoles.length) return false;
  const allowed = await developerRoleIds(env);
  if (!allowed.size) return false;
  return memberRoles.some((r) => allowed.has(r));
}
function reportTimestamp(raw: unknown): string {
  const ms = Date.parse(String(raw || ""));
  if (!Number.isFinite(ms)) return String(raw || "");
  return `<t:${Math.floor(ms / 1000)}:f>`;
}
async function kilaueaFetchJson(url: string): Promise<Record<string, unknown>> {
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "RootRecordKilaueaDiscord/1.0 (root@rootrecord.info)" },
    });
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    return { ok: res.ok, status: res.status, data };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

async function collectOfficialKilaueaXUpdates(env: KilaueaReportEnv): Promise<Record<string, unknown>> {
  return fetchOfficialKilaueaXUpdates(env);
}

function activeHourlyPeriod(periods: Array<Record<string, unknown>>): Record<string, unknown> {
  const now = Date.now();
  for (const p of periods) {
    const start = Date.parse(String(p.startTime || ""));
    const end = Date.parse(String(p.endTime || ""));
    if (Number.isFinite(start) && Number.isFinite(end) && now >= start && now <= end + 60_000) return p;
  }
  return periods[0] || {};
}

function formatNwsWeather(weather: Record<string, unknown>): { current: string; forecast: string } {
  const forecastPeriods = recordArray(weather.forecast_periods);
  const hourlyPeriods = recordArray(weather.hourly_periods);
  const hour = activeHourlyPeriod(hourlyPeriods);
  const period = forecastPeriods[0] || hour;

  const hourTemp =
    hour.temperature != null ? `${hour.temperature}\u00B0${String(hour.temperatureUnit || "F")}` : "";
  const hourWind = [hour.windSpeed, hour.windDirection].filter(Boolean).map(String).join(" ").trim();
  const currentParts = [String(hour.shortForecast || ""), hourTemp, hourWind ? `wind ${hourWind}` : ""].filter(Boolean);

  const forecast = [
    String(period.name || "Next period"),
    period.temperature != null ? `${period.temperature}\u00B0${String(period.temperatureUnit || "F")}` : "",
    String(period.shortForecast || ""),
  ].filter(Boolean).join(", ");

  return {
    current: currentParts.length ? currentParts.join("; ") : "",
    forecast: forecast || "",
  };
}

function dedupeNwsWarnings(warnings: Array<Record<string, unknown>>): Array<Record<string, unknown>> {
  const latestByKey = new Map<string, Record<string, unknown>>();
  for (const w of warnings) {
    const event = String(w.event || "NWS alert").trim().toLowerCase();
    const area = String(w.areaDesc || "Hawaiʻi").trim().toLowerCase();
    const key = `${event}|${area}`;
    const effective = Date.parse(String(w.effective || w.sent || ""));
    const existing = latestByKey.get(key);
    const existingEffective = existing ? Date.parse(String(existing.effective || existing.sent || "")) : 0;
    if (!existing || (Number.isFinite(effective) && effective > existingEffective)) latestByKey.set(key, w);
  }
  return [...latestByKey.values()].sort(
    (a, b) => Date.parse(String(b.effective || b.sent || "")) - Date.parse(String(a.effective || a.sent || "")),
  );
}

function summarizeNwsAreas(areaDesc: string): string {
  const zones = areaDesc.split(";").map((z) => z.trim()).filter(Boolean);
  if (zones.length <= 4) return zones.join("; ");
  const hasSummit = zones.some((z) => /summit/i.test(z));
  return `${zones.slice(0, 3).join("; ")}; +${zones.length - 3} more zones${hasSummit ? " (includes Big Island Summit)" : ""}`;
}

function formatNwsAlertLine(w: Record<string, unknown>): string {
  const event = String(w.event || "NWS alert");
  const severity = String(w.severity || "").trim();
  const area = summarizeNwsAreas(String(w.areaDesc || "Hawaiʻi"));
  const headline = cleanDisplayText(w.headline, 220);
  const parts = [severity ? `${event} (${severity})` : event, area];
  if (headline && headline.toLowerCase() !== event.toLowerCase()) parts.push(headline);
  return parts.filter(Boolean).join(" — ");
}

async function collectNwsKilaueaWeather(): Promise<Record<string, unknown>> {
  const points = await kilaueaFetchJson(`https://api.weather.gov/points/${KILAUEA_SUMMIT_LAT.toFixed(4)},${KILAUEA_SUMMIT_LON.toFixed(4)}`);
  const props = (points.data as Record<string, unknown> | undefined)?.properties as Record<string, unknown> | undefined;
  const forecastUrl = String(props?.forecast || "");
  const hourlyUrl = String(props?.forecastHourly || "");
  const [forecast, hourly] = await Promise.all([
    forecastUrl ? kilaueaFetchJson(forecastUrl) : Promise.resolve({ ok: false, reason: "missing forecast URL" } as Record<string, unknown>),
    hourlyUrl ? kilaueaFetchJson(hourlyUrl) : Promise.resolve({ ok: false, reason: "missing hourly forecast URL" } as Record<string, unknown>),
  ]);
  const forecastPeriods = Array.isArray(((forecast.data as Record<string, unknown> | undefined)?.properties as Record<string, unknown> | undefined)?.periods)
    ? ((((forecast.data as Record<string, unknown>).properties as Record<string, unknown>).periods as Array<Record<string, unknown>>).slice(0, 4))
    : [];
  const hourlyPeriods = Array.isArray(((hourly.data as Record<string, unknown> | undefined)?.properties as Record<string, unknown> | undefined)?.periods)
    ? ((((hourly.data as Record<string, unknown>).properties as Record<string, unknown>).periods as Array<Record<string, unknown>>).slice(0, 12))
    : [];
  return {
    source: "NWS api.weather.gov grid forecast",
    point: { lat: KILAUEA_SUMMIT_LAT, lon: KILAUEA_SUMMIT_LON, label: "Kīlauea summit" },
    grid: {
      office: props?.gridId || null,
      x: props?.gridX || null,
      y: props?.gridY || null,
      forecast_url: forecastUrl,
      hourly_url: hourlyUrl,
    },
    forecast_periods: forecastPeriods,
    hourly_periods: hourlyPeriods,
  };
}

async function collectKilaueaManualContext(env: KilaueaReportEnv, requesterDiscordId: string): Promise<Record<string, unknown>> {
  const [volcano, newest, newestNotice, recent, nws, eqResult, tsunami, weather, officialX] = await Promise.all([
    kilaueaFetchJson(`${HANS_BASE}/getVolcano/${VNUM_KILAUEA}`),
    kilaueaFetchJson(`${HANS_BASE}/getNewestVona/${VNUM_KILAUEA}`),
    kilaueaFetchJson(`${HANS_BASE}/newestForVolcano/${VNUM_KILAUEA}`),
    kilaueaFetchJson(`${HANS_BASE}/getRecentNotices/${VNUM_KILAUEA}`),
    kilaueaFetchJson("https://api.weather.gov/alerts/active?area=HI&status=actual"),
    fetchHawaiiEarthquakeEvents(KILAUEA_EQ_COUNT_MIN_MAG),
    kilaueaFetchJson("https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/significant_week.geojson"),
    collectNwsKilaueaWeather().catch((e) => ({ ok: false, error: e instanceof Error ? e.message : String(e) })),
    collectOfficialKilaueaXUpdates(env),
  ]);

  const nwsFeatures = Array.isArray((nws.data as Record<string, unknown> | undefined)?.features)
    ? (((nws.data as Record<string, unknown>).features as Array<Record<string, unknown>>).slice(0, 20))
    : [];
  const eqFeatures = eventsToLegacyRecords(eqResult.events || []);
  const tsunamiFeatures = Array.isArray((tsunami.data as Record<string, unknown> | undefined)?.features)
    ? (((tsunami.data as Record<string, unknown>).features as Array<Record<string, unknown>>).filter((f) => {
        const p = (f.properties as Record<string, unknown> | undefined) || {};
        return Boolean(p.tsunami);
      }).slice(0, 12))
    : [];

  return {
    generated_at: new Date().toISOString(),
    requested_by_discord_id: requesterDiscordId,
    trigger: {
      source_type: "manual",
      source_id: `manual:${requesterDiscordId}:${crypto.randomUUID()}`,
      source_time: new Date().toISOString(),
      event: "Manual /kilauea report",
      headline: "Manual Kīlauea AI analysis",
    },
    volcano: { volcano, newest_vona: newest, newest_notice: newestNotice, recent_notices: recent },
    official_x_updates: officialX,
    weather,
    earthquake_source: {
      ok: Boolean(eqResult.ok),
      status: eqResult.ok ? 200 : null,
      url: eqResult.url,
      count: eqFeatures.length,
      error: eqResult.error || null,
    },
    active_warning_advisories: nwsFeatures.map((f) => {
      const p = (f.properties as Record<string, unknown> | undefined) || {};
      return {
        id: f.id || p.id,
        event: p.event,
        severity: p.severity,
        headline: p.headline || p.event,
        effective: p.effective,
        expires: p.expires,
        areaDesc: p.areaDesc,
        url: p.uri || f.id,
      };
    }),
    hawaii_earthquakes: eqFeatures,
    pacific_tsunami_bulletins: {
      available: true,
      bulletins: tsunamiFeatures.map((f) => {
        const p = (f.properties as Record<string, unknown> | undefined) || {};
        return {
          id: f.id,
          title: p.title,
          place: p.place,
          magnitude: p.mag,
          time: p.time,
          url: p.url,
          alert: p.alert,
        };
      }),
    },
  };
}

function splitKilaueaReportText(content: string): { freeText: string; proText: string } {
  const clean =
    content
      .replace(/\bGrok\b/gi, "AI")
      .replace(/\bxAI\b/g, "AI")
      .replace(/\bAva Ivy\b/gi, "")
      .replace(/\bAva\b/g, "")
      .replace(/\bOptiPlex\b/gi, "")
      .replace(/\bRoot Server\b/gi, "")
      .replace(/\bMariaDB\b/gi, "")
      .replace(/\bCursor\b/g, "")
      .replace(/[ \t]{2,}/g, " ")
      .trim() || "Kīlauea AI report generated, but no summary text was returned.";
  for (const marker of ["\n\n**Seismic activity", "\n\n**Weather", "\n\n**NWS", "\n\n**Official social", "\n\n**Tsunami"]) {
    const idx = clean.indexOf(marker);
    if (idx > 300) {
      return {
        freeText: clean.slice(0, idx).trim(),
        proText: clean.slice(idx).trim(),
      };
    }
  }
  const midpoint = Math.max(1, Math.floor(clean.length / 2));
  const splitAt = clean.indexOf("\n\n", midpoint);
  const idx = splitAt > midpoint && splitAt < clean.length - 40 ? splitAt : midpoint;
  return {
    freeText: clean.slice(0, idx).trim(),
    proText: clean.slice(idx).trim() || "Additional details unavailable.",
  };
}

function recordArray(raw: unknown): Array<Record<string, unknown>> {
  return Array.isArray(raw) ? raw.filter((x): x is Record<string, unknown> => Boolean(x && typeof x === "object" && !Array.isArray(x))) : [];
}

function msDate(raw: unknown): string {
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) return "";
  return new Date(value).toISOString().replace("T", " ").replace(/\.\d{3}Z$/, " UTC");
}

function cleanDisplayText(raw: unknown, max = 2000): string {
  const s = decodeHtmlEntities(raw)
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<\/p>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return s.length > max ? `${s.slice(0, Math.max(0, max - 1)).trim()}…` : s;
}

const NOTICE_SYNOPSIS_KEYS = [
  "noticeSynopsis",
  "Synopsis",
  "synopsis",
  "summary",
  "description",
  "activitySummary",
  "body",
  "text",
  "noticeHtml",
];

/** Prefer the longest USGS/HVO notice body — findStringByKey returns the first shallow match (often too short). */
function extractVolcanoNoticeText(raw: unknown, maxLen = 8000): string {
  const candidates: string[] = [];
  const walk = (node: unknown, depth: number): void => {
    if (!node || depth > 10) return;
    if (typeof node === "string") {
      const t = node.trim();
      if (t.length > 40) candidates.push(t);
      return;
    }
    if (Array.isArray(node)) {
      for (const item of node) walk(item, depth + 1);
      return;
    }
    if (typeof node !== "object") return;
    const obj = node as Record<string, unknown>;
    for (const key of NOTICE_SYNOPSIS_KEYS) {
      const v = obj[key];
      if (typeof v === "string" && v.trim()) candidates.push(v.trim());
    }
    for (const value of Object.values(obj)) walk(value, depth + 1);
  };
  walk(raw, 0);
  let best = "";
  for (const c of candidates) {
    const cleaned = decodeHtmlEntities(c)
      .replace(/<br\s*\/?>/gi, " ")
      .replace(/<\/p>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (cleaned.length > best.length) best = cleaned;
  }
  return best ? cleanDisplayText(best, maxLen) : "";
}

function normalizeUsgsNoticeSpacing(text: string): string {
  return text.replace(/([.!?])([A-Za-z])/g, "$1 $2");
}

function compactLines(lines: string[], maxChars = 1800): string {
  const out: string[] = [];
  let total = 0;
  for (const line of lines) {
    const clean = line.trim();
    if (!clean) continue;
    if (total + clean.length + 1 > maxChars) break;
    out.push(clean);
    total += clean.length + 1;
  }
  return out.join("\n");
}

function findStringByKey(raw: unknown, keys: string[], depth = 0, maxLen = 2000): string {
  if (!raw || depth > 6) return "";
  if (Array.isArray(raw)) {
    for (const item of raw) {
      const found = findStringByKey(item, keys, depth + 1, maxLen);
      if (found) return found;
    }
    return "";
  }
  if (typeof raw !== "object") return "";
  const obj = raw as Record<string, unknown>;
  for (const key of keys) {
    const value = obj[key];
    if (typeof value === "string" && value.trim()) return cleanDisplayText(value, maxLen);
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  for (const value of Object.values(obj)) {
    const found = findStringByKey(value, keys, depth + 1, maxLen);
    if (found) return found;
  }
  return "";
}

function collectMatchingSentences(raw: unknown, pattern: RegExp, max = 3, out: string[] = [], depth = 0): string[] {
  if (!raw || out.length >= max || depth > 6) return out;
  if (typeof raw === "string") {
    const clean = cleanDisplayText(raw, 2000);
    for (const sentence of clean.split(/(?<=[.!?])\s+/)) {
      const item = sentence.trim();
      if (item && pattern.test(item) && !out.includes(item)) out.push(truncateText(item, 220));
      if (out.length >= max) break;
    }
    return out;
  }
  if (Array.isArray(raw)) {
    for (const item of raw) collectMatchingSentences(item, pattern, max, out, depth + 1);
    return out;
  }
  if (typeof raw === "object") {
    for (const value of Object.values(raw as Record<string, unknown>)) collectMatchingSentences(value, pattern, max, out, depth + 1);
  }
  return out;
}

function cToF(raw: unknown): string {
  if (raw == null || raw === "") return "";
  const c = Number(raw);
  if (!Number.isFinite(c)) return "";
  return `${Math.round((c * 9) / 5 + 32)}\u00B0F`;
}

function msToMph(raw: unknown): string {
  if (raw == null || raw === "") return "";
  const ms = Number(raw);
  if (!Number.isFinite(ms)) return "";
  return `${Math.round(ms * 2.23694)} mph`;
}

function truncateAtWord(text: string, maxChars: number): string {
  const clean = text.trim();
  if (clean.length <= maxChars) return clean;
  const slice = clean.slice(0, maxChars);
  const lastSpace = slice.lastIndexOf(" ");
  const trimmed = (lastSpace > maxChars * 0.55 ? slice.slice(0, lastSpace) : slice).trimEnd();
  return trimmed.length < clean.length ? `${trimmed}…` : trimmed;
}

function firstSentences(text: string, maxSentences = 8, maxChars = 2200): string {
  const clean = normalizeUsgsNoticeSpacing(cleanDisplayText(text, 12000));
  if (!clean) return "";
  if (clean.length <= maxChars) return clean;
  const parts = clean.split(/(?<=[.!?])\s+/).filter(Boolean);
  let out = "";
  let count = 0;
  for (const part of parts) {
    if (count >= maxSentences) break;
    const next = out ? `${out} ${part}` : part;
    if (next.length > maxChars) {
      const room = maxChars - (out ? out.length + 1 : 0);
      if (!out && room > 0) return truncateAtWord(part, maxChars);
      if (room > 60) out = `${out} ${truncateAtWord(part, room)}`.trim();
      break;
    }
    out = next;
    count += 1;
  }
  if (out) return out;
  return truncateAtWord(clean, maxChars);
}

function normalizeStatusToken(raw: string): string {
  const t = raw.trim().toUpperCase();
  if (!t || t === "N/A" || t === "UNKNOWN") return "";
  return t.charAt(0) + t.slice(1).toLowerCase();
}

function volcanoStatusLine(volcano: Record<string, unknown>, newestNotice: Record<string, unknown>, latestVona: Record<string, unknown>): string {
  const alertLevel = findStringByKey(volcano, [
    "volcanoAlertLevel",
    "alertLevel",
    "noticeHighestAlertLevel",
    "currentVolcanoAlertLevel",
  ]) || findStringByKey(newestNotice, ["noticeHighestAlertLevel", "AlertLevel", "alertLevel"]) ||
    findStringByKey(latestVona, ["noticeHighestAlertLevel", "AlertLevel"]);
  const aviation = findStringByKey(volcano, [
    "colorCode",
    "aviationColorCode",
    "noticeHighestColorCode",
    "currentAviationColorCode",
  ]) || findStringByKey(newestNotice, ["noticeHighestColorCode", "ColorCode"]) ||
    findStringByKey(latestVona, ["noticeHighestColorCode", "ColorCode"]);
  const parts: string[] = [];
  const av = normalizeStatusToken(aviation);
  const al = normalizeStatusToken(alertLevel);
  if (av) parts.push(`${av} aviation color`);
  if (al) parts.push(`${al} volcano alert level`);
  return parts.join("; ") || "Alert level not parsed from latest USGS/HVO payload";
}

function stripUsgsNoticeBoilerplate(text: string): string {
  let s = normalizeUsgsNoticeSpacing(cleanDisplayText(text, 12000));
  if (!s) return "";

  const summaryIdx = s.search(/\bSummary:\s*/i);
  if (summaryIdx >= 0) {
    s = s.slice(summaryIdx).replace(/^\s*Summary:\s*/i, "").trim();
  } else {
    const activityIdx = s.search(
      /\b(Precursory|Lava lake|Lava|Eruptive|Episode|Summit|Halema|Maunaulu|Inflation|Deflation|Spattering|Fountaining|Volcanic tremor)\b/i,
    );
    if (activityIdx > 60) s = s.slice(activityIdx);
  }

  s = s
    .replace(/^U\.S\. Geological Survey\b[^.]*\.?\s*/i, "")
    .replace(/\bHAWAIIAN VOLCANO OBSERVATORY\b[^.]*\.?\s*/gi, "")
    .replace(/\bKILAUEA\s*\(VNUM\s*#\d+\)[^.]*\.?\s*/gi, "")
    .replace(/\bCurrent Volcano Alert Level:\s*\w+\b/gi, "")
    .replace(/\bCurrent Aviation Color Code:\s*\w+\b/gi, "")
    .replace(/\bSummit Elevation[^.]*\.?\s*/gi, "")
    .replace(/\b\d{1,2}°\d{1,2}'\d{1,2}"\s*[NS]\s*\d{1,3}°\d{1,2}'\d{1,2}"\s*[EW]\b/g, "")
    .replace(/\s+/g, " ")
    .trim();

  return s;
}

function formatVolcanoActivityText(headline: string, synopsis: string): string {
  const h = cleanDisplayText(headline, 300).toLowerCase();
  let s = stripUsgsNoticeBoilerplate(synopsis);
  if (!s) s = normalizeUsgsNoticeSpacing(cleanDisplayText(synopsis, 8000));
  if (h && s.toLowerCase().startsWith(h)) {
    s = s.slice(h.length).replace(/^[\s:—-]+/, "").trim();
  }
  return firstSentences(s, 8, 2200);
}

function mergeFullOfficialSocialIntoReport(report: string, context: Record<string, unknown>): string {
  const officialX = (context.official_x_updates as Record<string, unknown> | undefined) || {};
  const posts = filterKilaueaRelevantOfficialXPosts(recordArray(officialX.posts));
  const social = formatOfficialSocialSection(posts, { maxPosts: 6, maxChars: 500 });
  if (!social) return report;
  return [stripOfficialSocialSection(report), social].filter(Boolean).join("\n\n");
}

function mergeFullActivityIntoReport(report: string, context: Record<string, unknown>): string {
  const volcano = (context.volcano as Record<string, unknown> | undefined) || {};
  const newestNotice = (volcano.newest_notice as Record<string, unknown> | undefined) || {};
  const latestVona = (volcano.newest_vona as Record<string, unknown> | undefined) || {};
  const headline =
    findStringByKey(newestNotice, ["noticeTitle", "title", "headline", "noticeSubject", "subject"], 0, 800) ||
    findStringByKey(latestVona, ["noticeTitle", "title", "headline", "noticeSubject", "subject"], 0, 800);
  const raw =
    extractVolcanoNoticeText(newestNotice, 8000) || extractVolcanoNoticeText(latestVona, 8000);
  const activity = formatVolcanoActivityText(headline, raw);
  if (!activity) return report;
  const line = `**Activity:** ${activity}`;
  if (/\*\*Activity:\*\*/i.test(report)) {
    return report.replace(/\*\*Activity:\*\*[^\n]*/i, line);
  }
  return report;
}

function buildOfficialKilaueaReport(context: Record<string, unknown>, _ai: Record<string, unknown>): string {
  const generated = String(context.generated_at || new Date().toISOString());
  const warnings = dedupeNwsWarnings(recordArray(context.active_warning_advisories));
  const earthquakeSource = (context.earthquake_source as Record<string, unknown> | undefined) || {};
  const earthquakeFeedOk = earthquakeSource.ok !== false;
  const eqActivity = (context.earthquake_activity as EarthquakeActivitySummary | undefined) ||
    (earthquakeFeedOk ? attachEarthquakeActivity(context, String((context.previous_report as Record<string, unknown> | undefined)?.created_at || "")) : undefined);
  const tsunami = (context.pacific_tsunami_bulletins as Record<string, unknown> | undefined) || {};
  const bulletins = recordArray(tsunami.bulletins);
  const volcano = (context.volcano as Record<string, unknown> | undefined) || {};
  const newestNotice = (volcano.newest_notice as Record<string, unknown> | undefined) || {};
  const latestVona = (volcano.newest_vona as Record<string, unknown> | undefined) || {};
  const weather = (context.weather as Record<string, unknown> | undefined) || {};
  const weatherText = formatNwsWeather(weather);
  const officialX = (context.official_x_updates as Record<string, unknown> | undefined) || {};
  const xPosts = filterKilaueaRelevantOfficialXPosts(recordArray(officialX.posts)).slice(0, 6);
  const prior = (context.previous_report as Record<string, unknown> | undefined) || null;

  const status = volcanoStatusLine(volcano, newestNotice, latestVona);
  const headline = findStringByKey(newestNotice, ["noticeTitle", "title", "headline", "noticeSubject", "subject"]) ||
    findStringByKey(latestVona, ["noticeTitle", "title", "headline", "noticeSubject", "subject"]);
  const rawActivity =
    extractVolcanoNoticeText(newestNotice, 8000) || extractVolcanoNoticeText(latestVona, 8000);
  const activity = formatVolcanoActivityText(headline, rawActivity);

  const peakMag = peakMagnitude(eqActivity, "since_last_report", "last_24_hours", "last_7_days");

  const concern =
    warnings.some((w) => /warning|emergency|extreme|severe/i.test(String(w.severity || w.event || ""))) ||
    peakMag >= 4 ||
    bulletins.length > 0
      ? "Elevated"
      : /WATCH|WARNING|ORANGE|RED/i.test(status)
        ? "Elevated"
        : "Routine";

  const contextBits: string[] = [];
  if (weatherText.current || weatherText.forecast) {
    const wx = [weatherText.current, weatherText.forecast].filter(Boolean).join(". ");
    contextBits.push(`**Weather:** ${wx}.`);
  }
  if (warnings.length) {
    contextBits.push("**NWS:**");
    for (const w of warnings.slice(0, 5)) {
      contextBits.push(`• ${formatNwsAlertLine(w)}`);
    }
    if (warnings.length > 5) contextBits.push(`• +${warnings.length - 5} more active alert(s).`);
  }
  if (bulletins.length) {
    const b = bulletins[0]!;
    const mag = Number(b.magnitude);
    contextBits.push(
      `**Tsunami context:** ${Number.isFinite(mag) ? `M${mag.toFixed(1)} ` : ""}${String(b.place || b.title || "Pacific event")}.`,
    );
  }
  const xAdds = xPosts
    .map((post) => {
      const account = String(post.account || "Official X");
      const text = cleanDisplayText(post.text, 500);
      return text ? `• ${account}: ${text}` : "";
    })
    .filter(Boolean);
  if (xAdds.length) {
    contextBits.push("**Official social:**");
    contextBits.push(...xAdds);
  }

  const seismicSection = earthquakeFeedOk
    ? formatEarthquakeActivitySection(eqActivity)
    : "**Seismic activity:** Unavailable this pull.";

  const lines = [
    "**Kīlauea Hazards Brief**",
    `_AI-assisted synthesis (${reportTimestamp(generated)}). Not an official USGS, HVO, or NWS release._`,
    `**Current condition (${concern}):** ${status}.`,
    activity ? `**Activity:** ${activity}` : headline ? `**Activity:** ${cleanDisplayText(headline, 800)}.` : "",
    seismicSection,
    ...contextBits,
    prior
      ? `**Since last report:** Prior brief ${String(prior.id || "").slice(0, 8)} (${String(prior.created_at || "unknown time")}).`
      : "",
    "_Follow USGS/HVO and NWS Honolulu for authoritative updates._",
  ];

  return joinReportSections(lines.filter(Boolean));
}

function joinReportSections(sections: string[]): string {
  return sections.map((s) => s.trim()).filter(Boolean).join("\n\n");
}

async function insertKilaueaManualAnalysis(
  env: KilaueaReportEnv,
  context: Record<string, unknown>,
  ai: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const id = crypto.randomUUID();
  const nowIso = new Date().toISOString();
  const trigger = (context.trigger as Record<string, unknown> | undefined) || {};
  const prior = await env.DB.prepare(`SELECT id FROM kilauea_ai_analyses ORDER BY created_at DESC LIMIT 1`).first<{ id: string }>().catch(() => null);
  const { freeText, proText } = splitKilaueaReportText(String(ai.content || ""));
  await env.DB.prepare(
    `INSERT INTO kilauea_ai_analyses
     (id, source_type, source_id, source_time, severity, event, magnitude, headline, url, free_text, pro_text, model, prompt_json, response_json, prior_report_id, discord_posted_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)`,
  )
    .bind(
      id,
      String(trigger.source_type || "manual"),
      String(trigger.source_id || `manual:${id}`),
      String(trigger.source_time || nowIso),
      null,
      String(trigger.event || "Manual /kilauea report"),
      null,
      String(trigger.headline || "Manual Kīlauea AI analysis"),
      null,
      freeText,
      proText,
      String(env.GROK_MODEL || "grok-3-latest"),
      archiveContextJson(context),
      jsonForArchive(ai),
      prior?.id || null,
      nowIso,
    )
    .run();
  return { id, created_at: nowIso, headline: trigger.headline || "Manual Kīlauea AI analysis", free_text: freeText, pro_text: proText };
}

// postKilaueaBotMessage removed — use postKilaueaDiscordMessage

function resolveFcmCredentials(env: KilaueaReportEnv): { projectId: string; clientEmail: string; privateKey: string } | null {
  const raw = String(env.FCM_SERVICE_ACCOUNT_JSON || "").trim();
  if (raw) {
    try {
      const j = JSON.parse(raw) as { project_id?: string; client_email?: string; private_key?: string };
      const projectId = String(j.project_id || "").trim();
      const clientEmail = String(j.client_email || "").trim();
      const privateKey = String(j.private_key || "").trim();
      if (projectId && clientEmail && privateKey) return { projectId, clientEmail, privateKey };
    } catch {
      return null;
    }
    return null;
  }
  const projectId = String(env.FCM_PROJECT_ID || "").trim();
  const clientEmail = String(env.FCM_CLIENT_EMAIL || "").trim();
  const privateKey = String(env.FCM_PRIVATE_KEY || "").trim();
  if (projectId && clientEmail && privateKey) return { projectId, clientEmail, privateKey };
  return null;
}

function kilaueaPushStatusText(context: Record<string, unknown>): string {
  const volcano = (context.volcano as Record<string, unknown> | undefined) || {};
  const newestNotice = (volcano.newest_notice as Record<string, unknown> | undefined) || {};
  const latestVona = (volcano.newest_vona as Record<string, unknown> | undefined) || {};
  const status = findStringByKey(volcano, ["alertLevel", "noticeHighestAlertLevel", "volcanoAlertLevel", "currentAlertLevel", "aviationColorCode", "noticeHighestColorCode"]);
  const headline = findStringByKey(newestNotice, ["noticeTitle", "title", "headline", "noticeSubject", "subject"]) ||
    findStringByKey(latestVona, ["noticeTitle", "title", "headline", "noticeSubject", "subject"]);
  const combined = [status, headline].filter(Boolean).join(" - ");
  return `Active status: ${cleanDisplayText(combined || "Updated summary available.", 220)}`;
}

async function sendKilaueaSummaryPush(
  env: KilaueaReportEnv,
  context: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const creds = resolveFcmCredentials(env);
  if (!creds) return { ok: false, reason: "fcm_not_configured", success: 0, failure: 0, total_tokens: 0 };

  const rows = await env.DB.prepare(
    "SELECT token FROM rrwm_push_tokens WHERE app_id = ? AND LENGTH(token) >= 20",
  ).bind(KILAUEA_ANDROID_APP_ID).all<{ token: string }>().catch((e) => {
    console.error("kilauea_push_token_query", e instanceof Error ? e.message : String(e));
    return { results: [] as { token: string }[] };
  });
  const seen = new Set<string>();
  const tokens = (rows.results || [])
    .map((row) => String(row.token || "").trim())
    .filter((token) => token.length >= 20 && !seen.has(token) && (seen.add(token), true));
  if (!tokens.length) return { ok: true, success: 0, failure: 0, total_tokens: 0 };

  let accessToken = "";
  try {
    accessToken = await getFcmAccessToken({ clientEmail: creds.clientEmail, privateKey: creds.privateKey });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("kilauea_push_oauth", msg);
    return { ok: false, reason: "fcm_oauth_failed", detail: msg, success: 0, failure: 0, total_tokens: tokens.length };
  }

  let success = 0;
  let failure = 0;
  const errors: string[] = [];
  const title = "Kilauea Current Known Summary was refreshed";
  const body = kilaueaPushStatusText(context);
  for (let i = 0; i < tokens.length; i += 24) {
    const chunk = tokens.slice(i, i + 24);
    const part = await Promise.all(chunk.map((token) => sendFcmNotification(creds.projectId, accessToken, token, title, body)));
    for (let j = 0; j < part.length; j++) {
      const r = part[j]!;
      if (r.ok) success += 1;
      else {
        failure += 1;
        if (errors.length < 8) errors.push(`${chunk[j]!.slice(0, 32)}...: ${r.error}`);
      }
    }
  }
  return { ok: true, success, failure, total_tokens: tokens.length, errors };
}

async function archiveKilaueaRawToDiscord(env: KilaueaReportEnv, id: string, record: Record<string, unknown>): Promise<void> {
  const token = kilaueaBotToken(env);
  const channelId = String(env.DISCORD_KILAUEA_AI_ARCHIVE_CHANNEL_ID || "1545283818146242642").trim();
  if (!token || !channelId) return;
  const form = new FormData();
  form.set("payload_json", JSON.stringify({ content: `Kīlauea AI raw archive ${id}`, username: "Root Record AI" }));
  form.set("files[0]", new Blob([jsonForArchive(record)], { type: "application/json" }), `kilauea-ai-${id}.json`);
  const res = await fetch(`https://discord.com/api/v10/channels/${encodeURIComponent(channelId)}/messages`, {
    method: "POST",
    headers: { Authorization: `Bot ${token}`, "User-Agent": "RootRecord/discord-kilauea-archive" },
    body: form,
  });
  if (!res.ok) console.error("kilauea_discord_archive", res.status, (await res.text().catch(() => "")).slice(0, 300));
}

export async function generateKilaueaManualReport(
  env: KilaueaReportEnv,
  requesterDiscordId: string,
  guildId = "",
): Promise<Record<string, unknown>> {
  const context = await collectKilaueaManualContext(env, requesterDiscordId);
  const previous = await env.DB.prepare(
    `SELECT id, created_at, headline, free_text, pro_text
     FROM kilauea_ai_analyses
     ORDER BY created_at DESC
     LIMIT 1`,
  ).first<Record<string, unknown>>().catch(() => null);
  if (previous) context.previous_report = previous;
  attachEarthquakeActivity(context, String(previous?.created_at || ""));
  const ai = await callGrokAnalysis(
    env,
    "Kīlauea Hazards Brief",
    "Write a single cohesive Kīlauea/Big Island hazards brief. Cross-check USGS/HVO volcano notices, NWS alerts, summit weather, Hawaiʻi earthquakes, tsunami flags, and official agency X posts. " +
      `${KILAUEA_BRIEF_SCOPE_INSTRUCTION} ` +
      "State alert/aviation level once, summarize eruptive activity in at most three sentences (volcano activity only — no weather), then present earthquake_activity recent rolling windows and calendar totals separately. " +
      "Copy earthquake_activity.count_description verbatim under **Seismic activity — recent** before listing counts. Calendar year totals are historical context, not current activity. " +
      "Use earthquake_activity only — do not cite old events from prior calendar years as current. Skip empty or off-topic official social posts. " +
      "Note what changed versus previous_report when present. Do not invent measurements or give evacuation orders.",
    slimEarthquakeContextForAi(context),
  );
  if (!ai.ok || !String(ai.content || "").trim()) {
    ai.content = buildOfficialKilaueaReport(context, ai);
    ai.fallback_report = true;
  } else {
    ai.content = String(ai.content).trim();
  }
  const row = await insertKilaueaManualAnalysis(env, context, ai);
  const reportId = String(row.id || "");
  let content =
    String(ai.content || "").trim() ||
    buildKilaueaAnalysisDiscordBody({
      headline: String(row.headline || ""),
      event: String(row.event || ""),
      free_text: String(row.free_text || ""),
      pro_text: String(row.pro_text || ""),
    }) ||
    "Kīlauea AI report generated.";
  content = mergeFullActivityIntoReport(content, context);
  content = mergeFullOfficialSocialIntoReport(content, context);
  const posted = await postKilaueaReportContent(env, content, {
    ...(guildId ? { guildId } : {}),
    sourceId: reportId,
  });
  if (posted) {
    await env.DB.prepare(`UPDATE kilauea_ai_analyses SET discord_posted_at = ? WHERE id = ?`)
      .bind(new Date().toISOString(), reportId)
      .run()
      .catch(() => {});
  }
  await archiveKilaueaRawToDiscord(env, reportId, { id: reportId, prompt: context, response: ai });
  const push = await sendKilaueaSummaryPush(env, context).catch((e) => {
    console.error("kilauea_summary_push", e instanceof Error ? e.message : String(e));
    return { ok: false, reason: "push_exception", success: 0, failure: 0, total_tokens: 0 };
  });
  return { ok: true, report: { id: reportId, headline: row.headline, created_at: row.created_at, discord_posted: posted, push } };
}
