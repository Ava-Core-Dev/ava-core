/**
 * Condensed daily summary for the daily intelligence channel (midnight HST cron).
 */

import { discordBotFetch } from "./discord-rootmc-api";
import { callGrokRootMcReport } from "./rootmc-world-ai";
import {
  jsonForArchive,
  latestCombinedReportBefore,
  combinedReportPosted,
  previousReportForPrompt,
} from "./rootmc-ai-report-store";
import { archiveRootMcDailyAiToDiscord, publicAiModel } from "./rootmc-daily-discord-ai";
import {
  buildReleaseTimelineBlock,
  buildReleaseTimelineContext,
  buildTestDataDisclaimer,
  mergeCountdownEvents,
  parseDiscordScheduledEvents,
} from "./rootmc-daily-events";
import {
  formatBriefMarkdown,
  ROOTMC_NO_CHANGE_REPORT_TEXT,
  sendChannelMarkdownReport,
  splitDiscordMarkdown,
  stripServerReserveSection,
} from "./rootmc-discord-markdown";
import { ROOTMC_DAILY_SERVER_AI_SYSTEM_PROMPT } from "./rootmc-grok-prompts";
import { composeDualHostDailyReportText, formatDiscordDailySection, formatEqualDualHostDailyBody, sanitizePlayerFacingReport, discordActivityForPlayers, economyContextForPlayers } from "./rootmc-player-facing";
import { mirrorReportToSlackServerReports } from "./rootmc-slack-report-mirror";
import { resolveDailySummaryChannelId } from "./rootmc-report-channels";
import {
  gatherDailyMetrics,
  nowIso,
  previousHstDayKey,
  resolveServerId,
  formatPlaytime,
  type DailyMetrics,
  type RootMcDailyReportEnv,
} from "./rootmc-daily-report";

function str(v: unknown): string {
  return String(v ?? "").trim();
}

function hstDayBefore(dayKey: string): string {
  const parts = dayKey.split("-").map((x) => Number(x));
  if (parts.length !== 3 || parts.some((n) => Number.isNaN(n))) return dayKey;
  const [y, m, d] = parts;
  const dt = new Date(Date.UTC(y, m - 1, d, 10, 0, 0));
  dt.setUTCDate(dt.getUTCDate() - 1);
  return dt.toISOString().slice(0, 10);
}

async function metricsFingerprint(data: unknown): Promise<string> {
  const text = JSON.stringify(data);
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join("");
}

function playtimeForPlayers(rows: Awaited<ReturnType<typeof gatherDailyMetrics>>["playtime"], limit = 5) {
  return rows.slice(0, limit).map((p, i) => ({
    rank: i + 1,
    player: String(p.minecraft_username || "Unknown").trim() || "Unknown",
    playtime: formatPlaytime(Number(p.total_playtime_seconds) || 0),
  }));
}

function buildCombinedMetricsOnly(metrics: Awaited<ReturnType<typeof gatherDailyMetrics>>): Record<string, unknown> {
  return {
    app: "RootMC",
    report_kind: "server_daily_combined",
    period: { day_key: metrics.dayKey, timezone: "Pacific/Honolulu" },
    realm_note:
      "Daily Summary (not Economy brief). Lead with Discord/community activity. Live production is play.rootmc.net (Root-Ava-Core). Do not mention towns, nations, or claims. Keep economy to a light glance only.",
    server: {
      name: metrics.serverName,
      game_version: metrics.gameVersion,
    },
    live_production: {
      name: metrics.serverName,
      join: "play.rootmc.net",
      economy: {
        gold_in_wallets: economyContextForPlayers(metrics.economy).gold_in_wallets_total,
        players_with_balances: metrics.economy.trackedPlayers,
      },
    },
    linked_players: metrics.linked,
    linked_players_note: "Discord-linked Minecraft accounts for live production.",
    realm_playtime: {
      players_with_playtime: metrics.playersWithPlaytime,
      top_playtime: playtimeForPlayers(metrics.playtime),
      note: "Live production playtime pool (Root-Ava-Core).",
    },
    discord: discordActivityForPlayers(metrics.discord),
  };
}

function buildCombinedContext(
  metrics: Awaited<ReturnType<typeof gatherDailyMetrics>>,
  priorReport: Record<string, unknown> | null,
): Record<string, unknown> {
  return {
    ...buildCombinedMetricsOnly(metrics),
    generated_at: new Date().toISOString(),
    release_timeline: buildReleaseTimelineContext(),
    previous_report: priorReport,
  };
}

async function postMarkdownBrief(token: string, channelId: string, markdown: string): Promise<string | null> {
  return sendChannelMarkdownReport(token, channelId, splitDiscordMarkdown(markdown));
}

