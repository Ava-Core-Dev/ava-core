/**
 * Create #constitution (read-only) + #governance (linked players participate).
 * Pin intro messages. Print IDs for wrangler + rootmc-discord.mjs.
 *
 *   node scripts/setup-discord-governance-channels.mjs --confirm
 */
import fs from "node:fs";
import path from "node:path";
import { loadRootMcEnv, rootMcBotToken } from "./lib/rootmc-env.mjs";
import { ROOTMC_GUILD_ID, ROOTMC_CHANNELS, postDiscordMessage } from "./lib/rootmc-discord.mjs";
import { realmApiRoot } from "./lib/rootmc-paths.mjs";

const API = "https://discord.com/api/v10";
const LINKED_ROLE_ID = "1516396491973984256";
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
      "User-Agent": "RootMC/setup-discord-governance-channels",
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
    reason: `RootMC ${name} channel`,
  });
  console.log("created", `#${name}`, ch.id);
  return ch;
}

async function applyReadOnly(token, channelId) {
  await discordReq(token, "PUT", `/channels/${channelId}/permissions/${ROOTMC_GUILD_ID}`, {
    id: ROOTMC_GUILD_ID,
    type: 0,
    allow: perm(VIEW, READ_HISTORY),
    deny: perm(SEND, PIN_MESSAGES, MANAGE_MESSAGES, ATTACH_FILES, CREATE_PUB_THREAD, SEND_IN_THREAD),
  });
}

async function applyLinkedParticipation(token, channelId) {
  await discordReq(token, "PUT", `/channels/${channelId}/permissions/${ROOTMC_GUILD_ID}`, {
    id: ROOTMC_GUILD_ID,
    type: 0,
    allow: perm(VIEW, READ_HISTORY, USE_APP_CMD),
    deny: perm(SEND, ATTACH_FILES, CREATE_PUB_THREAD, SEND_IN_THREAD),
  });
  await discordReq(token, "PUT", `/channels/${channelId}/permissions/${LINKED_ROLE_ID}`, {
    id: LINKED_ROLE_ID,
    type: 0,
    allow: perm(VIEW, READ_HISTORY, SEND, USE_APP_CMD, ATTACH_FILES, CREATE_PUB_THREAD, SEND_IN_THREAD),
    deny: "0",
  });
  if (STAFF_ROLE_ID !== LINKED_ROLE_ID) {
    await discordReq(token, "PUT", `/channels/${channelId}/permissions/${STAFF_ROLE_ID}`, {
      id: STAFF_ROLE_ID,
      type: 0,
      allow: perm(VIEW, READ_HISTORY, SEND, USE_APP_CMD, ATTACH_FILES, CREATE_PUB_THREAD, SEND_IN_THREAD, MANAGE_MESSAGES, PIN_MESSAGES),
      deny: "0",
    });
  }
}

async function pinMessage(token, channelId, messageId) {
  await discordReq(token, "PUT", `/channels/${channelId}/pins/${messageId}`);
}

const CONSTITUTION_PIN = `📜 **RootMC Constitution**

**Wiki (authoritative):** https://rootmc.net/wiki/constitution/

• Closed-loop **Server Reserve** · all Gold redeemable · https://rootmc.net/reserve/
• **Citizen legislature:** https://rootmc.net/governance/ · Terms: https://rootmc.net/terms/
• **Map return grant — 1000 G:** first join **before 1 Jul 2026 (HST)**, any playtime, Discord linked → \`/rootmc claim-return\`

**Channels:** <#${ROOTMC_CHANNELS.proposals || "proposals"}> (proposals) · <#${ROOTMC_CHANNELS.voting || "voting"}> (Council votes)

This channel is **read-only.** Policy updates on the wiki first.`;

