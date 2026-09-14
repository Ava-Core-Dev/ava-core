/**
 * Permanently exiled Discord users  -  excluded from all reports, awards, and activity ingest.
 * Source list: rootmc-exiled-discord-users.json
 */
import exiledUsers from "./rootmc-exiled-discord-users.json";

export type ExiledDiscordUser = { id: string; name: string };

export const EXILED_DISCORD_USERS: ExiledDiscordUser[] = exiledUsers as ExiledDiscordUser[];

export const EXILED_DISCORD_USER_IDS: ReadonlySet<string> = new Set(
  EXILED_DISCORD_USERS.map((u) => u.id),
);

export function isExiledDiscordUser(discordUserId: unknown): boolean {
  const id = String(discordUserId ?? "").trim();
  return id.length > 0 && EXILED_DISCORD_USER_IDS.has(id);
}

/** For SQL: `discord_user_id NOT IN (...)` bind list */
export function exiledDiscordUserIdList(): string[] {
  return [...EXILED_DISCORD_USER_IDS];
}

export function sqlExiledDiscordNotInClause(column = "discord_user_id"): string {
  const ids = exiledDiscordUserIdList();
  if (!ids.length) return "1=1";
  const quoted = ids.map((id) => `'${id.replace(/'/g, "''")}'`).join(", ");
  return `${column} NOT IN (${quoted})`;
}
