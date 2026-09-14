/**
 * Named Discord channel resolution for the RootMC Worker.
 * IDs come from wrangler DISCORD_ROOTMC_* vars; hardcoded fallbacks match production RootMC.
 * Paper cloud.yml does not override these (API/cron destinations stay Worker-owned).
 *
 * Name keys align with scripts/lib/rootmc-discord.mjs ROOTMC_CHANNELS.
 */

import { ROOTMC_G2_DISCORD_CHANNEL_ID } from "./discord-rootmc-api";
import { isG2Worker } from "./g2/g2-db";

export type DiscordChannelName =
  | "updates"
  | "general"
  | "admins"
  | "rules"
  | "economy"
  | "dailyReport"
  | "automatedReports"
  | "ingameChat"
  | "ingameFeedback"
  | "feedback"
  | "townInfo"
  | "nationInfo"
  | "operationsForum"
  | "appealsForum"
  | "constitution"
  | "governance"
  | "voting"
  | "proposals"
  | "gen2"
  | "hourlySnapshots"
  | "pluginSales"
  | "apiReferences"
  | "discordIds"
  | "cronsAutomation"
  | "tasks"
  | "logs"
  | "unverified"
  | "aiArchive"
  | "aiRawArchive"
  | "botSpam";

/** Production RootMC fallbacks when env var is blank (must match rootmc-api/wrangler.toml). */
export const ROOTMC_CHANNEL_FALLBACKS: Record<DiscordChannelName, string> = {
  updates: "1545284423740563528",
  general: "1545284354157187083",
  admins: "1516121832493678612",
  rules: "1516392367869919243",
  economy: "1516804780884889621",
  dailyReport: "1539779979280257054",
  /** Migrated to Slack #automated-reports (C0BM6KVFS0L). Live board message edits still Discord. */
  automatedReports: "1539779979280257054",
  ingameChat: "1545284399107547179",
  /** Migrated to Slack #feedback (C0BLMGBVAMD). Discord id kept for legacy resolve only. */
  ingameFeedback: "1516828735536365669",
  feedback: "1516391754625187921",
  /** Blank until channels are recreated — stale IDs 404'd. */
  townInfo: "",
  nationInfo: "",
  operationsForum: "1516143406315737169",
  appealsForum: "1516143406315737169",
  constitution: "1522406019152478210",
  governance: "1522406451413385317",
  voting: "1522413185364398090",
  /** Production wrangler (canonical over older script map id). */
  proposals: "1526664180491358419",
  gen2: ROOTMC_G2_DISCORD_CHANNEL_ID,
  hourlySnapshots: "1539779979280257054",
  /** Migrated to Slack #plugin-sales (C0BLZCVAC3X). Discord id kept for legacy resolve only. */
  pluginSales: "1529247837420912751",
  /** Migrated to Slack #api-description (C0BM6HN0WMA) + canvas F0BLMFRPA8P. Legacy Discord mirror. */
  apiReferences: "1520385893653938236",
  /** Migrated to Slack #discord-channels (C0BM4QT5U0Z) + canvas F0BLMFYJYEB. Legacy Discord mirror. */
  discordIds: "1520386796406706216",
  /** Migrated to Slack #crons-automation (C0BLMHKTCTH) + canvas F0BLZK9RHHT. Legacy Discord mirror. */
  cronsAutomation: "1520387570004135956",
  tasks: "1529753661901639761",
  /** Legacy Discord #logs — production logs go to Slack #server-logs (C0BMX0QKSTS) via Incoming Webhook. */
  logs: "1529414449088172064",
  unverified: "1519249871326937138",
  aiArchive: "1511922772983545947",
  aiRawArchive: "1545283818146242642",
  botSpam: "1516391754625187921",
};

