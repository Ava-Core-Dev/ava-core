/**
 * Channel policy — Discord only.
 * Ava has one unsolicited Discord home. Slack / Telegram / DMs are unchanged.
 */

import { AVA_CHANNELS } from "./config.mjs";
import { isSlackChannelId } from "./slackGateway.mjs";
import { isTelegramChannelId } from "./telegramApi.mjs";

function isDiscordGuildChannelId(id) {
  const s = String(id || "").trim();
  if (!s || isSlackChannelId(s) || isTelegramChannelId(s)) return false;
  if (s.startsWith("dm:") || s.startsWith("rcon:")) return false;
  return /^\d{17,20}$/.test(s);
}

/** Discord channels where Ava must not post unsolicited status. */
export function noUnsolicitedChannelIds() {
  const home = String(AVA_CHANNELS.avaHome || "").trim();
  const ids = new Set([
    AVA_CHANNELS.admins,
    "1516121832493678612",
  ]);
  const extra = String(process.env.AVA_NO_UNSOLICITED_CHANNELS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  for (const id of extra) ids.add(id);
  if (home) ids.delete(home);
  return ids;
}

export function allowsUnsolicitedPost(channelId) {
  const id = String(channelId || "").trim();
  if (!id) return false;
  // Slack (and TG/DMs) are not this Discord-home rule.
  if (!isDiscordGuildChannelId(id)) return true;
  const home = String(AVA_CHANNELS.avaHome || "").trim();
  return Boolean(home) && id === home;
}
