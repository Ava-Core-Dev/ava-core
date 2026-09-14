import { json } from "./cors";
import { extractAuthToken, sessionFromRequest, type AuthEnv } from "./primary-auth";

export type PartnershipSignupEnv = AuthEnv & {
  DISCORD_BOT_TOKEN?: string;
  DISCORD_PARTNERSHIP_REPORT_CHANNEL_ID?: string;
  GROK_API_BEARER_TOKEN?: string;
  GROK_X_BEARER_TOKEN?: string;
  GROK_API_URL?: string;
  GROK_MODEL?: string;
};

type PartnershipPayload = {
  name: string;
  organization: string;
  email: string;
  phone: string;
  preferredContact: string;
  role: string;
  website: string;
  partnershipType: string;
  audience: string;
  goals: string;
  assets: string;
  rootrecordFit: string;
  timeline: string;
  notes: string;
  sourceReport: string;
};

type LinkedAccount = {
  email: string;
  accountId: string;
};

function clampText(value: unknown, max: number): string {
  return String(value ?? "")
    .replace(/\r\n/g, "\n")
    .trim()
    .slice(0, max);
}

function isEmailLike(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function normalizeDiscordBotToken(raw: string): string {
  let t = String(raw || "").trim();
  if (/^bot\s+/i.test(t)) t = t.replace(/^bot\s+/i, "").trim();
  return t;
}

function isDiscordSnowflake(value: string): boolean {
  return /^\d{10,25}$/.test(value);
}

function chunkDiscordContent(text: string, max = 1900): string[] {
  const chunks: string[] = [];
  let s = text.replace(/\r\n/g, "\n").trim();
  while (s) {
    if (s.length <= max) {
      chunks.push(s);
      break;
    }
    let cut = s.lastIndexOf("\n", max);
    if (cut < 300) cut = max;
    chunks.push(s.slice(0, cut).trimEnd());
    s = s.slice(cut).trimStart();
  }
  return chunks;
}

function grokResponseText(response: Record<string, unknown>): string {
  const choice = (response.choices as Array<Record<string, unknown>> | undefined)?.[0];
  const message = choice?.message as Record<string, unknown> | undefined;
  const content = message?.content;
  if (typeof content === "string") return content.trim();
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === "string") return part;
        if (part && typeof part === "object" && "text" in part) return String((part as { text?: unknown }).text ?? "");
        return "";
      })
      .join("\n")
      .trim();
  }
  return "";
}

function grokErrorText(response: Record<string, unknown>, status: number): string {
  const error = response.error as Record<string, unknown> | string | undefined;
  if (typeof error === "string" && error.trim()) return `HTTP ${status}: ${error.trim()}`;
  if (error && typeof error === "object") {
    const message = String(error.message || error.detail || "").trim();
    if (message) return `HTTP ${status}: ${message}`;
  }
  return `HTTP ${status}`;
}

function formatPayloadForPrompt(payload: PartnershipPayload, account: LinkedAccount | null): string {
  const lines: string[] = [];
  lines.push(`Name: ${payload.name}`);
  lines.push(`Organization: ${payload.organization}`);
  lines.push(`Email: ${payload.email}`);
  if (payload.phone) lines.push(`Phone: ${payload.phone}`);
  lines.push(`Preferred contact: ${payload.preferredContact || "email"}`);
  if (payload.role) lines.push(`Role/title: ${payload.role}`);
  if (payload.website) lines.push(`Website/social links: ${payload.website}`);
  lines.push(`Partnership type: ${payload.partnershipType}`);
  lines.push(`Timeline: ${payload.timeline}`);
  if (account) {
    lines.push(`Linked RootRecord account email: ${account.email}`);
    lines.push(`Linked RootRecord account id: ${account.accountId}`);
  } else {
    lines.push("Linked RootRecord account: not linked");
  }
  lines.push("");
  lines.push("Audience / reach:");
  lines.push(payload.audience);
  lines.push("");
  lines.push("Goals:");
  lines.push(payload.goals);
  lines.push("");
  lines.push("Assets / content / channels:");
  lines.push(payload.assets || "Not provided.");
  lines.push("");
  lines.push("RootRecord fit:");
  lines.push(payload.rootrecordFit || "Not provided.");
  if (payload.notes) {
    lines.push("");
    lines.push("Notes:");
    lines.push(payload.notes);
  }
  if (payload.sourceReport) {
    lines.push("");
    lines.push("Source report / research notes:");
    lines.push(payload.sourceReport);
  }
  return lines.join("\n");
}

