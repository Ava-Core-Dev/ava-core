/**
 * Shared RootMC cron bundle — Worker scheduled() + Ava HTTP kicks.
 */
import type { ExecutionContext } from "@cloudflare/workers-types";
import type { Env } from "./realm-router";
import { previousHstDayKey, resolveServerId, isHstMidnightHour } from "./rootmc-daily-report";
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
import { runConnectionPreferenceWatchdogCron } from "./rootmc-connection-preference";

export type CronBundleJob = "ops-10m" | "hourly" | "weekly" | "every-tick" | "all-tick";

type Wait = (p: Promise<unknown>) => void;

function waiter(ctx?: ExecutionContext): Wait {
  if (ctx?.waitUntil) return (p) => ctx.waitUntil(p);
  return (p) => { void p; };
}

async function settle<T>(p: Promise<T>): Promise<{ ok: boolean; value?: T; error?: string }> {
  try {
    return { ok: true, value: await p };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

async function maybeRunDailyReports(env: Env, when: Date): Promise<void> {
  const throughDayKey = previousHstDayKey(when);
  const serverId = await resolveServerId(env.DB);
  const { runFullDailyReportSuite, runMissingDailyCategoryReports } = await import("./rootmc-daily-report-runner");
  const { combinedReportPosted, resolveDailyReportDayKey, resolveOldestIncompleteCategoryDayKey } = await import("./rootmc-ai-report-store");
  const dayKey = await resolveDailyReportDayKey(env.DB, serverId, throughDayKey);
  if (dayKey && !(await combinedReportPosted(env.DB, serverId, dayKey))) {
    await runFullDailyReportSuite(env, { serverId, dayKey });
    return;
  }
  const categoryDayKey = await resolveOldestIncompleteCategoryDayKey(env.DB, serverId, throughDayKey);
  if (categoryDayKey) {
    await runMissingDailyCategoryReports(env, serverId, categoryDayKey, undefined, { limit: 1 });
  }
}

async function maybeRunWeeklyReports(env: Env, when: Date): Promise<void> {
  if (!isWeeklyReportCronSlot(when)) return;
  const weekKey = previousCompletedHstWeekKey(when);
  if (!isWeeklyAwardsDue(weekKey, when)) return;
  if (!(await weeklyActivityAwardsPosted(env.DB, weekKey))) {
    await runRootMcWeeklyActivityAwards(env, weekKey);
  }
  await runWeeklyIntelligenceSuite(env, weekKey);
  try {
    const { refreshAutomatedReportsBoard } = await import("./rootmc-automated-reports-board");
    await refreshAutomatedReportsBoard(env);
  } catch { /* ignore */ }
}

export async function runRootMcCronBundle(
  env: Env,
  ctx: ExecutionContext | undefined,
  opts: { job: CronBundleJob; when: Date; force?: boolean; reason?: string },
): Promise<Record<string, unknown>> {
  if (isG2Worker(env)) return { skipped: true, reason: "g2_worker" };
  const wait = waiter(ctx);
  const when = opts.when;
  const job = opts.job;
  const out: Record<string, unknown> = { reason: opts.reason || "", at: when.toISOString(), job };

  if (job === "every-tick" || job === "all-tick" || job === "ops-10m" || job === "hourly") {
    wait(expireDueProposals(env).catch(() => null));
    wait(processGrantProposalMajorityHold(env).catch(() => null));
    wait(maybeRunLegislatureCron(env, when).catch(() => null));
    wait(evaluateShopPriceAlerts(env).catch(() => null));
    wait(runRootMcDiscordActivitySync(env).catch(() => null));
    out.everyTick = true;
  }

  if (job === "ops-10m" || job === "all-tick") {
    out.watchdog = await settle(runConnectionPreferenceWatchdogCron(env));
    out.workstationTimeout = await settle(runDevWorkstationTimeoutCron(env, when));
    out.hostPresence = await settle(
      resolveServerId(env.DB).then((serverId) => runHostPresenceMaintenance(env.DB, serverId, when)),
    );
    out.mysqlFull = await settle(runMysqlFullSyncCron(env));
    out.mysqlEconomy = await settle(runMysqlEconomyPullCron(env));
    if (when.getUTCMinutes() < 10 || opts.force) {
      out.reportsBoard = await settle(
        import("./rootmc-automated-reports-board").then(({ refreshAutomatedReportsBoard }) =>
          refreshAutomatedReportsBoard(env),
        ),
      );
    }
    out.dailyCatchup = await settle(maybeRunDailyReports(env, when));
    out.weeklyRetry = await settle(maybeRunWeeklyReports(env, when));
  }

  if (job === "hourly" || job === "all-tick") {
    if (isMonthlyDividendCronSlot(when) || opts.force) {
      out.dividend = await settle(runMonthlyTreasuryDividendCron(env));
    }
    if (isHstMidnightHour(when) || opts.force) {
      out.dailyMidnight = await settle(maybeRunDailyReports(env, when));
    }
    out.webstat = await settle(runWebstatPullCron(env));
    out.liveEconomy = await settle(runLiveEconomyStatusPost(env));
    out.weeklyRetry = await settle(maybeRunWeeklyReports(env, when));
  }

  if (job === "weekly" || (job === "all-tick" && opts.force)) {
    // Force weekly path: temporarily bypass slot by calling awards suite when forced
    if (opts.force) {
      const weekKey = previousCompletedHstWeekKey(when);
      out.weeklyForce = await settle((async () => {
        if (!(await weeklyActivityAwardsPosted(env.DB, weekKey))) {
          await runRootMcWeeklyActivityAwards(env, weekKey);
        }
        await runWeeklyIntelligenceSuite(env, weekKey);
        return { weekKey };
      })());
    } else {
      out.weekly = await settle(maybeRunWeeklyReports(env, when));
    }
  }

  return out;
}

export async function runRootMcScheduledEvent(
  event: { cron?: string; scheduledTime?: number },
  env: Env,
  ctx: ExecutionContext,
): Promise<void> {
  const when = new Date(event.scheduledTime || Date.now());
  const cron = event.cron || "";
  await runRootMcCronBundle(env, ctx, { job: "every-tick", when, reason: `cf:${cron}` });
  if (cron === "*/10 * * * *") {
    await runRootMcCronBundle(env, ctx, { job: "ops-10m", when, reason: `cf:${cron}` });
  }
  if (cron === "0 * * * *") {
    await runRootMcCronBundle(env, ctx, { job: "hourly", when, reason: `cf:${cron}` });
  }
  if (cron === "0 20 * * 1") {
    await runRootMcCronBundle(env, ctx, { job: "weekly", when, reason: `cf:${cron}` });
  }
}
