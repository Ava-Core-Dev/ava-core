/**

 * Manual trigger for combined daily summary (delegates to cron implementation).

 */



import { runRootMcCombinedDailyReport } from "./rootmc-daily-combined";

import type { RootMcDailyReportEnv } from "./rootmc-daily-report";



export async function runRootMcCombinedDailyPreview(

  env: RootMcDailyReportEnv,

  opts?: { previewLabel?: string; serverId?: string },

): Promise<{ ok: boolean; dayKey: string; messageId?: string; detail?: string }> {

  return runRootMcCombinedDailyReport(env, opts);

}


