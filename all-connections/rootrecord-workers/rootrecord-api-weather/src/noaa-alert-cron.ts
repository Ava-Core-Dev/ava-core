import type { D1Database } from "@cloudflare/workers-types";
import { getFcmAccessToken, sendFcmNotification } from "./fcm-v1";
import { loadProFlags } from "./free-tier";
import { readNoaaAlertsEnabled } from "./prefs";

type FcmCreds = { projectId: string; clientEmail: string; privateKey: string };

function resolveFcmCredentials(env: {
  FCM_SERVICE_ACCOUNT_JSON?: string;
  FCM_PROJECT_ID?: string;
  FCM_CLIENT_EMAIL?: string;
  FCM_PRIVATE_KEY?: string;
}): FcmCreds | null {
  const raw = (env.FCM_SERVICE_ACCOUNT_JSON || "").trim();
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
  const projectId = (env.FCM_PROJECT_ID || "").trim();
  const clientEmail = (env.FCM_CLIENT_EMAIL || "").trim();
  const privateKey = (env.FCM_PRIVATE_KEY || "").trim();
  if (projectId && clientEmail && privateKey) return { projectId, clientEmail, privateKey };
  return null;
}

type LocationRow = { id: string; user_id: string; name: string; latitude: number; longitude: number };

type NwsFeature = { id?: string; properties?: { headline?: string; event?: string; severity?: string } };
type NwsActive = { features?: NwsFeature[] };

function normalizeAlertId(raw: string): string {
  return String(raw || "").trim().slice(0, 220);
}

function pickHeadline(f: NwsFeature): string {
  const p = f?.properties || {};
  return String(p.headline || p.event || "Weather alert").trim().slice(0, 160) || "Weather alert";
}

async function fetchNoaaActive(lat: number, lon: number): Promise<{ ids: string[]; headline: string | null }> {
  const url = `https://api.weather.gov/alerts/active?point=${lat.toFixed(4)},${lon.toFixed(4)}`;
  const r = await fetch(url, {
    headers: { "User-Agent": "RootRecord Weather Manager Mobile (rootrecord.info)", Accept: "application/geo+json" },
  });
  if (!r.ok) return { ids: [], headline: null };
  const data = (await r.json()) as NwsActive;
  const feats = Array.isArray(data.features) ? data.features : [];
  const ids: string[] = [];
  let headline: string | null = null;
  for (const f of feats) {
    const id = normalizeAlertId(String(f?.id || ""));
    if (!id) continue;
    if (!headline) headline = pickHeadline(f);
    ids.push(id);
  }
  return { ids: [...new Set(ids)], headline };
}

async function wasSeen(db: D1Database, userId: string, locationId: string, alertId: string): Promise<boolean> {
  const row = await db
    .prepare(
      `SELECT alert_id FROM rrwm_alert_seen
       WHERE user_id = ? AND location_id = ? AND source = 'noaa' AND alert_id = ?
       LIMIT 1`
    )
    .bind(userId, locationId, alertId)
    .first<{ alert_id: string }>();
  return Boolean(row?.alert_id);
}

async function markSeen(db: D1Database, userId: string, locationId: string, alertId: string, nowIso: string): Promise<void> {
  await db
    .prepare(
      `INSERT INTO rrwm_alert_seen (user_id, location_id, source, alert_id, first_seen_at, last_seen_at)
       VALUES (?, ?, 'noaa', ?, ?, ?)
       ON CONFLICT(user_id, location_id, source, alert_id) DO UPDATE SET last_seen_at = excluded.last_seen_at`
    )
    .bind(userId, locationId, alertId, nowIso, nowIso)
    .run();
}

async function tokensForUser(db: D1Database, userId: string): Promise<string[]> {
  const { results } = await db
    .prepare("SELECT token FROM rrwm_push_tokens WHERE user_id = ? AND LENGTH(token) >= 20")
    .bind(userId)
    .all<{ token: string }>();
  const seen = new Set<string>();
  const out: string[] = [];
  for (const row of results || []) {
    const t = String(row.token || "").trim();
    if (t && !seen.has(t)) {
      seen.add(t);
      out.push(t);
    }
  }
  return out;
}

