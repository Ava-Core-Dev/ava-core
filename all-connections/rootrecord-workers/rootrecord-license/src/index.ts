import type { D1Database } from "@cloudflare/workers-types";
import {
  b64url,
  b64urlEncodeUtf8,
  b64urlToBytes,
  hashNewAccountCredentials,
  verifyLicenseAccountPassword,
} from "../../shared/password-verify";
import { fetchBillingSnapshot } from "../../shared/billing-state";
import { getAppAssociationsForEmail } from "../../shared/app-associations";
import { handleStripeWebhook } from "../../shared/stripe-webhook";

export interface Env {
  DB: D1Database;
  JWT_SECRET: string;
  CORS_ALLOW_ORIGIN?: string;
  /** Same as primary: `wrangler secret put STRIPE_SECRET_KEY` (invoice + subscription fetch in webhooks). */
  STRIPE_SECRET_KEY?: string;
  /** Stripe Dashboard → Webhooks → signing secret for this Worker’s `/v1/billing/webhook`. */
  STRIPE_WEBHOOK_SECRET?: string;
}

const JWT_TTL_SEC = 30 * 24 * 60 * 60;

function corsOrigin(env: Env, request: Request): string {
  const allow = (env.CORS_ALLOW_ORIGIN || "*").trim();
  if (allow === "*") return "*";
  const origin = request.headers.get("Origin") || "";
  const list = allow.split(",").map((s) => s.trim()).filter(Boolean);
  if (origin && list.includes(origin)) return origin;
  return list[0] || "*";
}

function corsHeaders(env: Env, request: Request): Record<string, string> {
  const o = corsOrigin(env, request);
  return {
    "Access-Control-Allow-Origin": o,
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Guest-Id",
    "Access-Control-Max-Age": "86400",
    ...(o !== "*" ? { Vary: "Origin" } : {}),
  };
}

function json(env: Env, request: Request, data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      ...corsHeaders(env, request),
    },
  });
}

async function jwtSign(payload: Record<string, unknown>, secret: string): Promise<string> {
  const header = { alg: "HS256", typ: "JWT" };
  const h = b64urlEncodeUtf8(JSON.stringify(header));
  const p = b64urlEncodeUtf8(JSON.stringify(payload));
  const data = `${h}.${p}`;
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(data));
  return `${data}.${b64url(sig)}`;
}

async function jwtVerify(token: string, secret: string): Promise<{ sub: string; aid: string } | null> {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const data = `${parts[0]}.${parts[1]}`;
  const enc = new TextEncoder();
  let sig: Uint8Array;
  try {
    sig = b64urlToBytes(parts[2]!);
  } catch {
    return null;
  }
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"]
  );
  const ok = await crypto.subtle.verify("HMAC", key, sig, enc.encode(data));
  if (!ok) return null;
  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(new TextDecoder().decode(b64urlToBytes(parts[1]!)));
  } catch {
    return null;
  }
  const exp = Number(payload.exp);
  if (!Number.isFinite(exp) || exp < Math.floor(Date.now() / 1000)) return null;
  const sub = String(payload.sub || "").trim().toLowerCase();
  const aid = String(payload.aid || "").trim();
  if (!sub || !aid) return null;
  return { sub, aid };
}

function authSuccessBody(
  env: Env,
  request: Request,
  row: { id: string; email: string },
  token: string
): Response {
  return json(env, request, {
    access_token: token,
    token,
    account_id: row.id,
    email: row.email,
    access: "full",
    reason: "none",
    valid_until: null,
    subscription_status: "none",
    proUnlocked: false,
    pro_unlocked: false,
    message: "ok",
  });
}

async function issueToken(env: Env, email: string, accountId: string): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  return jwtSign(
    { sub: email.toLowerCase(), aid: accountId, iat: now, exp: now + JWT_TTL_SEC },
    env.JWT_SECRET
  );
}

async function readBearer(env: Env, request: Request): Promise<{ sub: string; aid: string } | null> {
  const auth = request.headers.get("Authorization") || "";
  if (!auth.toLowerCase().startsWith("bearer ")) return null;
  const tok = auth.slice(7).trim();
  if (!tok || !env.JWT_SECRET) return null;
  return jwtVerify(tok, env.JWT_SECRET);
}

