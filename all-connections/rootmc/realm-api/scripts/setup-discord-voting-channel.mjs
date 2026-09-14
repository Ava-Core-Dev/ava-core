/**
 * Create #voting — read-only official polls; Council of Voters participate via bot buttons.
 *
 *   node scripts/setup-discord-voting-channel.mjs --confirm
 */
import fs from "node:fs";
import path from "node:path";
import { loadRootMcEnv, rootMcBotToken } from "./lib/rootmc-env.mjs";
import { ROOTMC_GUILD_ID, ROOTMC_CHANNELS, postDiscordMessage } from "./lib/rootmc-discord.mjs";
import { realmApiRoot } from "./lib/rootmc-paths.mjs";

const API = "https://discord.com/api/v10";
const COUNCIL_ROLE_ID = "1522410660418551910";
const STAFF_ROLE_ID = "1516121138420252803";

const VIEW = 1n << 10n;
const SEND = 1n << 11n;
const READ_HISTORY = 1n << 16n;
const ATTACH_FILES = 1n << 15n;
const MANAGE_MESSAGES = 1n << 13n;
const PIN_MESSAGES = 1n << 24n;
const USE_APP_CMD = 1n << 31n;
const CREATE_PUB_THREAD = 1n << 35n;
const SEND_IN_THREAD = 1n << 38n;

function perm(...bits) {
  return bits.reduce((a, b) => a | b, 0n).toString();
}

async function discordReq(token, method, route, body) {
  const res = await fetch(`${API}${route}`, {
    method,
    headers: {
      Authorization: `Bot ${token}`,
      "Content-Type": "application/json; charset=utf-8",
      "User-Agent": "RootMC/setup-discord-voting-channel",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${route} → ${res.status}: ${text.slice(0, 500)}`);
  return text ? JSON.parse(text) : null;
}

async function ensureChannel(token, channels, name, topic, parentId, confirm) {
  let ch = channels.find((c) => c.type === 0 && String(c.name).toLowerCase() === name);
  if (ch) {
    console.log("existing", `#${name}`, ch.id);
    return ch;
  }
  if (!confirm) {
    console.log("would create", `#${name}`);
    return null;
  }
  ch = await discordReq(token, "POST", `/guilds/${ROOTMC_GUILD_ID}/channels`, {
    name,
    type: 0,
    topic,
    parent_id: parentId,
    reason: "RootMC official governance polls",
  });
  console.log("created", `#${name}`, ch.id);
  return ch;
}

async function applyVotingPermissions(token, channelId) {
  await discordReq(token, "PUT", `/channels/${channelId}/permissions/${ROOTMC_GUILD_ID}`, {
    id: ROOTMC_GUILD_ID,
    type: 0,
    allow: perm(VIEW, READ_HISTORY, USE_APP_CMD),
    deny: perm(SEND, PIN_MESSAGES, MANAGE_MESSAGES, ATTACH_FILES, CREATE_PUB_THREAD, SEND_IN_THREAD),
  });
  await discordReq(token, "PUT", `/channels/${channelId}/permissions/${COUNCIL_ROLE_ID}`, {
    id: COUNCIL_ROLE_ID,
    type: 0,
    allow: perm(VIEW, READ_HISTORY, USE_APP_CMD),
    deny: perm(SEND, ATTACH_FILES, CREATE_PUB_THREAD, SEND_IN_THREAD),
  });
  if (STAFF_ROLE_ID) {
    await discordReq(token, "PUT", `/channels/${channelId}/permissions/${STAFF_ROLE_ID}`, {
      id: STAFF_ROLE_ID,
      type: 0,
      allow: perm(
        VIEW,
        READ_HISTORY,
        SEND,
        USE_APP_CMD,
        ATTACH_FILES,
        CREATE_PUB_THREAD,
        SEND_IN_THREAD,
        MANAGE_MESSAGES,
        PIN_MESSAGES,
      ),
      deny: "0",
    });
  }
}

async function pinMessage(token, channelId, messageId) {
  await discordReq(token, "PUT", `/channels/${channelId}/pins/${messageId}`);
}

const VOTING_PIN = `🗳️ **Council of Voters — official polls**

Read-only channel. Weighted **For / Against / Abstain** buttons on each poll; same verification as the site.

**Vote:** buttons below · https://rootmc.net/governance/ · Terms: https://rootmc.net/terms/
**Before voting:** link at https://rootmc.net/verify · ≥1h playtime · \`/vote\` for your % share

Proposals: <#${ROOTMC_CHANNELS.proposals || "proposals"}> · Constitution: <#${ROOTMC_CHANNELS.constitution || "constitution"}>`;

const confirm = process.argv.includes("--confirm");
const token = rootMcBotToken(loadRootMcEnv());
const channels = await discordReq(token, "GET", `/guilds/${ROOTMC_GUILD_ID}/channels`);
const rulesCh = channels.find((c) => String(c.id) === ROOTMC_CHANNELS.rules);
const parentId = rulesCh?.parent_id || null;

const votingCh = await ensureChannel(
  token,
  channels,
  "voting",
  "Official governance polls — Council of Voters (read-only, weighted buttons)",
  parentId,
  confirm,
);

let votingId = votingCh ? String(votingCh.id) : null;

if (votingId && confirm) {
  await applyVotingPermissions(token, votingId);
  const msg = await postDiscordMessage({
    channelId: votingId,
    content: VOTING_PIN,
    token,
    userAgent: "RootMC/setup-discord-voting-channel",
  });
  await pinMessage(token, votingId, msg.id);
  console.log("pinned voting intro", msg.id);
}

console.log("\n--- Add to scripts/lib/rootmc-discord.mjs ROOTMC_CHANNELS ---");
if (votingId) console.log(`  voting: "${votingId}",`);

console.log("\n--- Add to wrangler.toml [vars] ---");
if (votingId) console.log(`DISCORD_ROOTMC_VOTING_CHANNEL_ID = "${votingId}"`);

if (confirm && votingId) {
  for (const wranglerPath of [
    path.join(realmApiRoot(), "wrangler.toml"),
    path.join(realmApiRoot(), "..", "rootmc-api", "wrangler.toml"),
  ]) {
    if (!fs.existsSync(wranglerPath)) continue;
    let wrangler = fs.readFileSync(wranglerPath, "utf8");
    if (wrangler.includes("DISCORD_ROOTMC_VOTING_CHANNEL_ID")) {
      wrangler = wrangler.replace(
        /DISCORD_ROOTMC_VOTING_CHANNEL_ID\s*=\s*"[^"]*"/,
        `DISCORD_ROOTMC_VOTING_CHANNEL_ID = "${votingId}"`,
      );
    } else {
      wrangler = wrangler.replace(
        /DISCORD_ROOTMC_COUNCIL_VOTERS_ROLE_ID[^\n]*\n/,
        `$&DISCORD_ROOTMC_VOTING_CHANNEL_ID = "${votingId}"\n`,
      );
    }
    fs.writeFileSync(wranglerPath, wrangler);
    console.log("updated", wranglerPath);
  }

  const discordLib = path.join(realmApiRoot(), "scripts", "lib", "rootmc-discord.mjs");
  let lib = fs.readFileSync(discordLib, "utf8");
  lib = lib.replace(/voting:\s*"[^"]*"/, `voting: "${votingId}"`);
  fs.writeFileSync(discordLib, lib);
  console.log("updated rootmc-discord.mjs voting id");
}