async function deletePushToken(db: D1Database, token: string): Promise<void> {
  await db.prepare("DELETE FROM rrwm_push_tokens WHERE token = ?").bind(token).run();
}

function isStaleFcmTokenError(err: string): boolean {
  const e = err.toLowerCase();
  return (
    e.includes("not_found") ||
    e.includes("unregistered") ||
    e.includes("invalid-registration") ||
    e.includes("registration-token-not-registered") ||
    e.includes("requested entity was not found")
  );
}

export async function runNoaaAlertCron(env: {
  DB: D1Database;
  FCM_SERVICE_ACCOUNT_JSON?: string;
  FCM_PROJECT_ID?: string;
  FCM_CLIENT_EMAIL?: string;
  FCM_PRIVATE_KEY?: string;
}): Promise<void> {
  const fcm = resolveFcmCredentials(env);
  if (!fcm) return;

  // Only check locations for users who have at least one push token registered.
  const { results } = await env.DB.prepare(
    `SELECT l.id, l.user_id, l.name, l.latitude, l.longitude
     FROM rrwm_locations l
     WHERE EXISTS (SELECT 1 FROM rrwm_push_tokens t WHERE t.user_id = l.user_id)
     ORDER BY l.user_id, l.created_at DESC
     LIMIT 500`
  ).all<LocationRow>();
  const locs = results || [];
  if (!locs.length) return;

  const accessToken = await getFcmAccessToken({ clientEmail: fcm.clientEmail, privateKey: fcm.privateKey });

  const tokenCache = new Map<string, string[]>();
  const prefsCache = new Map<string, boolean>();
  const proCache = new Map<string, boolean>();
  const nowIso = new Date().toISOString();

  for (const loc of locs) {
    const isPro =
      proCache.get(loc.user_id) ??
      (await (async () => {
        const { pro } = await loadProFlags(env.DB, loc.user_id);
        proCache.set(loc.user_id, pro);
        return pro;
      })());
    if (!isPro) continue;

    const enabled =
      prefsCache.get(loc.user_id) ??
      (await (async () => {
        const v = await readNoaaAlertsEnabled(env.DB, loc.user_id);
        prefsCache.set(loc.user_id, v);
        return v;
      })());
    if (!enabled) continue;

    const { ids, headline } = await fetchNoaaActive(Number(loc.latitude), Number(loc.longitude));
    if (!ids.length) continue;

    const newIds: string[] = [];
    for (const id of ids) {
      if (!(await wasSeen(env.DB, loc.user_id, loc.id, id))) newIds.push(id);
    }
    if (!newIds.length) continue;

    const tokens = tokenCache.get(loc.user_id) || (await tokensForUser(env.DB, loc.user_id));
    tokenCache.set(loc.user_id, tokens);
    if (!tokens.length) continue;

    const title = "Weather alert";
    const body =
      newIds.length === 1
        ? `${loc.name}: ${headline || "New NOAA alert"}`
        : `${loc.name}: ${newIds.length} new NOAA alerts`;

    let anyDelivered = false;
    const concurrency = 12;
    for (let i = 0; i < tokens.length; i += concurrency) {
      const chunk = tokens.slice(i, i + concurrency);
      const part = await Promise.all(
        chunk.map(async (t) => {
          const r = await sendFcmNotification(fcm.projectId, accessToken, t, title, body);
          if (!r.ok && isStaleFcmTokenError(r.error)) {
            try {
              await deletePushToken(env.DB, t);
            } catch {
              /* ignore */
            }
          }
          return r;
        })
      );
      if (part.some((r) => r.ok)) anyDelivered = true;
    }

    if (!anyDelivered) continue;

    for (const id of newIds) {
      try {
        await markSeen(env.DB, loc.user_id, loc.id, id, nowIso);
      } catch {
        /* ignore */
      }
    }
  }
}
