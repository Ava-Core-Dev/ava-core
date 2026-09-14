import { json } from "./cors";
import { extractAuthToken, sessionFromRequest, type AuthEnv } from "./primary-auth";

export type FeedbackEnv = AuthEnv & {
  /** Preferred: Discord bot posts feedback to this channel. Defaults to the Kilauea feedback channel. */
  DISCORD_FEEDBACK_CHANNEL_ID?: string;
  DISCORD_BOT_TOKEN?: string;
  /** Fallback: `wrangler secret put DISCORD_FEEDBACK_WEBHOOK_URL` — Discord incoming webhook. */
  DISCORD_FEEDBACK_WEBHOOK_URL?: string;
};

const DEFAULT_FEEDBACK_CHANNEL_ID = "1499515809767096443";

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, Math.max(0, max - 3)) + "...";
}

/** Avoid breaking Discord embed markdown. */
function safeText(s: string): string {
  return s.replace(/```/g, "'''").replace(/\r\n/g, "\n").trim();
}

/**
 * POST /api/feedback — authenticated; forwards to Discord (no D1).
 * Body: { type?, message, reply_email?, include_diagnostics?, app_id? }
 */
export async function handleFeedbackRoute(
  request: Request,
  env: FeedbackEnv,
  sub: string,
  method: string
): Promise<Response | null> {
  if (sub !== "/feedback" || method !== "POST") return null;

  const sess = await sessionFromRequest(env, request);
  if (!sess) {
    return json({ detail: extractAuthToken(request) ? "Unauthorized" : "Missing token" }, 401);
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return json({ detail: "Invalid JSON" }, 400);
  }

  const type = truncate(String(body.type || "general").replace(/[\n\r]/g, " "), 80);
  const message = safeText(String(body.message || ""));
  if (!message) return json({ detail: "message is required" }, 400);

  const replyEmail = body.reply_email != null ? String(body.reply_email).trim().slice(0, 320) : "";
  const appId = truncate(String(body.app_id || "unknown").replace(/[\n\r]/g, " "), 160);
  const includeDiag = Boolean(body.include_diagnostics);
  const ua = truncate((request.headers.get("User-Agent") || "").replace(/[\n\r]/g, " "), 500);

  let desc =
    `**Type:** ${type}\n` +
    `**App:** ${appId}\n` +
    `**Account:** ${sess.email}\n` +
    `**Account ID:** ${sess.accountId}`;
  if (replyEmail) desc += `\n**Reply-to:** ${replyEmail}`;
  if (includeDiag) desc += `\n**User-Agent:** ${ua || "—"}`;
  desc += `\n\n**Message:**\n${truncate(message, 3200)}`;

  const embed = {
    title: "In-app feedback",
    description: truncate(desc, 4000),
    color: 0x2b8a8f,
    timestamp: new Date().toISOString(),
  };

  const delivery = await postFeedbackToDiscord(env, { embeds: [embed] });

  if (!delivery.ok) {
    console.error("feedback discord", delivery.status, delivery.detail.slice(0, 400));
    return json({ detail: delivery.detailForUser }, delivery.status);
  }

  return json({ ok: true, delivered: delivery.delivered }, 200);
}

async function postFeedbackToDiscord(
  env: FeedbackEnv,
  payload: { embeds: unknown[] },
): Promise<
  | { ok: true; delivered: "discord_channel" | "discord_webhook" }
  | { ok: false; status: number; detail: string; detailForUser: string }
> {
  const token = String(env.DISCORD_KILAUEA_BOT_TOKEN || env.DISCORD_BOT_TOKEN || "").replace(/^bot\s+/i, "").trim();
  const channelId = String(env.DISCORD_FEEDBACK_CHANNEL_ID || DEFAULT_FEEDBACK_CHANNEL_ID).trim();
  if (token && channelId) {
    const res = await fetch(
      `https://discord.com/api/v10/channels/${encodeURIComponent(channelId)}/messages`,
      {
        method: "POST",
        headers: {
          Authorization: `Bot ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      },
    );
    if (res.ok) return { ok: true, delivered: "discord_channel" };
    const text = await res.text().catch(() => "");
    return {
      ok: false,
      status: 502,
      detail: `channel ${channelId} http_${res.status} ${text}`,
      detailForUser: "Could not deliver feedback. Try again later.",
    };
  }

  const webhook = (env.DISCORD_FEEDBACK_WEBHOOK_URL || "").trim();
  const whOk =
    webhook.startsWith("https://discord.com/api/webhooks/") ||
    webhook.startsWith("https://discordapp.com/api/webhooks/");
  if (!whOk) {
    return {
      ok: false,
      status: 503,
      detail:
        "DISCORD_BOT_TOKEN/DISCORD_FEEDBACK_CHANNEL_ID and DISCORD_FEEDBACK_WEBHOOK_URL missing or invalid",
      detailForUser: "Feedback delivery is not configured. Try again later.",
    };
  }

  const res = await fetch(webhook, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      username: "RootRecord Feedback",
      embeds: payload.embeds,
    }),
  });
  if (res.ok) return { ok: true, delivered: "discord_webhook" };
  const text = await res.text().catch(() => "");
  return {
    ok: false,
    status: 502,
    detail: `webhook http_${res.status} ${text}`,
    detailForUser: "Could not deliver feedback. Try again later.",
  };
}
