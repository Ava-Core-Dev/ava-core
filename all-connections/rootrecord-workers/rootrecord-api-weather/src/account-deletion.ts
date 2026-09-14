import type { D1Database } from "@cloudflare/workers-types";

import { sweepCustodialToTreasury, type SweepEnv } from "./custodial-sweep";

export type AccountDeletionEnv = SweepEnv;

/**
 * **Custodial key custody:** we intentionally never `DELETE` from `internal_solana_wallets`.
 * Encrypted private key material stays in D1 after portal deletion so funds are never stranded by a lost row.
 * On-chain assets are still swept to treasury (when configured) before other rows are removed.
 */
export async function deletePortalAccountData(db: D1Database, accountId: string, email: string): Promise<void> {
  const emailLower = email.trim().toLowerCase();
  const userId = `user:${emailLower}`;

  await db.batch([
    db.prepare("DELETE FROM license_sessions WHERE account_id = ?").bind(accountId),
    db.prepare("DELETE FROM license_email_change WHERE account_id = ?").bind(accountId),
    db.prepare("DELETE FROM solana_linked_wallets WHERE account_id = ?").bind(accountId),
    db.prepare("DELETE FROM rr_earn_custodial_state WHERE account_id = ?").bind(accountId),
    db.prepare("DELETE FROM rr_earn_custodial_ledger WHERE account_id = ?").bind(accountId),
    db.prepare("DELETE FROM rrwm_locations WHERE user_id = ?").bind(userId),
    db.prepare("DELETE FROM rrwm_push_tokens WHERE user_id = ?").bind(userId),
    db.prepare("DELETE FROM weather_data WHERE user_id = ?").bind(userId),
    db.prepare("DELETE FROM weather_location_ai_reports WHERE user_id = ?").bind(userId),
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
    db.prepare("DELETE FROM me_password_attempt WHERE account_id = ?").bind(accountId),
    db.prepare("DELETE FROM user_accounts WHERE email = ?").bind(emailLower),
    db.prepare("DELETE FROM license_accounts WHERE id = ? AND email = ?").bind(accountId, emailLower),
  ]);
}

/**
 * On-chain sweep to treasury (SPL + SOL, close token accounts), verify wallet empty, then D1 deletes portal rows.
 * **Never** removes `internal_solana_wallets` (encrypted custodial keys) — see `deletePortalAccountData`.
 * If sweep or verification fails, other D1 rows are left intact and the caller must surface an error.
 */
export async function performAccountDeletion(
  env: AccountDeletionEnv,
  accountId: string,
  email: string,
): Promise<
  | { ok: true; custodial_sweep: string; custodial_wallet_keys_retained: true }
  | { ok: false; status: number; detail: string }
> {
  let sweep: Awaited<ReturnType<typeof sweepCustodialToTreasury>>;
  try {
    sweep = await sweepCustodialToTreasury(env, accountId);
  } catch (e) {
    const msg = String(e && typeof e === "object" && "message" in e ? (e as Error).message : e);
    console.error("sweepCustodialToTreasury threw", accountId, msg);
    return {
      ok: false,
      status: 503,
      detail:
        "Could not complete the custodial on-chain safety check. Nothing was deleted. Try again later or contact support.",
    };
  }
  if (sweep.blocksDeletion) {
    return { ok: false, status: 503, detail: sweep.userMessage };
  }
  try {
    await deletePortalAccountData(env.DB, accountId, email);
  } catch (e) {
    const msg = String(e && typeof e === "object" && "message" in e ? (e as Error).message : e);
    console.error("deletePortalAccountData", accountId, msg);
    return { ok: false, status: 500, detail: "Could not delete account. Please try again." };
  }
  return { ok: true, custodial_sweep: sweep.summary, custodial_wallet_keys_retained: true };
}
