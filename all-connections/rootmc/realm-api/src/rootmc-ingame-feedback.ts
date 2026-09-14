/**
 * In-game /feedback — Slack #feedback for staff + D1 queue Ava drains when online.
 */

import type { D1Database } from "@cloudflare/workers-types";

import { json } from "./cors";
import { record, str } from "./realm-lib";
import type { RootStatEnv } from "./rootstat-minecraft";
import { validateServerAuth } from "./rootstat-minecraft";
import {
  postSlackIncomingWebhook,
  slackFeedbackChannelId,
  slackFeedbackWebhook,
} from "./slack-incoming-webhook";
import { validateDevWorkstationAuth, type DevWorkstationEnv } from "./rootmc-dev-workstation";

type FeedbackEnv = RootStatEnv &
  DevWorkstationEnv & {
    SLACK_FEEDBACK_WEBHOOK_URL?: string;
    SLACK_FEEDBACK_CHANNEL_ID?: string;
  };

function stripMcColors(text: string): string {
  return text.replace(/§[0-9a-fk-or]/gi, "").replace(/&[0-9a-fk-or]/gi, "").trim();
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, Math.max(0, max - 3)) + "...";
}

function safeText(s: string): string {
  return s.replace(/```/g, "'''").replace(/\r\n/g, "\n").trim();
}

function nowIso(): string {
  return new Date().toISOString();
}

async function nextFeedbackId(db: D1Database): Promise<string> {
  try {
    const { results } = await db
      .prepare(`SELECT id FROM rootmc_ingame_feedback WHERE id LIKE 'FB-%'`)
      .all<{ id: string }>();
    let max = 0;
    for (const row of results || []) {
      const m = /^FB-(\d+)$/i.exec(str(row.id));
      if (m) max = Math.max(max, Number(m[1]) || 0);
    }
    return `FB-${String(max + 1).padStart(2, "0")}`;
  } catch {
    return `FB-${crypto.randomUUID().slice(0, 8)}`;
  }
}

type FeedbackRow = {
  id: string;
  minecraft_uuid: string;
  minecraft_username: string;
  server_id: string | null;
  server_name: string | null;
  message: string;
  status: string;
  created_at: string;
};

/**
 * POST /api/rootmc/ingame-feedback — server-authenticated in-game player feedback.
 * Body: { uuid, username, message, server_name? }
 */
export async function handleRootMcIngameFeedback(
  request: Request,
  env: FeedbackEnv,
  subpath: string,
  method: string,
): Promise<Response | null> {
  if (!subpath.startsWith("/rootmc/ingame-feedback")) return null;

  if (method !== "POST" || subpath !== "/rootmc/ingame-feedback") {
    return json({ detail: "Not Found" }, 404);
  }

  const server = await validateServerAuth(env, request);
  if (server instanceof Response) return server;

  let body: Record<string, unknown>;
  try {
    body = record(JSON.parse(await request.text()));
  } catch {
    return json({ detail: "Invalid JSON body." }, 400);
  }

  const uuid = stripMcColors(str(body.uuid));
  const username = stripMcColors(str(body.username));
  const message = safeText(stripMcColors(str(body.message)));
  let serverName = stripMcColors(str(body.server_name) || str(body.world));

  if (!uuid || !username) {
    return json({ detail: "uuid and username are required." }, 400);
  }
  if (!message) {
    return json({ detail: "message is required." }, 400);
  }

  if (!serverName) {
    try {
      const row = await env.DB.prepare(
        `SELECT server_name FROM rootstat_servers WHERE server_id = ? LIMIT 1`,
      )
        .bind(server.serverId)
        .first<{ server_name: string | null }>();
      serverName = stripMcColors(str(row?.server_name));
    } catch {
      // optional lookup
    }
  }

  const feedbackId = await nextFeedbackId(env.DB);
  const createdAt = nowIso();
  let queued = false;
  try {
    await env.DB.prepare(
      `INSERT INTO rootmc_ingame_feedback
         (id, minecraft_uuid, minecraft_username, server_id, server_name, message, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 'queued', ?, ?)`,
    )
      .bind(
        feedbackId,
        uuid.toLowerCase(),
        username,
        server.serverId,
        serverName || null,
        truncate(message, 3500),
        createdAt,
        createdAt,
      )
      .run();
    queued = true;
  } catch (e) {
    console.warn("ingame_feedback_queue_insert", e instanceof Error ? e.message : String(e));
  }

  const webhook = slackFeedbackWebhook(env);
  const channelId = slackFeedbackChannelId(env);
  if (!webhook) {
    if (queued) {
      return json({
        ok: true,
        feedback_id: feedbackId,
        queued: true,
        destination: "ava_queue",
        detail: "Queued for Ava (Slack webhook not configured).",
      });
    }
    return json({ detail: "In-game feedback is not configured on the API (Slack webhook)." }, 503);
  }

  let text =
    `*In-game feedback* (\`${feedbackId}\`)\n` +
    `*Player:* ${username}\n` +
    `*UUID:* \`${uuid}\`\n` +
    `*Server ID:* \`${server.serverId}\``;
  if (serverName) text += `\n*Server:* ${serverName}`;
  text += `\n\n*Message:*\n${truncate(message, 3200)}`;
  if (queued) text += `\n\n_Also queued for Ava._`;

  const posted = await postSlackIncomingWebhook(webhook, { text: truncate(text, 3900) });
  if (!posted.ok) {
    console.warn("ingame_feedback_slack_post_failed", posted.status, posted.body);
    if (queued) {
      return json({
        ok: true,
        feedback_id: feedbackId,
        queued: true,
        destination: "ava_queue",
        detail: "Queued for Ava (Slack delivery failed).",
      });
    }
    return json({ detail: "Could not deliver feedback. Try again later." }, 502);
  }

  return json(
    {
      ok: true,
      feedback_id: queued ? feedbackId : null,
      queued,
      channel_id: channelId,
      destination: queued ? "slack+ava_queue" : "slack",
    },
    200,
  );
}

/** Ava / workstation — GET/POST under /api/governance/feedback-inbox* */
export async function handleFeedbackInboxRoutes(
  request: Request,
  env: FeedbackEnv,
  rest: string,
  method: string,
): Promise<Response | null> {
  if (!rest.startsWith("feedback-inbox")) return null;

  if (!validateDevWorkstationAuth(request, env)) {
    return json({ detail: "Unauthorized." }, 401);
  }

  if (method === "GET" && (rest === "feedback-inbox" || rest === "feedback-inbox/")) {
    const url = new URL(request.url);
    const status = str(url.searchParams.get("status")) || "queued";
    const limit = Math.min(50, Math.max(1, Number(url.searchParams.get("limit") || 20) || 20));
    try {
      const { results } = await env.DB.prepare(
        `SELECT id, minecraft_uuid, minecraft_username, server_id, server_name, message, status,
                ava_note, error_detail, created_at, claimed_at, processed_at
         FROM rootmc_ingame_feedback
         WHERE status = ?
         ORDER BY created_at ASC
         LIMIT ?`,
      )
        .bind(status, limit)
        .all<Record<string, unknown>>();
      return json({ ok: true, feedback: results || [] });
    } catch (e) {
      return json({
        ok: false,
        detail: e instanceof Error ? e.message : String(e),
        feedback: [],
      });
    }
  }

  const ackMatch = rest.match(/^feedback-inbox\/([^/]+)\/ack\/?$/);
  if (method === "POST" && ackMatch) {
    const id = decodeURIComponent(ackMatch[1]);
    let body: { ava_note?: string } = {};
    try {
      body = JSON.parse(await request.text()) as { ava_note?: string };
    } catch {
      body = {};
    }
    const note = truncate(str(body.ava_note) || "Seen by Ava.", 500);
    const doneAt = nowIso();
    const res = await env.DB.prepare(
      `UPDATE rootmc_ingame_feedback
       SET status = 'seen', ava_note = ?, processed_at = ?, updated_at = ?, claimed_at = COALESCE(claimed_at, ?)
       WHERE id = ? AND status IN ('queued', 'processing')`,
    )
      .bind(note, doneAt, doneAt, doneAt, id)
      .run();
    if (!(res.meta?.changes ?? 0)) {
      const existing = await env.DB.prepare(
        `SELECT id, status, ava_note FROM rootmc_ingame_feedback WHERE id = ? LIMIT 1`,
      )
        .bind(id)
        .first<{ id: string; status: string; ava_note: string | null }>();
      if (!existing) return json({ ok: false, detail: "not_found" }, 404);
      return json({ ok: true, already: true, feedback_id: existing.id, status: existing.status });
    }
    return json({ ok: true, feedback_id: id, status: "seen", ava_note: note });
  }

  if (method === "POST" && (rest === "feedback-inbox/process-next" || rest === "feedback-inbox/process-next/")) {
    const row = await env.DB.prepare(
      `SELECT id, minecraft_uuid, minecraft_username, server_id, server_name, message, status, created_at
       FROM rootmc_ingame_feedback
       WHERE status = 'queued'
       ORDER BY created_at ASC
       LIMIT 1`,
    ).first<FeedbackRow>();
    if (!row) {
      return json({ ok: true, empty: true, detail: "No queued feedback." });
    }
    const claimedAt = nowIso();
    await env.DB.prepare(
      `UPDATE rootmc_ingame_feedback
       SET status = 'processing', claimed_at = ?, updated_at = ?
       WHERE id = ? AND status = 'queued'`,
    )
      .bind(claimedAt, claimedAt, row.id)
      .run();

    return json({
      ok: true,
      empty: false,
      feedback: {
        id: row.id,
        minecraft_uuid: row.minecraft_uuid,
        minecraft_username: row.minecraft_username,
        server_id: row.server_id,
        server_name: row.server_name,
        message: row.message,
        created_at: row.created_at,
      },
    });
  }

  return json({ detail: "Not Found" }, 404);
}
