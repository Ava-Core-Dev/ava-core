import type { D1Database } from "@cloudflare/workers-types";
import { json } from "./cors";
import { sessionFromRequest, type AuthEnv } from "./primary-auth";

type EmailPrefsEnv = AuthEnv;

type MarketingPrefs = {
  general_newsletter: boolean;
  kilauea_newsletter: boolean;
  business_manager_newsletter: boolean;
  simple_weather_newsletter: boolean;
  updated_at: string;
};

function fromInt(v: unknown): boolean {
  return Number(v) === 1;
}

async function ensureRow(db: D1Database, accountId: string, email: string): Promise<void> {
  const now = new Date().toISOString();
  await db
    .prepare(
      `INSERT INTO rr_email_marketing_prefs (
         account_id, email, general_newsletter, kilauea_newsletter, business_manager_newsletter, simple_weather_newsletter, created_at, updated_at
       ) VALUES (?, ?, 1, 1, 1, 1, ?, ?)
       ON CONFLICT(account_id) DO NOTHING`,
    )
    .bind(accountId, email, now, now)
    .run();
}

async function readPrefs(db: D1Database, accountId: string): Promise<MarketingPrefs> {
  const row = await db
    .prepare(
      `SELECT general_newsletter, kilauea_newsletter, business_manager_newsletter, simple_weather_newsletter, updated_at
       FROM rr_email_marketing_prefs
       WHERE account_id = ?`,
    )
    .bind(accountId)
    .first<{
      general_newsletter: number;
      kilauea_newsletter: number;
      business_manager_newsletter: number;
      simple_weather_newsletter: number;
      updated_at: string;
    }>();
  return {
    general_newsletter: fromInt(row?.general_newsletter),
    kilauea_newsletter: fromInt(row?.kilauea_newsletter),
    business_manager_newsletter: fromInt(row?.business_manager_newsletter),
    simple_weather_newsletter: fromInt(row?.simple_weather_newsletter),
    updated_at: String(row?.updated_at || ""),
  };
}

function boolFromBody(v: unknown, current: boolean): boolean {
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return v === 1;
  if (typeof v === "string") {
    const s = v.trim().toLowerCase();
    if (s === "1" || s === "true" || s === "yes" || s === "on") return true;
    if (s === "0" || s === "false" || s === "no" || s === "off") return false;
  }
  return current;
}

async function handleGet(request: Request, env: EmailPrefsEnv): Promise<Response> {
  const sess = await sessionFromRequest(env, request);
  if (!sess) return json({ detail: "Unauthorized" }, 401);
  try {
    await ensureRow(env.DB, sess.accountId, sess.email);
    const prefs = await readPrefs(env.DB, sess.accountId);
    return json({ ok: true, preferences: prefs }, 200);
  } catch (e) {
    const msg = String(e && typeof e === "object" && "message" in e ? (e as Error).message : e);
    console.error("email_prefs_get", msg);
    return json({ detail: "Could not load email preferences." }, 500);
  }
}

async function handlePatch(request: Request, env: EmailPrefsEnv): Promise<Response> {
  const sess = await sessionFromRequest(env, request);
  if (!sess) return json({ detail: "Unauthorized" }, 401);
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return json({ detail: "Invalid JSON." }, 400);
  }
  try {
    await ensureRow(env.DB, sess.accountId, sess.email);
    const current = await readPrefs(env.DB, sess.accountId);
    const next = {
      general_newsletter: boolFromBody(body.general_newsletter, current.general_newsletter),
      kilauea_newsletter: boolFromBody(body.kilauea_newsletter, current.kilauea_newsletter),
      business_manager_newsletter: boolFromBody(body.business_manager_newsletter, current.business_manager_newsletter),
      simple_weather_newsletter: boolFromBody(body.simple_weather_newsletter, current.simple_weather_newsletter),
    };
    const now = new Date().toISOString();
    await env.DB
      .prepare(
        `UPDATE rr_email_marketing_prefs
         SET email = ?, general_newsletter = ?, kilauea_newsletter = ?, business_manager_newsletter = ?, simple_weather_newsletter = ?, updated_at = ?
         WHERE account_id = ?`,
      )
      .bind(
        sess.email,
        next.general_newsletter ? 1 : 0,
        next.kilauea_newsletter ? 1 : 0,
        next.business_manager_newsletter ? 1 : 0,
        next.simple_weather_newsletter ? 1 : 0,
        now,
        sess.accountId,
      )
      .run();
    return json({ ok: true, preferences: { ...next, updated_at: now } }, 200);
  } catch (e) {
    const msg = String(e && typeof e === "object" && "message" in e ? (e as Error).message : e);
    console.error("email_prefs_patch", msg);
    return json({ detail: "Could not save email preferences." }, 500);
  }
}

export async function handleEmailMarketingPrefsRoute(
  request: Request,
  env: EmailPrefsEnv,
  sub: string,
  method: string,
): Promise<Response | null> {
  if (sub !== "/v1/me/email-marketing-prefs" && sub !== "/me/email-marketing-prefs") return null;
  if (method === "GET") return handleGet(request, env);
  if (method === "PATCH") return handlePatch(request, env);
  return json({ detail: "Method not allowed." }, 405);
}
