/** D1 archive + prior-report lookup for all RootMC Grok reports. */

import type { D1Database } from "@cloudflare/workers-types";

import {
  ROOTMC_DEDICATED_CHANNEL_CATEGORIES,
  type RootMcDailyCategory,
  type RootMcDedicatedChannelCategory,
} from "./rootmc-grok-prompts";

function str(v: unknown): string {
  return String(v ?? "").trim();
}

export function jsonForArchive(v: unknown): string {
  return JSON.stringify(v, (_k, value) => (typeof value === "bigint" ? value.toString() : value));
}

export type RootMcCategoryReportRow = {
  id: string;
  server_id: string;
  day_key: string;
  category: string;
  posted_at: string;
  channel_id: string | null;
  message_id: string | null;
  summary: string | null;
  report_text: string | null;
  grok_model: string | null;
  grok_ok: number;
  metrics_fingerprint: string | null;
  unchanged_from_prior: number;
  prompt_json: string | null;
  response_json: string | null;
  prior_report_id: string | null;
};

export type RootMcCombinedReportRow = {
  id: string;
  server_id: string;
  day_key: string;
  posted_at: string;
  channel_id: string | null;
  message_id: string | null;
  summary: string | null;
  report_text: string | null;
  grok_model: string | null;
  grok_ok: number;
  metrics_fingerprint: string | null;
  unchanged_from_prior: number;
  prompt_json: string | null;
  response_json: string | null;
  prior_report_id: string | null;
};

export function previousReportForPrompt(row: {
  id: string;
  day_key?: string;
  category?: string;
  posted_at?: string;
  created_at?: string;
  summary?: string | null;
  summary_text?: string | null;
  report_text?: string | null;
} | null): Record<string, unknown> | null {
  if (!row?.id) return null;
  return {
    id: row.id,
    day_key: row.day_key || null,
    category: row.category || null,
    posted_at: row.posted_at || row.created_at || null,
    summary_text: str(row.summary_text || row.summary) || null,
    report_text: str(row.report_text) || null,
  };
}

export async function latestCategoryReportBefore(
  db: D1Database,
  serverId: string,
  category: RootMcDailyCategory,
  beforeDayKey: string,
): Promise<RootMcCategoryReportRow | null> {
  const row = await db
    .prepare(
      `SELECT * FROM rootmc_daily_category_reports
       WHERE server_id = ? AND category = ? AND day_key < ?
       ORDER BY day_key DESC LIMIT 1`,
    )
    .bind(serverId, category, beforeDayKey)
    .first<RootMcCategoryReportRow>();
  if (!row) return null;
  if (str(row.summary) || str(row.report_text)) return row;
  return row.id ? row : null;
}

export async function latestCombinedReportBefore(
  db: D1Database,
  serverId: string,
  beforeDayKey: string,
): Promise<RootMcCombinedReportRow | null> {
  const row = await db
    .prepare(
      `SELECT * FROM rootmc_daily_reports
       WHERE server_id = ? AND day_key < ?
       ORDER BY day_key DESC LIMIT 1`,
    )
    .bind(serverId, beforeDayKey)
    .first<RootMcCombinedReportRow>();
  return row?.id || row?.summary ? row : null;
}

/** Next calendar day after an HST day_key (YYYY-MM-DD). */
export function hstDayAfter(dayKey: string): string {
  const parts = dayKey.split("-").map((x) => Number(x));
  if (parts.length !== 3 || parts.some((n) => Number.isNaN(n))) return dayKey;
  const [y, m, d] = parts;
  const dt = new Date(Date.UTC(y, m - 1, d, 10, 0, 0));
  dt.setUTCDate(dt.getUTCDate() + 1);
  return dt.toISOString().slice(0, 10);
}

export async function latestCombinedReportDayKey(
  db: D1Database,
  serverId: string,
): Promise<string | null> {
  const row = await db
    .prepare(
      `SELECT day_key FROM rootmc_daily_reports
       WHERE server_id = ?
       ORDER BY day_key DESC
       LIMIT 1`,
    )
    .bind(serverId)
    .first<{ day_key: string }>();
  const key = str(row?.day_key);
  return key || null;
}

/**
 * Oldest HST day at or before throughDayKey that still needs a combined daily summary.
 * Category briefs are retried separately — a single stuck category must not block
 * #daily-summary / economy catch-up for later days.
 */
