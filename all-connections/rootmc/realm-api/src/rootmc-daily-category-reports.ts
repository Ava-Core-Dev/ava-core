/**
 * RootMC daily category reports  -  midnight HST (10:00 UTC).
 * Posts only to dedicated channels (economy, towns, nations). Daily summary is separate.
 */

import { callGrokRootMcReport } from "./rootmc-world-ai";
import {
  jsonForArchive,
  latestCategoryReportBefore,
  previousReportForPrompt,
  priorDayCategoryFingerprint,
} from "./rootmc-ai-report-store";
import { archiveRootMcDailyAiToDiscord, publicAiModel } from "./rootmc-daily-discord-ai";
import { buildReleaseTimelineContext } from "./rootmc-daily-events";
import {
  formatBriefMarkdown,
  ROOTMC_NO_CHANGE_REPORT_TEXT,
  sendChannelMarkdownReport,
  splitDiscordMarkdown,
} from "./rootmc-discord-markdown";
import {
  ROOTMC_DAILY_CATEGORIES,
  ROOTMC_DAILY_CATEGORY_PROMPTS,
  ROOTMC_DAILY_CATEGORY_TITLES,
  type RootMcDailyCategory,
} from "./rootmc-grok-prompts";
import { resolveCategoryChannelId } from "./rootmc-report-channels";
import {
  composeDualHostEconomyReportText,
  economyIntelBriefContext,
  formatLiveProductionEconomyBody,
  formatTreasuryBriefAppendix,
  sanitizePlayerFacingReport,
} from "./rootmc-player-facing";
import { mirrorReportToSlackServerReports } from "./rootmc-slack-report-mirror";
import { formatTownsBriefAppendix, townsIntelBriefContext } from "./rootmc-towny-reports";
import {
  type DailyMetrics,
  formatGold,
  gatherDailyMetrics,
  nowIso,
  playerLine,
  previousHstDayKey,
  resolveServerId,
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

function channelForCategory(env: RootMcDailyReportEnv, category: RootMcDailyCategory): string {
  return resolveCategoryChannelId(env, category);
}

function buildCategoryContext(
  metrics: DailyMetrics,
  category: RootMcDailyCategory,
  priorReport: Record<string, unknown> | null,
): Record<string, unknown> {
  const base = {
    generated_at: new Date().toISOString(),
    app: "RootMC",
    report_kind: "server_daily_category",
    category,
    release_timeline: buildReleaseTimelineContext(),
    period: { day_key: metrics.dayKey, timezone: "Pacific/Honolulu" },
    server: {
      name: metrics.serverName,
      game_version: metrics.gameVersion,
    },
    previous_report: priorReport,
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
        active_shop_listings: metrics.economy.shopListings,
      };
    case "towns":
      return {
        ...base,
        ...townsIntelBriefContext(metrics.towny),
      };
    case "nations":
      return {
        ...base,
        nations: metrics.towny.nations.map((n) => ({
          name: str(n.nation_name),
          towns: Number(n.town_count) || 0,
          leader: str(n.leader_name) || null,
        })),
        active_nation_count: metrics.towny.nationCount,
      };
    default:
      return base;
  }
}

