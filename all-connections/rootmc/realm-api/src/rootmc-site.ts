/** Public RootMC URLs (rootmc.net). Use SITE_URL env when running on the Worker. */

export const ROOTMC_APEX = "https://rootmc.net";
export const ROOTMC_API = "https://api.rootmc.info";
export const ROOTMC_MAP_URL = "https://map.rootmc.net/";
export const ROOTMC_PLAY_HOST = "play.rootmc.net";
export const ROOTMC_WIKI_PLAYER = "https://rootmc.net/wiki/player/";
export const ROOTMC_WIKI_COMMANDS = "https://rootmc.net/wiki/player/#commands";
export const ROOTMC_WIKI_ECONOMY = "https://rootmc.net/wiki/economy/";
export const ROOTMC_WIKI_TOKEN = "https://rootmc.net/wiki/token/";
export const ROOTMC_VERIFY = "https://rootmc.net/verify";
export const ROOTMC_PLAYER_STATS = "https://rootmc.net/player";
export const ROOTMC_PLUGINS = "https://rootmc.net/plugins";
export const ROOTMC_SHOPS = "https://rootmc.net/market/";
export const ROOTMC_MARKET = "https://rootmc.net/market";
export const ROOTMC_REALM_HOME = "https://rootmc.net/";
export const ROOTMC_RESERVE = "https://rootmc.net/economy/#server-reserve";
/** Anchor on the economy page for all-time gold mined (/mint ledger). */
export const ROOTMC_RESERVE_GOLD_MINED = "https://rootmc.net/economy/#gold-mined";
export const ROOTMC_DISCORD_INVITE = "https://discord.gg/rFFQYrNaqS";

export function siteUrl(env?: { SITE_URL?: string }): string {
  return String(env?.SITE_URL || ROOTMC_APEX).trim().replace(/\/+$/, "") || ROOTMC_APEX;
}

export function verifyUrl(env?: { SITE_URL?: string }): string {
  return `${siteUrl(env)}/verify`;
}

export function wikiPlayerUrl(env?: { SITE_URL?: string }): string {
  return `${siteUrl(env)}/wiki/player/`;
}

export function playerStatsUrl(minecraftUuid: string, env?: { SITE_URL?: string }): string {
  return `${siteUrl(env)}/player?uuid=${encodeURIComponent(minecraftUuid.trim().toLowerCase())}`;
}

export function shopsUrl(env?: { SITE_URL?: string }): string {
  return `${siteUrl(env)}/market/`;
}

export function reserveGoldMinedUrl(env?: { SITE_URL?: string }): string {
  return `${siteUrl(env)}/economy/#gold-mined`;
}
