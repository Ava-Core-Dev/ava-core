/**
 * One Discord message in #automated-reports that lists each automated report
 * and the last version (day/week/month key) that posted. Refreshed after report posts.
 */

import type { D1Database } from "@cloudflare/workers-types";

import { discordBotFetch } from "./discord-rootmc-api";
import { resolveDiscordChannel } from "./rootmc-discord-channels";
import {
  ROOTMC_CHANNEL_AUTOMATED_REPORTS,
  resolveAutomatedReportsChannelId,
} from "./rootmc-report-channels";
import { resolveServerId } from "./rootmc-daily-report";

export { ROOTMC_CHANNEL_AUTOMATED_REPORTS };
export const AUTOMATED_REPORTS_BOARD_MARKER = "# Automated reports board";
const DEFAULT_ROOTMC_GUILD_ID = "1516108585740800042";

type BoardEnv = {
  DB: D1Database;
  WORKER_SHARD?: string;
  DISCORD_ROOTMC_BOT_TOKEN?: string;
  DISCORD_ROOTMC_GUILD_ID?: string;
  DISCORD_ROOTMC_AUTOMATED_REPORTS_CHANNEL_ID?: string;
  DISCORD_ROOTMC_DAILY_REPORT_CHANNEL_ID?: string;
  DISCORD_ROOTMC_ECONOMY_ANNOUNCE_CHANNEL_ID?: string;
  DISCORD_ROOTMC_TOWN_INFO_CHANNEL_ID?: string;
  DISCORD_ROOTMC_NATION_INFO_CHANNEL_ID?: string;
  DISCORD_ROOTMC_GENERAL_CHAT_CHANNEL_ID?: string;
};

type LastRun = {
  version: string;
  postedAt: string;
  channelId: string | null;
  messageId: string | null;
};

function str(v: unknown): string {
  return String(v ?? "").trim();
}

function nowIso(): string {
  return new Date().toISOString();
}

function boardChannelId(env: BoardEnv): string {
  return resolveAutomatedReportsChannelId(env);
}

function guildId(env: BoardEnv): string {
  return str(env.DISCORD_ROOTMC_GUILD_ID) || DEFAULT_ROOTMC_GUILD_ID;
}

function jumpLink(guild: string, channelId: string | null, messageId: string | null): string {
  if (!channelId || !messageId) return "";
  return `https://discord.com/channels/${guild}/${channelId}/${messageId}`;
}

function fmtWhen(iso: string): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return iso.slice(0, 19) || "—";
  return new Date(t).toISOString().replace(/\.\d{3}Z$/, "Z");
}

function line(
  label: string,
  targetChannelId: string,
  run: LastRun | null,
  guild: string,
): string {
  const ch = `<#${targetChannelId}>`;
  if (!run?.version) {
    return `- **${label}** → ${ch}\n  Last: _never_`;
  }
  const link = jumpLink(guild, run.channelId, run.messageId);
  const open = link ? ` · [open](${link})` : "";
  return `- **${label}** → ${ch}\n  Last: \`${run.version}\` · ${fmtWhen(run.postedAt)}${open}`;
}

async function latestCombined(db: D1Database, serverId: string): Promise<LastRun | null> {
  const row = await db
    .prepare(
      `SELECT day_key, posted_at, channel_id, message_id
       FROM rootmc_daily_reports WHERE server_id = ? ORDER BY day_key DESC LIMIT 1`,
    )
    .bind(serverId)
    .first<{ day_key: string; posted_at: string; channel_id: string | null; message_id: string | null }>();
  if (!row) return null;
  return {
    version: str(row.day_key),
    postedAt: str(row.posted_at),
    channelId: str(row.channel_id) || null,
    messageId: str(row.message_id) || null,
  };
}

async function latestDailyCategory(
  db: D1Database,
  serverId: string,
  category: string,
): Promise<LastRun | null> {
  const row = await db
    .prepare(
      `SELECT day_key, posted_at, channel_id, message_id
       FROM rootmc_daily_category_reports
       WHERE server_id = ? AND category = ?
       ORDER BY day_key DESC LIMIT 1`,
    )
    .bind(serverId, category)
    .first<{ day_key: string; posted_at: string; channel_id: string | null; message_id: string | null }>();
  if (!row) return null;
  return {
    version: str(row.day_key),
    postedAt: str(row.posted_at),
    channelId: str(row.channel_id) || null,
    messageId: str(row.message_id) || null,
  };
}

async function latestWeeklyCombined(db: D1Database, serverId: string): Promise<LastRun | null> {
  const row = await db
    .prepare(
      `SELECT week_key, posted_at, channel_id, message_id
       FROM rootmc_weekly_reports WHERE server_id = ? ORDER BY week_key DESC LIMIT 1`,
    )
    .bind(serverId)
    .first<{ week_key: string; posted_at: string; channel_id: string | null; message_id: string | null }>();
  if (!row) return null;
  return {
    version: str(row.week_key),
    postedAt: str(row.posted_at),
    channelId: str(row.channel_id) || null,
    messageId: str(row.message_id) || null,
  };
}

