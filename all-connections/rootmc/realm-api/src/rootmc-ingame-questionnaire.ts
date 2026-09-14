import { json } from "./cors";
import { record, str } from "./realm-lib";
import type { RootStatEnv } from "./rootstat-minecraft";
import { validateServerAuth } from "./rootstat-minecraft";
import {
  postSlackIncomingWebhook,
  slackFeedbackChannelId,
  slackFeedbackWebhook,
} from "./slack-incoming-webhook";

type QuestionnaireEnv = RootStatEnv & {
  SLACK_FEEDBACK_WEBHOOK_URL?: string;
  SLACK_FEEDBACK_CHANNEL_ID?: string;
};

type AnswerRow = { id?: string; question?: string; answer?: string };

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

/**
 * POST /api/rootmc/ingame-questionnaire — server-authenticated one-time survey → Slack #feedback.
 * Body: { uuid, username, world?, answers: [{ id, question, answer }] }
 */
export async function handleRootMcIngameQuestionnaire(
  request: Request,
  env: QuestionnaireEnv,
  subpath: string,
  method: string,
): Promise<Response | null> {
  if (!subpath.startsWith("/rootmc/ingame-questionnaire")) return null;

  if (method !== "POST" || subpath !== "/rootmc/ingame-questionnaire") {
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
  const answersRaw = body.answers;

  if (!uuid || !username) {
    return json({ detail: "uuid and username are required." }, 400);
  }
  if (!Array.isArray(answersRaw) || answersRaw.length === 0) {
    return json({ detail: "answers array is required." }, 400);
  }

  const webhook = slackFeedbackWebhook(env);
  const channelId = slackFeedbackChannelId(env);
  if (!webhook) {
    return json({ detail: "In-game questionnaire is not configured on the API (Slack webhook)." }, 503);
  }

  const lines = (answersRaw as AnswerRow[]).slice(0, 25).map((row, index) => {
    const answer = record(row as Record<string, unknown>);
    const question = truncate(safeText(stripMcColors(str(answer.question || answer.id || `Q${index + 1}`))), 256);
    const value = truncate(safeText(stripMcColors(str(answer.answer))), 1024);
    return `• *${question}*\n  ${value || "(empty)"}`;
  });

  let text =
    `*Player questionnaire*\n` +
    `*Player:* ${username}\n` +
    `*UUID:* \`${uuid}\`\n` +
    `*Server ID:* \`${server.serverId}\``;
  if (world) text += `\n*World:* ${world}`;
  text += `\n\n${lines.join("\n")}`;

  const posted = await postSlackIncomingWebhook(webhook, { text: truncate(text, 3900) });
  if (!posted.ok) {
    console.warn("ingame_questionnaire_slack_post_failed", posted.status, posted.body);
    return json({ detail: "Could not deliver questionnaire. Try again later." }, 502);
  }

  return json({ ok: true, channel_id: channelId, destination: "slack" }, 200);
}
