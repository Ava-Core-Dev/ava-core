/**
 * Post a message to a RootMC Discord channel (connectivity test or quick ops).
 *
 * Token: DISCORD_ROOTMC_BOT_TOKEN in RootMC Workspace\.env
 *
 * Usage:
 *   node scripts/post-discord-message.mjs --message "Hello from dev workstation"
 *   node scripts/post-discord-message.mjs --channel updates --message "Server maintenance tonight"
 *   node scripts/post-discord-message.mjs --channel 1545284423740563528 --message "Custom channel by id"
 *   node scripts/post-discord-message.mjs --dry-run --message "preview only"
 */
import {
  ROOTMC_CHANNELS,
  discordMessageUrl,
  postDiscordMessageChunks,
  resolveRootMcChannel,
} from "./lib/rootmc-discord.mjs";

import fs from "node:fs";

function argValue(flag) {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? String(process.argv[i + 1] || "").trim() : "";
}

const channelArg = argValue("--channel") || "updates";
const fileArg = argValue("--file");
const message = fileArg ? fs.readFileSync(fileArg, "utf8") : argValue("--message");
const dryRun = process.argv.includes("--dry-run");

if (!message) {
  console.error(`Usage: node scripts/post-discord-message.mjs --message "<text>" [--channel <name|id>] [--dry-run]
       node scripts/post-discord-message.mjs --file path/to/message.txt [--channel <name|id>] [--dry-run]

Channels (names): ${Object.keys(ROOTMC_CHANNELS).join(", ")}
Default channel: updates (${ROOTMC_CHANNELS.updates})`);
  process.exit(1);
}

const channelId = resolveRootMcChannel(channelArg);

if (dryRun) {
  console.log("dry-run — would post to channel", channelId);
  console.log(message);
  process.exit(0);
}

const posted = await postDiscordMessageChunks({
  channelId,
  content: message,
  userAgent: "RootMC/post-discord-message",
});

const first = posted[0];
console.log("posted", posted.length, "chunk(s); first id:", first.id);
console.log(discordMessageUrl(channelId, first.id));
