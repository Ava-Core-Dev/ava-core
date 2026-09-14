import type { D1Database } from "@cloudflare/workers-types";

import { getFcmAccessToken, sendFcmNotification } from "../../rootrecord-api-account/src/fcm-v1";
import { json } from "./cors";
import { requireSignedInAccount, str } from "./realm-lib";
import { shopPriceCatalog } from "./rootmc-economy";
import { FEATURED_SERVER_DEFAULTS } from "./rootmc-server";
import type { RootStatEnv } from "./rootstat-minecraft";

const ROOTMC_APP_ID = "rootrecord_rootmc_android";
const MAX_ALERTS_PER_ACCOUNT = 24;
const NOTIFY_COOLDOWN_MS = 6 * 60 * 60 * 1000;

export type ShopAlertsEnv = RootStatEnv & {
  FCM_SERVICE_ACCOUNT_JSON?: string;
  FCM_PROJECT_ID?: string;
  FCM_CLIENT_EMAIL?: string;
  FCM_PRIVATE_KEY?: string;
};

function nowIso(): string {
  return new Date().toISOString();
}

function normalizeItemKey(raw: string): string {
  return str(raw).toUpperCase().replace(/[^A-Z0-9_]/g, "_").slice(0, 64);
}

function normalizeAlertType(raw: string): "below" | "above" | null {
  const t = str(raw).toLowerCase();
  if (t === "below" || t === "above") return t;
  return null;
}

function resolveFcmCredentials(env: ShopAlertsEnv): { projectId: string; clientEmail: string; privateKey: string } | null {
  const raw = str(env.FCM_SERVICE_ACCOUNT_JSON);
  if (raw) {
    try {
      const j = JSON.parse(raw) as { project_id?: string; client_email?: string; private_key?: string };
      const projectId = str(j.project_id);
      const clientEmail = str(j.client_email);
      const privateKey = str(j.private_key);
      if (projectId && clientEmail && privateKey) return { projectId, clientEmail, privateKey };
    } catch {
      return null;
    }
    return null;
  }
  const projectId = str(env.FCM_PROJECT_ID);
  const clientEmail = str(env.FCM_CLIENT_EMAIL);
  const privateKey = str(env.FCM_PRIVATE_KEY);
  if (projectId && clientEmail && privateKey) return { projectId, clientEmail, privateKey };
  return null;
}

async function emailForAccount(db: D1Database, accountId: string): Promise<string | null> {
  const row = await db
    .prepare("SELECT email FROM license_accounts WHERE id = ? LIMIT 1")
    .bind(accountId)
    .first<{ email: string }>();
  const email = row?.email ? str(row.email).toLowerCase() : "";
  return email || null;
}

async function priceMap(db: D1Database, serverId: string): Promise<Map<string, number>> {
  const rows = await shopPriceCatalog(db, serverId, 500);
  const map = new Map<string, number>();
  for (const row of rows) {
    const key = normalizeItemKey(str(row.item_key));
    const avg = Number(row.avg_price) || 0;
    if (key && avg > 0) map.set(key, avg);
  }
  return map;
}

function shouldNotify(
  alertType: string,
  current: number,
  threshold: number,
  lastNotifiedAt: string | null,
  lastNotifiedPrice: number | null,
): boolean {
  if (current <= 0 || threshold <= 0) return false;
  const hit =
    alertType === "below" ? current <= threshold : alertType === "above" ? current >= threshold : false;
  if (!hit) return false;
  if (lastNotifiedAt) {
    const age = Date.now() - Date.parse(lastNotifiedAt);
    if (Number.isFinite(age) && age < NOTIFY_COOLDOWN_MS) {
      if (lastNotifiedPrice != null && Math.abs(lastNotifiedPrice - current) < 0.001) return false;
    }
  }
  return true;
}

