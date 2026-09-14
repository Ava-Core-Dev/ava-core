import { json } from "./cors";
import { extractAuthToken, sessionFromRequest, type AuthEnv } from "./primary-auth";

export type FeedbackEnv = AuthEnv & {
  /** `wrangler secret put DISCORD_FEEDBACK_WEBHOOK_URL` — Discord incoming webhook (https://discord.com/api/webhooks/...). */
  DISCORD_FEEDBACK_WEBHOOK_URL?: string;
};

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, Math.max(0, max - 3)) + "...";
}

/** Avoid breaking Discord embed markdown. */
function safeText(s: string): string {
  return s.replace(/```/g, "'''").replace(/\r\n/g, "\n").trim();
}

/**
 * POST /api/feedback — authenticated; forwards to Discord webhook (no D1).
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

  const webhook = (env.DISCORD_FEEDBACK_WEBHOOK_URL || "").trim();
  const whOk =
    webhook.startsWith("https://discord.com/api/webhooks/") ||
    webhook.startsWith("https://discordapp.com/api/webhooks/");
  if (!whOk) {
    console.error("feedback: DISCORD_FEEDBACK_WEBHOOK_URL missing or invalid");
    return json({ detail: "Feedback delivery is not configured. Try again later." }, 503);
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

  const discordRes = await fetch(webhook, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      username: "RootRecord Feedback",
      embeds: [embed],
    }),
  });

  if (!discordRes.ok) {
    const errText = await discordRes.text().catch(() => "");
    console.error("feedback discord", discordRes.status, errText.slice(0, 400));
    return json({ detail: "Could not deliver feedback. Try again later." }, 502);
  }

  return json({ ok: true, delivered: "discord" }, 200);
}