async function latestWeeklyCategory(
  db: D1Database,
  serverId: string,
  category: string,
): Promise<LastRun | null> {
  const row = await db
    .prepare(
      `SELECT week_key, posted_at, channel_id, message_id
       FROM rootmc_weekly_category_reports
       WHERE server_id = ? AND category = ?
       ORDER BY week_key DESC LIMIT 1`,
    )
    .bind(serverId, category)
    .first<{ week_key: string; posted_at: string; channel_id: string | null; message_id: string | null }>();
  if (!row) return null;
  return {
    version: str(row.week_key),
    postedAt: str(row.posted_at),
    channelId: str(row.channel_id) || null,
    messageId: str(row.message_id) || null,
  };
}

async function latestWeeklyAwards(db: D1Database): Promise<LastRun | null> {
  const row = await db
    .prepare(
      `SELECT week_key, posted_at, message_id
       FROM rootmc_weekly_activity_awards ORDER BY week_key DESC LIMIT 1`,
    )
    .first<{ week_key: string; posted_at: string; message_id: string | null }>();
  if (!row) return null;
  return {
    version: str(row.week_key),
    postedAt: str(row.posted_at),
    channelId: null,
    messageId: str(row.message_id) || null,
  };
}

async function latestMonthlyDividend(db: D1Database, serverId: string): Promise<LastRun | null> {
  try {
    const row = await db
      .prepare(
        `SELECT month_key, report_posted_at, discord_channel_id, discord_message_id
         FROM rootmc_treasury_dividend_runs
         WHERE server_id = ? AND discord_message_id IS NOT NULL
         ORDER BY month_key DESC LIMIT 1`,
      )
      .bind(serverId)
      .first<{
        month_key: string;
        report_posted_at: string | null;
        discord_channel_id: string | null;
        discord_message_id: string | null;
      }>();
    if (!row) return null;
    return {
      version: str(row.month_key),
      postedAt: str(row.report_posted_at) || nowIso(),
      channelId: str(row.discord_channel_id) || null,
      messageId: str(row.discord_message_id) || null,
    };
  } catch {
    return null;
  }
}

export async function buildAutomatedReportsBoardContent(env: BoardEnv): Promise<string> {
  const serverId = await resolveServerId(env.DB);
  const guild = guildId(env);
  const dailyCh = resolveDiscordChannel(env, "dailyReport");
  const economyCh = resolveDiscordChannel(env, "economy");
  const townsCh = resolveDiscordChannel(env, "townInfo", { allowBlank: true });
  const nationsCh = resolveDiscordChannel(env, "nationInfo", { allowBlank: true });
  const generalCh = resolveDiscordChannel(env, "general");

  const [
    daily,
    economyDaily,
    townsDaily,
    nationsDaily,
    weekly,
    economyWeekly,
    townsWeekly,
    nationsWeekly,
    awards,
    dividend,
  ] = await Promise.all([
    latestCombined(env.DB, serverId),
    latestDailyCategory(env.DB, serverId, "economy_intel"),
    latestDailyCategory(env.DB, serverId, "towns"),
    latestDailyCategory(env.DB, serverId, "nations"),
    latestWeeklyCombined(env.DB, serverId),
    latestWeeklyCategory(env.DB, serverId, "economy_intel"),
    latestWeeklyCategory(env.DB, serverId, "towns"),
    latestWeeklyCategory(env.DB, serverId, "nations"),
    latestWeeklyAwards(env.DB),
    latestMonthlyDividend(env.DB, serverId),
  ]);

  const awardsRun = awards
    ? { ...awards, channelId: awards.channelId || generalCh }
    : null;

  const parts = [
    AUTOMATED_REPORTS_BOARD_MARKER,
    `_Board refreshed: ${fmtWhen(nowIso())}_`,
    `_Updates automatically when each report posts._`,
    "",
    "## Daily · midnight HST",
    line("Combined summary", dailyCh, daily, guild),
    line("Economy intel", economyCh, economyDaily, guild),
    line("Towns brief", townsCh, townsDaily, guild),
    line("Nations brief", nationsCh, nationsDaily, guild),
    "",
    "## Weekly · Sun 08:00 HST",
    line("Activity awards", generalCh, awardsRun, guild),
    line("Weekly summary", dailyCh, weekly, guild),
    line("Weekly economy", economyCh, economyWeekly, guild),
    line("Weekly towns", townsCh, townsWeekly, guild),
    line("Weekly nations", nationsCh, nationsWeekly, guild),
    "",
    "## Monthly · 1st midnight HST",
    line("Activity Dividend", economyCh, dividend, guild),
  ];

  return parts.join("\n").slice(0, 1900);
}

