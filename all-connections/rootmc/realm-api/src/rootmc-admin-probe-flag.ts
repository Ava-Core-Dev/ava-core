import { json } from "./cors";
import { discordBotFetch } from "./discord-rootmc-api";
import { resolveDiscordChannel } from "./rootmc-discord-channels";
import { record, str } from "./realm-lib";
import type { RootStatEnv } from "./rootstat-minecraft";
import { validateServerAuth } from "./rootstat-minecraft";

type ReportEnv = RootStatEnv & {
  DISCORD_ROOTMC_BOT_TOKEN?: string;
  DISCORD_ROOTMC_ADMINS_CHANNEL_ID?: string;
};

function adminsChannelId(env: ReportEnv): string {
  return resolveDiscordChannel(env, "admins", { allowBlank: true });
}

function botToken(env: ReportEnv): string {
  return String(env.DISCORD_ROOTMC_BOT_TOKEN || "").replace(/^bot\s+/i, "").trim();
}

function stripMcColors(text: string): string {
  return text.replace(/§[0-9a-fk-or]/gi, "").replace(/&[0-9a-fk-or]/gi, "").trim();
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, Math.max(0, max - 3)) + "...";
}

/**
 * POST /api/rootmc/admin-probe-flag  -  unauthorized admin command attempts -> Discord #admins.
 */
export async function handleRootMcAdminProbeFlag(
  request: Request,
  env: ReportEnv,
  subpath: string,
  method: string,
): Promise<Response | null> {
  if (!subpath.startsWith("/rootmc/admin-probe-flag")) return null;

  if (method !== "POST" || subpath !== "/rootmc/admin-probe-flag") {
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

  const uuid = stripMcColors(str(body.player_uuid));
  const username = stripMcColors(str(body.player_name));
  const world = stripMcColors(str(body.world));
  const attemptCount = Number(body.attempt_count) || 0;
  const lastCommand = stripMcColors(str(body.last_command));
  const matchedLabel = stripMcColors(str(body.matched_label));
  const matchedReason = stripMcColors(str(body.matched_reason));
  const flaggedAt = stripMcColors(str(body.flagged_at));
  const recentRaw = body.recent_commands;
  const recent: string[] = Array.isArray(recentRaw)
    ? recentRaw.map((line) => stripMcColors(String(line ?? ""))).filter(Boolean)
    : [];

  if (!uuid || !username) {
    return json({ detail: "player_uuid and player_name are required." }, 400);
  }

  const token = botToken(env);
  const channelId = adminsChannelId(env);
  if (!token || !channelId) {
    return json({ detail: "Admin probe flags are not configured on the API." }, 503);
  }

  let desc =
    `**Player:** ${username}\n` +
    `**UUID:** \`${uuid}\`\n` +
    `**Failed attempts:** ${attemptCount}\n` +
    `**Last command:** \`${lastCommand || matchedLabel || "?"}\`\n` +
    `**Missing permission:** \`${matchedReason || "unknown"}\``;
  if (world) desc += `\n**World:** ${world}`;
  if (flaggedAt) desc += `\n**Flagged at:** ${flaggedAt}`;
  if (recent.length > 0) {
    desc += `\n\n**Recent admin probes:**\n${recent.map((line) => `- \`${line}\``).join("\n")}`;
  }

  const embed = {
    title: "Admin command probe flag",
    description: truncate(desc, 4000),
    color: 0xed4245,
    timestamp: new Date().toISOString(),
  };

  const res = await discordBotFetch(token, `/channels/${encodeURIComponent(channelId)}/messages`, {
    method: "POST",
    body: JSON.stringify({ embeds: [embed] }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    console.warn("admin_probe_flag_discord_failed", res.status, text.slice(0, 400));
    return json({ detail: "Could not deliver flag. Try again later." }, 502);
  }

  return json({ ok: true, channel_id: channelId }, 200);
}