async function handleSignup(env: Env, request: Request, body: Record<string, unknown>): Promise<Response> {
  const email = String(body.email || "")
    .trim()
    .toLowerCase();
  const password = String(body.password || "");
  if (!email.includes("@") || password.length < 6) {
    return json(env, request, { detail: "Valid email and password (6+ characters) required." }, 400);
  }
  const id = crypto.randomUUID();
  let salt: string;
  let password_hash: string;
  try {
    const creds = await hashNewAccountCredentials(password);
    salt = creds.salt;
    password_hash = creds.password_hash;
  } catch (e) {
    const msg = String(e && typeof e === "object" && "message" in e ? (e as Error).message : e);
    console.error("handleSignup hash error", msg);
    return json(env, request, { detail: "Could not prepare password hash. Please try again." }, 500);
  }
  const now = new Date().toISOString();
  try {
    await env.DB.prepare(
      "INSERT INTO license_accounts (id, email, password_hash, salt, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)"
    )
      .bind(id, email, password_hash, salt, now, now)
      .run();
  } catch (e) {
    const msg = String(e && typeof e === "object" && "message" in e ? (e as Error).message : e);
    if (/UNIQUE constraint failed|unique constraint/i.test(msg)) {
      return json(env, request, { detail: "That email is already registered. Try signing in instead." }, 409);
    }
    console.error("handleSignup insert error", msg);
    return json(env, request, { detail: "Could not save account. Please try again." }, 500);
  }
  const token = await issueToken(env, email, id);
  return authSuccessBody(env, request, { id, email }, token);
}

async function handleLogin(env: Env, request: Request, body: Record<string, unknown>): Promise<Response> {
  const email = String(body.email || "")
    .trim()
    .toLowerCase();
  const password = String(body.password || "");
  if (!email || !password) {
    return json(env, request, { detail: "Email and password required." }, 400);
  }
  const row = await env.DB.prepare(
    "SELECT id, email, password_hash, salt FROM license_accounts WHERE email = ?"
  )
    .bind(email)
    .first<{ id: string; email: string; password_hash: string; salt: string }>();
  if (!row) {
    return json(env, request, { detail: "Incorrect email or password." }, 401);
  }
  const v = await verifyLicenseAccountPassword(password, row.salt, row.password_hash);
  if (!v.ok) {
    return json(env, request, { detail: "Incorrect email or password." }, 401);
  }
  const now = new Date().toISOString();
  if (v.needsUpgrade) {
    await env.DB.prepare(
      "UPDATE license_accounts SET password_hash = ?, salt = ?, updated_at = ? WHERE id = ?"
    )
      .bind(v.password_hash, v.salt, now, row.id)
      .run();
  } else {
    await env.DB.prepare("UPDATE license_accounts SET updated_at = ? WHERE id = ?").bind(now, row.id).run();
  }
  const token = await issueToken(env, row.email, row.id);
  return authSuccessBody(env, request, row, token);
}

async function handleMe(env: Env, request: Request): Promise<Response> {
  const sess = await readBearer(env, request);
  if (!sess) {
    return json(env, request, { detail: "Unauthorized", authenticated: false }, 401);
  }
  const row = await env.DB.prepare(
    "SELECT id, email, created_at FROM license_accounts WHERE id = ? AND email = ?"
  )
    .bind(sess.aid, sess.sub)
    .first<{ id: string; email: string; created_at: string | null }>();
  if (!row) {
    return json(env, request, { detail: "Unauthorized", authenticated: false }, 401);
  }
  const account_created_at =
    typeof row.created_at === "string" && row.created_at.trim() ? row.created_at.trim() : null;
  const billing = await fetchBillingSnapshot(env.DB, row.email);
  const pro = Boolean(billing?.pro_unlocked);
  const life = Boolean(billing?.life_member);
  const sub = billing ? billing.subscription_status : "none";
  let apps: Awaited<ReturnType<typeof getAppAssociationsForEmail>>;
  try {
    apps = await getAppAssociationsForEmail(env.DB, row.email);
  } catch {
    apps = {
      rootrecord_business_manager_windows: {
        associated: null,
        note: "Association data temporarily unavailable.",
        last_connected_at: null,
      },
      rootrecord_business_manager_android: { associated: false, last_connected_at: null },
      rootrecord_weather_manager_windows: { associated: false, last_connected_at: null },
      rootrecord_weather_manager_android: { associated: false, last_connected_at: null },
      signals: { mobile_push: false, saved_locations: false, weather_cache: false },
    };
  }
  return json(env, request, {
    authenticated: true,
    email: row.email,
    account_id: row.id,
    account_created_at,
    proUnlocked: pro,
    pro_unlocked: pro,
    life_member: life,
    lifeMember: life,
    access: { tier: pro ? "pro" : "none", reason: pro ? "paid" : "none" },
    subscription_status: sub,
    apps,
  });
}

