/** Mirror Discord intelligence reports to Slack #server-reports after Discord succeeds. */

import { postSlackIncomingWebhook } from "./slack-incoming-webhook";

export type SlackReportMirrorEnv = {
  SLACK_SERVER_REPORTS_WEBHOOK_URL?: string;
  SLACK_SERVER_REPORTS_CHANNEL_ID?: string;
};

export const ROOTMC_SLACK_SERVER_REPORTS_CHANNEL_ID = "C0BLY49H13M";

const SLACK_TEXT_CHUNK = 3500;

function str(v: unknown): string {
  return String(v ?? "").trim();
}

/** Light Discord-markdown → Slack mrkdwn for Incoming Webhook text. */
export function discordMarkdownToSlackMrkdwn(markdown: string): string {
  let out = String(markdown || "");
  // Headings → bold lines
  out = out.replace(/^#{1,3}\s+(.+)$/gm, "*$1*");
  // Discord **bold** → Slack *bold*
  out = out.replace(/\*\*(.+?)\*\*/g, "*$1*");
  // Discord spoilers / underline noise
  out = out.replace(/__(.+?)__/g, "$1");
  // Collapse excessive blank lines
  out = out.replace(/\n{3,}/g, "\n\n");
  return out.trim();
}

function chunkText(text: string, max = SLACK_TEXT_CHUNK): string[] {
  const chunks: string[] = [];
  let rest = text.trim();
  while (rest.length > 0) {
    if (rest.length <= max) {
      chunks.push(rest);
      break;
    }
    let cut = rest.lastIndexOf("\n\n", max);
    if (cut < max * 0.4) cut = rest.lastIndexOf("\n", max);
    if (cut < max * 0.4) cut = max;
    chunks.push(rest.slice(0, cut).trimEnd());
    rest = rest.slice(cut).trimStart();
  }
  return chunks.filter(Boolean);
}

export function slackServerReportsWebhook(env: SlackReportMirrorEnv): string {
  return str(env.SLACK_SERVER_REPORTS_WEBHOOK_URL);
}

export function slackServerReportsChannelId(env: SlackReportMirrorEnv): string {
  return str(env.SLACK_SERVER_REPORTS_CHANNEL_ID) || ROOTMC_SLACK_SERVER_REPORTS_CHANNEL_ID;
}

/**
 * Post a copy of a Discord report to Slack #server-reports.
 * Never throws — Discord remains source of truth; Slack mirror is best-effort.
 */
export async function mirrorReportToSlackServerReports(
  env: SlackReportMirrorEnv,
  opts: {
    title: string;
    dayKey: string;
    markdown: string;
    kind?: string;
  },
): Promise<{ ok: boolean; detail?: string; parts?: number }> {
  const webhook = slackServerReportsWebhook(env);
  if (!webhook) {
    return { ok: false, detail: "missing_SLACK_SERVER_REPORTS_WEBHOOK_URL" };
  }

  const title = str(opts.title) || "RootMC report";
  const dayKey = str(opts.dayKey);
  const kind = str(opts.kind);
  const header = [
    `*${title}*`,
    dayKey ? `_${dayKey} HST · Slack copy after Discord_` : `_Slack copy after Discord_`,
    kind ? `_${kind}_` : "",
  ]
    .filter(Boolean)
    .join("\n");

  const body = discordMarkdownToSlackMrkdwn(opts.markdown);
  const full = body ? `${header}\n\n${body}` : header;
  const parts = chunkText(full);
  let posted = 0;
  for (let i = 0; i < parts.length; i++) {
    const part = parts.length > 1 ? `_(part ${i + 1}/${parts.length})_\n\n${parts[i]}` : parts[i];
    const res = await postSlackIncomingWebhook(webhook, { text: part });
    if (!res.ok) {
      console.warn(
        "rootmc_slack_report_mirror_failed",
        title,
        res.status,
        res.body.slice(0, 160),
      );
      return { ok: false, detail: res.body || `http_${res.status}`, parts: posted };
    }
    posted += 1;
  }
  console.log(
    JSON.stringify({
      msg: "rootmc_slack_report_mirror_ok",
      title,
      dayKey,
      kind: kind || null,
      parts: posted,
      channel: slackServerReportsChannelId(env),
    }),
  );
  return { ok: true, parts: posted };
}
