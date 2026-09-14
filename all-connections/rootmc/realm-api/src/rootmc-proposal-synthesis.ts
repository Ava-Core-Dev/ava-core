/**
 * Grok synthesis  -  Discord proposal/bill thread discussion -> generalized bill text.
 */

import type { D1Database } from "@cloudflare/workers-types";

import { discordBotFetch, sendChannelMessage } from "./discord-rootmc-api";
import { callGrokJsonObject, type RootMcAiEnv } from "./rootmc-world-ai";

export type ProposalSynthesisEnv = RootMcAiEnv & {
  DB: D1Database;
  DISCORD_ROOTMC_BOT_TOKEN?: string;
};

const ITEM_SYNTHESIS_PROMPT =
  "You are the RootMC legislature clerk. Players discuss citizen proposals in Discord threads. " +
  "Currency is Gold. Merge the original submission with thread discussion into one clear, neutral policy proposal " +
  "suitable for a weekly bill and Council weighted vote. Preserve concrete numbers and plugin names when stated. " +
  "Do not invent rules. Return JSON only: " +
  '{"synthesized_description":"<=2400 chars markdown","discussion_summary":"<=400 chars"}';

const BILL_SYNTHESIS_PROMPT =
  "You are the RootMC legislature clerk. Merge a weekly bill draft, formal amendments, and Discord thread discussion " +
  "into one final bill text for Council vote. Currency is Gold. Be precise; do not invent policy. " +
  'Return JSON only: {"synthesized_description":"<=3900 chars markdown","discussion_summary":"<=400 chars"}';

function str(v: unknown): string {
  return String(v ?? "").trim();
}

function nowIso(): string {
  return new Date().toISOString();
}

function effectiveItemDescription(row: Record<string, unknown>): string {
  return str(row.synthesized_description) || str(row.description);
}

export function effectiveBillDescription(row: Record<string, unknown>): string {
  return str(row.synthesized_description) || str(row.description);
}

async function fetchThreadMessages(token: string, threadId: string, limit = 80): Promise<string[]> {
  const res = await discordBotFetch(
    token,
    `/channels/${encodeURIComponent(threadId)}/messages?limit=${Math.min(100, limit)}`,
  );
  if (!res.ok) return [];
  const msgs = (await res.json()) as Array<{ content?: string; author?: { username?: string; bot?: boolean } }>;
  const lines: string[] = [];
  for (const msg of (msgs || []).reverse()) {
    if (msg.author?.bot) continue;
    const body = str(msg.content);
    if (!body || body.startsWith("📋") || body.startsWith("📜")) continue;
    lines.push(`**${str(msg.author?.username) || "player"}:** ${body.slice(0, 900)}`);
  }
  return lines;
}

export async function synthesizeLegislationItem(
  env: ProposalSynthesisEnv,
  itemId: string,
  opts: { postToThread?: boolean } = {},
): Promise<{ ok: boolean; detail: string; messageCount?: number }> {
  const token = str(env.DISCORD_ROOTMC_BOT_TOKEN);
  const row = await env.DB.prepare(`SELECT * FROM rootmc_legislation_items WHERE id = ? LIMIT 1`)
    .bind(itemId)
    .first<Record<string, unknown>>();
  if (!row) return { ok: false, detail: "Unknown item." };
  if (str(row.status) !== "pending") {
    return { ok: false, detail: "Item not pending synthesis." };
  }

  const threadId = str(row.discord_thread_id);
  const threadLines = token && threadId ? await fetchThreadMessages(token, threadId) : [];

  const aiRes = await callGrokJsonObject(
    env,
    ITEM_SYNTHESIS_PROMPT,
    {
      item_id: itemId,
      title: str(row.title),
      category: str(row.category),
      author: str(row.minecraft_username),
      original_description: str(row.description),
      thread_messages: threadLines.slice(-40),
      thread_message_count: threadLines.length,
    },
    { temperature: 0.15 },
  );

  if (!aiRes.ok) {
    return { ok: false, detail: str(aiRes.detail) || "Discussion synthesis failed." };
  }

  const synthesized = str(aiRes.synthesized_description).slice(0, 4000);
  if (!synthesized) return { ok: false, detail: "Empty synthesis." };

  const at = nowIso();
  await env.DB.prepare(
    `UPDATE rootmc_legislation_items
     SET synthesized_description = ?, synthesis_at = ?, synthesis_message_count = ?
     WHERE id = ?`,
  )
    .bind(synthesized, at, threadLines.length, itemId)
    .run();

  if (opts.postToThread && token && threadId) {
    const summary = str(aiRes.discussion_summary);
    await sendChannelMessage(token, threadId, {
      content: [
        "🤖 **Discussion synthesized** for weekly bill compilation",
        summary ? `_Summary:_ ${summary.slice(0, 500)}` : "",
        `_Updated proposal text is on https://rootmc.net/governance/proposal/?id=${itemId}_`,
      ]
        .filter(Boolean)
        .join("\n"),
    });
  }

  return { ok: true, detail: `Synthesized **${itemId}** (${threadLines.length} thread messages).`, messageCount: threadLines.length };
}