async function ensureBoardTable(db: D1Database): Promise<void> {
  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS rootmc_automated_reports_board (
         id INTEGER PRIMARY KEY CHECK (id = 1),
         channel_id TEXT NOT NULL,
         message_id TEXT NOT NULL,
         updated_at TEXT NOT NULL
       )`,
    )
    .run();
}

async function loadBoardMessageId(db: D1Database): Promise<{ channelId: string; messageId: string } | null> {
  try {
    const row = await db
      .prepare(`SELECT channel_id, message_id FROM rootmc_automated_reports_board WHERE id = 1 LIMIT 1`)
      .first<{ channel_id: string; message_id: string }>();
    if (!row) return null;
    const channelId = str(row.channel_id);
    const messageId = str(row.message_id);
    if (!channelId || !messageId) return null;
    return { channelId, messageId };
  } catch {
    return null;
  }
}

async function saveBoardMessageId(
  db: D1Database,
  channelId: string,
  messageId: string,
): Promise<void> {
  await ensureBoardTable(db);
  await db
    .prepare(
      `INSERT INTO rootmc_automated_reports_board (id, channel_id, message_id, updated_at)
       VALUES (1, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         channel_id = excluded.channel_id,
         message_id = excluded.message_id,
         updated_at = excluded.updated_at`,
    )
    .bind(channelId, messageId, nowIso())
    .run();
}

async function findExistingBoardMessage(
  token: string,
  channelId: string,
): Promise<string | null> {
  const res = await discordBotFetch(
    token,
    `/channels/${encodeURIComponent(channelId)}/messages?limit=25`,
  );
  if (!res.ok) return null;
  const msgs = (await res.json()) as Array<{ id?: string; content?: string; author?: { bot?: boolean } }>;
  for (const msg of msgs) {
    if (!msg.author?.bot) continue;
    if (str(msg.content).startsWith(AUTOMATED_REPORTS_BOARD_MARKER) && msg.id) {
      return String(msg.id);
    }
  }
  return null;
}

async function pinMessage(token: string, channelId: string, messageId: string): Promise<void> {
  await discordBotFetch(
    token,
    `/channels/${encodeURIComponent(channelId)}/pins/${encodeURIComponent(messageId)}`,
    { method: "PUT" },
  ).catch(() => undefined);
}

async function patchMessage(
  token: string,
  channelId: string,
  messageId: string,
  content: string,
): Promise<boolean> {
  const res = await discordBotFetch(
    token,
    `/channels/${encodeURIComponent(channelId)}/messages/${encodeURIComponent(messageId)}`,
    { method: "PATCH", body: JSON.stringify({ content: content.slice(0, 2000) }) },
  );
  return res.ok;
}

async function postMessage(token: string, channelId: string, content: string): Promise<string | null> {
  const res = await discordBotFetch(token, `/channels/${encodeURIComponent(channelId)}/messages`, {
    method: "POST",
    body: JSON.stringify({ content: content.slice(0, 2000) }),
  });
  if (!res.ok) {
    console.error("rootmc_reports_board_post_failed", res.status, await res.text().catch(() => ""));
    return null;
  }
  const data = (await res.json()) as { id?: string };
  return data.id ? String(data.id) : null;
}

/** Create or edit the single automated-reports board message from current D1 last-runs. */
export async function refreshAutomatedReportsBoard(
  env: BoardEnv,
): Promise<{ ok: boolean; detail: string }> {
  const token = str(env.DISCORD_ROOTMC_BOT_TOKEN);
  const channelId = boardChannelId(env);
  if (token.length < 40) {
    return { ok: false, detail: "missing bot token" };
  }
  if (!/^\d{10,}$/.test(channelId)) {
    return { ok: false, detail: "invalid board channel" };
  }

  let content: string;
  try {
    content = await buildAutomatedReportsBoardContent(env);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, detail: `build failed: ${msg.slice(0, 120)}` };
  }

  let stored = await loadBoardMessageId(env.DB);
  if (!stored || stored.channelId !== channelId) {
    const found = await findExistingBoardMessage(token, channelId);
    if (found) {
      stored = { channelId, messageId: found };
      await saveBoardMessageId(env.DB, channelId, found);
    }
  }

  if (stored?.messageId) {
    const patched = await patchMessage(token, channelId, stored.messageId, content);
    if (patched) {
      await saveBoardMessageId(env.DB, channelId, stored.messageId);
      return { ok: true, detail: `updated ${stored.messageId}` };
    }
  }

  const created = await postMessage(token, channelId, content);
  if (!created) {
    return { ok: false, detail: "discord create failed" };
  }
  await saveBoardMessageId(env.DB, channelId, created);
  await pinMessage(token, channelId, created);
  return { ok: true, detail: `created ${created}` };
}
