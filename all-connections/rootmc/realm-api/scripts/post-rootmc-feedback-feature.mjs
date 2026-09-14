/**
 * Announce in-game /feedback (legacy Discord helper — canonical is Slack #feedback).
 *
 * Usage (from Web Files/rootmc-realm-api/):
 *   node scripts/post-rootmc-feedback-feature.mjs
 *
 * Live delivery: Slack Incoming Webhook → #feedback (C0BLMGBVAMD) via api.rootmc.net
 */
import fs from "node:fs";
import path from "node:path";
import { findCredentialsPath, wranglerTomlPath } from "./lib/rootmc-paths.mjs";
import { ROOTMC_URLS } from "./lib/rootmc-env.mjs";
import { ROOTMC_SLACK_CHANNEL_URLS } from "./lib/rootmc-slack-channels.mjs";

const API = "https://discord.com/api/v10";
const GUILD_ID = "1516108585740800042";
const COLOR = 0x57f287;

function readEnvFile(p) {
  const out = {};
  if (!fs.existsSync(p)) return out;
  for (const raw of fs.readFileSync(p, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const i = line.indexOf("=");
    if (i <= 0) continue;
    out[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return out;
}

function readWranglerVar(p, name) {
  if (!fs.existsSync(p)) return "";
  const m = fs.readFileSync(p, "utf8").match(new RegExp(`^${name}\\s*=\\s*"([^"]*)"`, "m"));
  return m ? m[1] : "";
}

const credPath = findCredentialsPath();
const fileEnv = readEnvFile(credPath);
const wranglerPath = wranglerTomlPath();

const token = String(process.env.DISCORD_ROOTMC_BOT_TOKEN || fileEnv.DISCORD_ROOTMC_BOT_TOKEN || "")
  .replace(/^bot\s+/i, "")
  .trim();

const channelId = String(
  process.env.DISCORD_ROOTMC_GENERAL_CHAT_CHANNEL_ID ||
    fileEnv.DISCORD_ROOTMC_GENERAL_CHAT_CHANNEL_ID ||
    readWranglerVar(wranglerPath, "DISCORD_ROOTMC_GENERAL_CHAT_CHANNEL_ID") ||
    "1545284354157187083",
).trim();

if (token.length < 40) {
  console.error("Need DISCORD_ROOTMC_BOT_TOKEN in credentials.env");
  process.exit(1);
}

const EMBEDS = [
  {
    title: "New: /feedback in-game",
    description:
      "Found a bug, have a suggestion, or want to shout out something cool on the server?\n\n" +
      "While playing on **RootMC**, use:\n" +
      "`/feedback <your message>`\n\n" +
      "Your note goes straight to staff in Slack #feedback (" +
      ROOTMC_SLACK_CHANNEL_URLS.feedback +
      ") — include enough detail that we can reproduce bugs (what you did, where, what you expected).\n\n" +
      "• Works for everyone on the server (no Discord link required)\n" +
      "• Keep it constructive — same respect rules as chat\n" +
      "• For rule disputes or bans, use the appeals forum instead\n\n" +
      "Other help: **`/rules`** · **`/cmds`** · **`/discord`** · wiki " + ROOTMC_URLS.wiki,
    color: COLOR,
  },
];

async function sendMessage(body) {
  const res = await fetch(`${API}/channels/${encodeURIComponent(channelId)}/messages`, {
    method: "POST",
    headers: {
      Authorization: `Bot ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Discord ${res.status}: ${text}`);
  }
  return res.json();
}

const msg = await sendMessage({
  content: "**RootMC update** — you can now send staff feedback from in-game.",
  embeds: EMBEDS,
});
console.log("Posted:", msg.id);
console.log(`https://discord.com/channels/${GUILD_ID}/${channelId}/${msg.id}`);
