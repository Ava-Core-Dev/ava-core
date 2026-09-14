/** Public read API for archived RootMC daily intelligence (Discord cron suite). */

import type { D1Database } from "@cloudflare/workers-types";

import { json } from "./cors";
import { ROOTMC_DAILY_CATEGORY_TITLES } from "./rootmc-grok-prompts";
import { latestCombinedReportDayKey } from "./rootmc-ai-report-store";
import { previousHstDayKey, resolveServerId } from "./rootmc-daily-report";
import { repairMojibake } from "./rootmc-discord-markdown";

function str(v: unknown): string {
  return repairMojibake(String(v ?? "").trim());
}

type CombinedRow = {
  day_key: string;
  posted_at: string | null;
  summary: string | null;
  report_text: string | null;
  unchanged_from_prior: number | null;
};

type CategoryRow = {
  day_key: string;
  category: string;
  posted_at: string | null;
  summary: string | null;
  report_text: string | null;
  unchanged_from_prior: number | null;
};

function daysBehind(latestDayKey: string | null, expectedDayKey: string): number {
  if (!latestDayKey) return 99;
  const latestMs = Date.parse(`${latestDayKey}T12:00:00Z`);
  const expectedMs = Date.parse(`${expectedDayKey}T12:00:00Z`);
  if (Number.isNaN(latestMs) || Number.isNaN(expectedMs)) return 0;
  return Math.max(0, Math.round((expectedMs - latestMs) / (24 * 60 * 60 * 1000)));
}

export async function handleDailyReportPublic(
  request: Request,
  env: { DB: D1Database; SITE_URL?: string },
  subpath: string,
  method: string,
): Promise<Response | null> {
  if (method !== "GET" || subpath !== "/rootmc/daily-report") return null;

  const url = new URL(request.url);
  const serverId = str(url.searchParams.get("server_id")) || (await resolveServerId(env.DB));
  const limit = Math.min(30, Math.max(1, Number(url.searchParams.get("limit")) || 14));
  const expectedDayKey = previousHstDayKey();
  const latestDayKey = await latestCombinedReportDayKey(env.DB, serverId);

  const combinedRes = await env.DB.prepare(
    `SELECT day_key, posted_at, summary, report_text, unchanged_from_prior
     FROM rootmc_daily_reports
     WHERE server_id = ?
     ORDER BY day_key DESC
     LIMIT ?`,
  )
    .bind(serverId, limit)
    .all<CombinedRow>();

  const dayKeys = (combinedRes.results || []).map((r) => str(r.day_key)).filter(Boolean);
  let categoryRows: CategoryRow[] = [];
  if (dayKeys.length > 0) {
    const placeholders = dayKeys.map(() => "?").join(", ");
    const catRes = await env.DB.prepare(
      `SELECT day_key, category, posted_at, summary, report_text, unchanged_from_prior
       FROM rootmc_daily_category_reports
       WHERE server_id = ? AND day_key IN (${placeholders})
       ORDER BY day_key DESC, category ASC`,
    )
      .bind(serverId, ...dayKeys)
      .all<CategoryRow>();
    categoryRows = catRes.results || [];
  }

  const categoriesByDay = new Map<string, CategoryRow[]>();
  for (const row of categoryRows) {
    const key = str(row.day_key);
    if (!key) continue;
    const list = categoriesByDay.get(key) || [];
    list.push(row);
    categoriesByDay.set(key, list);
  }

  const reports = (combinedRes.results || []).map((row) => {
    const dayKey = str(row.day_key);
    const cats = (categoriesByDay.get(dayKey) || []).map((c) => {
      const category = str(c.category);
      const title =
        ROOTMC_DAILY_CATEGORY_TITLES[category as keyof typeof ROOTMC_DAILY_CATEGORY_TITLES] ||
        category.replace(/_/g, " ");
      return {
        category,
        title,
        posted_at: c.posted_at,
        summary: str(c.summary),
        report_text: str(c.report_text),
        unchanged_from_prior: Number(c.unchanged_from_prior) > 0,
      };
    });
    return {
      day_key: dayKey,
      posted_at: row.posted_at,
      summary: str(row.summary),
      report_text: str(row.report_text),
      unchanged_from_prior: Number(row.unchanged_from_prior) > 0,
      categories: cats,
    };
  });

  return json({
    server_id: serverId,
    expected_day_key: expectedDayKey,
    latest_day_key: latestDayKey,
    days_behind: daysBehind(latestDayKey, expectedDayKey),
    reports,
  });
}
