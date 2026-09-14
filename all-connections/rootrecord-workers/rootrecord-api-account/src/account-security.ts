import type { D1Database } from "@cloudflare/workers-types";

import { sendTransactionalEmail, type TransactionalEmailEnv } from "../../shared/send-transactional-email";

export type AccountChallengePurpose = "email_verify" | "password_reset" | "account_change";
export type SecurityMeta = {
  device_id?: string | null;
  user_agent?: string | null;
  ip?: string | null;
};

export type AccountSecurityEnv = TransactionalEmailEnv & {
  DB: D1Database;
  SITE_URL?: string;
};

export type AccountSecurityState = {
  email_verified: boolean;
  email_verified_at: string | null;
  last_challenge_verified_at: string | null;
  last_challenge_method: string | null;
};

export type ConsumedChallenge = {
  id: string;
  account_id: string;
  email: string;
  purpose: AccountChallengePurpose;
  new_email: string | null;
};

type ChallengeRow = {
  id: string;
  account_id: string;
  email: string;
  purpose: AccountChallengePurpose;
  new_email: string | null;
  expires_at: string;
  failed_attempts: number;
};

const SUPPORT_EMAIL = "root@rootrecord.info";
const EMAIL_VERIFY_TTL_MS = 24 * 60 * 60_000;
const PASSWORD_RESET_TTL_MS = 45 * 60_000;
const ACCOUNT_CHANGE_TTL_MS = 15 * 60_000;
export const RECENT_ACCOUNT_VERIFICATION_MS = 15 * 60_000;

function siteUrl(env: { SITE_URL?: string }): string {
  return String(env.SITE_URL || "https://rootrecord.cloud").trim().replace(/\/+$/, "");
}

function normalizeEmail(email: string): string {
  return String(email || "").trim().toLowerCase();
}

