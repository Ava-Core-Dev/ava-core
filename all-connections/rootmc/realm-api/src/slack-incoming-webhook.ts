/**
 * Post to a Slack Incoming Webhook (hooks.slack.com).
 * Prefer this over Discord for migrated ops destinations.
 */
export async function postSlackIncomingWebhook(
  webhookUrl: string,
  payload: { text?: string; blocks?: unknown[]; attachments?: unknown[] },
): Promise<{ ok: boolean; status: number; body: string }> {
  const url = String(webhookUrl || "").trim();
  if (!/^https:\/\/hooks\.slack\.com\/services\//i.test(url)) {
    return { ok: false, status: 0, body: "invalid_webhook_url" };
  }
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify(payload),
  });
  const body = await res.text().catch(() => "");
  // Incoming Webhooks return plain text "ok" on success.
  return { ok: res.ok && body.trim() === "ok", status: res.status, body: body.slice(0, 400) };
}

export function slackFeedbackWebhook(env: { SLACK_FEEDBACK_WEBHOOK_URL?: string }): string {
  return String(env.SLACK_FEEDBACK_WEBHOOK_URL || "").trim();
}

/** Default: Slack #feedback (migrated from Discord 1516828735536365669). */
export function slackFeedbackChannelId(env: { SLACK_FEEDBACK_CHANNEL_ID?: string }): string {
  return String(env.SLACK_FEEDBACK_CHANNEL_ID || "").trim() || "C0BLMGBVAMD";
}
