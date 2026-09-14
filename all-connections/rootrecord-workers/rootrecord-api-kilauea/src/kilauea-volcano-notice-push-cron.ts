import type { D1Database } from "@cloudflare/workers-types";
import { getFcmAccessToken, sendFcmDataNotification } from "./fcm-v1";

const VNUM_KILAUEA = "332010";
const HANS_BASE = "https://volcanoes.usgs.gov/hans-public/api/volcano";
const KILAUEA_ANDROID_APP_ID = "rootrecord_kilauea_alerts_android";
const STATE_ID = "current";
const USGS_UA = "RootRecord Kilauea Alerts (rootrecord.info)";

type FcmCreds = { projectId: string; clientEmail: string; privateKey: string };

function resolveFcmCredentials(env: {
  FCM_SERVICE_ACCOUNT_JSON?: string;
  FCM_PROJECT_ID?: string;
  FCM_CLIENT_EMAIL?: string;
  FCM_PRIVATE_KEY?: string;
}): FcmCreds | null {
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

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : v == null ? "" : String(v).trim();
}

function stripHtml(html: string): string {
  return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function volcanoNewestNoticeId(newest: Record<string, unknown>): string | null {
  for (const key of ["messageId", "id", "volcanoMessageId", "noticeId", "MessageId"]) {
    const v = str(newest[key]);
    if (v) return v.slice(0, 220);
  }
  const vm = newest.volcanoMessage;
  if (vm && typeof vm === "object" && vm !== null) {
    const nested = str((vm as Record<string, unknown>).messageId);
    if (nested) return nested.slice(0, 220);
  }
  const sent = str(newest.sentUtc || newest.SentUTC || newest.sent);
  const title = str(newest.noticeTitle || newest.title || newest.Subject);
  if (sent || title) return `${sent}|${title}`.slice(0, 220);
  return null;
}

function isUrgentNotice(volcano: Record<string, unknown>, newest: Record<string, unknown>, plain: string): boolean {
  const color = str(
    volcano.colorCode ||
      volcano.aviationColorCode ||
      newest.noticeHighestColorCode ||
      newest.ColorCode,
  ).toUpperCase();
  if (color === "RED" || color === "ORANGE") return true;
  const level = str(
    volcano.volcanoAlertLevel ||
      volcano.alertLevel ||
      newest.noticeHighestAlertLevel ||
      newest.AlertLevel,
  ).toUpperCase();
  if (level === "WARNING" || level === "WATCH") return true;
  const t = plain.toLowerCase();
  if (!t) return false;
  const neg = ["no active eruption", "not erupting", "no eruption", "eruption has ended", "remains paused"];
  if (neg.some((p) => t.includes(p))) return false;
  const sig = ["eruption", "eruptive", "erupting", "lava flow", "lava fountain", "active lava", "effusive"];
  return sig.some((p) => t.includes(p));
}

async function fetchJson(url: string): Promise<Record<string, unknown>> {
  const r = await fetch(url, {
    headers: { "User-Agent": USGS_UA, Accept: "application/json" },
  });
  if (!r.ok) throw new Error(`usgs_http_${r.status}`);
  return (await r.json()) as Record<string, unknown>;
}

async function loadPushState(db: D1Database): Promise<string> {
  const row = await db
    .prepare(`SELECT last_notice_id FROM kilauea_volcano_notice_push_state WHERE id = ? LIMIT 1`)
    .bind(STATE_ID)
    .first<{ last_notice_id: string }>();
  return str(row?.last_notice_id);
}

async function savePushState(db: D1Database, noticeId: string, nowIso: string): Promise<void> {
  await db
    .prepare(
      `INSERT INTO kilauea_volcano_notice_push_state (id, last_notice_id, pushed_at)
       VALUES (?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         last_notice_id = excluded.last_notice_id,
         pushed_at = excluded.pushed_at`,
    )
    .bind(STATE_ID, noticeId, nowIso)
    .run();
}

async function kilaueaAndroidTokens(db: D1Database): Promise<string[]> {
  const { results } = await db
    .prepare(`SELECT token FROM rrwm_push_tokens WHERE app_id = ? AND LENGTH(token) >= 20`)
    .bind(KILAUEA_ANDROID_APP_ID)
    .all<{ token: string }>();
  const seen = new Set<string>();
  return (results || [])
    .map((row) => str(row.token))
    .filter((token) => token.length >= 20 && !seen.has(token) && (seen.add(token), true));
}

/** Detect new USGS HANS Kīlauea notices and FCM-push Android installs (10-minute cron). */
export async function runKilaueaVolcanoNoticePushCron(env: {
  DB: D1Database;
  FCM_SERVICE_ACCOUNT_JSON?: string;
  FCM_PROJECT_ID?: string;
  FCM_CLIENT_EMAIL?: string;
  FCM_PRIVATE_KEY?: string;
}): Promise<void> {
  const fcm = resolveFcmCredentials(env);
  if (!fcm) return;

  let volcano: Record<string, unknown>;
  let newest: Record<string, unknown>;
  try {
    [volcano, newest] = await Promise.all([
      fetchJson(`${HANS_BASE}/getVolcano/${VNUM_KILAUEA}`),
      fetchJson(`${HANS_BASE}/newestForVolcano/${VNUM_KILAUEA}`),
    ]);
  } catch (e) {
    console.warn("kilauea_volcano_push_fetch", e instanceof Error ? e.message : String(e));
    return;
  }

  const noticeId = volcanoNewestNoticeId(newest);
  if (!noticeId) return;

  const previous = await loadPushState(env.DB);
  if (!previous) {
    await savePushState(env.DB, noticeId, new Date().toISOString());
    return;
  }
  if (noticeId === previous) return;

  const plain = stripHtml(str(newest.noticeHtml)).slice(0, 500);
  const urgent = isUrgentNotice(volcano, newest, plain);
  const title = urgent
    ? "Kīlauea — eruptive activity or elevated unrest (USGS)"
    : "Kīlauea update (USGS)";
  const headline = str(newest.noticeTitle || newest.title || newest.Subject);
  const body = headline
    ? `${headline.slice(0, 160)} — open the app for official USGS wording.`
    : urgent
      ? "A new USGS notice describes eruption, lava, strong unrest, or elevated aviation color."
      : "New volcano notice or status change. Open the app for official details.";

  const tokens = await kilaueaAndroidTokens(env.DB);
  if (!tokens.length) {
    await savePushState(env.DB, noticeId, new Date().toISOString());
    return;
  }

  let accessToken = "";
  try {
    accessToken = await getFcmAccessToken({ clientEmail: fcm.clientEmail, privateKey: fcm.privateKey });
  } catch (e) {
    console.error("kilauea_volcano_push_oauth", e instanceof Error ? e.message : String(e));
    return;
  }

  const data = {
    type: "volcano_notice",
    notice_id: noticeId,
    urgent: urgent ? "true" : "false",
    title,
    body,
  };

  let success = 0;
  for (let i = 0; i < tokens.length; i += 24) {
    const chunk = tokens.slice(i, i + 24);
    const part = await Promise.all(
      chunk.map((token) => sendFcmDataNotification(fcm.projectId, accessToken, token, data)),
    );
    success += part.filter((r) => r.ok).length;
  }

  if (success > 0) {
    await savePushState(env.DB, noticeId, new Date().toISOString());
  }
  console.log(
    JSON.stringify({
      msg: "kilauea_volcano_notice_push",
      notice_id: noticeId,
      urgent,
      success,
      total_tokens: tokens.length,
    }),
  );
}