export async function synthesizePendingItemsForWeek(
  env: ProposalSynthesisEnv,
  weekKey: string,
  itemIds?: string[],
): Promise<{ synthesized: number; skipped: number }> {
  let sql = `SELECT id FROM rootmc_legislation_items WHERE week_key = ? AND status = 'pending'`;
  const binds: unknown[] = [weekKey];
  if (itemIds?.length) {
    sql += ` AND id IN (${itemIds.map(() => "?").join(",")})`;
    binds.push(...itemIds);
  }
  const { results } = await env.DB.prepare(sql).bind(...binds).all<{ id: string }>();

  let synthesized = 0;
  let skipped = 0;
  for (const row of results || []) {
    const id = str(row.id);
    const res = await synthesizeLegislationItem(env, id, { postToThread: true }).catch(() => ({
      ok: false,
      detail: "error",
    }));
    if (res.ok) synthesized += 1;
    else skipped += 1;
  }
  return { synthesized, skipped };
}

export async function synthesizeWeeklyBill(
  env: ProposalSynthesisEnv,
  billId: string,
): Promise<{ ok: boolean; detail: string }> {
  const token = str(env.DISCORD_ROOTMC_BOT_TOKEN);
  const bill = await env.DB.prepare(`SELECT * FROM rootmc_weekly_bills WHERE id = ? LIMIT 1`)
    .bind(billId)
    .first<Record<string, unknown>>();
  if (!bill) return { ok: false, detail: "Unknown bill." };

  const { results: items } = await env.DB.prepare(
    `SELECT id, title, category, description, synthesized_description, minecraft_username
     FROM rootmc_legislation_items WHERE bill_id = ? ORDER BY submit_weight DESC`,
  )
    .bind(billId)
    .all<Record<string, unknown>>();

  const { results: amendments } = await env.DB.prepare(
    `SELECT amendment_text, minecraft_username, item_id FROM rootmc_bill_amendments WHERE bill_id = ? ORDER BY created_at ASC`,
  )
    .bind(billId)
    .all<Record<string, unknown>>();

  const threadId = str(bill.discord_thread_id);
  const threadLines = token && threadId ? await fetchThreadMessages(token, threadId) : [];

  const aiRes = await callGrokJsonObject(
    env,
    BILL_SYNTHESIS_PROMPT,
    {
      bill_id: billId,
      week_key: str(bill.week_key),
      draft_description: str(bill.description),
      items: (items || []).map((i) => ({
        id: str(i.id),
        title: str(i.title),
        category: str(i.category),
        author: str(i.minecraft_username),
        text: effectiveItemDescription(i),
      })),
      amendments: (amendments || []).map((a) => ({
        author: str(a.minecraft_username),
        item_id: str(a.item_id) || null,
        text: str(a.amendment_text),
      })),
      thread_messages: threadLines.slice(-50),
    },
    { temperature: 0.12 },
  );

  if (!aiRes.ok) {
    return { ok: false, detail: str(aiRes.detail) || "Bill synthesis failed." };
  }

  const synthesized = str(aiRes.synthesized_description).slice(0, 3900);
  if (!synthesized) return { ok: false, detail: "Empty bill synthesis." };

  await env.DB.prepare(
    `UPDATE rootmc_weekly_bills SET synthesized_description = ?, synthesis_at = ? WHERE id = ?`,
  )
    .bind(synthesized, nowIso(), billId)
    .run();

  if (token && threadId) {
    await sendChannelMessage(token, threadId, {
      content: [
        "🤖 **Final bill text synthesized** from discussion + amendments  -  Council vote uses this version.",
        `_View: https://rootmc.net/governance/bill/?id=${billId}_`,
      ].join("\n"),
    });
  }

  return { ok: true, detail: `Bill **${billId}** synthesized.` };
}

export { effectiveItemDescription };
