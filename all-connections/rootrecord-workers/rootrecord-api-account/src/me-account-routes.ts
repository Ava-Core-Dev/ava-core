import type { D1Database } from "@cloudflare/workers-types";
import { json } from "./cors";
import { resolveUserId } from "./auth";
import {
  extractAuthToken,
  sessionFromRequest,
  issueFreshSessionToken,
  type SessionInsertMeta,
  type AuthEnv,
} from "./primary-auth";
import { buildClearSessionCookieHeader, buildSessionCookieHeader, ssoCookieDomainForApiHost } from "./web-sso";
import {
  hashNewAccountCredentials,
  verifyLicenseAccountPassword,
} from "../../shared/password-verify";
import { fetchBillingSnapshot } from "../../shared/billing-state";
import {
  sendTransactionalEmail,
  type TransactionalEmailEnv,
} from "../../shared/send-transactional-email";
import { readUserAccountAccessFlags } from "./accounts";
import { readDiscordLink } from "./discord-account-link";
import {
  consumeChallenge,
  hasRecentAccountVerification,
  markEmailVerified,
  markRecentAccountVerification,
  readAccountSecurity,
  sendAccountChangeChallenge,
  sendEmailVerificationChallenge,
  sendPasswordResetChallenge,
} from "./account-security";

export type MeAccountEnv = AuthEnv & TransactionalEmailEnv & {
  SITE_URL?: string;
};

function ssoClearCookieLine(request: Request): string | undefined {
  const dom = ssoCookieDomainForApiHost(new URL(request.url).hostname);
  if (!dom) return undefined;
  return buildClearSessionCookieHeader(dom);
}

