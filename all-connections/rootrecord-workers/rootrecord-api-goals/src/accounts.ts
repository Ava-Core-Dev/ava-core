import type { D1Database } from "@cloudflare/workers-types";
import { SERVER_GOAL_EMAIL, ensureAvaLifetimeMember, isAvaOperatorEmail } from "../../shared/ava-shards";

/**
 * `user_accounts` — portal mirror only: email, account_id, pro/life flags, extra_json.
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
  const ava = isAvaOperatorEmail(email);

  const now = new Date().toISOString();
  const pro = input.pro_unlocked || ava ? 1 : 0;
  const life = input.life_member || ava ? 1 : 0;
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
 * Returns merged access flags: the license-driven `pro_unlocked` column OR an active
 * rewards-redeemed Pro window (`pro_redeemed_until > now`). Schema column added by
 * api-account migration 0033; D1 is shared across every shard, so this shard just reads.
 */
export async function readUserAccountAccessFlags(
  db: D1Database,
  email: string
): Promise<{ pro_unlocked: boolean; life_member: boolean; pro_redeemed_until: string | null } | null> {
  const e = email.trim().toLowerCase();
  if (!e) return null;
  if (isAvaOperatorEmail(e)) {
    await ensureAvaLifetimeMember(db).catch(() => {});
  }
  const row = await db
    .prepare("SELECT pro_unlocked, life_member, pro_redeemed_until FROM user_accounts WHERE email = ?")
    .bind(e)
    .first<{ pro_unlocked: number; life_member: number; pro_redeemed_until: string | null }>();
  if (!row) {
    if (isAvaOperatorEmail(e)) {
      return { pro_unlocked: true, life_member: true, pro_redeemed_until: null };
    }
    return null;
  }
  const redeemedUntil = row.pro_redeemed_until ? String(row.pro_redeemed_until).trim() || null : null;
  const redemptionActive = redeemedUntil ? Date.parse(redeemedUntil) > Date.now() : false;
  const life = Boolean(row.life_member) || isAvaOperatorEmail(e);
  return {
    pro_unlocked: Boolean(row.pro_unlocked) || redemptionActive || life,
    life_member: life,
    pro_redeemed_until: redeemedUntil,
  };
}