function formatSyncedAtHst(iso: string | null | undefined): string {
  const raw = str(iso);
  if (!raw) return "unknown";
  const ms = Date.parse(raw);
  if (Number.isNaN(ms)) return raw;
  return new Date(ms).toLocaleString("en-US", {
    timeZone: "Pacific/Honolulu",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

function buildCategoryAppendix(metrics: DailyMetrics, category: RootMcDailyCategory): string {
  switch (category) {
    case "economy_intel":
      // Live production body is already in report_text; appendix is reserve only.
      return formatTreasuryBriefAppendix(metrics.treasury, formatSyncedAtHst(metrics.economy.syncedAt));
    case "towns":
      return formatTownsBriefAppendix(metrics.towny);
    case "nations":
      return (
        metrics.towny.nations
          .slice(0, 12)
          .map((n, i) =>
            playerLine(
              i + 1,
              str(n.nation_name),
              `${Number(n.town_count) || 0} towns  -  ${str(n.leader_name) || "?"}`,
            ),
          )
          .join("\n") || "_No nations yet._"
      );
    default:
      return "";
  }
}

async function categoryAlreadyPosted(
  env: RootMcDailyReportEnv,
  serverId: string,
  dayKey: string,
  category: RootMcDailyCategory,
): Promise<boolean> {
  const row = await env.DB.prepare(
    `SELECT category FROM rootmc_daily_category_reports
     WHERE server_id = ? AND day_key = ? AND category = ? LIMIT 1`,
  )
    .bind(serverId, dayKey, category)
    .first();
  return Boolean(row);
}

async function postMarkdownBrief(token: string, channelId: string, markdown: string): Promise<string | null> {
  return sendChannelMarkdownReport(token, channelId, splitDiscordMarkdown(markdown));
}

export async function runRootMcDailyCategoryReport(
  env: RootMcDailyReportEnv,
  category: RootMcDailyCategory,
  serverIdOverride?: string,
  metricsOverride?: DailyMetrics,
): Promise<{ ok: boolean; detail?: string }> {
  const token = str(env.DISCORD_ROOTMC_BOT_TOKEN);
  if (!token) {
    console.warn("rootmc_daily_category_skip", category, "missing bot token");
    return { ok: false, detail: "missing bot token" };
  }

  const channelId = channelForCategory(env, category);
  if (!channelId) {
    console.warn("rootmc_daily_category_skip", category, "no channel");
    return { ok: false, detail: "no channel configured" };
  }

  const serverId = str(serverIdOverride) || (await resolveServerId(env.DB));
  const dayKey = str(metricsOverride?.dayKey) || previousHstDayKey();
  const priorDayKey = hstDayBefore(dayKey);

  if (await categoryAlreadyPosted(env, serverId, dayKey, category)) {
    console.log("rootmc_daily_category_skip", category, dayKey, "already posted");
    return { ok: true, detail: "already posted" };
  }

  const metrics = metricsOverride ?? (await gatherDailyMetrics(env, dayKey, serverId));
  const priorRow = await latestCategoryReportBefore(env.DB, serverId, category, dayKey);
  const priorReport = previousReportForPrompt(priorRow);
  const context = buildCategoryContext(metrics, category, priorReport);
  const fingerprint = await metricsFingerprint(buildCategoryContext(metrics, category, null));
  const priorFp = await priorDayCategoryFingerprint(env.DB, serverId, category, priorDayKey);
  const unchanged = Boolean(priorFp && priorFp === fingerprint);

  let summary = "";
  let reportText = ROOTMC_NO_CHANGE_REPORT_TEXT;
  let aiRes: Record<string, unknown> = { ok: false, skipped: true, reason: "unchanged_metrics" };
  let grokOk = 0;

  if (!unchanged) {
    aiRes = await callGrokRootMcReport(env, ROOTMC_DAILY_CATEGORY_PROMPTS[category], context, {
      temperature: 0.15,
      summaryMax: 180,
      reportMax: category === "economy_intel" || category === "towns" ? 2200 : 1200,
    });
    if (aiRes.ok === true) {
      summary = sanitizePlayerFacingReport(str(aiRes.summary_text));
      reportText = sanitizePlayerFacingReport(str(aiRes.report_text) || summary);
      grokOk = 1;
    } else {
      console.warn("rootmc_daily_category_grok_fallback", category, str(aiRes.detail));
      reportText = `_Intelligence brief unavailable._`;
    }
    if (category === "economy_intel") {
      const liveBody = formatLiveProductionEconomyBody({
        linked: metrics.linked,
        playersWithPlaytime: metrics.playersWithPlaytime,
        playtime: metrics.playtime,
        live: {
          economy: metrics.economy,
          wallets: metrics.wallets,
        },
      });
      reportText = composeDualHostEconomyReportText({
        aiReportText: reportText,
        dualHostBody: liveBody,
      });
    }
    await archiveRootMcDailyAiToDiscord(env, {
      reportKind: "daily_category",
      dayKey,
      category,
      serverId,
      promptContext: context,
      ai: aiRes,
    });
  }

  const title = ROOTMC_DAILY_CATEGORY_TITLES[category];
  const briefMd = formatBriefMarkdown({
    title,
    dayKey,
    summary: unchanged ? undefined : summary || undefined,
    report: reportText,
    footer: unchanged ? "metrics unchanged from prior day" : undefined,
  });

  const statsCategories: RootMcDailyCategory[] = ["economy_intel", "towns", "nations"];
  const appendix =
    !unchanged && statsCategories.includes(category) ? buildCategoryAppendix(metrics, category) : "";
  const fullMd = appendix ? `${briefMd}\n\n### Live stats\n${appendix}` : briefMd;
  const messageId = await postMarkdownBrief(token, channelId, fullMd);
  if (!messageId) {
    console.error("rootmc_daily_category_post_failed", category, channelId);
    // Persist a failure row so one inaccessible channel cannot stall the whole catch-up queue.
    const failId = crypto.randomUUID();
    const failText = `_Discord post failed for ${category} (channel \`${channelId}\`)._`;
    await env.DB.prepare(
      `INSERT INTO rootmc_daily_category_reports
         (server_id, day_key, category, posted_at, channel_id, message_id, summary, report_text,
          grok_model, grok_ok, metrics_fingerprint, unchanged_from_prior, id, prompt_json, response_json, prior_report_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        serverId,
        dayKey,
        category,
        nowIso(),
        channelId,
        "post_failed",
        failText,
        failText,
        unchanged ? null : publicAiModel(aiRes) || null,
        0,
        fingerprint,
        0,
        failId,
        jsonForArchive(context),
        jsonForArchive({ ok: false, detail: "discord post failed", ...aiRes }),
        priorRow?.id || null,
      )
      .run();
    return { ok: false, detail: "discord post failed (recorded)" };
  }

  void mirrorReportToSlackServerReports(env, {
    title,
    dayKey,
    markdown: fullMd,
    kind: `daily_${category}`,
  }).catch((e) =>
    console.warn("rootmc_slack_report_mirror", category, e instanceof Error ? e.message : String(e)),
  );

  const reportId = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO rootmc_daily_category_reports
       (server_id, day_key, category, posted_at, channel_id, message_id, summary, report_text,
        grok_model, grok_ok, metrics_fingerprint, unchanged_from_prior, id, prompt_json, response_json, prior_report_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      serverId,
      dayKey,
      category,
      nowIso(),
      channelId,
      messageId,
      unchanged ? ROOTMC_NO_CHANGE_REPORT_TEXT : summary || `${category} ${dayKey}`,
      reportText,
      unchanged ? null : publicAiModel(aiRes) || null,
      grokOk,
      fingerprint,
      unchanged ? 1 : 0,
      reportId,
      jsonForArchive(context),
      jsonForArchive(aiRes),
      priorRow?.id || null,
    )
    .run();

  console.log("rootmc_daily_category_posted", category, dayKey, messageId, unchanged ? "unchanged" : "fresh");
  return { ok: true, detail: unchanged ? "unchanged metrics" : "posted" };
}

export async function runRootMcDailyCategoryReports(
  env: RootMcDailyReportEnv,
  opts?: { serverId?: string; metrics?: DailyMetrics },
): Promise<{ category: RootMcDailyCategory; ok: boolean; detail?: string }[]> {
  const results: { category: RootMcDailyCategory; ok: boolean; detail?: string }[] = [];
  for (const category of ROOTMC_DAILY_CATEGORIES) {
    try {
      const result = await runRootMcDailyCategoryReport(
        env,
        category,
        opts?.serverId,
        opts?.metrics,
      );
      results.push({ category, ...result });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error("rootmc_daily_category_failed", category, msg.slice(0, 200));
      results.push({ category, ok: false, detail: msg.slice(0, 120) });
    }
  }
  return results;
}