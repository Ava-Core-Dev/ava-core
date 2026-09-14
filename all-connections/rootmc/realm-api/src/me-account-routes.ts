import type { D1Database } from "@cloudflare/workers-types";
import { json } from "./cors";
import {
  extractAuthToken,
  sessionFromRequest,
  type SessionInsertMeta,
  type AuthEnv,
} from "./primary-auth";
import { buildClearSessionCookieHeader, ssoCookieDomainForApiHost } from "./web-sso";

export type MeAccountEnv = AuthEnv & {
  SITE_URL?: string;
};

function ssoClearCookieLine(request: Request): string | undefined {
  const dom = ssoCookieDomainForApiHost(new URL(request.url).hostname);
  if (!dom) return undefined;
  return buildClearSessionCookieHeader(dom);
}

export function buildSessionInsertMeta(request: Request, deviceId: string | null): SessionInsertMeta {
  const ua = (request.headers.get("User-Agent") || "").trim().slice(0, 512) || null;
  const cf =
    (request.headers.get("CF-Connecting-IP") || "").trim() ||
    (request.headers.get("X-Forwarded-For") || "").split(",")[0]?.trim().slice(0, 64) ||
    "";
  const ip = cf || null;
  const d = deviceId ? String(deviceId).trim().slice(0, 128) : "";
  return { device_id: d || null, user_agent: ua, ip };
}

async function revokeAllSessions(db: D1Database, accountId: string): Promise<void> {
  const now = new Date().toISOString();
  try {
    await db
      .prepare("UPDATE license_sessions SET revoked_at = ? WHERE account_id = ? AND revoked_at IS NULL")
      .bind(now, accountId)
      .run();
  } catch {
    /* ignore */
  }
}

async function revokeSessionById(db: D1Database, accountId: string, sessionId: string): Promise<boolean> {
  const now = new Date().toISOString();
  try {
    const r = await db
      .prepare(
        `UPDATE license_sessions SET revoked_at = ?
         WHERE id = ? AND account_id = ? AND revoked_at IS NULL`,
      )
      .bind(now, sessionId, accountId)
      .run();
    return Number(r.meta?.rows_written ?? 0) > 0;
  } catch {
    return false;
  }
}

export async function handleAuthLogout(request: Request, env: MeAccountEnv): Promise<Response> {
  let allDevices = false;
  try {
    const raw = await request.text();
    if (raw && raw.trim()) {
      const b = JSON.parse(raw) as { all_devices?: boolean };
      allDevices = Boolean(b?.all_devices);
    }
  } catch {
    allDevices = false;
  }

  const clearLine = ssoClearCookieLine(request);
  const sess = await sessionFromRequest(env, request);
  if (!sess) {
    return json({ ok: true }, 200, undefined, clearLine);
  }

  if (allDevices) {
    let n = 0;
    try {
      const row = await env.DB.prepare(
        `SELECT COUNT(*) AS c FROM license_sessions WHERE account_id = ? AND revoked_at IS NULL`,
      )
        .bind(sess.accountId)
        .first<{ c: number }>();
      n = Math.max(0, Number(row?.c) || 0);
    } catch {
      n = 0;
    }
    await revokeAllSessions(env.DB, sess.accountId);
    return json({ ok: true, revoked: n }, 200, undefined, clearLine);
  }

  if (sess.sessionId) {
    await revokeSessionById(env.DB, sess.accountId, sess.sessionId);
  }
  return json({ ok: true }, 200, undefined, clearLine);
}

export async function handleAuthLogoutAll(request: Request, env: MeAccountEnv): Promise<Response> {
  const clearLine = ssoClearCookieLine(request);
  const sess = await sessionFromRequest(env, request);
  if (!sess) {
    return json(
      { detail: "Unauthorized" },
      401,
      undefined,
      extractAuthToken(request) ? clearLine : undefined,
    );
  }
  let n = 0;
  try {
    const row = await env.DB.prepare(
      `SELECT COUNT(*) AS c FROM license_sessions WHERE account_id = ? AND revoked_at IS NULL`,
    )
      .bind(sess.accountId)
      .first<{ c: number }>();
    n = Math.max(0, Number(row?.c) || 0);
  } catch {
    n = 0;
  }
  await revokeAllSessions(env.DB, sess.accountId);
  return json({ ok: true, revoked: n }, 200, undefined, clearLine);
}
