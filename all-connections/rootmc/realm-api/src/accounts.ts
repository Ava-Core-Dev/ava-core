import type { D1Database } from "@cloudflare/workers-types";

/**
 * `user_accounts`  -  portal mirror only: email, account_id, pro/life flags, extra_json.
 * Credentials (password_hash, salt) always live in `license_accounts`; never query passwords here.
 */

/** True if license payload marks a paid lifelong membership (snake_case or camelCase). */
export function lifeMemberFromLicenseData(data: Record<string, unknown>): boolean {
  const a = data.access;
  const access = a && typeof a === "object" ? (a as Record<string, unknown>) : undefined;
  return Boolean(
    data.life_member ??
      data.lifeMember ??
      data.lifetime_member ??
      data.lifetimeMember ??
      data.lifetime ??
      access?.life_member ??
      access?.lifeMember
  );
}

/** Upsert a row after a successful license login / signup / prepare. Email is stored lowercased. */
export async function upsertUserAccountFromLicense(
  db: D1Database,
  input: {
    email: string;
    account_id: string;
    pro_unlocked: boolean;
    life_member: boolean;
    extra?: Record<string, unknown>;
  }
): Promise<void> {
  const email = input.email.trim().toLowerCase();
  if (!email) return;

  const now = new Date().toISOString();
  const pro = input.pro_unlocked ? 1 : 0;
  const life = input.life_member ? 1 : 0;
  const extraJson = input.extra && Object.keys(input.extra).length ? JSON.stringify(input.extra) : null;
  const accountId = input.account_id?.trim() || null;

  const existing = await db
    .prepare("SELECT id, created_at FROM user_accounts WHERE email = ?")
    .bind(email)
    .first<{ id: string; created_at: string }>();

  const id = existing?.id ?? crypto.randomUUID();
  const created_at = existing?.created_at ?? now;

  await db
    .prepare(
      `INSERT INTO user_accounts (id, email, account_id, created_at, updated_at, pro_unlocked, life_member, extra_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(email) DO UPDATE SET
         account_id = COALESCE(excluded.account_id, user_accounts.account_id),
         updated_at = excluded.updated_at,
         pro_unlocked = MAX(excluded.pro_unlocked, user_accounts.pro_unlocked),
         life_member = MAX(excluded.life_member, user_accounts.life_member),
         extra_json = COALESCE(excluded.extra_json, user_accounts.extra_json)`
    )
    .bind(id, email, accountId, created_at, now, pro, life, extraJson)
    .run();
}

/**
 * Returns merged access flags: paid `pro_unlocked`, lifetime, weekly award window
 * (`pro_redeemed_until`), or Stripe one-month window (`pro_paid_until`).
 */
export async function readUserAccountAccessFlags(
  db: D1Database,
  email: string
): Promise<{
  pro_unlocked: boolean;
  life_member: boolean;
  pro_redeemed_until: string | null;
  pro_paid_until: string | null;
} | null> {
  const e = email.trim().toLowerCase();
  if (!e) return null;
  const row = await db
    .prepare(
      "SELECT pro_unlocked, life_member, pro_redeemed_until, pro_paid_until FROM user_accounts WHERE email = ?",
    )
    .bind(e)
    .first<{
      pro_unlocked: number;
      life_member: number;
      pro_redeemed_until: string | null;
      pro_paid_until: string | null;
    }>();
  if (!row) return null;
  const redeemedUntil = row.pro_redeemed_until ? String(row.pro_redeemed_until).trim() || null : null;
  const paidUntil = row.pro_paid_until ? String(row.pro_paid_until).trim() || null : null;
  const now = Date.now();
  const redemptionActive = redeemedUntil ? Date.parse(redeemedUntil) > now : false;
  const paidActive = paidUntil ? Date.parse(paidUntil) > now : false;
  return {
    pro_unlocked: Boolean(row.pro_unlocked) || redemptionActive || paidActive || Boolean(row.life_member),
    life_member: Boolean(row.life_member),
    pro_redeemed_until: redeemedUntil,
    pro_paid_until: paidUntil,
  };
}

/** Extend `pro_redeemed_until` by `addDays` from max(now, current window). */
export async function extendProRedeemedUntil(
  db: D1Database,
  email: string,
  addDays: number,
): Promise<string | null> {
  const e = email.trim().toLowerCase();
  if (!e || addDays <= 0) return null;
  const row = await db
    .prepare("SELECT pro_redeemed_until FROM user_accounts WHERE email = ?")
    .bind(e)
    .first<{ pro_redeemed_until: string | null }>();
  if (!row) return null;
  const nowMs = Date.now();
  const existingMs = row.pro_redeemed_until ? Date.parse(String(row.pro_redeemed_until)) : NaN;
  const floorMs = Number.isFinite(existingMs) && existingMs > nowMs ? existingMs : nowMs;
  const nextMs = floorMs + addDays * 24 * 60 * 60 * 1000;
  const nextIso = new Date(nextMs).toISOString();
  await db
    .prepare("UPDATE user_accounts SET pro_redeemed_until = ?, updated_at = ? WHERE email = ?")
    .bind(nextIso, new Date().toISOString(), e)
    .run();
  return nextIso;
}

/** Extend Stripe paid one-month window (`pro_paid_until`) — never uses weekly award column. */
export async function extendProPaidUntil(
  db: D1Database,
  email: string,
  addDays: number,
): Promise<string | null> {
  const e = email.trim().toLowerCase();
  if (!e || addDays <= 0) return null;
  const row = await db
    .prepare("SELECT id, pro_paid_until FROM user_accounts WHERE email = ?")
    .bind(e)
    .first<{ id: string; pro_paid_until: string | null }>();
  if (!row) return null;
  const nowMs = Date.now();
  const existingMs = row.pro_paid_until ? Date.parse(String(row.pro_paid_until)) : NaN;
  const floorMs = Number.isFinite(existingMs) && existingMs > nowMs ? existingMs : nowMs;
  const nextMs = floorMs + addDays * 24 * 60 * 60 * 1000;
  const nextIso = new Date(nextMs).toISOString();
  await db
    .prepare("UPDATE user_accounts SET pro_paid_until = ?, updated_at = ? WHERE email = ?")
    .bind(nextIso, new Date().toISOString(), e)
    .run();
  return nextIso;
}

/** Clear paid one-month window (refund / dispute after redeem). */
export async function clearProPaidUntil(db: D1Database, email: string): Promise<void> {
  const e = email.trim().toLowerCase();
  if (!e) return;
  const now = new Date().toISOString();
  await db
    .prepare("UPDATE user_accounts SET pro_paid_until = NULL, updated_at = ? WHERE email = ?")
    .bind(now, e)
    .run();
}

