/**
 * Create #proposals — citizen submissions (linked + governance power).
 *
 *   node scripts/setup-discord-proposals-channel.mjs --confirm
 */
import fs from "node:fs";
import path from "node:path";
import { loadRootMcEnv, rootMcBotToken } from "./lib/rootmc-env.mjs";
import { ROOTMC_GUILD_ID, ROOTMC_CHANNELS, postDiscordMessage } from "./lib/rootmc-discord.mjs";
import { realmApiRoot } from "./lib/rootmc-paths.mjs";

const API = "https://discord.com/api/v10";
const COUNCIL_ROLE_ID = "1522410660418551910";
const LINKED_ROLE_ID = "1516396491973984256";
const STAFF_ROLE_ID = "1516121138420252803";

const VIEW = 1n << 10n;
const SEND = 1n << 11n;
const ATTACH_FILES = 1n << 15n;
const READ_HISTORY = 1n << 16n;
const SEND_IN_THREADS = 1n << 38n;
const USE_APP_CMD = 1n << 31n;

function perm(...bits) {
  return bits.reduce((a, b) => a | b, 0n).toString();
}

async function discordReq(token, method, route, body) {
  const res = await fetch(`${API}${route}`, {
    method,
    headers: {
      Authorization: `Bot ${token}`,
      "Content-Type": "application/json; charset=utf-8",
      "User-Agent": "RootMC/setup-discord-proposals-channel",
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
    reason: "RootMC citizen proposals channel",
  });
  console.log("created", `#${name}`, ch.id);
  return ch;
}

async function applyPermissions(token, channelId) {
  await discordReq(token, "PUT", `/channels/${channelId}/permissions/${ROOTMC_GUILD_ID}`, {
    id: ROOTMC_GUILD_ID,
    type: 0,
    allow: perm(VIEW, READ_HISTORY, USE_APP_CMD),
    deny: perm(SEND, ATTACH_FILES),
  });
  for (const roleId of [COUNCIL_ROLE_ID, LINKED_ROLE_ID]) {
    await discordReq(token, "PUT", `/channels/${channelId}/permissions/${roleId}`, {
      id: roleId,
      type: 0,
      // Verified (Linked) + Council: talk in proposal threads; no new top-level posts
      allow: perm(VIEW, READ_HISTORY, USE_APP_CMD, ATTACH_FILES, SEND_IN_THREADS),
      deny: perm(SEND),
    });
  }
  if (STAFF_ROLE_ID) {
    await discordReq(token, "PUT", `/channels/${channelId}/permissions/${STAFF_ROLE_ID}`, {
      id: STAFF_ROLE_ID,
      type: 0,
      allow: perm(VIEW, READ_HISTORY, SEND, SEND_IN_THREADS, USE_APP_CMD, ATTACH_FILES),
      deny: "0",
    });
  }
}

const PIN = `📋 **Citizen proposals** — site + discussion threads

Full text on **https://rootmc.net/governance/** · this channel = links + threads only.

**Submit (only way):** in-game **\`/proposal <idea>\`** (64 G → Server Reserve). Ava publishes the formal proposal — including catch-up from the official queue if she was offline.
**Discuss** in each thread — any **verified (Linked)** player can talk. Thread discussion is summarized into the weekly bill before the Council vote.

**Pipeline:** Ava publishes → discuss (≥3 days before Sunday compile) → Sunday compile → 48h amendments → <#${ROOTMC_CHANNELS.voting || "voting"}> vote
**Commands:** \`/proposals list\` · \`/proposals discuss id:<id>\` · \`/vote\`

Constitution: <#${ROOTMC_CHANNELS.constitution || "constitution"}>`;

const confirm = process.argv.includes("--confirm");
const token = rootMcBotToken(loadRootMcEnv());
const channels = await discordReq(token, "GET", `/guilds/${ROOTMC_GUILD_ID}/channels`);
const rulesCh = channels.find((c) => String(c.id) === ROOTMC_CHANNELS.rules);
const parentId = rulesCh?.parent_id || null;

const proposalsCh = await ensureChannel(
  token,
  channels,
  "proposals",
  "Citizen proposals — compiled into weekly bills for Council vote",
  parentId,
  confirm,
);

const proposalsId = proposalsCh ? String(proposalsCh.id) : null;

if (proposalsId && confirm) {
  await applyPermissions(token, proposalsId);
  const msg = await postDiscordMessage({
    channelId: proposalsId,
    content: PIN,
    token,
    userAgent: "RootMC/setup-discord-proposals-channel",
  });
  await discordReq(token, "PUT", `/channels/${proposalsId}/pins/${msg.id}`);
  console.log("pinned proposals intro", msg.id);

  for (const wranglerPath of [
    path.join(realmApiRoot(), "wrangler.toml"),
    path.join(realmApiRoot(), "..", "rootmc-api", "wrangler.toml"),
  ]) {
    if (!fs.existsSync(wranglerPath)) continue;
    let wrangler = fs.readFileSync(wranglerPath, "utf8");
    const line = `DISCORD_ROOTMC_PROPOSALS_CHANNEL_ID = "${proposalsId}"`;
    if (wrangler.includes("DISCORD_ROOTMC_PROPOSALS_CHANNEL_ID")) {
      wrangler = wrangler.replace(/DISCORD_ROOTMC_PROPOSALS_CHANNEL_ID\s*=\s*"[^"]*"/, line);
    } else {
      wrangler = wrangler.replace(
        /DISCORD_ROOTMC_VOTING_CHANNEL_ID[^\n]*\n/,
        `$&${line}\n`,
      );
    }
    fs.writeFileSync(wranglerPath, wrangler);
    console.log("updated", wranglerPath);
  }

  const discordLib = path.join(realmApiRoot(), "scripts", "lib", "rootmc-discord.mjs");
  let lib = fs.readFileSync(discordLib, "utf8");
  if (lib.includes('proposals: ""')) {
    lib = lib.replace(/proposals:\s*"[^"]*"/, `proposals: "${proposalsId}"`);
  } else if (!lib.includes("proposals:")) {
    lib = lib.replace(/voting: "[^"]+",/, `$&\n  proposals: "${proposalsId}",`);
  }
  fs.writeFileSync(discordLib, lib);
}

console.log("\nDISCORD_ROOTMC_PROPOSALS_CHANNEL_ID =", proposalsId || "(dry run)");
