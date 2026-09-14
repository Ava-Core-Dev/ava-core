import { json } from "./cors";
import { record, str } from "./realm-lib";
import type { RootStatEnv } from "./rootstat-minecraft";
import { validateServerAuth } from "./rootstat-minecraft";
import {
  postSlackIncomingWebhook,
  slackFeedbackChannelId,
  slackFeedbackWebhook,
} from "./slack-incoming-webhook";

type ReportEnv = RootStatEnv & {
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

/**
 * POST /api/rootmc/command-test-report — per-command onboarding test notes → Slack #feedback.
 */
export async function handleRootMcCommandTestReport(
  request: Request,
  env: ReportEnv,
  subpath: string,
  method: string,
): Promise<Response | null> {
  if (!subpath.startsWith("/rootmc/command-test-report")) return null;

  if (method !== "POST" || subpath !== "/rootmc/command-test-report") {
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
  const world = stripMcColors(str(body.world));
  const testKey = stripMcColors(str(body.test_key));
  const command = stripMcColors(str(body.command));
  const note = stripMcColors(str(body.note));
  const completed = Number(body.completed) || 0;
  const total = Number(body.total) || 0;

  if (!uuid || !username || !testKey) {
    return json({ detail: "uuid, username, and test_key are required." }, 400);
  }

  const webhook = slackFeedbackWebhook(env);
  const channelId = slackFeedbackChannelId(env);
  if (!webhook) {
    return json({ detail: "Command test reports are not configured on the API (Slack webhook)." }, 503);
  }

  let text =
    `*Command test report*\n` +
    `*Player:* ${username}\n` +
    `*UUID:* \`${uuid}\`\n` +
    `*Progress:* ${completed}/${total}\n` +
    `*Command key:* \`${testKey}\`\n` +
    `*Catalog:* ${command || testKey}`;
  if (world) text += `\n*World:* ${world}`;
  if (note) text += `\n\n*Note:*\n${truncate(note, 2800)}`;

  const posted = await postSlackIncomingWebhook(webhook, { text: truncate(text, 3900) });
  if (!posted.ok) {
    console.warn("command_test_report_slack_failed", posted.status, posted.body);
    return json({ detail: "Could not deliver report. Try again later." }, 502);
  }

  return json({ ok: true, channel_id: channelId, destination: "slack" }, 200);
}
