/**
 * Weekly RootMC intelligence reports + metrics (Sunday 10:00 HST cron).
 */

import type { D1Database } from "@cloudflare/workers-types";

import { callGrokRootMcReport } from "./rootmc-world-ai";
import { jsonForArchive } from "./rootmc-ai-report-store";
import { archiveRootMcDailyAiToDiscord } from "./rootmc-daily-discord-ai";
import {
  formatBriefMarkdown,
  sendChannelMarkdownReport,
  splitDiscordMarkdown,
} from "./rootmc-discord-markdown";
import {
  ROOTMC_DAILY_CATEGORIES,
  ROOTMC_DAILY_CATEGORY_TITLES,
  ROOTMC_WEEKLY_CATEGORY_PROMPTS,
  ROOTMC_WEEKLY_SERVER_AI_SYSTEM_PROMPT,
  type RootMcDailyCategory,
} from "./rootmc-grok-prompts";
import {
  discordActivityForPlayers,
  economyContextForPlayers,
  economyIntelBriefContext,
  netWorthLeaderboardForPlayers,
  sanitizePlayerFacingReport,
  walletLeaderboardForPlayers,
} from "./rootmc-player-facing";
import { mirrorReportToSlackServerReports } from "./rootmc-slack-report-mirror";
import { townsIntelBriefContext } from "./rootmc-towny-reports";
import { resolveCategoryChannelId, resolveDailySummaryChannelId } from "./rootmc-report-channels";
import { excludedDiscordChannelsForGrok } from "./rootmc-daily-discord-ops";
import {
  formatPlaytime,
  gatherDailyMetrics,
  nowIso,
  resolveServerId,
  type DailyMetrics,
  type RootMcDailyReportEnv,
} from "./rootmc-daily-report";
import { hstWeekBoundsMs, previousCompletedHstWeekKey, previousHstWeekKey } from "./rootmc-hst-week";

function str(v: unknown): string {
  return String(v ?? "").trim();
}

async function metricsFingerprint(data: unknown): Promise<string> {
  const text = JSON.stringify(data);
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join("");
}

export async function weeklyCombinedReportPosted(
  db: D1Database,
  serverId: string,
  weekKey: string,
): Promise<boolean> {
  const row = await db
    .prepare(`SELECT 1 FROM rootmc_weekly_reports WHERE server_id = ? AND week_key = ? LIMIT 1`)
    .bind(serverId, weekKey)
    .first();
  return Boolean(row);
}

async function discordActivityForWeek(
  db: D1Database,
  guildId: string,
  weekKey: string,
  excluded: Set<string> = new Set(),
): Promise<{ totalMessages: number; topChannels: { name: string; count: number }[]; memberCount: number }> {
  const { startMs, endMs } = hstWeekBoundsMs(weekKey);
  const startIso = new Date(startMs).toISOString();
  const endIso = new Date(endMs).toISOString();

  const totalRow = await db
    .prepare(
      `SELECT COUNT(*) AS c FROM discord_message_activity WHERE created_at >= ? AND created_at <= ?`,
    )
    .bind(startIso, endIso)
    .first<{ c: number }>();

  const channelRows = await db
    .prepare(
      `SELECT m.channel_id, COUNT(*) AS c, c.name
       FROM discord_message_activity m
       LEFT JOIN discord_discovered_channels c ON c.channel_id = m.channel_id
       WHERE m.created_at >= ? AND m.created_at <= ? AND c.guild_id = ?
       GROUP BY m.channel_id
       ORDER BY c DESC
       LIMIT 40`,
    )
    .bind(startIso, endIso, guildId)
    .all<{ channel_id: string; c: number; name: string | null }>();

  const topChannels = (channelRows.results || [])
    .filter((r) => r.channel_id && !excluded.has(r.channel_id))
    .slice(0, 5)
    .map((r) => ({
      name: str(r.name) || r.channel_id.slice(-6),
      count: Number(r.c) || 0,
    }));

  return {
    totalMessages: Number(totalRow?.c) || 0,
    topChannels,
    memberCount: 0,
  };
}

export async function gatherWeeklyMetrics(
  env: RootMcDailyReportEnv,
  weekKey: string,
  serverId?: string,
): Promise<DailyMetrics> {
  const sid = str(serverId) || (await resolveServerId(env.DB));
  const base = await gatherDailyMetrics(env, weekKey, sid);
  const guildId = str(env.DISCORD_ROOTMC_GUILD_ID);
  const discord = guildId
    ? await discordActivityForWeek(env.DB, guildId, weekKey, excludedDiscordChannelsForGrok(env))
    : base.discord;
  return { ...base, dayKey: weekKey, discord, discordOps: [] };
}

