import { json } from "./cors";
import { extractAuthToken, sessionFromRequest, type AuthEnv } from "./primary-auth";
import { resolveDiscordChannel } from "./rootmc-discord-channels";

export type RootMcFeedbackEnv = AuthEnv & {
  DISCORD_FEEDBACK_CHANNEL_ID?: string;
  DISCORD_ROOTMC_BOT_TOKEN?: string;
  /** Fallback: `wrangler secret put DISCORD_ROOTMC_WEBHOOK_URL` */
  DISCORD_ROOTMC_WEBHOOK_URL?: string;
};

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, Math.max(0, max - 3)) + "...";
}

function safeText(s: string): string {
  return s.replace(/```/g, "'''").replace(/\r\n/g, "\n").trim();
}

function guestIdFromRequest(request: Request): string | null {
  const guest = (request.headers.get("X-Guest-Id") || "").replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 64);
  return guest || null;
}

/**
 * POST /api/feedback  -  guest (X-Guest-Id) or authenticated session; forwards to Discord (no D1).
 * Body: { type?, message, reply_email?, include_diagnostics?, app_id? }
 */
export async function handleRootMcFeedbackRoute(
  request: Request,
  env: RootMcFeedbackEnv,
  sub: string,
  method: string,
): Promise<Response | null> {
  if (sub !== "/feedback" || method !== "POST") return null;

  const sess = await sessionFromRequest(env, request);
  const guestId = guestIdFromRequest(request);
  if (!sess && !guestId) {
    return json(
      {
        detail: extractAuthToken(request)
          ? "Unauthorized"
          : "Sign in or send X-Guest-Id header for guest feedback.",
      },
      401,
    );
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
  const appId = truncate(String(body.app_id || "rootmc").replace(/[\n\r]/g, " "), 160);
  const includeDiag = Boolean(body.include_diagnostics);
  const ua = truncate((request.headers.get("User-Agent") || "").replace(/[\n\r]/g, " "), 500);

  let desc =
    `**Type:** ${type}\n` +
    `**App:** ${appId}\n` +
    (sess
      ? `**Account:** ${sess.email}\n**Account ID:** ${sess.accountId}`
      : `**Guest ID:** ${guestId}`);
  if (replyEmail) desc += `\n**Reply-to:** ${replyEmail}`;
  if (includeDiag) desc += `\n**User-Agent:** ${ua || " - "}`;
  desc += `\n\n**Message:**\n${truncate(message, 3200)}`;

  const embed = {
    title: sess ? "RootMc feedback (signed in)" : "RootMc feedback (guest)",
    description: truncate(desc, 4000),
    color: 0x5865f2,
    timestamp: new Date().toISOString(),
  };

  const delivery = await postFeedbackToDiscord(env, { embeds: [embed] });

  if (!delivery.ok) {
    console.error("rootmc feedback discord", delivery.status, delivery.detail.slice(0, 400));
    return json({ detail: delivery.detailForUser }, delivery.status);
  }

  return json({ ok: true, delivered: delivery.delivered, guest: !sess }, 200);
}

async function postFeedbackToDiscord(
  env: RootMcFeedbackEnv,
  payload: { embeds: unknown[] },
): Promise<
  | { ok: true; delivered: "discord_channel" | "discord_webhook" }
  | { ok: false; status: number; detail: string; detailForUser: string }
> {
  const token = String(env.DISCORD_ROOTMC_BOT_TOKEN || "")
    .replace(/^bot\s+/i, "")
    .trim();
  const channelId = resolveDiscordChannel(env, "feedback");
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

  const webhook = (env.DISCORD_ROOTMC_WEBHOOK_URL || "").trim();
  const whOk =
    webhook.startsWith("https://discord.com/api/webhooks/") ||
    webhook.startsWith("https://discordapp.com/api/webhooks/");
  if (!whOk) {
    return {
      ok: false,
      status: 503,
      detail: "DISCORD_ROOTMC_BOT_TOKEN + channel or DISCORD_ROOTMC_WEBHOOK_URL not configured",
      detailForUser: "Feedback delivery is not configured. Try again later.",
    };
  }

  const res = await fetch(webhook, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      username: "RootRecord RootMc",
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