function ssoSetAccessTokenLine(request: Request, accessToken: string | null | undefined): string | undefined {
  const t = accessToken?.trim();
  if (!t) return undefined;
  const dom = ssoCookieDomainForApiHost(new URL(request.url).hostname);
  if (!dom) return undefined;
  return buildSessionCookieHeader(t, dom);
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

async function sha256Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function passwordFailCount(db: D1Database, accountId: string, sinceIso: string): Promise<number> {
  try {
    const row = await db
      .prepare(
        `SELECT COUNT(*) AS c FROM me_password_attempt
         WHERE account_id = ? AND ok = 0 AND created_at > ?`
      )
      .bind(accountId, sinceIso)
      .first<{ c: number }>();
    return Math.min(99, Math.max(0, Number(row?.c) || 0));
  } catch {
    return 0;
  }
}

async function recordPasswordAttempt(db: D1Database, accountId: string, ok: boolean): Promise<void> {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  try {
    await db
      .prepare("INSERT INTO me_password_attempt (id, account_id, created_at, ok) VALUES (?, ?, ?, ?)")
      .bind(id, accountId, now, ok ? 1 : 0)
      .run();
  } catch {
    /* table may be missing pre-migration */
  }
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

export function accountNotVerifiedResponse(): Response {
  return json(
    {
      detail: "Verify your account by email or Discord before making this change.",
      code: "account_not_verified",
      account_not_verified: true,
    },
    403,
  );
}

export function accountVerificationRequiredResponse(): Response {
  return json(
    {
      detail:
        "Confirm this change with a fresh email code or Discord re-verification. Open Account → Sensitive changes (valid 15 minutes).",
      code: "verification_required",
      verification_required: true,
    },
    403,
  );
}

export async function isPortalAccountVerified(db: D1Database, accountId: string): Promise<boolean> {
  try {
    const security = await readAccountSecurity(db, accountId);
    if (security.email_verified) return true;
    const discord = await readDiscordLink(db, accountId).catch(() => ({ linked: false }));
    return Boolean(discord?.linked);
  } catch {
    return false;
  }
}

/** One-time account proof (email or Discord) plus a recent confirmation challenge. */
export async function requireSensitiveAccountAction(db: D1Database, accountId: string): Promise<Response | null> {
  try {
    if (!(await isPortalAccountVerified(db, accountId))) {
      return accountNotVerifiedResponse();
    }
    if (await hasRecentAccountVerification(db, accountId)) return null;
  } catch {
    /* fail closed for account-changing operations */
  }
  return accountVerificationRequiredResponse();
}

export async function requireRecentAccountVerification(db: D1Database, accountId: string): Promise<Response | null> {
  return requireSensitiveAccountAction(db, accountId);
}

async function revokeSessionById(db: D1Database, accountId: string, sessionId: string): Promise<boolean> {
  const now = new Date().toISOString();
  try {
    const r = await db
      .prepare(
        `UPDATE license_sessions SET revoked_at = ?
         WHERE id = ? AND account_id = ? AND revoked_at IS NULL`
      )
      .bind(now, sessionId, accountId)
      .run();
    return Number(r.meta?.rows_written ?? 0) > 0;
  } catch {
    return false;
  }
}

async function migrateUserScopedIds(db: D1Database, oldEmail: string, newEmail: string): Promise<void> {
  const o = oldEmail.trim().toLowerCase();
  const n = newEmail.trim().toLowerCase();
  if (!o || !n || o === n) return;
  const oldU = `user:${o}`;
  const newU = `user:${n}`;

  const updates: { sql: string; binds: unknown[] }[] = [
    { sql: "UPDATE rrwm_user_prefs SET user_id = ? WHERE user_id = ?", binds: [newU, oldU] },
    { sql: "UPDATE rrwm_push_tokens SET user_id = ? WHERE user_id = ?", binds: [newU, oldU] },
    { sql: "UPDATE rrwm_locations SET user_id = ? WHERE user_id = ?", binds: [newU, oldU] },
    { sql: "UPDATE weather_data SET user_id = ? WHERE user_id = ?", binds: [newU, oldU] },
    { sql: "UPDATE rrwm_alert_seen SET user_id = ? WHERE user_id = ?", binds: [newU, oldU] },
    { sql: "UPDATE rr_earn_balance SET user_id = ? WHERE user_id = ?", binds: [newU, oldU] },
    { sql: "UPDATE rr_earn_day SET user_id = ? WHERE user_id = ?", binds: [newU, oldU] },
    { sql: "UPDATE rr_earn_state SET user_id = ? WHERE user_id = ?", binds: [newU, oldU] },
    { sql: "UPDATE rr_earn_app_day SET user_id = ? WHERE user_id = ?", binds: [newU, oldU] },
    { sql: "UPDATE rr_earn_app_total SET user_id = ? WHERE user_id = ?", binds: [newU, oldU] },
    { sql: "UPDATE rr_earn_signup_bonus SET user_id = ? WHERE user_id = ?", binds: [newU, oldU] },
    { sql: "UPDATE rr_earn_app_first_open SET user_id = ? WHERE user_id = ?", binds: [newU, oldU] },
    { sql: "UPDATE bm_owned_row SET user_key = ? WHERE user_key = ?", binds: [newU, oldU] },
  ];

  for (const u of updates) {
    try {
      await db.prepare(u.sql).bind(...u.binds).run();
    } catch (e) {
      const msg = String(e && typeof e === "object" && "message" in e ? (e as Error).message : e);
      console.error("migrateUserScopedIds", u.sql.slice(0, 40), msg);
    }
  }
}

const KNOWN_APPS: {
  id: string;
  name: string;
  android_package: string;
  play_store_url?: string;
}[] = [
  {
    id: "rootrecord_weather_manager_android",
    name: "Weather Manager",
    android_package: "com.rootrecord.weathermanager",
  },
  {
    id: "rootrecord_business_manager_android",
    name: "Business Manager",
    android_package: "com.rootrecord.businessmanager",
  },
  {
    id: "rootrecord_account_hub_android",
    name: "Account Hub",
    android_package: "com.rootrecord.accounthub",
  },
  {
    id: "rootrecord_token_manager_android",
    name: "Token Manager",
    android_package: "com.rootrecord.tokenmanager",
  },
  {
    id: "rootrecord_kilauea_alerts_android",
    name: "Kīlauea Alerts",
    android_package: "com.rootrecord.kilauea",
    play_store_url: "https://play.google.com/store/apps/details?id=com.rootrecord.kilauea",
  },
];

async function entitlementTier(
  db: D1Database,
  email: string
): Promise<"life" | "pro" | "free"> {
  const billing = await fetchBillingSnapshot(db, email);
  const acct = await readUserAccountAccessFlags(db, email);
  const life = Boolean(billing?.life_member) || Boolean(acct?.life_member);
  if (life) return "life";
  const pro = Boolean(billing?.pro_unlocked) || Boolean(acct?.pro_unlocked);
  if (pro) return "pro";
  return "free";
}

async function lastSeenForApp(db: D1Database, userId: string, appId: string): Promise<string | null> {
  try {
    const row = await db
      .prepare(
        `SELECT updated_at FROM rr_earn_app_total WHERE user_id = ? AND app_id = ?`
      )
      .bind(userId, appId)
      .first<{ updated_at: string | null }>();
    const u = row?.updated_at;
    return typeof u === "string" && u.trim() ? u.trim() : null;
  } catch {
    return null;
  }
}

async function handleMePassword(request: Request, env: MeAccountEnv): Promise<Response> {
  const sess = await sessionFromRequest(env, request);
  if (!sess) return json({ detail: "Unauthorized" }, 401);
  const recent = await requireRecentAccountVerification(env.DB, sess.accountId);
  if (recent) return recent;

  let body: { current_password?: string; new_password?: string; device_id?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return json({ detail: "Invalid JSON" }, 400);
  }
  const current_password = String(body.current_password || "");
  const new_password = String(body.new_password || "");
  if (!current_password || new_password.length < 6) {
    return json({ detail: "Current password and new password (6+ characters) required." }, 422);
  }

  const since = new Date(Date.now() - 10 * 60_000).toISOString();
  const fails = await passwordFailCount(env.DB, sess.accountId, since);
  if (fails >= 5) {
    return json({ detail: "Too many attempts. Try again in about 10 minutes." }, 429);
  }

  const row = await env.DB
    .prepare("SELECT id, email, password_hash, salt FROM license_accounts WHERE id = ? AND email = ?")
    .bind(sess.accountId, sess.email)
    .first<{ id: string; email: string; password_hash: string; salt: string }>();
  if (!row) return json({ detail: "Account not found." }, 404);

  const v = await verifyLicenseAccountPassword(current_password, row.salt, row.password_hash);
  if (!v.ok) {
    await recordPasswordAttempt(env.DB, sess.accountId, false);
    return json({ detail: "Current password is incorrect." }, 401);
  }

  let newHash: string;
  let newSalt: string;
  try {
    const creds = await hashNewAccountCredentials(new_password);
    newHash = creds.password_hash;
    newSalt = creds.salt;
  } catch {
    return json({ detail: "Could not hash new password." }, 500);
  }

  const now = new Date().toISOString();
  try {
    await env.DB
      .prepare("UPDATE license_accounts SET password_hash = ?, salt = ?, updated_at = ? WHERE id = ?")
      .bind(newHash, newSalt, now, row.id)
      .run();
  } catch {
    return json({ detail: "Could not update password." }, 500);
  }

  await recordPasswordAttempt(env.DB, sess.accountId, true);
  await revokeAllSessions(env.DB, sess.accountId);

  const deviceFromBody = String(body.device_id || "").trim().slice(0, 128) || null;
  const meta = buildSessionInsertMeta(request, deviceFromBody);
  const access_token = await issueFreshSessionToken(env, sess.email, sess.accountId, meta);
  if (!access_token) {
    return json({ ok: true, detail: "Password updated; sign in again (session issue)." }, 200);
  }
  return json(
    { ok: true, access_token, token: access_token },
    200,
    undefined,
    ssoSetAccessTokenLine(request, access_token)
  );
}

async function handleMeSessionsGet(request: Request, env: MeAccountEnv): Promise<Response> {
  const sess = await sessionFromRequest(env, request);
  if (!sess) return json({ detail: "Unauthorized" }, 401);

  try {
    const rows = await env.DB
      .prepare(
        `SELECT id, device_id, user_agent, ip, created_at, last_seen_at, revoked_at
         FROM license_sessions WHERE account_id = ? ORDER BY created_at DESC LIMIT 50`
      )
      .bind(sess.accountId)
      .all<{
        id: string;
        device_id: string | null;
        user_agent: string | null;
        ip: string | null;
        created_at: string;
        last_seen_at: string;
        revoked_at: string | null;
      }>();
    const list = (rows.results || []).map((r) => ({
      id: r.id,
      device_id: r.device_id || "",
      user_agent: r.user_agent || "",
      ip: r.ip || "",
      created_at: r.created_at,
      last_seen_at: r.last_seen_at,
      current: Boolean(sess.sessionId && r.id === sess.sessionId && !r.revoked_at),
      revoked: Boolean(r.revoked_at && String(r.revoked_at).trim()),
    }));
    return json(list, 200);
  } catch {
    return json([], 200);
  }
}

async function handleMeSessionRevoke(request: Request, env: MeAccountEnv, sessionId: string): Promise<Response> {
  const sess = await sessionFromRequest(env, request);
  if (!sess) return json({ detail: "Unauthorized" }, 401);

  const sid = sessionId.trim();
  if (!sid || sid.length < 8) return json({ detail: "Invalid session id." }, 400);
  if (sess.sessionId === sid) {
    return json({ detail: "Use sign out to end this session." }, 400);
  }

  const ok = await revokeSessionById(env.DB, sess.accountId, sid);
  if (!ok) return json({ detail: "Session not found or already revoked." }, 404);
  return json({ ok: true }, 200);
}

async function handleMeAppsGet(request: Request, env: MeAccountEnv): Promise<Response> {
  const u = await resolveUserId(request, env);
  if (u instanceof Response) return u;
  const email = u.startsWith("user:") ? u.slice(5).trim().toLowerCase() : "";
  if (!email) return json({ detail: "Invalid user." }, 401);

  const tier = await entitlementTier(env.DB, email);
  const userId = `user:${email}`;
  const out: Record<string, unknown>[] = [];
  for (const app of KNOWN_APPS) {
    const last_seen_at = await lastSeenForApp(env.DB, userId, app.id);
    out.push({
      id: app.id,
      name: app.name,
      entitlement: tier,
      last_seen_at,
      android_package: app.android_package,
      play_store_url: app.play_store_url || null,
    });
  }
  return json(out, 200);
}

async function handleEmailRequest(request: Request, env: MeAccountEnv): Promise<Response> {
  const sess = await sessionFromRequest(env, request);
  if (!sess) return json({ detail: "Unauthorized" }, 401);
  const recent = await requireRecentAccountVerification(env.DB, sess.accountId);
  if (recent) return recent;

  let body: { new_email?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return json({ detail: "Invalid JSON" }, 400);
  }
  const new_email = String(body.new_email || "")
    .trim()
    .toLowerCase();
  if (!new_email.includes("@") || new_email.length > 254) {
    return json({ detail: "Valid new_email required." }, 422);
  }
  if (new_email === sess.email) {
    return json({ detail: "That is already your email." }, 400);
  }

  const taken = await env.DB.prepare("SELECT 1 AS ok FROM license_accounts WHERE email = ?").bind(new_email).first<{ ok: number }>();
  if (taken?.ok === 1) {
    return json({ detail: "That email is already in use." }, 409);
  }

  const rawToken = `${crypto.randomUUID()}${crypto.randomUUID()}`.replace(/-/g, "");
  const id = await sha256Hex(rawToken);
  const now = new Date().toISOString();
  const exp = new Date(Date.now() + 24 * 60 * 60_000).toISOString();

  try {
    await env.DB.prepare("DELETE FROM license_email_change WHERE account_id = ?").bind(sess.accountId).run();
    await env.DB
      .prepare(
        `INSERT INTO license_email_change (id, account_id, new_email, expires_at, created_at)
         VALUES (?, ?, ?, ?, ?)`
      )
      .bind(id, sess.accountId, new_email, exp, now)
      .run();
  } catch (e) {
    const msg = String(e && typeof e === "object" && "message" in e ? (e as Error).message : e);
    console.error("license_email_change insert", msg);
    return json({ detail: "Could not start email change." }, 500);
  }

  const site = (env.SITE_URL || "https://rootrecord.cloud").replace(/\/+$/, "");
  const link = `${site}/account.html?email_token=${encodeURIComponent(rawToken)}`;
  const html = `<p>Confirm your new RootRecord account email:</p><p><a href="${link}">${link}</a></p><p>If you did not request this, ignore this message.</p>`;

  const sent = await sendTransactionalEmail(env, new_email, "Confirm your RootRecord email change", html);
  if (!sent) {
    await env.DB.prepare("DELETE FROM license_email_change WHERE id = ?").bind(id).run();
    return json(
      {
        detail:
          "Outbound email is not configured. Onboard rootrecord.info in Cloudflare Email Sending (dashboard) and deploy Workers with the EMAIL binding, or set RESEND_API_KEY and RESEND_FROM.",
      },
      503
    );
  }

  return json({ ok: true, detail: "Verification email sent." }, 202);
}

async function handleEmailConfirm(request: Request, env: MeAccountEnv): Promise<Response> {
  let body: { token?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return json({ detail: "Invalid JSON" }, 400);
  }
  const token = String(body.token || "").trim();
  if (token.length < 16) return json({ detail: "Invalid token." }, 400);

  const id = await sha256Hex(token);
  const row = await env.DB
    .prepare(
      `SELECT account_id, new_email, expires_at FROM license_email_change WHERE id = ?`
    )
    .bind(id)
    .first<{ account_id: string; new_email: string; expires_at: string }>();
  if (!row) return json({ detail: "Invalid or expired token." }, 400);

  const exp = Date.parse(row.expires_at);
  if (!Number.isFinite(exp) || exp < Date.now()) {
    await env.DB.prepare("DELETE FROM license_email_change WHERE id = ?").bind(id).run();
    return json({ detail: "Token expired." }, 400);
  }

  const newEmail = String(row.new_email || "")
    .trim()
    .toLowerCase();
  const accountId = String(row.account_id || "").trim();
  if (!newEmail || !accountId) return json({ detail: "Invalid pending change." }, 400);

  const taken = await env.DB.prepare("SELECT 1 AS ok FROM license_accounts WHERE email = ?").bind(newEmail).first<{ ok: number }>();
  if (taken?.ok === 1) {
    await env.DB.prepare("DELETE FROM license_email_change WHERE id = ?").bind(id).run();
    return json({ detail: "That email is no longer available." }, 409);
  }

  const acc = await env.DB
    .prepare("SELECT id, email FROM license_accounts WHERE id = ?")
    .bind(accountId)
    .first<{ id: string; email: string }>();
  if (!acc) return json({ detail: "Account not found." }, 404);

  const oldEmail = String(acc.email || "")
    .trim()
    .toLowerCase();
  if (oldEmail === newEmail) {
    await env.DB.prepare("DELETE FROM license_email_change WHERE id = ?").bind(id).run();
    return json({ email: newEmail }, 200);
  }

  const now = new Date().toISOString();
  try {
    await migrateUserScopedIds(env.DB, oldEmail, newEmail);
    await env.DB
      .prepare("UPDATE license_accounts SET email = ?, updated_at = ? WHERE id = ?")
      .bind(newEmail, now, accountId)
      .run();
    await env.DB
      .prepare("UPDATE user_accounts SET email = ?, updated_at = ? WHERE email = ?")
      .bind(newEmail, now, oldEmail)
      .run();
    await env.DB.prepare("DELETE FROM license_email_change WHERE id = ?").bind(id).run();
    await markEmailVerified(env.DB, accountId, "email");
    await revokeAllSessions(env.DB, accountId);
  } catch (e) {
    const msg = String(e && typeof e === "object" && "message" in e ? (e as Error).message : e);
    console.error("email confirm migrate", msg);
    return json({ detail: "Could not complete email change." }, 500);
  }

  return json({ email: newEmail, ok: true }, 200);
}

async function accountByEmail(db: D1Database, emailRaw: string): Promise<{ id: string; email: string } | null> {
  const email = String(emailRaw || "").trim().toLowerCase();
  if (!email.includes("@")) return null;
  return db
    .prepare("SELECT id, lower(trim(email)) AS email FROM license_accounts WHERE lower(trim(email)) = ?")
    .bind(email)
    .first<{ id: string; email: string }>();
}

async function consumedEmailVerifyChallengeByToken(
  db: D1Database,
  tokenRaw: string | null | undefined,
): Promise<{ account_id: string; email: string } | null> {
  const token = String(tokenRaw || "").trim();
  if (token.length < 16) return null;
  const tokenHash = await sha256Hex(token);
  const row = await db
    .prepare(
      `SELECT account_id, email, expires_at, consumed_at
       FROM license_account_challenges
       WHERE token_hash = ? AND purpose = 'email_verify'
       LIMIT 1`,
    )
    .bind(tokenHash)
    .first<{ account_id: string; email: string; expires_at: string; consumed_at: string | null }>();
  if (!row?.account_id || !row.email || !row.consumed_at) return null;
  const consumedAt = Date.parse(row.consumed_at);
  const expiresAt = Date.parse(row.expires_at || "");
  if (!Number.isFinite(consumedAt) || !Number.isFinite(expiresAt) || consumedAt > expiresAt) return null;
  return { account_id: row.account_id, email: row.email };
}

async function handleEmailVerifyRequest(request: Request, env: MeAccountEnv): Promise<Response> {
  const sess = await sessionFromRequest(env, request);
  if (!sess) return json({ detail: "Unauthorized" }, 401);
  const sent = await sendEmailVerificationChallenge(
    env,
    sess.accountId,
    sess.email,
    buildSessionInsertMeta(request, null),
  );
  if (!sent) return json({ detail: "Could not send verification email." }, 503);
  return json({ ok: true, detail: "Verification email sent." }, 202);
}

async function handleEmailVerifyConfirm(request: Request, env: MeAccountEnv): Promise<Response> {
  let body: { token?: string; code?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return json({ detail: "Invalid JSON" }, 400);
  }
  const sess = await sessionFromRequest(env, request);
  const consumed =
    (await consumeChallenge({
      db: env.DB,
      purpose: "email_verify",
      token: body.token,
      code: body.code,
      accountId: sess?.accountId || null,
    })) || (await consumedEmailVerifyChallengeByToken(env.DB, body.token));
  if (!consumed) return json({ detail: "Invalid or expired verification code." }, 400);
  await markEmailVerified(env.DB, consumed.account_id, "email");
  return json({ ok: true, email_verified: true }, 200);
}

async function handlePasswordResetRequest(request: Request, env: MeAccountEnv): Promise<Response> {
  let body: { email?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return json({ detail: "Invalid JSON" }, 400);
  }
  const email = String(body.email || "").trim().toLowerCase();
  if (!email.includes("@")) return json({ detail: "Valid email required." }, 422);
  const row = await accountByEmail(env.DB, email).catch(() => null);
  if (row?.id && row.email) {
    const sent = await sendPasswordResetChallenge(env, row.id, row.email, buildSessionInsertMeta(request, null)).catch((e) => {
      const msg = String(e && typeof e === "object" && "message" in e ? (e as Error).message : e);
      console.error("password_reset_email", msg);
      return false;
    });
    if (!sent) console.error("password_reset_email_not_sent", email);
  }
  return json({ ok: true, detail: "If that account exists, a reset email has been sent." }, 202);
}

async function handlePasswordResetConfirm(request: Request, env: MeAccountEnv): Promise<Response> {
  let body: { token?: string; code?: string; email?: string; new_password?: string; device_id?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return json({ detail: "Invalid JSON" }, 400);
  }
  const newPassword = String(body.new_password || "");
  if (newPassword.length < 6) return json({ detail: "New password must be at least 6 characters." }, 422);

  let accountIdForCode: string | null = null;
  if (!String(body.token || "").trim() && String(body.code || "").trim() && body.email) {
    const acc = await accountByEmail(env.DB, body.email).catch(() => null);
    accountIdForCode = acc?.id || null;
  }
  const consumed = await consumeChallenge({
    db: env.DB,
    purpose: "password_reset",
    token: body.token,
    code: body.code,
    accountId: accountIdForCode,
  });
  if (!consumed) return json({ detail: "Invalid or expired reset code." }, 400);

  let newHash: string;
  let newSalt: string;
  try {
    const creds = await hashNewAccountCredentials(newPassword);
    newHash = creds.password_hash;
    newSalt = creds.salt;
  } catch {
    return json({ detail: "Could not hash new password." }, 500);
  }

  const now = new Date().toISOString();
  await env.DB
    .prepare("UPDATE license_accounts SET password_hash = ?, salt = ?, updated_at = ? WHERE id = ?")
    .bind(newHash, newSalt, now, consumed.account_id)
    .run();
  await markEmailVerified(env.DB, consumed.account_id, "email");
  await revokeAllSessions(env.DB, consumed.account_id);

  const access_token = await issueFreshSessionToken(
    env,
    consumed.email,
    consumed.account_id,
    buildSessionInsertMeta(request, String(body.device_id || "").trim() || null),
  );
  if (!access_token) return json({ ok: true, detail: "Password reset. Sign in with your new password." }, 200);
  return json(
    { ok: true, access_token, token: access_token, email: consumed.email, account_id: consumed.account_id },
    200,
    undefined,
    ssoSetAccessTokenLine(request, access_token),
  );
}

async function handleAccountChallengeRequest(request: Request, env: MeAccountEnv): Promise<Response> {
  const sess = await sessionFromRequest(env, request);
  if (!sess) return json({ detail: "Unauthorized" }, 401);
  const sent = await sendAccountChangeChallenge(env, sess.accountId, sess.email, buildSessionInsertMeta(request, null));
  if (!sent) return json({ detail: "Could not send account confirmation email." }, 503);
  return json({ ok: true, detail: "Confirmation email sent." }, 202);
}

async function handleAccountChallengeConfirm(request: Request, env: MeAccountEnv): Promise<Response> {
  const sess = await sessionFromRequest(env, request);
  if (!sess) return json({ detail: "Unauthorized" }, 401);
  let body: { token?: string; code?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return json({ detail: "Invalid JSON" }, 400);
  }
  const consumed = await consumeChallenge({
    db: env.DB,
    purpose: "account_change",
    token: body.token,
    code: body.code,
    accountId: sess.accountId,
  });
  if (!consumed || consumed.account_id !== sess.accountId) {
    return json({ detail: "Invalid or expired confirmation code." }, 400);
  }
  await markRecentAccountVerification(env.DB, sess.accountId, "email");
  return json({ ok: true, verified: true }, 200);
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
      const row = await env.DB
        .prepare(
          `SELECT COUNT(*) AS c FROM license_sessions WHERE account_id = ? AND revoked_at IS NULL`
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
      extractAuthToken(request) ? clearLine : undefined
    );
  }
  let n = 0;
  try {
    const row = await env.DB
      .prepare(`SELECT COUNT(*) AS c FROM license_sessions WHERE account_id = ? AND revoked_at IS NULL`)
      .bind(sess.accountId)
      .first<{ c: number }>();
    n = Math.max(0, Number(row?.c) || 0);
  } catch {
    n = 0;
  }
  await revokeAllSessions(env.DB, sess.accountId);
  return json({ ok: true, revoked: n }, 200, undefined, clearLine);
}

export async function handleMeAccountRoutes(
  request: Request,
  env: MeAccountEnv,
  sub: string,
  method: string
): Promise<Response | null> {
  if (method === "POST" && (sub === "/me/password" || sub === "/v1/me/password")) {
    return handleMePassword(request, env);
  }
  if (method === "GET" && sub === "/me/sessions") {
    return handleMeSessionsGet(request, env);
  }
  if (method === "GET" && sub === "/me/apps") {
    return handleMeAppsGet(request, env);
  }
  if (method === "POST" && (sub === "/me/email/request" || sub === "/v1/me/email/request")) {
    return handleEmailRequest(request, env);
  }
  if (method === "POST" && (sub === "/me/email/confirm" || sub === "/v1/me/email/confirm")) {
    return handleEmailConfirm(request, env);
  }
  if (method === "POST" && (sub === "/me/email/verify/request" || sub === "/v1/me/email/verify/request")) {
    return handleEmailVerifyRequest(request, env);
  }
  if (method === "POST" && (sub === "/me/email/verify/confirm" || sub === "/v1/me/email/verify/confirm")) {
    return handleEmailVerifyConfirm(request, env);
  }
  if (method === "POST" && (sub === "/auth/password-reset/request" || sub === "/v1/auth/password-reset/request")) {
    return handlePasswordResetRequest(request, env);
  }
  if (method === "POST" && (sub === "/auth/password-reset/confirm" || sub === "/v1/auth/password-reset/confirm")) {
    return handlePasswordResetConfirm(request, env);
  }
  if (method === "POST" && (sub === "/me/security/challenge/request" || sub === "/v1/me/security/challenge/request")) {
    return handleAccountChallengeRequest(request, env);
  }
  if (method === "POST" && (sub === "/me/security/challenge/confirm" || sub === "/v1/me/security/challenge/confirm")) {
    return handleAccountChallengeConfirm(request, env);
  }

  const revokePrefix = "/me/sessions/";
  const revokeSuffix = "/revoke";
  if (method === "POST" && sub.startsWith(revokePrefix) && sub.endsWith(revokeSuffix)) {
    const mid = sub.slice(revokePrefix.length, sub.length - revokeSuffix.length);
    return handleMeSessionRevoke(request, env, mid);
  }

  return null;
}