const GOVERNANCE_PIN = `🗳️ **Governance discussion**

Linked players discuss policy here. **Official text and votes live on rootmc.net.**

• Hub: https://rootmc.net/governance/
• Submit: https://rootmc.net/governance/submit/
• Terms (required to vote): https://rootmc.net/terms/

**Weekly pipeline:** Mon–Sun submit (≥**3 days** before Sunday compile) → Sunday bill → **48h** amendments → <#${ROOTMC_CHANNELS.voting || "voting"}> vote

**Power formula:** playtime × ln(1+net worth) × listing-site multiplier → your **% of 100%**
Check \`/vote\` · Policy: https://rootmc.net/wiki/constitution/#governance-voting

**Not the same as** vote-site Gold (1–20 G) — that's a separate wallet reward from the reserve.

Proposal threads: <#${ROOTMC_CHANNELS.proposals || "proposals"}> · Council votes: <#${ROOTMC_CHANNELS.voting || "voting"}> · Law: <#CONSTITUTION_CHANNEL_ID>`;

const confirm = process.argv.includes("--confirm");
const token = rootMcBotToken(loadRootMcEnv());
const channels = await discordReq(token, "GET", `/guilds/${ROOTMC_GUILD_ID}/channels`);
const rulesCh = channels.find((c) => String(c.id) === ROOTMC_CHANNELS.rules);
const parentId = rulesCh?.parent_id || null;

const constitutionCh = await ensureChannel(
  token,
  channels,
  "constitution",
  "RootMC Constitution — economy & reserve rules (read-only)",
  parentId,
  confirm,
);
const governanceCh = await ensureChannel(
  token,
  channels,
  "governance",
  "Community votes — linked players discuss & use /proposal",
  parentId,
  confirm,
);

const ids = { constitution: null, governance: null };

if (constitutionCh && confirm) {
  ids.constitution = String(constitutionCh.id);
  await applyReadOnly(token, ids.constitution);
  const msg = await postDiscordMessage({
    channelId: ids.constitution,
    content: CONSTITUTION_PIN,
    token,
    userAgent: "RootMC/setup-discord-governance-channels",
  });
  await pinMessage(token, ids.constitution, msg.id);
  console.log("pinned constitution intro", msg.id);
}

if (governanceCh && confirm) {
  ids.governance = String(governanceCh.id);
  await applyLinkedParticipation(token, ids.governance);
  const govPin = GOVERNANCE_PIN.replace(
    "<#CONSTITUTION_CHANNEL_ID>",
    ids.constitution ? `<#${ids.constitution}>` : "#constitution",
  );
  const msg = await postDiscordMessage({
    channelId: ids.governance,
    content: govPin,
    token,
    userAgent: "RootMC/setup-discord-governance-channels",
  });
  await pinMessage(token, ids.governance, msg.id);
  console.log("pinned governance intro", msg.id);
}

console.log("\n--- Add to scripts/lib/rootmc-discord.mjs ROOTMC_CHANNELS ---");
if (ids.constitution) console.log(`  constitution: "${ids.constitution}",`);
if (ids.governance) console.log(`  governance: "${ids.governance}",`);

console.log("\n--- Add to wrangler.toml [vars] ---");
if (ids.constitution) console.log(`DISCORD_ROOTMC_CONSTITUTION_CHANNEL_ID = "${ids.constitution}"`);
if (ids.governance) console.log(`DISCORD_ROOTMC_GOVERNANCE_CHANNEL_ID = "${ids.governance}"`);

if (confirm && (ids.constitution || ids.governance)) {
  const wranglerPath = path.join(realmApiRoot(), "wrangler.toml");
  let wrangler = fs.readFileSync(wranglerPath, "utf8");
  if (ids.constitution && !wrangler.includes("DISCORD_ROOTMC_CONSTITUTION_CHANNEL_ID")) {
    wrangler += `\nDISCORD_ROOTMC_CONSTITUTION_CHANNEL_ID = "${ids.constitution}"\n`;
  }
  if (ids.governance && !wrangler.includes("DISCORD_ROOTMC_GOVERNANCE_CHANNEL_ID")) {
    wrangler += `DISCORD_ROOTMC_GOVERNANCE_CHANNEL_ID = "${ids.governance}"\n`;
  }
  fs.writeFileSync(wranglerPath, wrangler);
  console.log("appended channel IDs to wrangler.toml (if missing)");
}
