import type { D1Database } from "@cloudflare/workers-types";

import { json } from "./cors";
import type { AuthEnv } from "./primary-auth";
import { JWT_TTL_SEC, mintAuthToken } from "./primary-auth";
import { provisionMinecraftPlayerAccount } from "./rootmc-provision-account";

function nowIso(): string {
  return new Date().toISOString();
}

function str(v: unknown): string {
  return v == null ? "" : String(v).trim();
}

export type LinkCodeRow = {
  code: string;
  minecraft_uuid: string;
  minecraft_username: string;
  expires_at: string;
  consumed_at: string | null;
};

export async function loadLinkCode(db: D1Database, code: string): Promise<LinkCodeRow | null> {
  const row = await db
    .prepare(
      `SELECT code, minecraft_uuid, minecraft_username, expires_at, consumed_at
       FROM rootstat_link_codes WHERE code = ? LIMIT 1`,
    )
    .bind(code)
    .first<Record<string, unknown>>();
  if (!row) return null;
  return {
    code: str(row.code),
    minecraft_uuid: str(row.minecraft_uuid).toLowerCase(),
    minecraft_username: str(row.minecraft_username),
    expires_at: str(row.expires_at),
    consumed_at: row.consumed_at ? str(row.consumed_at) : null,
  };
}

export function validateLinkCodeRow(row: LinkCodeRow | null): Response | LinkCodeRow {
  if (!row) return json({ detail: "Invalid code." }, 404);
  if (row.consumed_at) return json({ detail: "Code already used." }, 409);
  if (row.expires_at < nowIso()) {
    return json({ detail: "Code expired. Run /rootmc link in-game again." }, 410);
  }
  return row;
}

export async function upsertGlobalMinecraftLink(
  db: D1Database,
  uuid: string,
  username: string,
  accountId: string,
  email: string,
): Promise<void> {
  const now = nowIso();
  await db
    .prepare(
      `INSERT INTO rootstat_minecraft_links
         (minecraft_uuid, minecraft_username, account_id, email, verified_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(minecraft_uuid) DO UPDATE SET
         minecraft_username = excluded.minecraft_username,
         account_id = excluded.account_id,
         email = excluded.email,
         verified_at = excluded.verified_at,
         updated_at = excluded.updated_at`,
    )
    .bind(uuid, username, accountId, email, now, now)
    .run();

  const profile = await db
    .prepare("SELECT account_id FROM rootmc_player_profiles WHERE account_id = ? LIMIT 1")
    .bind(accountId)
    .first<{ account_id: string }>();

  if (profile) {
    await db
      .prepare(
        `UPDATE rootmc_player_profiles
         SET minecraft_uuid = ?, minecraft_username = ?, updated_at = ?
         WHERE account_id = ?`,
      )
      .bind(uuid, username, now, accountId)
      .run();
  } else {
    await db
      .prepare(
        `INSERT INTO rootmc_player_profiles
           (account_id, realm_username, minecraft_username, minecraft_uuid, skin_url, bio, public_profile, created_at, updated_at)
         VALUES (?, NULL, ?, ?, NULL, NULL, 1, ?, ?)`,
      )
      .bind(accountId, username, uuid, now, now)
      .run();
  }
}

export async function consumeLinkCode(
  db: D1Database,
  code: string,
  accountId: string,
): Promise<void> {
  await db
    .prepare("UPDATE rootstat_link_codes SET consumed_at = ?, account_id = ? WHERE code = ?")
    .bind(nowIso(), accountId, code)
    .run();
}

/** Mobile app sign-in: in-game /link code proves identity; mints a 30-day JWT. */
export async function completeAppLinkLogin(
  env: AuthEnv & { DB: D1Database },
  rawCode: string,
): Promise<Response> {
  const code = str(rawCode).toUpperCase();
  if (!code || code.length !== 6) {
    return json({ detail: "Valid 6-character link code required." }, 400);
  }

  const linkRow = validateLinkCodeRow(await loadLinkCode(env.DB, code));
  if (linkRow instanceof Response) return linkRow;

  const account = await provisionMinecraftPlayerAccount(
    env.DB,
    linkRow.minecraft_uuid,
    linkRow.minecraft_username,
  );

  await upsertGlobalMinecraftLink(
    env.DB,
    linkRow.minecraft_uuid,
    linkRow.minecraft_username,
    account.accountId,
    account.email,
  );
  await consumeLinkCode(env.DB, code, account.accountId);

  const token = await mintAuthToken(env, account.email, account.accountId);
  if (!token) return json({ detail: "Auth not configured." }, 503);

  const expiresAt = new Date(Date.now() + JWT_TTL_SEC * 1000).toISOString();
  return json({
    access_token: token,
    token,
    account_id: account.accountId,
    email: account.email,
    minecraft_username: linkRow.minecraft_username,
    minecraft_uuid: linkRow.minecraft_uuid,
    provisioned: account.created,
    expires_at: expiresAt,
    expires_in: JWT_TTL_SEC,
    message: "ok",
  });
}
