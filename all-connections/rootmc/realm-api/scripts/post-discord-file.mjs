/**
 * Post a file attachment to a RootMC Discord channel.
 * Usage: node scripts/post-discord-file.mjs --channel 1545284423740563528 --file "path" [--message "intro"]
 */
import fs from "node:fs";
import path from "node:path";
import { loadRootMcEnv, rootMcBotToken } from "./lib/rootmc-env.mjs";
import { resolveRootMcChannel, discordMessageUrl } from "./lib/rootmc-discord.mjs";

const DISCORD_API = "https://discord.com/api/v10";

function argValue(flag) {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? String(process.argv[i + 1] || "").trim() : "";
}

const channelArg = argValue("--channel") || "updates";
const filePath = argValue("--file");
const message = argValue("--message") || "";

if (!filePath) {
  console.error("Usage: node scripts/post-discord-file.mjs --file <path> [--channel <name|id>] [--message \"intro\"]");
  process.exit(1);
}

const abs = path.resolve(filePath);
if (!fs.existsSync(abs)) {
  console.error("File not found:", abs);
  process.exit(1);
}

const channelId = resolveRootMcChannel(channelArg);
const token = rootMcBotToken(loadRootMcEnv()).replace(/^bot\s+/i, "").trim();
const fileName = path.basename(abs);
const fileContent = fs.readFileSync(abs);

const form = new FormData();
form.append("payload_json", JSON.stringify({ content: message.slice(0, 2000) }));
form.append("files[0]", new Blob([fileContent], { type: "text/plain" }), fileName);

const res = await fetch(`${DISCORD_API}/channels/${channelId}/messages`, {
  method: "POST",
  headers: { Authorization: `Bot ${token}` },
  body: form,
});
const text = await res.text();
if (!res.ok) throw new Error(`Discord ${res.status}: ${text.slice(0, 400)}`);
const posted = JSON.parse(text);
console.log("posted file", fileName, "id:", posted.id);
console.log(discordMessageUrl(channelId, posted.id));