async function pushToAccount(
  env: ShopAlertsEnv,
  accountId: string,
  title: string,
  body: string,
): Promise<{ sent: number; failed: number }> {
  const creds = resolveFcmCredentials(env);
  if (!creds) return { sent: 0, failed: 0 };
  const email = await emailForAccount(env.DB, accountId);
  if (!email) return { sent: 0, failed: 0 };
  const userId = `user:${email}`;
  const { results } = await env.DB.prepare(
    `SELECT token FROM rrwm_push_tokens
     WHERE user_id = ? AND LENGTH(token) >= 20
       AND (app_id IS NULL OR app_id = ? OR app_id = '')`,
  )
    .bind(userId, ROOTMC_APP_ID)
    .all<{ token: string }>();
  const tokens = [...new Set((results || []).map((r) => str(r.token)).filter((t) => t.length >= 20))];
  if (!tokens.length) return { sent: 0, failed: 0 };
  let accessToken: string;
  try {
    accessToken = await getFcmAccessToken({ clientEmail: creds.clientEmail, privateKey: creds.privateKey });
  } catch (e) {
    console.warn("rootmc_shop_alert_fcm_oauth", e instanceof Error ? e.message : String(e));
    return { sent: 0, failed: tokens.length };
  }
  let sent = 0;
  let failed = 0;
  for (const token of tokens) {
    const r = await sendFcmNotification(creds.projectId, accessToken, token, title, body);
    if (r.ok) sent += 1;
    else failed += 1;
  }
  return { sent, failed };
}

export async function evaluateShopPriceAlerts(env: ShopAlertsEnv): Promise<{ checked: number; notified: number }> {
  const serverId = FEATURED_SERVER_DEFAULTS.server_id;
  const prices = await priceMap(env.DB, serverId);
  const { results } = await env.DB.prepare(
    `SELECT id, account_id, item_key, alert_type, threshold_value, last_notified_at, last_notified_price
     FROM rootmc_shop_price_alerts
     WHERE server_id = ? AND enabled = 1`,
  )
    .bind(serverId)
    .all<Record<string, unknown>>();
  const rows = results || [];
  let notified = 0;
  const now = nowIso();
  for (const row of rows) {
    const id = str(row.id);
    const itemKey = normalizeItemKey(str(row.item_key));
    const current = prices.get(itemKey) ?? 0;
    await env.DB.prepare(
      `UPDATE rootmc_shop_price_alerts SET last_seen_price = ?, updated_at = ? WHERE id = ?`,
    )
      .bind(current > 0 ? current : null, now, id)
      .run();
    if (current <= 0) continue;
    const alertType = str(row.alert_type) || "below";
    const threshold = Number(row.threshold_value) || 0;
    const lastAt = row.last_notified_at ? str(row.last_notified_at) : null;
    const lastPrice =
      row.last_notified_price == null || row.last_notified_price === ""
        ? null
        : Number(row.last_notified_price);
    if (!shouldNotify(alertType, current, threshold, lastAt, lastPrice)) continue;
    const accountId = str(row.account_id);
    const dir = alertType === "below" ? "at or below" : "at or above";
    const title = "RootMC shop alert";
    const body = `${itemKey.replace(/_/g, " ")} is ${dir} ${threshold.toFixed(3)} G (now ${current.toFixed(3)} G avg)`;
    const push = await pushToAccount(env, accountId, title, body);
    if (push.sent > 0) {
      notified += 1;
      await env.DB.prepare(
        `UPDATE rootmc_shop_price_alerts
         SET last_notified_at = ?, last_notified_price = ?, updated_at = ?
         WHERE id = ?`,
      )
        .bind(now, current, now, id)
        .run();
    }
  }
  return { checked: rows.length, notified };
}

