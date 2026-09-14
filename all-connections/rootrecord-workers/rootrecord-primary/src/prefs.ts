import type { D1Database } from "@cloudflare/workers-types";
import { json } from "./cors";
import { resolveUserId } from "./auth";

export interface PrefsEnv {
  DB: D1Database;
  JWT_SECRET: string;
}

export async function handlePrefsRoutes(
  request: Request,
  env: PrefsEnv,
  sub: string,
  method: string
): Promise<Response | null> {
  if (sub !== "/me/prefs") return null;
  const user = await resolveUserId(request, env);
  if (user instanceof Response) return user;

  if (method === "GET") {
    const row = await env.DB.prepare("SELECT noaa_alerts_enabled FROM rrwm_user_prefs WHERE user_id = ?")
      .bind(user)
      .first<{ noaa_alerts_enabled: number }>();
    const enabled = row ? Boolean(row.noaa_alerts_enabled) : true;
    return json({ noaa_alerts_enabled: enabled }, 200);
  }

  if (method === "POST") {
    let body: { noaa_alerts_enabled?: boolean };
    try {
      body = (await request.json()) as typeof body;
    } catch {
      return json({ detail: "Invalid JSON." }, 400);
    }
    const enabled = body.noaa_alerts_enabled !== undefined ? Boolean(body.noaa_alerts_enabled) : true;
    const updatedAt = new Date().toISOString();
    await env.DB.prepare(
      `INSERT INTO rrwm_user_prefs (user_id, noaa_alerts_enabled, updated_at)
       VALUES (?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET noaa_alerts_enabled = excluded.noaa_alerts_enabled, updated_at = excluded.updated_at`
    )
      .bind(user, enabled ? 1 : 0, updatedAt)
      .run();
    return json({ ok: true, noaa_alerts_enabled: enabled }, 200);
  }

  return json({ detail: "Method not allowed" }, 405);
}

export async function readNoaaAlertsEnabled(db: D1Database, userId: string): Promise<boolean> {
  const row = await db
    .prepare("SELECT noaa_alerts_enabled FROM rrwm_user_prefs WHERE user_id = ?")
    .bind(userId)
    .first<{ noaa_alerts_enabled: number }>();
  if (!row) return true; // default enabled
  return Boolean(row.noaa_alerts_enabled);
}

