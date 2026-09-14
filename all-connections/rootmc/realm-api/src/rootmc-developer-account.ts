import type { D1Database } from "@cloudflare/workers-types";

import { upsertUserAccountFromLicense } from "./accounts";
import { hashNewAccountCredentials } from "../../shared/password-verify";

/** Synthetic email when Discord does not share a verified address. */
export function developerDiscordFallbackEmail(discordUserId: string): string {
  const id = String(discordUserId || "").trim();
  return `discord+${id}@developers.rootmc.net`;
}

/**
 * Prefer Discord-verified email; otherwise stable synthetic address.
 * Falls back to synthetic if the preferred email is already taken by another account.
 */
export async function resolveDeveloperEmail(
  db: D1Database,
  discordUserId: string,
  discordEmail: string | null,
  emailVerified: boolean | null,
): Promise<string> {
  const fallback = developerDiscordFallbackEmail(discordUserId);
  const raw = String(discordEmail || "")
    .trim()
    .toLowerCase();
  if (!raw.includes("@") || emailVerified === false) {
    return fallback;
  }

  const taken = await db
    .prepare("SELECT id FROM license_accounts WHERE email = ? LIMIT 1")
    .bind(raw)
    .first<{ id: string }>();
  if (taken?.id) {
    return fallback;
  }
  return raw;
}

/** Creates a RootMC license account for a Discord developer (no Minecraft link required). */
export async function provisionDeveloperDiscordAccount(
  db: D1Database,
  input: {
    discord_user_id: string;
    discord_username: string | null;
    discord_global_name: string | null;
    discord_email: string | null;
    email_verified: boolean | null;
  },
): Promise<{ accountId: string; email: string; created: boolean }> {
  const discordUserId = String(input.discord_user_id || "").trim();
  if (!discordUserId) {
    throw new Error("discord_user_id required");
  }

  const existingLink = await db
    .prepare(
      `SELECT account_id, email FROM discord_account_links WHERE discord_user_id = ? LIMIT 1`,
    )
    .bind(discordUserId)
    .first<{ account_id: string; email: string }>();
  if (existingLink?.account_id) {
    return {
      accountId: existingLink.account_id,
      email: String(existingLink.email || "").trim().toLowerCase(),
      created: false,
    };
  }

  const email = await resolveDeveloperEmail(
    db,
    discordUserId,
    input.discord_email,
    input.email_verified,
  );

  const existingAcct = await db
    .prepare("SELECT id, email FROM license_accounts WHERE email = ? LIMIT 1")
    .bind(email)
    .first<{ id: string; email: string }>();
  if (existingAcct?.id) {
    return { accountId: existingAcct.id, email: existingAcct.email, created: false };
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

  const display =
    String(input.discord_global_name || input.discord_username || "").trim() || null;
  if (display) {
    try {
      await db
        .prepare("UPDATE license_accounts SET public_display_name = ? WHERE id = ?")
        .bind(display.slice(0, 64), accountId)
        .run();
    } catch {
      /* column may be absent on older D1 — ignore */
    }
  }

  await upsertUserAccountFromLicense(db, {
    email,
    account_id: accountId,
    pro_unlocked: false,
    life_member: false,
    extra: {
      rootmc_developer: true,
      discord_user_id: discordUserId,
      discord_username: input.discord_username,
    },
  });

  return { accountId, email, created: true };
}
