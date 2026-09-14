/**
 * Discord app / bot accounts that must never appear on player activity awards.
 */
export const ROOTMC_ACTIVITY_BOT_DISCORD_IDS: ReadonlySet<string> = new Set([
  "1532751879875072070", // Ava Ivy
  "1511794429986345020", // RootMC Official Discord bot
]);

export function isActivityBotDiscordUser(discordUserId: unknown): boolean {
  const id = String(discordUserId ?? "").trim();
  return id.length > 0 && ROOTMC_ACTIVITY_BOT_DISCORD_IDS.has(id);
}
