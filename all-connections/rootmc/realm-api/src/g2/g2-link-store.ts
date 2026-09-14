import type { D1Database } from "@cloudflare/workers-types";

import { json } from "../cors";
import type { AuthEnv } from "../primary-auth";
import { JWT_TTL_SEC, mintAuthToken } from "../primary-auth";
import { hashNewAccountCredentials } from "../../../shared/password-verify";
import { msToIso, nowMs, str } from "./g2-db";

export type G2LinkCodeRow = {
  code: string;
  minecraft_uuid: string;
  minecraft_username: string;
  expires_at_ms: number;
  consumed_at_ms: number | null;
};

function minecraftProvisionerEmail(uuid: string): string {
  const compact = uuid.replace(/-/g, "").toLowerCase();
  return `mc+${compact}@players.rootmc.rootrecord.info`;
}

export async function g2LoadLinkCode(db: D1Database, code: string): Promise<G2LinkCodeRow | null> {
  const row = await db
    .prepare(
      `SELECT code, minecraft_uuid, minecraft_username, expires_at_ms, consumed_at_ms
       FROM g2_link_code WHERE code = ? LIMIT 1`,
    )
    .bind(code)
    .first<Record<string, unknown>>();
  if (!row) return null;
  return {
    code: str(row.code),
    minecraft_uuid: str(row.minecraft_uuid).toLowerCase(),
    minecraft_username: str(row.minecraft_username),
    expires_at_ms: Number(row.expires_at_ms) || 0,
    consumed_at_ms: row.consumed_at_ms == null ? null : Number(row.consumed_at_ms),
  };
}

export function g2ValidateLinkCodeRow(row: G2LinkCodeRow | null): Response | G2LinkCodeRow {
  if (!row) return json({ detail: "Invalid code." }, 404);
  if (row.consumed_at_ms) return json({ detail: "Code already used." }, 409);
  if (row.expires_at_ms < nowMs()) {
    return json({ detail: "Code expired. Run /rootmc link in-game again." }, 410);
  }
  return row;
}

export async function g2ProvisionMinecraftPlayerAccount(
  db: D1Database,
  uuid: string,
  username: string,
): Promise<{ accountId: string; email: string; created: boolean }> {
  const linked = await db
    .prepare("SELECT account_id, email FROM g2_minecraft_link WHERE minecraft_uuid = ? LIMIT 1")
    .bind(uuid)
    .first<{ account_id: string; email: string | null }>();
  if (linked?.account_id) {
    const email = str(linked.email).toLowerCase();
    if (email) return { accountId: linked.account_id, email, created: false };
  }

  const email = minecraftProvisionerEmail(uuid);
  const existing = await db
    .prepare("SELECT id, email FROM g2_license_account WHERE email = ? LIMIT 1")
    .bind(email)
    .first<{ id: string; email: string }>();
  if (existing?.id) {
    return { accountId: existing.id, email: existing.email, created: false };
  }

  const accountId = crypto.randomUUID();
  const ts = nowMs();
  const randomSecret = `${crypto.randomUUID()}${crypto.randomUUID()}`;
  const { salt, password_hash } = await hashNewAccountCredentials(randomSecret);

  await db
    .prepare(
      `INSERT INTO g2_license_account (id, email, password_hash, salt, created_at_ms, updated_at_ms)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .bind(accountId, email, password_hash, salt, ts, ts)
    .run();

  await db
    .prepare(
      `INSERT INTO g2_user_account (id, email, account_id, created_at_ms, updated_at_ms, pro_unlocked, life_member, extra_json)
       VALUES (?, ?, ?, ?, ?, 0, 0, ?)
       ON CONFLICT(email) DO UPDATE SET account_id = excluded.account_id, updated_at_ms = excluded.updated_at_ms`,
    )
    .bind(
      crypto.randomUUID(),
      email,
      accountId,
      ts,
      ts,
      JSON.stringify({ rootmc_provisioned: true, minecraft_uuid: uuid, minecraft_username: username }),
    )
    .run();

  return { accountId, email, created: true };
}

export async function g2UpsertMinecraftLink(
  db: D1Database,
  uuid: string,
  username: string,
  accountId: string,
  email: string,
): Promise<void> {
  const ts = nowMs();
  await db
    .prepare(
      `INSERT INTO g2_minecraft_link
         (minecraft_uuid, minecraft_username, account_id, email, verified_at_ms, updated_at_ms)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(minecraft_uuid) DO UPDATE SET
         minecraft_username = excluded.minecraft_username,
         account_id = excluded.account_id,
         email = excluded.email,
         verified_at_ms = excluded.verified_at_ms,
         updated_at_ms = excluded.updated_at_ms`,
    )
    .bind(uuid, username, accountId, email, ts, ts)
    .run();

  const profile = await db
    .prepare("SELECT account_id FROM g2_player_profile WHERE account_id = ? LIMIT 1")
    .bind(accountId)
    .first<{ account_id: string }>();

  if (profile) {
    await db
      .prepare(
        `UPDATE g2_player_profile
         SET minecraft_uuid = ?, minecraft_username = ?, updated_at_ms = ?
         WHERE account_id = ?`,
      )
      .bind(uuid, username, ts, accountId)
      .run();
  } else {
    await db
      .prepare(
        `INSERT INTO g2_player_profile
           (account_id, minecraft_uuid, minecraft_username, public_profile, created_at_ms, updated_at_ms)
         VALUES (?, ?, ?, 1, ?, ?)`,
      )
      .bind(accountId, uuid, username, ts, ts)
      .run();
  }
}

export async function g2ConsumeLinkCode(
  db: D1Database,
  code: string,
  accountId: string,
): Promise<void> {
  await db
    .prepare("UPDATE g2_link_code SET consumed_at_ms = ?, account_id = ? WHERE code = ?")
    .bind(nowMs(), accountId, code)
    .run();
}

export async function g2CompleteAppLinkLogin(
  env: AuthEnv & { DB: D1Database },
  rawCode: string,
): Promise<Response> {
  const code = str(rawCode).toUpperCase();
  if (!code || code.length !== 6) {
    return json({ detail: "Valid 6-character link code required." }, 400);
  }

  const linkRow = g2ValidateLinkCodeRow(await g2LoadLinkCode(env.DB, code));
  if (linkRow instanceof Response) return linkRow;

  const account = await g2ProvisionMinecraftPlayerAccount(
    env.DB,
    linkRow.minecraft_uuid,
    linkRow.minecraft_username,
  );

  await g2UpsertMinecraftLink(
    env.DB,
    linkRow.minecraft_uuid,
    linkRow.minecraft_username,
    account.accountId,
    account.email,
  );
  await g2ConsumeLinkCode(env.DB, code, account.accountId);

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
