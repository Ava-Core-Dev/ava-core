import type { ExecutionContext } from "@cloudflare/workers-types";

const DEFAULT_AI_COPY_CHANNEL_ID = "1511923750776606780";
const DEFAULT_AI_RAW_ARCHIVE_CHANNEL_ID = "1545283818146242642";

export type GoalsDiscordAiEnv = {
  DISCORD_ROOTMC_BOT_TOKEN?: string;
  DISCORD_BOT_TOKEN?: string;
  DISCORD_ROOTGOALS_AI_COPY_CHANNEL_ID?: string;
  DISCORD_ROOTGOALS_AI_RAW_ARCHIVE_CHANNEL_ID?: string;
};

function botToken(env: GoalsDiscordAiEnv): string {
  return String(env.DISCORD_ROOTMC_BOT_TOKEN || env.DISCORD_BOT_TOKEN || "")
    .replace(/^bot\s+/i, "")
    .trim();
}

function jsonForArchive(v: unknown): string {
  return JSON.stringify(v, (_k, value) => (typeof value === "bigint" ? value.toString() : value));
}

function publicText(raw: unknown, max: number): string {
  const t = String(raw ?? "")
    .replace(/\bGrok\b/gi, "AI")
    .replace(/\bxAI\b/g, "AI")
    .replace(/\s+/g, " ")
    .trim();
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
}

function truncate(s: string, max: number): string {
  const t = s.trim();
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
}

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

async function postChannelMessage(
  env: GoalsDiscordAiEnv,
  channelId: string,
  form: FormData,
): Promise<boolean> {
  const token = botToken(env);
  if (!/^\d{10,}$/.test(channelId) || token.length < 40) return false;
  const res = await fetch(`https://discord.com/api/v10/channels/${encodeURIComponent(channelId)}/messages`, {
    method: "POST",
    headers: { Authorization: `Bot ${token}`, "User-Agent": "RootRecord/root-goals-ai" },
    body: form,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    console.warn("root_goals_ai_discord", res.status, text.slice(0, 400));
    return false;
  }
  return true;
}

/** Human-readable AI plan copy for developers (channel 1511923750776606780). */
export async function postGoalsAiCopyToDiscord(
  env: GoalsDiscordAiEnv,
  params: {
    goalId: string;
    userId: string;
    title: string;
    reason: string | null;
    passNumber: number;
    ai: Record<string, unknown>;
  },
): Promise<void> {
  const channelId = String(
    env.DISCORD_ROOTGOALS_AI_COPY_CHANNEL_ID || DEFAULT_AI_COPY_CHANNEL_ID,
  ).trim();
  const summary = publicText(params.ai.summary_text, 700);
  const plan = params.ai.plan && typeof params.ai.plan === "object" ? (params.ai.plan as Record<string, unknown>) : {};
  const steps = Array.isArray(plan.steps) ? plan.steps : [];
  const stepsPreview = steps
    .slice(0, 6)
    .map((s, i) => `${i + 1}. ${publicText(typeof s === "string" ? s : (s as Record<string, unknown>)?.text || (s as Record<string, unknown>)?.title, 120)}`)
    .filter(Boolean)
    .join("\n");
  const actions = Array.isArray(params.ai.actions) ? params.ai.actions.length : 0;
  const suggestions = Array.isArray(params.ai.suggestions) ? params.ai.suggestions.length : 0;
  const ok = params.ai.ok !== false;
  const errorDetail = str(params.ai.detail) || str(params.ai.parse_error) || "";

  const embed = {
    title: truncate(`Root Goals AI — ${params.title}`, 256),
    description: truncate(
      ok ? summary || "—" : errorDetail || summary || "AI plan failed",
      4000,
    ),
    color: ok ? 0x4a9eff : 0xcc4444,
    fields: [
      { name: "Goal", value: truncate(params.title, 256), inline: true },
      { name: "Pass", value: String(params.passNumber), inline: true },
      { name: "Reason", value: truncate(params.reason || "—", 256), inline: true },
      { name: "Account", value: truncate(params.userId, 256), inline: true },
      { name: "Model", value: truncate(str(params.ai.model) || "—", 256), inline: true },
      {
        name: "Outputs",
        value: `${actions} actions · ${suggestions} suggestions`,
        inline: true,
      },
      ...(!ok && errorDetail
        ? [{ name: "Error", value: truncate(errorDetail, 1024), inline: false }]
        : []),
      ...(stepsPreview
        ? [{ name: "Plan steps (preview)", value: truncate(stepsPreview, 1024), inline: false }]
        : []),
    ],
    footer: { text: `Goal ${params.goalId.slice(0, 8)}` },
    timestamp: new Date().toISOString(),
  };

  const form = new FormData();
  form.set(
    "payload_json",
    JSON.stringify({
      content: `${ok ? "Root Goals AI copy" : "Root Goals AI failed"} — **${params.title}** (\`${params.goalId.slice(0, 8)}\`)`,
      embeds: [embed],
      allowed_mentions: { parse: [] },
    }),
  );
  await postChannelMessage(env, channelId, form);
}

/** Full prompt/response JSON (channel 1545283818146242642 — shared raw archive with Kīlauea). */
export async function archiveRawGoalsAiToDiscord(
  env: GoalsDiscordAiEnv,
  params: {
    goalId: string;
    userId: string;
    title: string;
    reason: string | null;
    passNumber: number;
    promptContext: Record<string, unknown>;
    ai: Record<string, unknown>;
  },
): Promise<void> {
  const channelId = String(
    env.DISCORD_ROOTGOALS_AI_RAW_ARCHIVE_CHANNEL_ID || DEFAULT_AI_RAW_ARCHIVE_CHANNEL_ID,
  ).trim();
  const payload = {
    product: "root_goals",
    goal_id: params.goalId,
    user_id: params.userId,
    title: params.title,
    pass_number: params.passNumber,
    reason: params.reason,
    created_at: new Date().toISOString(),
    prompt: params.promptContext,
    response: params.ai,
  };
  const form = new FormData();
  form.set(
    "payload_json",
    JSON.stringify({
      content: `Root Goals AI raw archive — **${params.title}** (\`${params.goalId.slice(0, 8)}\`)`,
      allowed_mentions: { parse: [] },
    }),
  );
  form.set(
    "files[0]",
    new Blob([jsonForArchive(payload)], { type: "application/json" }),
    `root-goals-ai-${params.goalId.slice(0, 8)}-p${params.passNumber}.json`,
  );
  await postChannelMessage(env, channelId, form);
}

export function scheduleGoalsAiDiscordNotify(
  ctx: ExecutionContext | undefined,
  env: GoalsDiscordAiEnv,
  params: {
    goalId: string;
    userId: string;
    title: string;
    reason: string | null;
    passNumber: number;
    promptContext: Record<string, unknown>;
    ai: Record<string, unknown>;
  },
): void {
  const job = (async () => {
    await postGoalsAiCopyToDiscord(env, params);
    await archiveRawGoalsAiToDiscord(env, params);
  })().catch((e) => {
    console.warn("root_goals_ai_discord_job", e instanceof Error ? e.message : String(e));
  });
  if (ctx) ctx.waitUntil(job);
  else void job;
}
