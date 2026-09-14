import type { D1Database } from "@cloudflare/workers-types";

import { isDiscordWebhookUrl, notifySolanaToolsDiscord } from "./discord-solana-notify";
import {
  buildEconomyDiscordMessage,
  formatEconomyUnits,
  formatEconomyUnitsLocale,
  leaderboardEntryLabel,
  loadEconomyLeaderboardData,
  type EconomyLeaderboardData,
} from "./root-economy";
import { touchRootEconomy } from "../../shared/root-economy-snapshot";

export type RootEconomyDiscordCronEnv = {
  DB: D1Database;
  /** `wrangler secret put DISCORD_ROOT_ECONOMY_WEBHOOK_URL` — incoming webhook URL (never commit). */
  DISCORD_ROOT_ECONOMY_WEBHOOK_URL?: string;
};

async function lastDiscordPingCirculation(db: D1Database): Promise<number | null> {
  try {
    const row = await db
      .prepare(
        `SELECT total_circulation FROM root_economy_snapshot
         WHERE trigger_kind = 'discord_ping'
         ORDER BY recorded_at DESC LIMIT 1`,
      )
      .first<{ total_circulation: number }>();
    if (row == null) return null;
    const n = Math.floor(Number(row.total_circulation) || 0);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

/** Shorter than slash-command output — periodic channel update. */
export function buildEconomyCronPingMessage(
  data: EconomyLeaderboardData,
  accountCount: number,
  opts?: { deltaRu?: number | null; atUtc?: string },
): string {
  const total = data.total_circulation;
  const at =
    opts?.atUtc ||
    new Date().toISOString().replace("T", " ").replace(/\.\d{3}Z$/, " UTC");
  const lines: string[] = [
    "**Root Economy** — circulation update",
    `**Internal circulation:** **${formatEconomyUnitsLocale(total)} Roots** (${formatEconomyUnits(total)}) · **${accountCount}** linked account${accountCount === 1 ? "" : "s"}`,
    `_Updated ${at}_`,
  ];
  const delta = opts?.deltaRu;
  if (delta != null && Number.isFinite(delta) && delta !== 0) {
    const sign = delta > 0 ? "+" : "";
    lines.push(`_Δ since last ping:_ **${sign}${formatEconomyUnitsLocale(delta)} Roots** (${formatEconomyUnits(Math.abs(delta))})`);
  }
  lines.push("");
  if (data.entries.length === 0) {
    lines.push("No balances on the board yet.");
  } else {
    lines.push("**Top 5**");
    for (const e of data.entries.slice(0, 5)) {
      lines.push(`**${e.rank}.** ${leaderboardEntryLabel(e)} — **${formatEconomyUnits(e.balance)}**`);
    }
    if (data.entries.length > 5) {
      lines.push(`_+${data.entries.length - 5} more on the full board._`);
    }
  }
  lines.push(
    "",
    "Chart: **https://rootrecord.cloud/charts/root-economy/**",
    "Board: **https://rootrecord.cloud/root-units**",
  );
  let content = lines.join("\n");
  if (content.length > 1950) content = `${content.slice(0, 1940)}…`;
  return content;
}

export type RootEconomyDiscordCronResult = {
  ok: boolean;
  skipped?: string;
  posted?: boolean;
  total_circulation?: number;
  account_count?: number;
  delta_ru?: number | null;
};

/** Scheduled + internal manual: post Root Economy snapshot to Discord incoming webhook. */
export async function runRootEconomyDiscordCron(env: RootEconomyDiscordCronEnv): Promise<RootEconomyDiscordCronResult> {
  const webhook = String(env.DISCORD_ROOT_ECONOMY_WEBHOOK_URL || "").trim();
  if (!webhook || !isDiscordWebhookUrl(webhook)) {
    return { ok: false, skipped: "DISCORD_ROOT_ECONOMY_WEBHOOK_URL not set" };
  }

  const prev = await lastDiscordPingCirculation(env.DB);

  let totals: { total_circulation: number; account_count: number };
  try {
    totals = await touchRootEconomy(env.DB, "discord_ping");
  } catch {
    const data = await loadEconomyLeaderboardData(env.DB);
    totals = { total_circulation: data.total_circulation, account_count: data.entries.length };
  }

  const deltaRu = prev == null ? null : totals.total_circulation - prev;

  const data = await loadEconomyLeaderboardData(env.DB);
  const body = buildEconomyCronPingMessage(data, totals.account_count, {
    deltaRu,
    atUtc: new Date().toISOString().replace("T", " ").replace(/\.\d{3}Z$/, " UTC"),
  });

  await notifySolanaToolsDiscord(webhook, body);

  return {
    ok: true,
    posted: true,
    total_circulation: totals.total_circulation,
    account_count: totals.account_count,
    delta_ru: deltaRu,
  };
}

/** Full leaderboard text (same as `/economy` slash) for manual ops ping. */
export async function runRootEconomyDiscordFullBoard(env: RootEconomyDiscordCronEnv): Promise<RootEconomyDiscordCronResult> {
  const webhook = String(env.DISCORD_ROOT_ECONOMY_WEBHOOK_URL || "").trim();
  if (!webhook || !isDiscordWebhookUrl(webhook)) {
    return { ok: false, skipped: "DISCORD_ROOT_ECONOMY_WEBHOOK_URL not set" };
  }
  await touchRootEconomy(env.DB, "discord_ping").catch(() => {});
  const data = await loadEconomyLeaderboardData(env.DB);
  await notifySolanaToolsDiscord(webhook, buildEconomyDiscordMessage(data));
  return { ok: true, posted: true, total_circulation: data.total_circulation };
}
