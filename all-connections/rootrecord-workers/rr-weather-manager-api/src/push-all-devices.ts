/**
 * All-device FCM broadcast + per-user push token registration (D1).
 * Merge into your main Worker router: if `dispatchPushRoutes` returns non-null, return it.
 */
import type { PushWorkerEnv } from './bindings';
import { getFcmAccessToken, sendFcmNotification } from './fcm-v1';

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}

async function sha256DigestBytes(text: string): Promise<ArrayBuffer> {
  return crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
}

function timingSafeEqual(a: ArrayBuffer, b: ArrayBuffer): boolean {
  if (a.byteLength !== b.byteLength) return false;
  const ua = new Uint8Array(a);
  const ub = new Uint8Array(b);
  let diff = 0;
  for (let i = 0; i < ua.length; i++) diff |= ua[i] ^ ub[i];
  return diff === 0;
}

/** Matches FastAPI `require_push_broadcast_admin` (SHA-256 compare). */
async function verifyPushAdminKey(headerVal: string | null, secret: string): Promise<boolean> {
  const h = (headerVal || '').trim();
  const s = (secret || '').trim();
  if (!h || !s) return false;
  const pHash = await sha256DigestBytes(h);
  const sHash = await sha256DigestBytes(s);
  return timingSafeEqual(pHash, sHash);
}

async function resolveUserId(request: Request, env: PushWorkerEnv): Promise<string | null> {
  const auth = request.headers.get('Authorization') || '';
  if (auth.toLowerCase().startsWith('bearer ')) {
    const token = auth.slice(7).trim();
    if (!token) return null;
    const fromEnv = (env.PRIMARY_API_BASE || '').replace(/\/+$/, '');
    const base = fromEnv || new URL(request.url).origin;
    if (!base) return null;
    const r = await fetch(`${base}/api/auth/me`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: '{}',
    });
    if (!r.ok) return null;
    const data = (await r.json().catch(() => ({}))) as {
      authenticated?: boolean;
      email?: string;
    };
    const email = String(data.email || '')
      .trim()
      .toLowerCase();
    if (email && data.authenticated) return `user:${email}`;
    return null;
  }
  const gidRaw = request.headers.get('X-Guest-Id') || '';
  const gid = gidRaw.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64);
  if (gid) return `guest:${gid}`;
  return null;
}

export async function handleRegisterPushToken(
  request: Request,
  env: PushWorkerEnv
): Promise<Response> {
  if (request.method !== 'POST') return json({ detail: 'Method Not Allowed' }, 405);
  const userId = await resolveUserId(request, env);
  if (!userId) return json({ detail: 'Sign in or provide a guest id.' }, 401);

  let body: { token?: string; platform?: string };
  try {
    body = (await request.json()) as { token?: string; platform?: string };
  } catch {
    return json({ detail: 'Invalid JSON.' }, 400);
  }
  const tok = String(body.token || '').trim();
  if (tok.length < 20) return json({ detail: 'Invalid token.' }, 400);
  const plat = String(body.platform || 'android')
    .trim()
    .toLowerCase()
    .slice(0, 32);
  const updatedAt = new Date().toISOString();

  await env.USER_DATA_DB.prepare(
    `INSERT INTO rrwm_push_tokens (token, user_id, platform, updated_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(token) DO UPDATE SET user_id = excluded.user_id, platform = excluded.platform, updated_at = excluded.updated_at`
  )
    .bind(tok, userId, plat || 'android', updatedAt)
    .run();

  return json({ ok: true });
}

export async function handleInternalPushBroadcast(
  request: Request,
  env: PushWorkerEnv
): Promise<Response> {
  if (request.method !== 'POST') return json({ detail: 'Method Not Allowed' }, 405);

  const secret = (env.RR_PUSH_ADMIN_SECRET || '').trim();
  if (!secret) {
    return json({ detail: 'RR_PUSH_ADMIN_SECRET is not set on the server.' }, 503);
  }
  const adminOk = await verifyPushAdminKey(request.headers.get('X-RR-Push-Admin-Key'), secret);
  if (!adminOk) {
    const hasHeader = Boolean(request.headers.get('X-RR-Push-Admin-Key'));
    return json({ detail: hasHeader ? 'Invalid admin key.' : 'Missing X-RR-Push-Admin-Key header.' }, 401);
  }

  const projectId = (env.FCM_PROJECT_ID || '').trim();
  if (!projectId || !env.FCM_CLIENT_EMAIL || !env.FCM_PRIVATE_KEY) {
    return json(
      {
        detail:
          'FCM not configured. Set secrets FCM_PROJECT_ID, FCM_CLIENT_EMAIL, FCM_PRIVATE_KEY (service account PEM).',
      },
      503
    );
  }

  let payload: { title?: string; body?: string };
  try {
    payload = (await request.json()) as { title?: string; body?: string };
  } catch {
    return json({ detail: 'Invalid JSON.' }, 400);
  }
  const title = String(payload.title || '').trim();
  const bodyText = String(payload.body || '').trim();
  if (!title || title.length > 120) return json({ detail: 'title required (1–120 chars).' }, 400);
  if (!bodyText || bodyText.length > 500) return json({ detail: 'body required (1–500 chars).' }, 400);

  const { results } = await env.USER_DATA_DB.prepare(
    'SELECT token FROM rrwm_push_tokens WHERE LENGTH(token) >= 20'
  ).all<{ token: string }>();

  const rows = results || [];
  const seen = new Set<string>();
  const tokens: string[] = [];
  for (const row of rows) {
    const t = String(row.token || '').trim();
    if (t && !seen.has(t)) {
      seen.add(t);
      tokens.push(t);
    }
  }

  if (tokens.length === 0) {
    return json({
      ok: true,
      message: 'No push tokens registered yet. Open the app on a device with FCM configured.',
      fcm: { success: 0, failure: 0, total_tokens: 0, errors: [] as string[] },
    });
  }

  let accessToken: string;
  try {
    accessToken = await getFcmAccessToken(env);
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
      chunk.map(async (token) => {
        const r = await sendFcmNotification(projectId, accessToken, token, title, bodyText);
        return r;
      })
    );
    for (let j = 0; j < part.length; j++) {
      const r = part[j];
      if (r.ok) success += 1;
      else {
        failure += 1;
        if (errors.length < 8) {
          const tid = chunk[j].slice(0, 32);
          errors.push(`${tid}…: ${r.error}`);
        }
      }
    }
  }

  return json({
    ok: true,
    fcm: {
      success,
      failure,
      total_tokens: tokens.length,
      errors,
    },
  });
}

/**
 * Handles only:
 * - POST /api/me/push-token
 * - POST /api/internal/push-broadcast
 * Returns null if the URL is not one of these (caller continues routing).
 */
export async function dispatchPushRoutes(request: Request, env: PushWorkerEnv): Promise<Response | null> {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, '') || '/';
  if (path === '/api/me/push-token') {
    return handleRegisterPushToken(request, env);
  }
  if (path === '/api/internal/push-broadcast') {
    return handleInternalPushBroadcast(request, env);
  }
  return null;
}
