import type { D1Database } from "@cloudflare/workers-types";

export const GOVERNANCE_TERMS_VERSION = "2026-07-02";

function str(v: unknown): string {
  return String(v ?? "").trim();
}

export async function termsAcceptedForAccount(db: D1Database, accountId: string): Promise<boolean> {
  const row = await db
    .prepare(`SELECT terms_version FROM rootmc_governance_terms_acceptance WHERE account_id = ? LIMIT 1`)
    .bind(accountId)
    .first<{ terms_version: string }>();
  return str(row?.terms_version) === GOVERNANCE_TERMS_VERSION;
}

export async function termsAcceptedForDiscord(db: D1Database, discordUserId: string): Promise<boolean> {
  const row = await db
    .prepare(
      `SELECT a.terms_version FROM rootmc_governance_terms_acceptance a
       INNER JOIN discord_account_links d ON d.account_id = a.account_id
       WHERE d.discord_user_id = ? LIMIT 1`,
    )
    .bind(discordUserId)
    .first<{ terms_version: string }>();
  return str(row?.terms_version) === GOVERNANCE_TERMS_VERSION;
}
