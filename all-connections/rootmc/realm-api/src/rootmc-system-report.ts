/**

 * Manual RootMC daily report triggers (Discord /systemreport).

 */



import type { ExecutionContext } from "@cloudflare/workers-types";



import { runRootMcCombinedDailyReport } from "./rootmc-daily-combined";

import { runRootMcDailyCategoryReport } from "./rootmc-daily-category-reports";

import {

  formatReportSuiteSummary,

  runFullDailyReportSuite,

} from "./rootmc-daily-report-runner";

import {

  previousHstDayKey,

  resolveServerId,

  type RootMcDailyReportEnv,

} from "./rootmc-daily-report";

import {

  type RootMcDedicatedChannelCategory,

} from "./rootmc-grok-prompts";



/** Only this Discord user may run /systemreport. */

export const ROOTMC_SYSTEM_REPORT_USER_ID = "1497037418979786823";



export type SystemReportKind = "all" | "daily" | "economy" | "towns" | "nations";



const CATEGORY_BY_KIND: Record<"economy" | "towns" | "nations", RootMcDedicatedChannelCategory> = {

  economy: "economy_intel",

  towns: "towns",

  nations: "nations",

};



export function isSystemReportUser(discordUserId: string): boolean {

  return discordUserId === ROOTMC_SYSTEM_REPORT_USER_ID;

}



export function parseSystemReportKind(raw: string): SystemReportKind | null {

  const key = String(raw || "").trim().toLowerCase();

  if (key === "all" || key === "daily" || key === "economy" || key === "towns" || key === "nations") {

    return key;

  }

  return null;

}



async function clearCategoryReport(

  env: RootMcDailyReportEnv,

  serverId: string,

  dayKey: string,

  category: RootMcDedicatedChannelCategory,

): Promise<void> {

  await env.DB.prepare(

    `DELETE FROM rootmc_daily_category_reports WHERE server_id = ? AND day_key = ? AND category = ?`,

  )

    .bind(serverId, dayKey, category)

    .run();

}



export async function runSystemReport(

  env: RootMcDailyReportEnv,

  kind: SystemReportKind,

): Promise<{ ok: boolean; detail: string }> {

  const serverId = await resolveServerId(env.DB);

  const dayKey = previousHstDayKey();



  if (kind === "all") {

    const suite = await runFullDailyReportSuite(env, {

      serverId,

      previewLabel: "systemreport",

      clearDayKey: dayKey,

    });

    const allOk = suite.daily.ok && suite.categories.every((c) => c.ok);

    return {

      ok: allOk,

      detail: formatReportSuiteSummary(dayKey, suite.daily, suite.categories),

    };

  }



  if (kind === "daily") {

    const result = await runRootMcCombinedDailyReport(env, { previewLabel: "systemreport", serverId });

    return {

      ok: result.ok,

      detail: result.ok

        ? `Daily summary  -  ${result.detail || "posted"} (${dayKey} HST)`

        : result.detail || "Daily summary failed",

    };

  }



  const category = CATEGORY_BY_KIND[kind];

  await clearCategoryReport(env, serverId, dayKey, category);

  const result = await runRootMcDailyCategoryReport(env, category, serverId);

  return {

    ok: result.ok,

    detail: result.ok

      ? `**${kind}** brief  -  ${result.detail || "posted"} for **${dayKey} HST**.`

      : result.detail || `${kind} brief failed`,

  };

}



/** Background task wrapper for deferred Discord follow-up after /systemreport. */

export function scheduleSystemReportFollowUp(

  env: RootMcDailyReportEnv,

  kind: SystemReportKind,

  ctx: Pick<ExecutionContext, "waitUntil">,

  onComplete: (content: string) => Promise<void>,

  onError: (content: string) => Promise<void>,

  onStarted?: () => Promise<void>,

): void {

  ctx.waitUntil(

    (async () => {

      try {

        if (onStarted) await onStarted();

        const result = await runSystemReport(env, kind);

        await (result.ok ? onComplete(result.detail) : onError(result.detail));

      } catch (e) {

        const msg = e instanceof Error ? e.message : String(e);

        await onError(`**Report run failed:** ${msg.slice(0, 500)}`);

      }

    })(),

  );

}


