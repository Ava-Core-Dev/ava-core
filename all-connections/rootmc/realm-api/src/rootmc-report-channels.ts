/** Canonical RootMC Discord report channel IDs (delegates to rootmc-discord-channels). */

import type { RootMcDedicatedChannelCategory } from "./rootmc-grok-prompts";
import {
  resolveDiscordChannel,
  resolveDiscordChannelForReports,
  resolveG2DumpChannelId,
  ROOTMC_CHANNEL_FALLBACKS,
} from "./rootmc-discord-channels";

export { resolveG2DumpChannelId };

export const ROOTMC_CHANNEL_DAILY_SUMMARY = ROOTMC_CHANNEL_FALLBACKS.dailyReport;
export const ROOTMC_CHANNEL_ECONOMY = ROOTMC_CHANNEL_FALLBACKS.economy;
export const ROOTMC_CHANNEL_TOWNS = ROOTMC_CHANNEL_FALLBACKS.townInfo;
export const ROOTMC_CHANNEL_NATIONS = ROOTMC_CHANNEL_FALLBACKS.nationInfo;
/** #automated-reports — live index of report last-runs. */
export const ROOTMC_CHANNEL_AUTOMATED_REPORTS = ROOTMC_CHANNEL_FALLBACKS.automatedReports;
/** Hourly Gen1 + Gen2 realm snapshots (combined post). */
export const ROOTMC_CHANNEL_HOURLY_SNAPSHOTS = ROOTMC_CHANNEL_FALLBACKS.hourlySnapshots;

export const ROOTMC_CATEGORY_CHANNEL_ID: Record<RootMcDedicatedChannelCategory, string> = {
  economy_intel: ROOTMC_CHANNEL_ECONOMY,
  towns: ROOTMC_CHANNEL_TOWNS,
  nations: ROOTMC_CHANNEL_NATIONS,
};

type ChannelEnv = {
  WORKER_SHARD?: string;
  DISCORD_ROOTMC_DAILY_REPORT_CHANNEL_ID?: string;
  DISCORD_ROOTMC_ECONOMY_ANNOUNCE_CHANNEL_ID?: string;
  DISCORD_ROOTMC_TOWN_INFO_CHANNEL_ID?: string;
  DISCORD_ROOTMC_NATION_INFO_CHANNEL_ID?: string;
  DISCORD_ROOTMC_AUTOMATED_REPORTS_CHANNEL_ID?: string;
  DISCORD_ROOTMC_HOURLY_SNAPSHOT_CHANNEL_ID?: string;
};

export function resolveDailySummaryChannelId(env: ChannelEnv): string {
  return resolveDiscordChannelForReports(env, "dailyReport");
}

export function resolveCategoryChannelId(
  env: ChannelEnv,
  category: RootMcDedicatedChannelCategory,
): string {
  if (category === "economy_intel") {
    return resolveDiscordChannelForReports(env, "economy");
  }
  if (category === "towns") {
    return resolveDiscordChannelForReports(env, "townInfo");
  }
  if (category === "nations") {
    return resolveDiscordChannelForReports(env, "nationInfo");
  }
  return ROOTMC_CATEGORY_CHANNEL_ID[category];
}

export function resolveAutomatedReportsChannelId(env: ChannelEnv): string {
  return resolveDiscordChannelForReports(env, "automatedReports");
}

/** Combined Gen1+Gen2 hourly snapshot destination (Gen1 worker posts both). */
export function resolveHourlySnapshotChannelId(env?: ChannelEnv): string {
  return resolveDiscordChannel(env, "hourlySnapshots");
}