function buildWeeklyCombinedContext(metrics: DailyMetrics): Record<string, unknown> {
  return {
    app: "RootMC",
    report_kind: "server_weekly_combined",
    period: { week_key: metrics.dayKey, timezone: "Pacific/Honolulu", days: 7 },
    realm_note:
      "Live production is play.rootmc.net (Root-Ava-Core). Do not mention towns, nations, or claims. Never treat wallet totals as combined net worth.",
    server: { name: metrics.serverName, game_version: metrics.gameVersion },
    live_production: {
      name: metrics.serverName,
      join: "play.rootmc.net",
      economy: economyContextForPlayers(metrics.economy),
      top_net_worth: netWorthLeaderboardForPlayers(metrics.netWorth, 5),
      top_wallet_balances: walletLeaderboardForPlayers(metrics.wallets, 5),
    },
    linked_players: metrics.linked,
    linked_players_note: "Discord-linked Minecraft accounts for live production.",
    realm_playtime: {
      players_with_playtime: metrics.playersWithPlaytime,
      top_playtime: metrics.playtime.slice(0, 5).map((p, i) => ({
        rank: i + 1,
        player: str(p.minecraft_username) || "Unknown",
        playtime: formatPlaytime(Number(p.total_playtime_seconds) || 0),
      })),
      note: "Live production playtime pool (Root-Ava-Core).",
    },
    discord: discordActivityForPlayers(metrics.discord),
    generated_at: new Date().toISOString(),
  };
}