export async function handleRootMcShopAlerts(
  request: Request,
  env: ShopAlertsEnv,
  subpath: string,
  method: string,
): Promise<Response | null> {
  const serverIdDefault = FEATURED_SERVER_DEFAULTS.server_id;

  if (method === "GET" && subpath === "/rootmc/shop-alerts") {
    const auth = await requireSignedInAccount(request, env);
    if (auth instanceof Response) return auth;
    const url = new URL(request.url);
    const serverId = str(url.searchParams.get("server_id")) || serverIdDefault;
    const { results } = await env.DB.prepare(
      `SELECT id, server_id, item_key, alert_type, threshold_value, enabled,
              last_seen_price, last_notified_at, last_notified_price, created_at, updated_at
       FROM rootmc_shop_price_alerts
       WHERE account_id = ? AND server_id = ?
       ORDER BY item_key ASC, alert_type ASC`,
    )
      .bind(auth.accountId, serverId)
      .all();
    return json({ server_id: serverId, alerts: results || [] });
  }

  if (method === "POST" && subpath === "/rootmc/shop-alerts") {
    const auth = await requireSignedInAccount(request, env);
    if (auth instanceof Response) return auth;
    let body: { server_id?: string; item_key?: string; alert_type?: string; threshold_value?: number };
    try {
      body = (await request.json()) as typeof body;
    } catch {
      return json({ detail: "Invalid JSON." }, 400);
    }
    const serverId = str(body.server_id) || serverIdDefault;
    const itemKey = normalizeItemKey(str(body.item_key));
    const alertType = normalizeAlertType(str(body.alert_type) || "below");
    const threshold = Number(body.threshold_value);
    if (!itemKey) return json({ detail: "item_key required." }, 400);
    if (!alertType) return json({ detail: "alert_type must be below or above." }, 400);
    if (!Number.isFinite(threshold) || threshold <= 0) {
      return json({ detail: "threshold_value must be a positive number." }, 400);
    }
    const countRow = await env.DB.prepare(
      `SELECT COUNT(*) AS c FROM rootmc_shop_price_alerts WHERE account_id = ? AND server_id = ?`,
    )
      .bind(auth.accountId, serverId)
      .first<{ c: number }>();
    if ((Number(countRow?.c) || 0) >= MAX_ALERTS_PER_ACCOUNT) {
      return json({ detail: `Maximum ${MAX_ALERTS_PER_ACCOUNT} alerts per account.` }, 400);
    }
    const now = nowIso();
    const id = crypto.randomUUID();
    try {
      await env.DB.prepare(
        `INSERT INTO rootmc_shop_price_alerts
         (id, account_id, server_id, item_key, alert_type, threshold_value, enabled, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)`,
      )
        .bind(id, auth.accountId, serverId, itemKey, alertType, threshold, now, now)
        .run();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.toLowerCase().includes("unique") || msg.toLowerCase().includes("constraint")) {
        return json({ detail: "You already have an alert for this item and direction." }, 409);
      }
      throw e;
    }
    const prices = await priceMap(env.DB, serverId);
    const current = prices.get(itemKey) ?? null;
    if (current != null) {
      await env.DB.prepare(
        `UPDATE rootmc_shop_price_alerts SET last_seen_price = ? WHERE id = ?`,
      )
        .bind(current, id)
        .run();
    }
    return json(
      {
        ok: true,
        alert: {
          id,
          server_id: serverId,
          item_key: itemKey,
          alert_type: alertType,
          threshold_value: threshold,
          enabled: 1,
          last_seen_price: current,
          created_at: now,
          updated_at: now,
        },
      },
      201,
    );
  }

  const deleteMatch = subpath.match(/^\/rootmc\/shop-alerts\/([^/]+)$/);
  if (method === "DELETE" && deleteMatch) {
    const auth = await requireSignedInAccount(request, env);
    if (auth instanceof Response) return auth;
    const id = str(deleteMatch[1]);
    const r = await env.DB.prepare(
      `DELETE FROM rootmc_shop_price_alerts WHERE id = ? AND account_id = ?`,
    )
      .bind(id, auth.accountId)
      .run();
    if (!r.meta.changes) return json({ detail: "Alert not found." }, 404);
    return json({ ok: true });
  }

  const patchMatch = subpath.match(/^\/rootmc\/shop-alerts\/([^/]+)$/);
  if (method === "PATCH" && patchMatch) {
    const auth = await requireSignedInAccount(request, env);
    if (auth instanceof Response) return auth;
    let body: { enabled?: boolean; threshold_value?: number };
    try {
      body = (await request.json()) as typeof body;
    } catch {
      return json({ detail: "Invalid JSON." }, 400);
    }
    const id = str(patchMatch[1]);
    const existing = await env.DB.prepare(
      `SELECT id FROM rootmc_shop_price_alerts WHERE id = ? AND account_id = ? LIMIT 1`,
    )
      .bind(id, auth.accountId)
      .first();
    if (!existing) return json({ detail: "Alert not found." }, 404);
    const now = nowIso();
    if (body.enabled != null) {
      await env.DB.prepare(
        `UPDATE rootmc_shop_price_alerts SET enabled = ?, updated_at = ? WHERE id = ?`,
      )
        .bind(body.enabled ? 1 : 0, now, id)
        .run();
    }
    if (body.threshold_value != null) {
      const threshold = Number(body.threshold_value);
      if (!Number.isFinite(threshold) || threshold <= 0) {
        return json({ detail: "threshold_value must be positive." }, 400);
      }
      await env.DB.prepare(
        `UPDATE rootmc_shop_price_alerts SET threshold_value = ?, updated_at = ? WHERE id = ?`,
      )
        .bind(threshold, now, id)
        .run();
    }
    return json({ ok: true });
  }

  return null;
}
