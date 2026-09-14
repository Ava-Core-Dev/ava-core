import { verifyLicenseAccountPassword } from "./password-verify";

type D1PreparedStatement = {
  bind: (...args: unknown[]) => D1PreparedStatement;
  first: <T>() => Promise<T | null>;
  all: <T>() => Promise<{ results?: T[] }>;
  run: () => Promise<unknown>;
};
type D1Database = { prepare: (sql: string) => D1PreparedStatement };

export type LicenseLoginRow = {
  id: string;
  email: string;
  password_hash: string;
  salt: string;
  /** Email typed at sign-in when it was an alias row. */
  login_email: string;
  via_alias: boolean;
};

/** True when this email was merged onto another account (alias row only). */
export async function isMergedLoginAliasEmail(db: D1Database, emailRaw: string): Promise<boolean> {
  const email = String(emailRaw || "").trim().toLowerCase();
  if (!email) return false;
  const row = await db
    .prepare("SELECT 1 AS ok FROM license_account_login_aliases WHERE email = ?")
    .bind(email)
    .first<{ ok: number }>();
  return Boolean(row?.ok);
}

export async function resolveLicenseLoginRow(
  db: D1Database,
  emailRaw: string,
): Promise<LicenseLoginRow | null> {
  const email = String(emailRaw || "").trim().toLowerCase();
  if (!email) return null;

  const primary = await db
    .prepare("SELECT id, email, password_hash, salt FROM license_accounts WHERE email = ?")
    .bind(email)
    .first<{ id: string; email: string; password_hash: string; salt: string }>();
  if (primary?.id) {
    return {
      id: primary.id,
      email: primary.email.trim().toLowerCase(),
      password_hash: primary.password_hash,
      salt: primary.salt,
      login_email: email,
      via_alias: false,
    };
  }

  const alias = await db
    .prepare(
      "SELECT account_id, password_hash, salt FROM license_account_login_aliases WHERE email = ?",
    )
    .bind(email)
    .first<{ account_id: string; password_hash: string; salt: string }>();
  if (!alias?.account_id) return null;

  const canonical = await db
    .prepare("SELECT id, email FROM license_accounts WHERE id = ?")
    .bind(alias.account_id)
    .first<{ id: string; email: string }>();
  if (!canonical?.id) return null;

  return {
    id: canonical.id,
    email: canonical.email.trim().toLowerCase(),
    password_hash: alias.password_hash,
    salt: alias.salt,
    login_email: email,
    via_alias: true,
  };
}

export async function attachLoginEmailAlias(
  db: D1Database,
  canonicalAccountId: string,
  aliasEmail: string,
  password_hash: string,
  salt: string,
): Promise<void> {
  const email = aliasEmail.trim().toLowerCase();
  const aid = canonicalAccountId.trim();
  if (!email || !aid) return;
  const now = new Date().toISOString();
  await db
    .prepare(
      `INSERT INTO license_account_login_aliases (email, account_id, password_hash, salt, created_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(email) DO UPDATE SET
         account_id = excluded.account_id,
         password_hash = excluded.password_hash,
         salt = excluded.salt`,
    )
    .bind(email, aid, password_hash, salt, now)
    .run();
}

/** Remove a duplicate portal account created for a second email; drops its custodial wallet row. */
export async function deleteMergedDuplicateAccount(
  db: D1Database,
  accountId: string,
  email: string,
): Promise<void> {
  const emailLower = email.trim().toLowerCase();
  const aid = accountId.trim();
  const userId = `user:${emailLower}`;

  await (db as unknown as { batch: (statements: D1PreparedStatement[]) => Promise<unknown> }).batch([
    db.prepare("DELETE FROM license_sessions WHERE account_id = ?").bind(aid),
    db.prepare("DELETE FROM license_email_change WHERE account_id = ?").bind(aid),
    db.prepare("DELETE FROM license_account_security WHERE account_id = ?").bind(aid),
    db.prepare("DELETE FROM license_account_challenges WHERE account_id = ?").bind(aid),
    db.prepare("DELETE FROM discord_account_links WHERE account_id = ?").bind(aid),
    db.prepare("DELETE FROM solana_linked_wallets WHERE account_id = ?").bind(aid),
    db.prepare("DELETE FROM internal_solana_wallets WHERE account_id = ?").bind(aid),
    db.prepare("DELETE FROM custodial_wallet_token_slots WHERE account_id = ?").bind(aid),
    db.prepare("DELETE FROM rr_earn_custodial_state WHERE account_id = ?").bind(aid),
    db.prepare("DELETE FROM rr_earn_custodial_ledger WHERE account_id = ?").bind(aid),
    db.prepare("DELETE FROM rr_earn_internal_transfer WHERE from_account_id = ? OR to_account_id = ?").bind(
      aid,
      aid,
    ),
    db.prepare("DELETE FROM rrwm_locations WHERE user_id = ?").bind(userId),
    db.prepare("DELETE FROM rrwm_push_tokens WHERE user_id = ?").bind(userId),
    db.prepare("DELETE FROM weather_data WHERE user_id = ?").bind(userId),
    db.prepare("DELETE FROM rrwm_alert_seen WHERE user_id = ?").bind(userId),
    db.prepare("DELETE FROM rrwm_user_prefs WHERE user_id = ?").bind(userId),
    db.prepare("DELETE FROM rr_earn_balance WHERE user_id = ?").bind(userId),
    db.prepare("DELETE FROM rr_earn_day WHERE user_id = ?").bind(userId),
    db.prepare("DELETE FROM rr_earn_state WHERE user_id = ?").bind(userId),
    db.prepare("DELETE FROM rr_earn_app_day WHERE user_id = ?").bind(userId),
    db.prepare("DELETE FROM rr_earn_app_total WHERE user_id = ?").bind(userId),
    db.prepare("DELETE FROM rr_earn_signup_bonus WHERE user_id = ?").bind(userId),
    db.prepare("DELETE FROM rr_earn_app_first_open WHERE user_id = ?").bind(userId),
    db.prepare("DELETE FROM bm_owned_row WHERE user_key = ?").bind(userId),
    db.prepare("DELETE FROM me_password_attempt WHERE account_id = ?").bind(aid),
    db.prepare("DELETE FROM user_accounts WHERE email = ?").bind(emailLower),
    db.prepare("DELETE FROM license_accounts WHERE id = ? AND email = ?").bind(aid, emailLower),
  ]);
}

export async function verifyPasswordForLoginRow(
  password: string,
  row: LicenseLoginRow,
): Promise<
  | { ok: true; needsUpgrade: boolean; password_hash: string; salt: string }
  | { ok: false }
> {
  if (typeof row.password_hash !== "string" || !row.password_hash || typeof row.salt !== "string" || !row.salt) {
    return { ok: false };
  }
  try {
    const v = await verifyLicenseAccountPassword(password, row.salt, row.password_hash);
    if (!v.ok) return { ok: false };
    return {
      ok: true,
      needsUpgrade: v.needsUpgrade,
      password_hash: v.password_hash,
      salt: v.salt,
    };
  } catch {
    return { ok: false };
  }
}