export async function runRootMcCombinedWeeklyReport(
  env: RootMcDailyReportEnv,
  opts?: { weekKey?: string; serverId?: string; metrics?: DailyMetrics },
): Promise<{ ok: boolean; weekKey: string; detail?: string }> {
  const token = str(env.DISCORD_ROOTMC_BOT_TOKEN);
  const channelId = resolveDailySummaryChannelId(env);
  const serverId = str(opts?.serverId) || (await resolveServerId(env.DB));
  const weekKey = str(opts?.weekKey) || previousCompletedHstWeekKey();

  if (!token || !channelId) {
    return { ok: false, weekKey, detail: "missing bot token or daily channel" };
  }
  if (await weeklyCombinedReportPosted(env.DB, serverId, weekKey)) {
    return { ok: true, weekKey, detail: "already posted" };
  }

  const metrics = opts?.metrics ?? (await gatherWeeklyMetrics(env, weekKey, serverId));
  const context = buildWeeklyCombinedContext(metrics);
  const fingerprint = await metricsFingerprint(context);

  const priorWeek = previousHstWeekKey(weekKey);
  const priorRow = await env.DB.prepare(
    `SELECT metrics_fingerprint, report_text FROM rootmc_weekly_reports WHERE server_id = ? AND week_key = ? LIMIT 1`,
  )
    .bind(serverId, priorWeek)
    .first<{ metrics_fingerprint: string | null; report_text: string | null }>();

  let summary = "";
  let reportText = str(priorRow?.report_text) || "_Weekly brief pending._";
  let grokOk = 0;
  let grokModel: string | null = null;

  const unchanged = str(priorRow?.metrics_fingerprint) === fingerprint;
  if (!unchanged) {
    const aiRes = await callGrokRootMcReport(env, ROOTMC_WEEKLY_SERVER_AI_SYSTEM_PROMPT, context, {
      temperature: 0.2,
      summaryMax: 300,
      reportMax: 2400,
    });
    if (aiRes.ok === true) {
      summary = sanitizePlayerFacingReport(str(aiRes.summary_text));
      reportText = sanitizePlayerFacingReport(str(aiRes.report_text) || summary);
      grokOk = 1;
      grokModel = str(aiRes.model) || null;
    } else {
      reportText = `_Weekly intelligence brief unavailable._\n\nMetrics were collected but the report could not run.`;
    }
    await archiveRootMcDailyAiToDiscord(env, {
      reportKind: "weekly_combined",
      dayKey: weekKey,
      serverId,
      promptContext: context,
      ai: aiRes,
    });
  }

  const briefMd = formatBriefMarkdown({
    title: "Weekly Summary",
    dayKey: weekKey,
    summary: summary || undefined,
    report: reportText,
    footer: `week of ${weekKey} HST`,
  });

  const messageId = await sendChannelMarkdownReport(
    token,
    channelId,
    splitDiscordMarkdown(briefMd),
  );
  if (!messageId) {
    return { ok: false, weekKey, detail: "discord post failed" };
  }

  void mirrorReportToSlackServerReports(env, {
    title: "Weekly Summary",
    dayKey: weekKey,
    markdown: briefMd,
    kind: "weekly_combined",
  }).catch((e) =>
    console.warn("rootmc_slack_report_mirror", e instanceof Error ? e.message : String(e)),
  );

  await env.DB.prepare(
    `INSERT INTO rootmc_weekly_reports
       (server_id, week_key, posted_at, channel_id, message_id, summary, report_text, metrics_fingerprint, grok_model, grok_ok)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(serverId, weekKey, nowIso(), channelId, messageId, summary, reportText, fingerprint, grokModel, grokOk)
    .run();

  return { ok: true, weekKey, detail: "posted" };
}

function buildCategoryContext(metrics: DailyMetrics, category: RootMcDailyCategory): Record<string, unknown> {
  const base = {
    app: "RootMC",
    report_kind: "server_weekly_category",
    category,
    period: { week_key: metrics.dayKey, timezone: "Pacific/Honolulu", days: 7 },
    server: { name: metrics.serverName, game_version: metrics.gameVersion },
    generated_at: new Date().toISOString(),
  };
  switch (category) {
    case "economy_intel":
      return {
        ...base,
        ...economyIntelBriefContext(metrics.economy, metrics.netWorth, metrics.treasury, 15, metrics.claims, {
          displayName: metrics.serverName,
          linked: metrics.linked,
          playersWithPlaytime: metrics.playersWithPlaytime,
          playtime: metrics.playtime,
          wallets: metrics.wallets,
        }),
      };
    case "towns":
      return {
        ...base,
        ...townsIntelBriefContext(metrics.towny),
      };
    case "nations":
      return {
        ...base,
        nations: metrics.towny.nations.slice(0, 25),
        active_nation_count: metrics.towny.nationCount,
      };
    default:
      return base;
  }
}

export async function runRootMcWeeklyCategoryReports(
  env: RootMcDailyReportEnv,
  opts: { weekKey: string; serverId: string; metrics: DailyMetrics },
): Promise<{ category: RootMcDailyCategory; ok: boolean; detail?: string }[]> {
  const token = str(env.DISCORD_ROOTMC_BOT_TOKEN);
  const results: { category: RootMcDailyCategory; ok: boolean; detail?: string }[] = [];

  for (const category of ROOTMC_DAILY_CATEGORIES) {
    const channelId = resolveCategoryChannelId(env, category);
    if (!token || !channelId) {
      results.push({ category, ok: false, detail: "missing channel" });
      continue;
    }

    const existing = await env.DB.prepare(
      `SELECT 1 FROM rootmc_weekly_category_reports WHERE server_id = ? AND week_key = ? AND category = ? LIMIT 1`,
    )
      .bind(opts.serverId, opts.weekKey, category)
      .first();
    if (existing) {
      results.push({ category, ok: true, detail: "already posted" });
      continue;
    }

    const context = buildCategoryContext(opts.metrics, category);
    const fingerprint = await metricsFingerprint(context);
    const aiRes = await callGrokRootMcReport(env, ROOTMC_WEEKLY_CATEGORY_PROMPTS[category], context, {
      temperature: 0.2,
      summaryMax: 220,
      reportMax: 2400,
    });

    const summary =
      aiRes.ok === true ? sanitizePlayerFacingReport(str(aiRes.summary_text)) : "";
    const reportText =
      aiRes.ok === true
        ? sanitizePlayerFacingReport(str(aiRes.report_text) || summary)
        : `_Weekly ${ROOTMC_DAILY_CATEGORY_TITLES[category]} unavailable._`;

    const briefMd = formatBriefMarkdown({
      title: `${ROOTMC_DAILY_CATEGORY_TITLES[category]}  -  Week of ${opts.weekKey}`,
      dayKey: opts.weekKey,
      summary: summary || undefined,
      report: reportText,
      footer: `weekly ${category}`,
    });

    const messageId = await sendChannelMarkdownReport(
      token,
      channelId,
      splitDiscordMarkdown(briefMd),
    );
    if (!messageId) {
      results.push({ category, ok: false, detail: "discord post failed" });
      continue;
    }

    void mirrorReportToSlackServerReports(env, {
      title: `${ROOTMC_DAILY_CATEGORY_TITLES[category]}  -  Week of ${opts.weekKey}`,
      dayKey: opts.weekKey,
      markdown: briefMd,
      kind: `weekly_${category}`,
    }).catch((e) =>
      console.warn(
        "rootmc_slack_report_mirror",
        category,
        e instanceof Error ? e.message : String(e),
      ),
    );

    await env.DB.prepare(
      `INSERT INTO rootmc_weekly_category_reports
         (server_id, week_key, category, posted_at, channel_id, message_id, summary, report_text, metrics_fingerprint, grok_ok)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        opts.serverId,
        opts.weekKey,
        category,
        nowIso(),
        channelId,
        messageId,
        summary,
        reportText,
        fingerprint,
        aiRes.ok === true ? 1 : 0,
      )
      .run();

    results.push({ category, ok: true, detail: "posted" });
  }

  return results;
}

export { previousCompletedHstWeekKey };