export async function runRootMcCombinedDailyReport(
  env: RootMcDailyReportEnv,
  opts?: { previewLabel?: string; serverId?: string; metrics?: DailyMetrics; dayKey?: string },
): Promise<{ ok: boolean; dayKey: string; messageId?: string; detail?: string }> {
  const token = str(env.DISCORD_ROOTMC_BOT_TOKEN);
  const dailyChannelId = resolveDailySummaryChannelId(env);
  if (!token || !dailyChannelId) {
    return { ok: false, dayKey: previousHstDayKey(), detail: "missing bot token or daily channel" };
  }

  const serverId = str(opts?.serverId) || (await resolveServerId(env.DB));
  const dayKey = str(opts?.dayKey) || str(opts?.metrics?.dayKey) || previousHstDayKey();
  if (!opts?.previewLabel && (await combinedReportPosted(env.DB, serverId, dayKey))) {
    return { ok: true, dayKey, detail: "already posted" };
  }
  if (opts?.previewLabel) {
    await env.DB.prepare(`DELETE FROM rootmc_daily_reports WHERE server_id = ? AND day_key = ?`)
      .bind(serverId, dayKey)
      .run();
  }

  const priorDayKey = hstDayBefore(dayKey);
  const metrics = opts?.metrics ?? (await gatherDailyMetrics(env, dayKey, serverId));
  const priorRow = await latestCombinedReportBefore(env.DB, serverId, dayKey);
  const priorReport = previousReportForPrompt(priorRow);
  const context = buildCombinedContext(metrics, priorReport);
  const fingerprint = await metricsFingerprint(buildCombinedMetricsOnly(metrics));

  const priorFpRow = await env.DB.prepare(
    `SELECT metrics_fingerprint FROM rootmc_daily_reports WHERE server_id = ? AND day_key = ? LIMIT 1`,
  )
    .bind(serverId, priorDayKey)
    .first<{ metrics_fingerprint: string | null }>();
  const priorFp = str(priorFpRow?.metrics_fingerprint);
  const unchanged = Boolean(priorFp && priorFp === fingerprint);

  const previewSuffix = "";
  let timelineBlock = "";
  const guildId = str(env.DISCORD_ROOTMC_GUILD_ID);
  let discordEvents = mergeCountdownEvents();
  if (guildId) {
    const evRes = await discordBotFetch(token, `/guilds/${encodeURIComponent(guildId)}/scheduled-events`);
    if (evRes.ok) {
      discordEvents = mergeCountdownEvents(parseDiscordScheduledEvents(await evRes.json().catch(() => [])));
    }
  }
  timelineBlock = buildReleaseTimelineBlock(discordEvents);
  const disclaimer = buildTestDataDisclaimer();
  if (disclaimer) {
    timelineBlock = `${disclaimer}\n\n${timelineBlock}`;
  }

  let summary = "";
  let reportText = ROOTMC_NO_CHANGE_REPORT_TEXT;
  let aiRes: Record<string, unknown> = { ok: false, skipped: true, reason: "unchanged_metrics" };
  let grokOk = 0;

  if (!unchanged) {
    aiRes = await callGrokRootMcReport(env, ROOTMC_DAILY_SERVER_AI_SYSTEM_PROMPT, context, {
      temperature: 0.2,
      summaryMax: 220,
      reportMax: 900,
    });
    const discordSection = formatDiscordDailySection({
      memberCount: metrics.discord.memberCount,
      totalMessages: metrics.discord.totalMessages,
      topChannels: metrics.discord.topChannels,
    });
    const dualHostBody = formatEqualDualHostDailyBody({
      linked: metrics.linked,
      playersWithPlaytime: metrics.playersWithPlaytime,
      playtime: metrics.playtime,
      towny: {
        economy: metrics.economy,
        townCount: metrics.towny.townCount,
        nationCount: metrics.towny.nationCount,
        totalPlots: metrics.towny.totalPlots,
      },
      claims: {
        economy: metrics.claims.economy,
        onlinePlayers: metrics.claims.onlinePlayers,
      },
    });
    if (aiRes.ok === true) {
      summary = sanitizePlayerFacingReport(str(aiRes.summary_text));
      const aiText = stripServerReserveSection(sanitizePlayerFacingReport(str(aiRes.report_text) || summary));
      reportText = composeDualHostDailyReportText({
        aiReportText: aiText,
        discordSection,
        dualHostBody,
      });
      grokOk = 1;
    } else {
      console.warn("rootmc_daily_combined_grok_fallback", str(aiRes.detail));
      reportText = composeDualHostDailyReportText({
        aiReportText: "## Executive Summary\n\n_Summary unavailable; Discord and host glance below._\n\n## Outlook\n\n_Pending._",
        discordSection,
        dualHostBody,
      });
    }
    await archiveRootMcDailyAiToDiscord(env, {
      reportKind: "daily_combined",
      dayKey,
      serverId,
      promptContext: context,
      ai: aiRes,
    });
  }

  const title = "RootMC Daily Summary";
  const footer = unchanged
    ? `metrics unchanged from prior day`
    : undefined;

  const briefMd = formatBriefMarkdown({
    title,
    dayKey,
    timelineBlock,
    summary: unchanged ? undefined : summary || undefined,
    report: reportText,
    footer,
  });

  const fullMd = briefMd;

  const messageId = await postMarkdownBrief(token, dailyChannelId, fullMd);
  if (!messageId) {
    return { ok: false, dayKey, detail: "discord post failed" };
  }

  void mirrorReportToSlackServerReports(env, {
    title,
    dayKey,
    markdown: fullMd,
    kind: "daily_combined",
  }).catch((e) =>
    console.warn("rootmc_slack_report_mirror", e instanceof Error ? e.message : String(e)),
  );

  const reportId = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO rootmc_daily_reports
       (server_id, day_key, posted_at, channel_id, message_id, summary, report_text,
        id, prompt_json, response_json, prior_report_id, metrics_fingerprint, unchanged_from_prior, grok_model, grok_ok)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      serverId,
      dayKey,
      nowIso(),
      dailyChannelId,
      messageId,
      unchanged ? ROOTMC_NO_CHANGE_REPORT_TEXT : summary || `${dayKey} summary`,
      reportText,
      reportId,
      jsonForArchive(context),
      jsonForArchive(aiRes),
      priorRow?.id || null,
      fingerprint,
      unchanged ? 1 : 0,
      unchanged ? null : publicAiModel(aiRes) || null,
      grokOk,
    )
    .run();

  return { ok: true, dayKey, messageId };
}