const ENV_KEYS: Record<DiscordChannelName, string> = {
  updates: "DISCORD_ROOTMC_UPDATES_CHANNEL_ID",
  general: "DISCORD_ROOTMC_GENERAL_CHAT_CHANNEL_ID",
  admins: "DISCORD_ROOTMC_ADMINS_CHANNEL_ID",
  rules: "DISCORD_ROOTMC_RULES_CHANNEL_ID",
  economy: "DISCORD_ROOTMC_ECONOMY_ANNOUNCE_CHANNEL_ID",
  dailyReport: "DISCORD_ROOTMC_DAILY_REPORT_CHANNEL_ID",
  automatedReports: "DISCORD_ROOTMC_AUTOMATED_REPORTS_CHANNEL_ID",
  ingameChat: "DISCORD_ROOTMC_INGAME_CHAT_CHANNEL_ID",
  ingameFeedback: "DISCORD_ROOTMC_INGAME_FEEDBACK_CHANNEL_ID",
  feedback: "DISCORD_FEEDBACK_CHANNEL_ID",
  townInfo: "DISCORD_ROOTMC_TOWN_INFO_CHANNEL_ID",
  nationInfo: "DISCORD_ROOTMC_NATION_INFO_CHANNEL_ID",
  operationsForum: "DISCORD_ROOTMC_OPERATIONS_FORUM_CHANNEL_ID",
  appealsForum: "DISCORD_ROOTMC_APPEALS_FORUM_CHANNEL_ID",
  constitution: "DISCORD_ROOTMC_CONSTITUTION_CHANNEL_ID",
  governance: "DISCORD_ROOTMC_GOVERNANCE_CHANNEL_ID",
  voting: "DISCORD_ROOTMC_VOTING_CHANNEL_ID",
  proposals: "DISCORD_ROOTMC_PROPOSALS_CHANNEL_ID",
  gen2: "DISCORD_ROOTMC_GEN2_CHANNEL_ID",
  hourlySnapshots: "DISCORD_ROOTMC_HOURLY_SNAPSHOT_CHANNEL_ID",
  pluginSales: "DISCORD_ROOTMC_PLUGIN_SALES_CHANNEL_ID",
  apiReferences: "DISCORD_ROOTMC_API_REFERENCES_CHANNEL_ID",
  discordIds: "DISCORD_ROOTMC_DISCORD_IDS_CHANNEL_ID",
  cronsAutomation: "DISCORD_ROOTMC_CRONS_AUTOMATION_CHANNEL_ID",
  tasks: "DISCORD_ROOTMC_TASKS_CHANNEL_ID",
  logs: "DISCORD_ROOTMC_LOGS_CHANNEL_ID",
  unverified: "DISCORD_ROOTMC_UNVERIFIED_CHANNEL_ID",
  aiArchive: "DISCORD_ROOTMC_AI_ARCHIVE_CHANNEL_ID",
  aiRawArchive: "DISCORD_ROOTMC_AI_RAW_ARCHIVE_CHANNEL_ID",
  botSpam: "DISCORD_ROOTMC_BOT_SPAM_CHANNEL_ID",
};

type ChannelEnv = Record<string, unknown> & {
  WORKER_SHARD?: string;
};

function str(v: unknown): string {
  return String(v ?? "").trim();
}

/**
 * Resolve a named channel: env var → production fallback.
 * Pass `{ allowBlank: true }` to skip fallback (e.g. optional destinations).
 */
export function resolveDiscordChannel(
  env: ChannelEnv | undefined,
  name: DiscordChannelName,
  opts?: { allowBlank?: boolean },
): string {
  const envKey = ENV_KEYS[name];
  const fromEnv = envKey && env ? str((env as Record<string, unknown>)[envKey]) : "";
  if (fromEnv) return fromEnv;
  if (opts?.allowBlank) return "";
  return ROOTMC_CHANNEL_FALLBACKS[name] || "";
}

/** Gen 2: single isolated dump channel for report/announce traffic. */
export function resolveG2DumpChannelId(env?: ChannelEnv): string {
  const fromEnv = resolveDiscordChannel(env, "dailyReport", { allowBlank: true });
  return fromEnv || ROOTMC_G2_DISCORD_CHANNEL_ID;
}

/**
 * Like resolveDiscordChannel, but Gen2 workers remap report-style channels to the dump channel.
 * Does not remap general/admins/rules/governance destinations used for live guild ops.
 */
export function resolveDiscordChannelForReports(
  env: ChannelEnv | undefined,
  name: DiscordChannelName,
): string {
  if (env && isG2Worker(env) && isReportStyleChannel(name)) {
    return resolveG2DumpChannelId(env);
  }
  return resolveDiscordChannel(env, name);
}

function isReportStyleChannel(name: DiscordChannelName): boolean {
  return (
    name === "dailyReport" ||
    name === "economy" ||
    name === "townInfo" ||
    name === "nationInfo" ||
    name === "automatedReports" ||
    name === "hourlySnapshots" ||
    name === "ingameChat"
  );
}