function escapeHtml(s: string): string {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

async function sha256Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function randomToken(): string {
  return `${crypto.randomUUID()}${crypto.randomUUID()}`.replace(/-/g, "");
}

function randomCode(): string {
  const bytes = new Uint8Array(4);
  crypto.getRandomValues(bytes);
  const n = new DataView(bytes.buffer).getUint32(0) % 1_000_000;
  return String(n).padStart(6, "0");
}

async function ensureSecurityRow(db: D1Database, accountId: string): Promise<void> {
  const now = new Date().toISOString();
  await db
    .prepare(
      `INSERT INTO license_account_security (account_id, created_at, updated_at)
       VALUES (?, ?, ?)
       ON CONFLICT(account_id) DO UPDATE SET updated_at = license_account_security.updated_at`,
    )
    .bind(accountId, now, now)
    .run();
}

export async function readAccountSecurity(db: D1Database, accountId: string): Promise<AccountSecurityState> {
  try {
    const row = await db
      .prepare(
        `SELECT email_verified_at, last_challenge_verified_at, last_challenge_method
         FROM license_account_security WHERE account_id = ?`,
      )
      .bind(accountId)
      .first<{
        email_verified_at: string | null;
        last_challenge_verified_at: string | null;
        last_challenge_method: string | null;
      }>();
    const emailVerifiedAt = String(row?.email_verified_at || "").trim() || null;
    const lastAt = String(row?.last_challenge_verified_at || "").trim() || null;
    const method = String(row?.last_challenge_method || "").trim() || null;
    return {
      email_verified: Boolean(emailVerifiedAt),
      email_verified_at: emailVerifiedAt,
      last_challenge_verified_at: lastAt,
      last_challenge_method: method,
    };
  } catch {
    return {
      email_verified: false,
      email_verified_at: null,
      last_challenge_verified_at: null,
      last_challenge_method: null,
    };
  }
}

export async function markEmailVerified(db: D1Database, accountId: string, method = "email"): Promise<void> {
  const now = new Date().toISOString();
  await db
    .prepare(
      `INSERT INTO license_account_security (
         account_id, email_verified_at, last_challenge_verified_at, last_challenge_method, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(account_id) DO UPDATE SET
         email_verified_at = COALESCE(license_account_security.email_verified_at, excluded.email_verified_at),
         last_challenge_verified_at = excluded.last_challenge_verified_at,
         last_challenge_method = excluded.last_challenge_method,
         updated_at = excluded.updated_at`,
    )
    .bind(accountId, now, now, method, now, now)
    .run();
}

export async function markRecentAccountVerification(
  db: D1Database,
  accountId: string,
  method: "email" | "discord",
): Promise<void> {
  const now = new Date().toISOString();
  await db
    .prepare(
      `INSERT INTO license_account_security (
         account_id, last_challenge_verified_at, last_challenge_method, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(account_id) DO UPDATE SET
         last_challenge_verified_at = excluded.last_challenge_verified_at,
         last_challenge_method = excluded.last_challenge_method,
         updated_at = excluded.updated_at`,
    )
    .bind(accountId, now, method, now, now)
    .run();
}

export async function hasRecentAccountVerification(db: D1Database, accountId: string): Promise<boolean> {
  const state = await readAccountSecurity(db, accountId);
  const ts = Date.parse(state.last_challenge_verified_at || "");
  return Number.isFinite(ts) && Date.now() - ts <= RECENT_ACCOUNT_VERIFICATION_MS;
}

async function createChallenge(params: {
  env: AccountSecurityEnv;
  accountId: string;
  email: string;
  purpose: AccountChallengePurpose;
  ttlMs: number;
  meta?: SecurityMeta;
  newEmail?: string | null;
}): Promise<{ token: string; code: string; id: string }> {
  const accountId = String(params.accountId || "").trim();
  const email = normalizeEmail(params.email);
  if (!accountId || !email.includes("@")) throw new Error("Invalid account security challenge target.");

  await ensureSecurityRow(params.env.DB, accountId);

  const token = randomToken();
  const code = randomCode();
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const expiresAt = new Date(Date.now() + params.ttlMs).toISOString();
  const meta = params.meta || {};

  await params.env.DB
    .prepare(
      `UPDATE license_account_challenges
       SET consumed_at = ?
       WHERE account_id = ? AND purpose = ? AND consumed_at IS NULL`,
    )
    .bind(now, accountId, params.purpose)
    .run();

  await params.env.DB
    .prepare(
      `INSERT INTO license_account_challenges (
         id, account_id, email, purpose, token_hash, code_hash, new_email,
         device_id, user_agent, ip, created_at, expires_at, consumed_at, failed_attempts
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, 0)`,
    )
    .bind(
      id,
      accountId,
      email,
      params.purpose,
      await sha256Hex(token),
      await sha256Hex(code),
      params.newEmail ? normalizeEmail(params.newEmail) : null,
      String(meta.device_id || "").trim().slice(0, 128) || null,
      String(meta.user_agent || "").trim().slice(0, 512) || null,
      String(meta.ip || "").trim().slice(0, 64) || null,
      now,
      expiresAt,
    )
    .run();

  return { token, code, id };
}

function baseEmailHtml(title: string, body: string, actionHtml: string): string {
  return [
    `<p>${escapeHtml(title)}</p>`,
    `<p>${body}</p>`,
    actionHtml,
    `<p>If you did not request this, you can ignore this message.</p>`,
    `<p>Need help? Email <a href="mailto:${SUPPORT_EMAIL}">${SUPPORT_EMAIL}</a>.</p>`,
  ].join("");
}

export async function sendEmailVerificationChallenge(
  env: AccountSecurityEnv,
  accountId: string,
  email: string,
  meta?: SecurityMeta,
): Promise<boolean> {
  const { token, code } = await createChallenge({
    env,
    accountId,
    email,
    purpose: "email_verify",
    ttlMs: EMAIL_VERIFY_TTL_MS,
    meta,
  });
  const link = `${siteUrl(env)}/account.html?verify_email_token=${encodeURIComponent(token)}`;
  const html = baseEmailHtml(
    "Verify your RootRecord email address.",
    `Use code <strong>${escapeHtml(code)}</strong> or open the verification link below. This link expires in 24 hours.`,
    `<p><a href="${escapeHtml(link)}">${escapeHtml(link)}</a></p>`,
  );
  return sendTransactionalEmail(env, normalizeEmail(email), "Verify your RootRecord email", html);
}

export async function sendPasswordResetChallenge(
  env: AccountSecurityEnv,
  accountId: string,
  email: string,
  meta?: SecurityMeta,
): Promise<boolean> {
  const { token, code } = await createChallenge({
    env,
    accountId,
    email,
    purpose: "password_reset",
    ttlMs: PASSWORD_RESET_TTL_MS,
    meta,
  });
  const link = `${siteUrl(env)}/account.html?reset_token=${encodeURIComponent(token)}`;
  const html = baseEmailHtml(
    "Reset your RootRecord password.",
    `Use code <strong>${escapeHtml(code)}</strong> or open the reset link below. This link expires in 45 minutes.`,
    `<p><a href="${escapeHtml(link)}">${escapeHtml(link)}</a></p>`,
  );
  return sendTransactionalEmail(env, normalizeEmail(email), "Reset your RootRecord password", html);
}

export async function sendAccountChangeChallenge(
  env: AccountSecurityEnv,
  accountId: string,
  email: string,
  meta?: SecurityMeta,
): Promise<boolean> {
  const { token, code } = await createChallenge({
    env,
    accountId,
    email,
    purpose: "account_change",
    ttlMs: ACCOUNT_CHANGE_TTL_MS,
    meta,
  });
  const link = `${siteUrl(env)}/account.html?security_token=${encodeURIComponent(token)}`;
  const html = baseEmailHtml(
    "Confirm this RootRecord account change.",
    `Use code <strong>${escapeHtml(code)}</strong> or open the confirmation link below. This verification expires in 15 minutes.`,
    `<p><a href="${escapeHtml(link)}">${escapeHtml(link)}</a></p>`,
  );
  return sendTransactionalEmail(env, normalizeEmail(email), "Confirm your RootRecord account change", html);
}

export async function consumeChallenge(params: {
  db: D1Database;
  purpose: AccountChallengePurpose;
  token?: string | null;
  code?: string | null;
  accountId?: string | null;
}): Promise<ConsumedChallenge | null> {
  const token = String(params.token || "").trim();
  const code = String(params.code || "").trim();
  const accountId = String(params.accountId || "").trim();
  let row: ChallengeRow | null = null;

  if (token.length >= 16) {
    row = await params.db
      .prepare(
        `SELECT id, account_id, email, purpose, new_email, expires_at, failed_attempts
         FROM license_account_challenges
         WHERE token_hash = ? AND purpose = ? AND consumed_at IS NULL`,
      )
      .bind(await sha256Hex(token), params.purpose)
      .first<ChallengeRow>();
  } else if (code.length >= 6 && accountId) {
    row = await params.db
      .prepare(
        `SELECT id, account_id, email, purpose, new_email, expires_at, failed_attempts
         FROM license_account_challenges
         WHERE account_id = ? AND purpose = ? AND code_hash = ? AND consumed_at IS NULL
         ORDER BY created_at DESC LIMIT 1`,
      )
      .bind(accountId, params.purpose, await sha256Hex(code))
      .first<ChallengeRow>();
  }

  if (!row?.id) return null;

  const exp = Date.parse(row.expires_at || "");
  if (!Number.isFinite(exp) || exp < Date.now() || Number(row.failed_attempts || 0) >= 5) {
    await params.db
      .prepare("UPDATE license_account_challenges SET consumed_at = ? WHERE id = ?")
      .bind(new Date().toISOString(), row.id)
      .run();
    return null;
  }

  await params.db
    .prepare("UPDATE license_account_challenges SET consumed_at = ? WHERE id = ? AND consumed_at IS NULL")
    .bind(new Date().toISOString(), row.id)
    .run();

  return {
    id: row.id,
    account_id: row.account_id,
    email: normalizeEmail(row.email),
    purpose: row.purpose,
    new_email: row.new_email ? normalizeEmail(row.new_email) : null,
  };
}

