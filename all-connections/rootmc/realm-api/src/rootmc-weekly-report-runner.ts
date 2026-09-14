/**
 * Sunday 10:00 HST  -  weekly activity awards + intelligence suite.
 */
import { runRootMcWeeklyActivityAwards } from "./rootmc-weekly-activity-awards";
import type { Env } from "./realm-router";
import {
  gatherWeeklyMetrics,
  previousCompletedHstWeekKey,
  runRootMcCombinedWeeklyReport,
  runRootMcWeeklyCategoryReports,
  weeklyCombinedReportPosted,
} from "./rootmc-weekly-reports";
import { resolveServerId } from "./rootmc-daily-report";

function str(v: unknown): string {
  return String(v ?? "").trim();
}

export async function runFullWeeklyReportSuite(
  env: Env,
  weekKey = previousCompletedHstWeekKey(),
): Promise<{
  weekKey: string;
  active: Awaited<ReturnType<typeof runRootMcWeeklyActivityAwards>>;
  weekly: Awaited<ReturnType<typeof runRootMcCombinedWeeklyReport>>;
  categories: Awaited<ReturnType<typeof runRootMcWeeklyCategoryReports>>;
}> {
  const active = await runRootMcWeeklyActivityAwards(env, weekKey);
  const intelligence = await runWeeklyIntelligenceSuite(env, weekKey);
  try {
    const { refreshAutomatedReportsBoard } = await import("./rootmc-automated-reports-board");
    const board = await refreshAutomatedReportsBoard(env);
    console.log("rootmc_reports_board", board.detail);
  } catch (e) {
    console.warn("rootmc_reports_board_failed", e instanceof Error ? e.message : String(e));
  }
  console.log(
    JSON.stringify({
      msg: "rootmc_weekly_suite_complete",
      weekKey,
      active: active.detail,
      weekly: intelligence.weekly.detail,
      categories: intelligence.categories.map((c) => `${c.category}:${c.detail}`),
    }),
  );
  return { weekKey, active, ...intelligence };
}

export async function runWeeklyIntelligenceSuite(
  env: Env,
  weekKey: string,
): Promise<{
  weekly: Awaited<ReturnType<typeof runRootMcCombinedWeeklyReport>>;
  categories: Awaited<ReturnType<typeof runRootMcWeeklyCategoryReports>>;
}> {
  const serverId = await resolveServerId(env.DB);
  const metrics = await gatherWeeklyMetrics(env, weekKey, serverId);

  const weekly = (await weeklyCombinedReportPosted(env.DB, serverId, weekKey))
    ? { ok: true, weekKey, detail: "already posted" }
    : await runRootMcCombinedWeeklyReport(env, { weekKey, serverId, metrics });

  const categories = await runRootMcWeeklyCategoryReports(env, { weekKey, serverId, metrics });

  return { weekly, categories };
}

export async function runRootMcWeeklyReportCron(env: Env, weekKey?: string): Promise<void> {
  await runFullWeeklyReportSuite(env, weekKey?.trim() || previousCompletedHstWeekKey());
}