export async function resolveDailyReportDayKey(
  db: D1Database,
  serverId: string,
  throughDayKey: string,
): Promise<string | null> {
  const latest = await latestCombinedReportDayKey(db, serverId);
  let cursor = latest ? hstDayAfter(latest) : throughDayKey;
  while (cursor <= throughDayKey) {
    if (!(await combinedReportPosted(db, serverId, cursor))) {
      return cursor;
    }
    cursor = hstDayAfter(cursor);
  }
  return null;
}

/** Incomplete category briefs for the latest combined day and newer — not ancient gaps. */
export async function resolveOldestIncompleteCategoryDayKey(
  db: D1Database,
  serverId: string,
  throughDayKey: string,
): Promise<string | null> {
  const latest = await latestCombinedReportDayKey(db, serverId);
  if (!latest) return null;
  let cursor = latest;
  while (cursor <= throughDayKey) {
    if (
      (await combinedReportPosted(db, serverId, cursor)) &&
      !(await dailyCategoryReportsPosted(db, serverId, cursor))
    ) {
      return cursor;
    }
    cursor = hstDayAfter(cursor);
  }
  return null;
}

export async function combinedReportPosted(
  db: D1Database,
  serverId: string,
  dayKey: string,
): Promise<boolean> {
  const row = await db
    .prepare(`SELECT day_key FROM rootmc_daily_reports WHERE server_id = ? AND day_key = ? LIMIT 1`)
    .bind(serverId, dayKey)
    .first();
  return Boolean(row);
}

/** True when economy_intel, towns, and nations briefs exist for the HST day. */
export async function dailyCategoryReportsPosted(
  db: D1Database,
  serverId: string,
  dayKey: string,
): Promise<boolean> {
  const rows = await db
    .prepare(
      `SELECT category FROM rootmc_daily_category_reports
       WHERE server_id = ? AND day_key = ?`,
    )
    .bind(serverId, dayKey)
    .all<{ category: string }>();
  const posted = new Set((rows.results || []).map((r) => str(r.category)));
  return ROOTMC_DEDICATED_CHANNEL_CATEGORIES.every((c) => posted.has(c));
}

export async function missingDailyCategoryReports(
  db: D1Database,
  serverId: string,
  dayKey: string,
): Promise<RootMcDedicatedChannelCategory[]> {
  const rows = await db
    .prepare(
      `SELECT category FROM rootmc_daily_category_reports
       WHERE server_id = ? AND day_key = ?`,
    )
    .bind(serverId, dayKey)
    .all<{ category: string }>();
  const posted = new Set((rows.results || []).map((r) => str(r.category)));
  return ROOTMC_DEDICATED_CHANNEL_CATEGORIES.filter((c) => !posted.has(c));
}

export async function dailyReportSuiteComplete(
  db: D1Database,
  serverId: string,
  dayKey: string,
): Promise<boolean> {
  const [combined, categories] = await Promise.all([
    combinedReportPosted(db, serverId, dayKey),
    dailyCategoryReportsPosted(db, serverId, dayKey),
  ]);
  return combined && categories;
}

export async function priorDayCategoryFingerprint(
  db: D1Database,
  serverId: string,
  category: RootMcDailyCategory,
  priorDayKey: string,
): Promise<string | null> {
  const row = await db
    .prepare(
      `SELECT metrics_fingerprint FROM rootmc_daily_category_reports
       WHERE server_id = ? AND day_key = ? AND category = ? LIMIT 1`,
    )
    .bind(serverId, priorDayKey, category)
    .first<{ metrics_fingerprint: string | null }>();
  const fp = str(row?.metrics_fingerprint);
  return fp || null;
}

export async function latestRootMcReportBefore(
  db: D1Database,
  userId: string,
  worldKey: string,
): Promise<{ id: string; summary_text: string; report_text: string; created_at: string } | null> {
  const row = await db
    .prepare(
      `SELECT id, summary_text, report_text, created_at FROM rootmc_world_ai_reports
       WHERE user_id = ? AND world_key = ?
       ORDER BY created_at DESC LIMIT 1`,
    )
    .bind(userId, worldKey)
    .first<{ id: string; summary_text: string; report_text: string; created_at: string }>();
  return row?.id ? row : null;
}
