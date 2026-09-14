import type { D1Database } from "@cloudflare/workers-types";

import { upsertUserAccountFromLicense } from "./accounts";
import { hashNewAccountCredentials } from "../../shared/password-verify";

export function minecraftProvisionerEmail(uuid: string): string {
  const compact = uuid.replace(/-/g, "").toLowerCase();
  return `mc+${compact}@players.rootmc.rootrecord.info`;
}

export async function findLinkedAccountForUuid(
  db: D1Database,
  uuid: string,
): Promise<{ accountId: string; email: string } | null> {
  const row = await db
    .prepare("SELECT account_id, email FROM rootstat_minecraft_links WHERE minecraft_uuid = ? LIMIT 1")
    .bind(uuid)
    .first<{ account_id: string; email: string | null }>();
  if (!row?.account_id) return null;
  const email = String(row.email || "").trim().toLowerCase();
  if (!email) return null;
  return { accountId: row.account_id, email };
}

/** Ensures a license_accounts row exists for this Minecraft player (no password login by default). */
export async function provisionMinecraftPlayerAccount(
  db: D1Database,
  uuid: string,
  username: string,
): Promise<{ accountId: string; email: string; created: boolean }> {
  const linked = await findLinkedAccountForUuid(db, uuid);
  if (linked) return { ...linked, created: false };

  const email = minecraftProvisionerEmail(uuid);
  const existing = await db
    .prepare("SELECT id, email FROM license_accounts WHERE email = ? LIMIT 1")
    .bind(email)
    .first<{ id: string; email: string }>();
  if (existing?.id) {
    return { accountId: existing.id, email: existing.email, created: false };
  }

  const accountId = crypto.randomUUID();
  const now = new Date().toISOString();
  const randomSecret = `${crypto.randomUUID()}${crypto.randomUUID()}`;
  const { salt, password_hash } = await hashNewAccountCredentials(randomSecret);

  await db
    .prepare(
      "INSERT INTO license_accounts (id, email, password_hash, salt, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
    )
    .bind(accountId, email, password_hash, salt, now, now)
    .run();

  await upsertUserAccountFromLicense(db, {
    email,
    account_id: accountId,
    pro_unlocked: false,
    life_member: false,
    extra: {
      rootmc_provisioned: true,
      minecraft_uuid: uuid,
      minecraft_username: username,
    },
  });

  return { accountId, email, created: true };
}
