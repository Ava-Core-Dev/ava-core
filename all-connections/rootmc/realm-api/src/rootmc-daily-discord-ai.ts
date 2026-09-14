/** Raw Grok prompt/response archive for RootMC daily AI (RootRecord business Discord). */

import { discordBotFetch } from "./discord-rootmc-api";

const DEFAULT_ROOTMC_AI_RAW_ARCHIVE_CHANNEL_ID = "1545283818146242642";

export type RootMcDailyDiscordAiEnv = {
  DISCORD_ROOTMC_BOT_TOKEN?: string;
  DISCORD_BOT_TOKEN?: string;
  DISCORD_ROOTMC_AI_RAW_ARCHIVE_CHANNEL_ID?: string;
};

function archiveBotToken(env: RootMcDailyDiscordAiEnv): string {
  // Business Discord raw archive (1545283818146242642)  -  same pattern as Kīlauea/Goals.
  return String(env.DISCORD_BOT_TOKEN || env.DISCORD_ROOTMC_BOT_TOKEN || "")
    .replace(/^bot\s+/i, "")
    .trim();
}

function jsonForArchive(v: unknown): string {
  return JSON.stringify(v, (_k, value) => (typeof value === "bigint" ? value.toString() : value));
}

function str(v: unknown): string {
  return String(v ?? "").trim();
}

export async function archiveRootMcDailyAiToDiscord(
  env: RootMcDailyDiscordAiEnv,
  params: {
    reportKind: "daily_category" | "daily_combined" | "daily_preview" | "weekly_combined" | "weekly_category";
    dayKey: string;
    category?: string;
    serverId: string;
    promptContext: Record<string, unknown>;
    ai: Record<string, unknown>;
  },
): Promise<void> {
  const channelId = String(
    env.DISCORD_ROOTMC_AI_RAW_ARCHIVE_CHANNEL_ID || DEFAULT_ROOTMC_AI_RAW_ARCHIVE_CHANNEL_ID,
  ).trim();
  const token = archiveBotToken(env);
  if (!/^\d{10,}$/.test(channelId) || token.length < 40) {
    console.warn("rootmc_daily_ai_archive_skip", "bot token or archive channel not configured");
    return;
  }

  const stamp = new Date().toISOString();
  const label = params.category ? `${params.category}  -  ${params.dayKey}` : params.dayKey;
  const payload = {
    product: "rootmc",
    report_kind: params.reportKind,
    day_key: params.dayKey,
    category: params.category || null,
    server_id: params.serverId,
    created_at: stamp,
    prompt: params.promptContext,
    response: params.ai,
  };

  const form = new FormData();
  form.set(
    "payload_json",
    JSON.stringify({
      content: `RootMC AI raw archive  -  **${label}**`,
      allowed_mentions: { parse: [] },
    }),
  );
  form.set(
    "files[0]",
    new Blob([jsonForArchive(payload)], { type: "application/json" }),
    `rootmc-ai-${params.reportKind}-${params.dayKey}${params.category ? `-${params.category}` : ""}.json`,
  );

  const res = await discordBotFetch(token, `/channels/${encodeURIComponent(channelId)}/messages`, {
    method: "POST",
    body: form,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    console.warn("rootmc_daily_ai_archive_failed", res.status, text.slice(0, 400));
  }
}

export function publicAiModel(ai: Record<string, unknown>): string | undefined {
  const model = str(ai.model);
  return model || undefined;
}
