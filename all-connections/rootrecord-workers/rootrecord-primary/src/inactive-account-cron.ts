import type { Env } from "./router";
import { performAccountDeletion } from "./account-deletion";

/**
 * Purge accounts with no meaningful login for `ABANDONED_ACCOUNT_INACTIVITY_DAYS` (default 365).
 * Activity = max(session last_seen/created, license_accounts.updated_at, license_accounts.created_at).
 * Same on-chain sweep + verify as voluntary DELETE /v1/me.
 */
export async function runInactiveAccountCleanupCron(env: Env): Promise<void> {
  const raw = String(env.ABANDONED_ACCOUNT_INACTIVITY_DAYS || "365").trim();
  const days = Math.min(2000, Math.max(30, Math.floor(Number(raw) || 365)));
  const cutoffMs = Date.now() - days * 86_400_000;
  const cutoffIso = new Date(cutoffMs).toISOString();

  let rows: { account_id: string; email: string }[] = [];
  try {
    const r = await env.DB
      .prepare(
        `SELECT la.id AS account_id, la.email AS email
         FROM license_accounts la
         WHERE datetime(
           max(
             ifnull((SELECT MAX(COALESCE(s.last_seen_at, s.created_at)) FROM license_sessions s WHERE s.account_id = la.id), '1970-01-01T00:00:00.000Z'),
             la.updated_at,
             la.created_at
           )
         ) < datetime(?)
         LIMIT 6`,
      )
      .bind(cutoffIso)
      .all<{ account_id: string; email: string }>();
    rows = r.results || [];
  } catch (e) {
    const msg = String(e && typeof e === "object" && "message" in e ? (e as Error).message : e);
    console.error("inactiveAccountCleanup query", msg);
    return;
  }

  if (!rows.length) {
    console.log("inactive account cleanup: no candidates");
    return;
  }

  for (const row of rows) {
    const accountId = String(row.account_id || "").trim();
    const email = String(row.email || "").trim();
    if (!accountId || !email) continue;
    const res = await performAccountDeletion(env, accountId, email);
    if (!res.ok) {
      console.error("inactive account cleanup blocked", accountId, res.detail);
      continue;
    }
    console.log("inactive account cleanup purged", accountId, res.custodial_sweep);
  }
}
