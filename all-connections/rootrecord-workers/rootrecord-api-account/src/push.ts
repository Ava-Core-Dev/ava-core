import type { D1Database } from "@cloudflare/workers-types";
import { json } from "./cors";
import { resolveUserId } from "./auth";
import { getFcmAccessToken, sendFcmNotification } from "./fcm-v1";

export interface PushEnv {
  DB: D1Database;
  JWT_SECRET: string;
  RR_PUSH_ADMIN_SECRET?: string;
  /** Full Firebase service account JSON (one Wrangler secret). */
  FCM_SERVICE_ACCOUNT_JSON?: string;
  FCM_PROJECT_ID?: string;
  FCM_CLIENT_EMAIL?: string;
  FCM_PRIVATE_KEY?: string;
}

/** Prefer `FCM_SERVICE_ACCOUNT_JSON`; else the three separate vars. */
function resolveFcmCredentials(env: PushEnv): { projectId: string; clientEmail: string; privateKey: string } | null {
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

async function sha256DigestBytes(text: string): Promise<ArrayBuffer> {
  return crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
}

function timingSafeEqual(a: ArrayBuffer, b: ArrayBuffer): boolean {
  if (a.byteLength !== b.byteLength) return false;
  const ua = new Uint8Array(a);
  const ub = new Uint8Array(b);
  let diff = 0;
  for (let i = 0; i < ua.length; i++) diff |= ua[i]! ^ ub[i]!;
  return diff === 0;
}

/** Compare SHA-256(header) to SHA-256(secret) (constant-time). */
export async function verifyPushAdminKey(headerVal: string | null, secret: string): Promise<boolean> {
  const h = (headerVal || "").trim();
  const s = (secret || "").trim();
  if (!h || !s) return false;
  const pHash = await sha256DigestBytes(h);
  const sHash = await sha256DigestBytes(s);
  return timingSafeEqual(pHash, sHash);
}

/** Same gate as POST /api/internal/push-broadcast (`X-RR-Push-Admin-Key` vs `RR_PUSH_ADMIN_SECRET`). */
export async function verifyWorkerOpsAdmin(request: Request, env: { RR_PUSH_ADMIN_SECRET?: string }): Promise<boolean> {
  const secret = (env.RR_PUSH_ADMIN_SECRET || "").trim();
  if (!secret) return false;
  return verifyPushAdminKey(request.headers.get("X-RR-Push-Admin-Key"), secret);
}

export async function handlePushRoutes(
  request: Request,
  env: PushEnv,
  sub: string,
  method: string
): Promise<Response | null> {
  if (method === "POST" && sub === "/me/push-token") {
    const user = await resolveUserId(request, env);
    if (user instanceof Response) return user;
    let body: { token?: string; platform?: string; app_id?: string };
    try {
      body = (await request.json()) as typeof body;
    } catch {
      return json({ detail: "Invalid JSON." }, 400);
    }
    const tok = String(body.token || "").trim();
    if (tok.length < 20) return json({ detail: "Invalid token." }, 400);
    const plat = String(body.platform || "android")
      .trim()
      .toLowerCase()
      .slice(0, 32);
    const appId = String(body.app_id || request.headers.get("X-RR-App-Id") || "")
      .trim()
      .toLowerCase()
      .slice(0, 80);
    const updatedAt = new Date().toISOString();
    await env.DB.prepare(
      `INSERT INTO rrwm_push_tokens (token, user_id, platform, updated_at, app_id)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(token) DO UPDATE SET user_id = excluded.user_id, platform = excluded.platform, updated_at = excluded.updated_at, app_id = excluded.app_id`
    )
      .bind(tok, user, plat || "android", updatedAt, appId || null)
      .run();
    return json({ ok: true }, 200);
  }

  if (method === "POST" && sub === "/internal/push-broadcast") {
    const secret = (env.RR_PUSH_ADMIN_SECRET || "").trim();
    if (!secret) {
      return json({ detail: "RR_PUSH_ADMIN_SECRET is not set on the server." }, 503);
    }
    const adminOk = await verifyWorkerOpsAdmin(request, env);
    if (!adminOk) {
      const has = Boolean(request.headers.get("X-RR-Push-Admin-Key"));
      return json({ detail: has ? "Invalid admin key." : "Missing X-RR-Push-Admin-Key header." }, 401);
    }
    const fcmCreds = resolveFcmCredentials(env);
    if (!fcmCreds) {
      return json(
        {
          detail:
            "FCM not configured. Set wrangler secret FCM_SERVICE_ACCOUNT_JSON to your full Firebase service account JSON, or set FCM_PROJECT_ID, FCM_CLIENT_EMAIL, and FCM_PRIVATE_KEY.",
        },
        503
      );
    }
    let payload: { title?: string; body?: string };
    try {
      payload = (await request.json()) as typeof payload;
    } catch {
      return json({ detail: "Invalid JSON." }, 400);
    }
    const title = String(payload.title || "").trim();
    const bodyText = String(payload.body || "").trim();
    if (!title || title.length > 120) return json({ detail: "title required (1–120 chars)." }, 400);
    if (!bodyText || bodyText.length > 500) return json({ detail: "body required (1–500 chars)." }, 400);

    const { results } = await env.DB.prepare(
      "SELECT token FROM rrwm_push_tokens WHERE LENGTH(token) >= 20"
    ).all<{ token: string }>();

    const rows = results || [];
    const seen = new Set<string>();
    const tokens: string[] = [];
    for (const row of rows) {
      const t = String(row.token || "").trim();
      if (t && !seen.has(t)) {
        seen.add(t);
        tokens.push(t);
      }
    }
    if (tokens.length === 0) {
      return json(
        {
          ok: true,
          message: "No push tokens registered yet. Open the app on a device with FCM configured.",
          fcm: { success: 0, failure: 0, total_tokens: 0, errors: [] as string[] },
        },
        200
      );
    }
    let accessToken: string;
    try {
      accessToken = await getFcmAccessToken({
        clientEmail: fcmCreds.clientEmail,
        privateKey: fcmCreds.privateKey,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return json({ detail: `FCM OAuth failed: ${msg}` }, 503);
    }
    const errors: string[] = [];
    let success = 0;
    let failure = 0;
    const concurrency = 24;
    for (let i = 0; i < tokens.length; i += concurrency) {
      const chunk = tokens.slice(i, i + concurrency);
      const part = await Promise.all(
        chunk.map((token) =>
          sendFcmNotification(fcmCreds.projectId, accessToken, token, title, bodyText)
        )
      );
      for (let j = 0; j < part.length; j++) {
        const r = part[j]!;
        if (r.ok) success += 1;
        else {
          failure += 1;
          if (errors.length < 8) {
            const tid = chunk[j]!.slice(0, 32);
            errors.push(`${tid}…: ${r.error}`);
          }
        }
      }
    }
    return json(
      {
        ok: true,
        fcm: { success, failure, total_tokens: tokens.length, errors },
      },
      200
    );
  }

  return null;
}
