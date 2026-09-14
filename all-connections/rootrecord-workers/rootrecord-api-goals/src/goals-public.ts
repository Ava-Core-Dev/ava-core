import type { D1Database } from "@cloudflare/workers-types";

import { json } from "./cors";
import { AI_DISCLAIMER } from "./goals-ai";
import { publicGoalPage } from "./goal-funding";

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

function publicGoalCard(row: Record<string, unknown>) {
  return {
    slug: row.slug,
    title: row.title,
    target_date_est: row.target_date_est,
    ai_summary_text: row.ai_summary_text,
    updated_at: row.updated_at,
  };
}

function publicGoalDetail(row: Record<string, unknown>) {
  return publicGoalPage(row, {
    user_steps_summary: row.user_steps_summary,
    ai_plan: row.ai_plan_json ? JSON.parse(String(row.ai_plan_json)) : null,
    min_days: row.min_days,
    max_days: row.max_days,
  });
}

async function userIdForSolanaAddress(db: D1Database, address: string): Promise<string | null> {
  const row = await db
    .prepare(
      `SELECT ua.id AS account_id
       FROM internal_solana_wallets iw
       JOIN user_accounts ua ON ua.account_id = iw.account_id
       WHERE LOWER(iw.pubkey) = LOWER(?)
       LIMIT 1`,
    )
    .bind(address)
    .first<{ account_id: string }>();
  if (!row?.account_id) return null;
  const acct = await db
    .prepare(`SELECT email FROM user_accounts WHERE account_id = ? LIMIT 1`)
    .bind(row.account_id)
    .first<{ email: string }>();
  const email = str(acct?.email).toLowerCase();
  return email ? `user:${email}` : null;
}

export async function handlePublicGoals(
  env: { DB: D1Database },
  solanaAddress: string,
  slug?: string,
): Promise<Response> {
  const addr = solanaAddress.replace(/[^1-9A-HJ-NP-Za-km-z]/g, "").slice(0, 64);
  if (addr.length < 32) return json({ detail: "Invalid Solana address." }, 400);

  const userId = await userIdForSolanaAddress(env.DB, addr);
  if (!userId) return json({ detail: "No public goals profile for this address." }, 404);

  if (slug) {
    const row = await env.DB.prepare(
      `SELECT * FROM rg_goals WHERE user_id = ? AND slug = ? AND deleted_at IS NULL AND public_enabled = 1`,
    )
      .bind(userId, slug)
      .first<Record<string, unknown>>();
    if (!row) return json({ detail: "Goal not found or not public." }, 404);
    return json({ address: addr, goal: publicGoalDetail(row), disclaimer: AI_DISCLAIMER });
  }

  const rows = await env.DB.prepare(
    `SELECT slug, title, purpose, target_date_est, ai_summary_text, updated_at, user_steps_summary, estimated_cost_cents, ai_plan_json, min_days, max_days
     FROM rg_goals WHERE user_id = ? AND deleted_at IS NULL AND public_enabled = 1 ORDER BY updated_at DESC`,
  )
    .bind(userId)
    .all();
  const goals = (rows.results ?? []).map((r) => publicGoalCard(r as Record<string, unknown>));
  return json({ address: addr, goals, disclaimer: AI_DISCLAIMER });
}