async function callGrok(env: PartnershipSignupEnv, payload: PartnershipPayload, account: LinkedAccount | null): Promise<string> {
  const token = String(env.GROK_API_BEARER_TOKEN || env.GROK_X_BEARER_TOKEN || "").trim();
  if (!token) throw new Error("Grok is not configured on the Worker.");

  const apiUrl = String(env.GROK_API_URL || "https://api.x.ai/v1/chat/completions").trim();
  const model = String(env.GROK_MODEL || "grok-3-latest").trim();
  const body = {
    model,
    temperature: 0.35,
    max_tokens: 3200,
    messages: [
      {
        role: "system",
        content:
          "You write RootRecord partnership prospect reports. Produce a practical, persuasive Markdown report for a local business or creator prospect. Keep safety-critical guidance separate from creator/marketing content, avoid legal promises, and focus on concrete partnership paths.",
      },
      {
        role: "user",
        content:
          "Create the same type of partnership prospect report as RootRecord's Doing Hawaii report. Use these sections: Executive Summary, Public/Business Snapshot, Brand and Audience Fit, Strengths, Improvement Opportunities, RootRecord Partnership Fit, Integration Ideas, Suggested Offer Structure, Meeting Plan, Risks and Legal Notes, Recommended Next Steps.\n\n" +
          formatPayloadForPrompt(payload, account),
      },
    ],
  };

  const res = await fetch(apiUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const response = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  const text = grokResponseText(response);
  if (!res.ok || !text) {
    throw new Error(text || grokErrorText(response, res.status));
  }
  return text;
}

async function sendDiscordReport(
  env: PartnershipSignupEnv,
  payload: PartnershipPayload,
  account: LinkedAccount | null,
  report: string,
): Promise<void> {
  const botToken = normalizeDiscordBotToken(String(env.DISCORD_BOT_TOKEN || ""));
  const channelId = String(env.DISCORD_PARTNERSHIP_REPORT_CHANNEL_ID || "1499489364147835090").trim();
  if (!botToken) throw new Error("Discord bot token is not configured.");
  if (!isDiscordSnowflake(channelId)) throw new Error("Discord partnership channel id is invalid.");

  const header = [
    "**New RootRecord partnership signup + Grok report**",
    "",
    `**Organization:** ${payload.organization}`,
    `**Contact:** ${payload.name} <${payload.email}>`,
    account ? `**Linked account:** ${account.email} (${account.accountId})` : "**Linked account:** not linked",
    `**Partnership type:** ${payload.partnershipType}`,
    `**Timeline:** ${payload.timeline}`,
    "",
    report,
  ].join("\n");

  const auth = `Bot ${botToken}`;
  for (const chunk of chunkDiscordContent(header)) {
    const res = await fetch(`https://discord.com/api/v10/channels/${encodeURIComponent(channelId)}/messages`, {
      method: "POST",
      headers: {
        Authorization: auth,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ content: chunk, allowed_mentions: { parse: [] } }),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new Error(`Discord post failed: HTTP ${res.status} ${detail.slice(0, 300)}`);
    }
  }
}

export async function handlePartnershipSignupRoute(
  request: Request,
  env: PartnershipSignupEnv,
  sub: string,
  method: string,
): Promise<Response | null> {
  if (sub !== "/partnership/signup" || method !== "POST") return null;

  let incoming: Record<string, unknown>;
  try {
    incoming = (await request.json()) as Record<string, unknown>;
  } catch {
    return json({ detail: "Invalid JSON." }, 400);
  }

  if (clampText(incoming.websiteTrap, 200)) {
    return json({ ok: true, ignored: true }, 200);
  }

  const payload: PartnershipPayload = {
    name: clampText(incoming.name, 120),
    organization: clampText(incoming.organization, 180),
    email: clampText(incoming.email, 200),
    phone: clampText(incoming.phone, 60),
    preferredContact: clampText(incoming.preferredContact, 40) || "email",
    role: clampText(incoming.role, 120),
    website: clampText(incoming.website, 600),
    partnershipType: clampText(incoming.partnershipType, 120),
    audience: clampText(incoming.audience, 4000),
    goals: clampText(incoming.goals, 4000),
    assets: clampText(incoming.assets, 4000),
    rootrecordFit: clampText(incoming.rootrecordFit, 4000),
    timeline: clampText(incoming.timeline, 80),
    notes: clampText(incoming.notes, 4000),
    sourceReport: clampText(incoming.sourceReport, 24000),
  };

  if (!payload.name) return json({ detail: "Name is required." }, 400);
  if (!payload.organization) return json({ detail: "Organization is required." }, 400);
  if (!payload.email || !isEmailLike(payload.email)) return json({ detail: "A valid email is required." }, 400);
  if (!payload.partnershipType) return json({ detail: "Partnership type is required." }, 400);
  if (!payload.audience) return json({ detail: "Audience / reach is required." }, 400);
  if (!payload.goals) return json({ detail: "Goals are required." }, 400);
  if (!payload.timeline) return json({ detail: "Timeline is required." }, 400);

  const sess = await sessionFromRequest(env, request);
  if (!sess && extractAuthToken(request)) {
    return json({ detail: "Sign in again to link your RootRecord account, or submit without a stale token." }, 401);
  }
  const account = sess ? { email: sess.email, accountId: sess.accountId } : null;

  let report: string;
  try {
    report = await callGrok(env, payload, account);
  } catch (err) {
    const detail = err instanceof Error ? err.message : "Grok analysis failed.";
    console.error("partnership grok", detail.slice(0, 500));
    return json({ detail }, 502);
  }

  try {
    await sendDiscordReport(env, payload, account, report);
  } catch (err) {
    const detail = err instanceof Error ? err.message : "Discord delivery failed.";
    console.error("partnership discord", detail.slice(0, 500));
    return json({ detail }, 502);
  }

  return json({ ok: true, account_linked: Boolean(account), report }, 200);
}
