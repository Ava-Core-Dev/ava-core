import type { ExecutionContext } from "@cloudflare/workers-types";

import { json } from "./cors";
import type { Env } from "./realm-router";
import { handleRequest } from "./realm-router";
import { previousHstDayKey, resolveServerId, isHstMidnightHour } from "./rootmc-daily-report";
import { latestCombinedReportDayKey } from "./rootmc-ai-report-store";
import { expireDueProposals, processGrantProposalMajorityHold } from "./rootmc-community-proposals";
import { maybeRunLegislatureCron } from "./rootmc-legislature";
import { evaluateShopPriceAlerts } from "./rootmc-shop-alerts";
import { runRootMcDiscordActivitySync } from "./rootmc-discord-activity-sync";
import { isWeeklyAwardsDue, isWeeklyReportCronSlot, previousCompletedHstWeekKey } from "./rootmc-hst-week";
import { runWeeklyIntelligenceSuite } from "./rootmc-weekly-report-runner";
import { runRootMcWeeklyActivityAwards, weeklyActivityAwardsPosted } from "./rootmc-weekly-activity-awards";
import { isMonthlyDividendCronSlot, runMonthlyTreasuryDividendCron } from "./rootmc-treasury";
import { runMysqlFullSyncCron } from "./rootmc-mysql-full-sync";
import { runMysqlEconomyPullCron } from "./rootmc-mysql-economy-pull";
import { runLiveEconomyStatusPost } from "./rootmc-live-economy-status";
import { runWebstatPullCron } from "./rootmc-webstat";
import { runDevWorkstationTimeoutCron } from "./rootmc-dev-workstation";
import { runHostPresenceMaintenance } from "./rootmc-host-presence";
import { isG2Worker } from "./g2/g2-db";
import { withPublicCacheHeaders } from "./public-cache";
import { maybeAttachResponseSignature } from "./rootmc-cache-sign";
import { runConnectionPreferenceWatchdogCron } from "./rootmc-connection-preference";
import { runRootMcScheduledEvent } from "./rootmc-cron-bundle";

async function maybeRunDailyReports(env: Env, when: Date): Promise<void> {
  const throughDayKey = previousHstDayKey(when);
  const serverId = await resolveServerId(env.DB);

  const { runFullDailyReportSuite, runMissingDailyCategoryReports } = await import(
    "./rootmc-daily-report-runner"
  );
  const {
    combinedReportPosted,
    resolveDailyReportDayKey,
    resolveOldestIncompleteCategoryDayKey,
  } = await import("./rootmc-ai-report-store");

  // Prefer combined #daily-summary catch-up — one suite per tick (Grok is slow).
  const dayKey = await resolveDailyReportDayKey(env.DB, serverId, throughDayKey);
  if (dayKey && !(await combinedReportPosted(env.DB, serverId, dayKey))) {
    await runFullDailyReportSuite(env, { serverId, dayKey });
    return;
  }

  const categoryDayKey = await resolveOldestIncompleteCategoryDayKey(env.DB, serverId, throughDayKey);
  if (categoryDayKey) {
    const categories = await runMissingDailyCategoryReports(env, serverId, categoryDayKey, undefined, {
      limit: 1,
    });
    console.log(
      JSON.stringify({
        msg: "rootmc_daily_category_retry",
        dayKey: categoryDayKey,
        categories: categories.map((c) => `${c.category}:${c.detail}`),
      }),
    );
  }
}

async function maybeRunWeeklyReports(env: Env, when: Date): Promise<void> {
  // Sunday 10:xx HST only (20:xx UTC). Never run on weekday midnight — it shares
  // economy/towns/nations channels with the daily suite and will overwrite them.
  if (!isWeeklyReportCronSlot(when)) {
    return;
  }
  const weekKey = previousCompletedHstWeekKey(when);
  if (!isWeeklyAwardsDue(weekKey, when)) {
    return;
  }
  if (!(await weeklyActivityAwardsPosted(env.DB, weekKey))) {
    console.log(JSON.stringify({ msg: "rootmc_weekly_awards_start", weekKey }));
    const active = await runRootMcWeeklyActivityAwards(env, weekKey);
    console.log(JSON.stringify({ msg: "rootmc_weekly_awards_done", weekKey, detail: active.detail }));
  }
  await runWeeklyIntelligenceSuite(env, weekKey);
  try {
    const { refreshAutomatedReportsBoard } = await import("./rootmc-automated-reports-board");
    const board = await refreshAutomatedReportsBoard(env);
    console.log("rootmc_reports_board", board.detail);
  } catch (e) {
    console.warn("rootmc_reports_board_failed", e instanceof Error ? e.message : String(e));
  }
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    try {
      const url = new URL(request.url);
      let response = await handleRequest(request, env, ctx);
      response = await withPublicCacheHeaders(request, response, url.pathname);
      response = await maybeAttachResponseSignature(response, env);
      return response;
    } catch (e) {
      const detail = e instanceof Error ? e.message : String(e);
      console.error("http_request_uncaught", detail.slice(0, 800));
      return json({ detail: "Internal Server Error" }, 500);
    }
  },

  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    // Ava owns production schedules after cutover; this remains for cold backup / manual CF triggers.
    await runRootMcScheduledEvent(event, env, ctx);
  },
};
