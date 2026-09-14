/**
 * Monthly Activity Dividend report  -  posts to #economy-guide after cron (1st midnight HST).
 */

import type { D1Database } from "@cloudflare/workers-types";

import { formatBriefMarkdown, splitDiscordMarkdown, sendChannelMarkdownReport } from "./rootmc-discord-markdown";
import { ROOTMC_MONTHLY_DIVIDEND_SYSTEM_PROMPT } from "./rootmc-grok-prompts";
import { formatReportGold, sanitizePlayerFacingReport } from "./rootmc-player-facing";
import { resolveCategoryChannelId } from "./rootmc-report-channels";
import type { RootMcDailyReportEnv } from "./rootmc-daily-report";
import { formatPlaytime, resolveServerId } from "./rootmc-daily-report";
import {
  computeMonthlyDividendPlan,
  loadDividendPlanFromRun,
  previousHstMonthKey,
  type DividendPlan,
  type DividendPayoutLine,
} from "./rootmc-treasury";
import { callGrokRootMcReport } from "./rootmc-world-ai";
import { archiveRootMcDailyAiToDiscord } from "./rootmc-daily-discord-ai";

function str(v: unknown): string {
  return String(v ?? "").trim();
}

function nowIso(): string {
  return new Date().toISOString();
}

function monthLabel(monthKey: string): string {
  const [y, m] = monthKey.split("-").map((x) => Number(x));
  if (!y || !m) return monthKey;
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleString("en-US", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

function formatGoldExact(value: number): string {
  const n = Math.max(0, Number(value) || 0);
  return `${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 3 })} Gold`;
}

function sortedPayoutLines(payouts: DividendPayoutLine[]): DividendPayoutLine[] {
  return [...payouts].sort((a, b) => b.amount - a.amount || b.playtime_seconds - a.playtime_seconds);
}

export function buildDividendReportContext(
  plan: DividendPlan,
  opts?: { testMode?: boolean; payoutsQueued?: boolean },
): Record<string, unknown> {
  const lines = sortedPayoutLines(plan.payouts).map((row, idx) => ({
    rank: idx + 1,
    minecraft_username: row.minecraft_username || "Unknown",
    playtime_seconds: row.playtime_seconds,
    playtime_label: formatPlaytime(row.playtime_seconds),
    playtime_hours: Math.round((row.playtime_seconds / 3600) * 100) / 100,
    amount_gold: row.amount,
    amount_label: formatGoldExact(row.amount),
  }));

  return {
    generated_at: nowIso(),
    app: "RootMC",
    report_kind: "monthly_activity_dividend",
    month_key: plan.month_key,
    month_label: monthLabel(plan.month_key),
    timezone: "Pacific/Honolulu",
    eligibility_hours_required: 20,
    payout_ratio: plan.payout_ratio,
    treasury_pool_net_month: plan.pool_net,
    treasury_pool_distributable: plan.pool_distributable,
    eligible_players: plan.eligible_count,
    total_eligible_playtime_seconds: plan.total_eligible_seconds,
    total_eligible_playtime_label: formatPlaytime(plan.total_eligible_seconds),
    status: plan.status,
    payout_lines: lines,
    total_distributed_gold: plan.pool_distributable,
    total_distributed_label: formatGoldExact(plan.pool_distributable),
    test_mode: Boolean(opts?.testMode),
    payouts_queued_ingame: Boolean(opts?.payoutsQueued),
  };
}

export function formatDividendPayoutAppendix(plan: DividendPlan): string {
  if (plan.status === "empty") {
    return "_No treasury inflows this month  -  Activity Dividend pool was empty._";
  }
  if (plan.status === "no_eligible") {
    return `_Treasury pool **${formatReportGold(plan.pool_distributable)}** was available, but no players met the **20 hour** playtime requirement._`;
  }
  const lines = sortedPayoutLines(plan.payouts).map(
    (row, idx) =>
      `${idx + 1}. **${row.minecraft_username || "Unknown"}**  -  **${formatGoldExact(row.amount)}** (${formatPlaytime(row.playtime_seconds)})`,
  );
  return (
    `**Total distributed:** ${formatGoldExact(plan.pool_distributable)}  -  **${plan.eligible_count}** eligible players\n\n` +
    (lines.join("\n") || "_No payout lines._")
  );
}

async function dividendReportAlreadyPosted(
  db: D1Database,
  serverId: string,
  monthKey: string,
): Promise<boolean> {
  const row = await db
    .prepare(
      `SELECT discord_message_id FROM rootmc_treasury_dividend_runs
       WHERE server_id = ? AND month_key = ? AND discord_message_id IS NOT NULL LIMIT 1`,
    )
    .bind(serverId, monthKey)
    .first();
  return Boolean(row);
}

async function markDividendReportPosted(
  db: D1Database,
  serverId: string,
  monthKey: string,
  channelId: string,
  messageId: string,
): Promise<void> {
  await db
    .prepare(
      `UPDATE rootmc_treasury_dividend_runs
       SET discord_channel_id = ?, discord_message_id = ?, report_posted_at = ?
       WHERE server_id = ? AND month_key = ?`,
    )
    .bind(channelId, messageId, nowIso(), serverId, monthKey)
    .run();
}

export async function runRootMcMonthlyDividendDiscordReport(
  env: RootMcDailyReportEnv,
  opts?: {
    monthKey?: string;
    dryRun?: boolean;
    serverId?: string;
    skipIdempotency?: boolean;
  },
): Promise<{ ok: boolean; detail?: string; messageId?: string | null; monthKey?: string }> {
  const token = str(env.DISCORD_ROOTMC_BOT_TOKEN);
  if (!token) {
    return { ok: false, detail: "missing bot token" };
  }

  const channelId = resolveCategoryChannelId(env, "economy_intel");
  if (!channelId) {
    return { ok: false, detail: "no economy channel" };
  }

  const serverId = str(opts?.serverId) || (await resolveServerId(env.DB));
  const monthKey = str(opts?.monthKey) || previousHstMonthKey();
  const dryRun = Boolean(opts?.dryRun);

  if (!dryRun && !opts?.skipIdempotency && (await dividendReportAlreadyPosted(env.DB, serverId, monthKey))) {
    return { ok: true, detail: "already posted", monthKey };
  }

  let plan: DividendPlan | null = null;
  let payoutsQueued = false;

  if (dryRun) {
    plan = await computeMonthlyDividendPlan(env.DB, serverId, monthKey, env);
  } else {
    plan = await loadDividendPlanFromRun(env.DB, serverId, monthKey, env);
    if (!plan) {
      plan = await computeMonthlyDividendPlan(env.DB, serverId, monthKey, env);
    } else {
      payoutsQueued = plan.status === "ready" && plan.payouts.length > 0;
    }
  }

  if (!plan) {
    return { ok: false, detail: "no dividend data", monthKey };
  }

  const context = buildDividendReportContext(plan, { testMode: dryRun, payoutsQueued });
  const aiRes = await callGrokRootMcReport(env, ROOTMC_MONTHLY_DIVIDEND_SYSTEM_PROMPT, context, {
    temperature: 0.12,
    summaryMax: 220,
    reportMax: 2400,
  });

  let summary = "";
  let reportText: string;
  if (aiRes.ok === true) {
    summary = sanitizePlayerFacingReport(str(aiRes.summary_text));
    reportText = sanitizePlayerFacingReport(str(aiRes.report_text) || summary);
  } else {
    console.warn("rootmc_dividend_grok_fallback", str(aiRes.detail));
    reportText = formatDividendPayoutAppendix(plan);
  }

  await archiveRootMcDailyAiToDiscord(env, {
    reportKind: "weekly_combined",
    dayKey: monthKey,
    category: "monthly_dividend",
    serverId,
    promptContext: context,
    ai: aiRes,
  });

  const title = dryRun
    ? `Activity Dividend (TEST  -  no payouts issued)  -  ${monthLabel(monthKey)}`
    : `Activity Dividend  -  ${monthLabel(monthKey)}`;

  const footer = dryRun
    ? "Preview only  -  wallet credits were not queued or applied"
    : payoutsQueued
      ? "Payouts are queued to eligible wallets in-game"
      : undefined;

  const briefMd = formatBriefMarkdown({
    title,
    dayKey: `${monthKey} HST`,
    summary,
    report: reportText,
    footer,
  });

  const messageId = await sendChannelMarkdownReport(token, channelId, splitDiscordMarkdown(briefMd));
  if (!messageId) {
    return { ok: false, detail: "discord post failed", monthKey };
  }

  if (!dryRun) {
    await markDividendReportPosted(env.DB, serverId, monthKey, channelId, messageId);
  }

  console.log(
    JSON.stringify({
      msg: dryRun ? "rootmc_dividend_report_test" : "rootmc_dividend_report_posted",
      monthKey,
      channelId,
      messageId,
      status: plan.status,
      eligible: plan.eligible_count,
      total: plan.pool_distributable,
    }),
  );

  return { ok: true, messageId, monthKey, detail: dryRun ? "test posted" : "posted" };
}

export async function maybePostMonthlyDividendDiscordReport(
  env: RootMcDailyReportEnv,
  when = new Date(),
): Promise<void> {
  const serverId = await resolveServerId(env.DB);
  const monthKey = previousHstMonthKey(when);
  const run = await env.DB.prepare(
    `SELECT discord_message_id FROM rootmc_treasury_dividend_runs
     WHERE server_id = ? AND month_key = ? LIMIT 1`,
  )
    .bind(serverId, monthKey)
    .first<{ discord_message_id: string | null }>();

  if (!run || str(run.discord_message_id)) return;

  await runRootMcMonthlyDividendDiscordReport(env, { monthKey, serverId });
}