async function handlePrepare(env: Env, request: Request): Promise<Response> {
  const sess = await readBearer(env, request);
  if (!sess) {
    return json(env, request, { authenticated: false, detail: "Unauthorized" }, 401);
  }
  const row = await env.DB.prepare("SELECT id, email FROM license_accounts WHERE id = ? AND email = ?")
    .bind(sess.aid, sess.sub)
    .first<{ id: string; email: string }>();
  if (!row) {
    return json(env, request, { authenticated: false }, 401);
  }
  const billing = await fetchBillingSnapshot(env.DB, row.email);
  const pro = Boolean(billing?.pro_unlocked);
  const life = Boolean(billing?.life_member);
  return json(env, request, {
    authenticated: true,
    email: row.email,
    account_id: row.id,
    proUnlocked: pro,
    pro_unlocked: pro,
    life_member: life,
    lifeMember: life,
    subscription_status: billing ? billing.subscription_status : "none",
  });
}

async function handleEntitlement(env: Env, request: Request, body: Record<string, unknown>): Promise<Response> {
  const sess = await readBearer(env, request);
  if (!sess) {
    return json(env, request, { error: { message: "Unauthorized", code: "UNAUTHORIZED" } }, 401);
  }
  const emailBody = String(body.email || "")
    .trim()
    .toLowerCase();
  if (emailBody && emailBody !== sess.sub) {
    return json(env, request, { error: { message: "Email mismatch", code: "FORBIDDEN" } }, 403);
  }
  const billing = await fetchBillingSnapshot(env.DB, sess.sub);
  const pro = Boolean(billing?.pro_unlocked);
  const reason = pro ? "paid" : "none";
  const sub = billing ? billing.subscription_status : "none";
  return json(env, request, {
    account_id: sess.aid,
    access: "full",
    reason,
    valid_until: null,
    subscription_status: sub,
    pro_unlocked: pro,
    proUnlocked: pro,
    life_member: Boolean(billing?.life_member),
    lifeMember: Boolean(billing?.life_member),
  });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (!env.JWT_SECRET || env.JWT_SECRET.length < 16) {
      return json(
        env,
        request,
        { detail: "Worker misconfigured: set secret JWT_SECRET (deploy.ps1 sets this from ROOTRECORD_LICENSE_JWT_SECRET)." },
        503
      );
    }

    const url = new URL(request.url);
    const path = (url.pathname.replace(/\/+$/, "") || "/") as string;
    const method = request.method;

    if (method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders(env, request) });
    }

    if (method === "GET" && (path === "/" || path === "/health")) {
      if (path === "/health") {
        let ok = false;
        try {
          const r = await env.DB.prepare("SELECT 1 AS ok").first<{ ok: number }>();
          ok = r?.ok === 1;
        } catch {
          ok = false;
        }
        return json(env, request, { status: ok ? "ok" : "degraded", db: ok ? "ok" : "unavailable" }, ok ? 200 : 503);
      }
      return json(
        env,
        request,
        {
          ok: true,
          service: "rootrecord-license",
          routes: [
            "POST /v1/auth/signup",
            "POST /v1/auth/login",
            "POST /license/signup",
            "POST /license/login",
            "GET /v1/me",
            "POST /v1/entitlement",
            "POST /license/prepare",
            "POST /v1/auth/logout",
            "POST /v1/billing/webhook",
          ],
        },
        200
      );
    }

    if (method === "POST" && path === "/v1/billing/webhook") {
      return handleStripeWebhook(request, env);
    }

    let body: Record<string, unknown> = {};
    if (method === "POST") {
      try {
        const t = await request.text();
        if (t) body = JSON.parse(t) as Record<string, unknown>;
      } catch {
        return json(env, request, { detail: "Invalid JSON" }, 400);
      }
    }

    if (method === "POST" && (path === "/v1/auth/signup" || path === "/license/signup")) {
      return handleSignup(env, request, body);
    }
    if (method === "POST" && (path === "/v1/auth/login" || path === "/license/login")) {
      return handleLogin(env, request, body);
    }
    if (method === "GET" && path === "/v1/me") {
      return handleMe(env, request);
    }
    if (method === "POST" && path === "/v1/entitlement") {
      return handleEntitlement(env, request, body);
    }
    if (method === "POST" && path === "/license/prepare") {
      return handlePrepare(env, request);
    }
    if (method === "POST" && path === "/v1/auth/logout") {
      return json(env, request, { ok: true }, 200);
    }

    return json(env, request, { detail: "Not Found" }, 404);
  },
};
