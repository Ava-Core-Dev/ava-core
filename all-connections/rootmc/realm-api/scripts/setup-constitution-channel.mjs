/**
 * Create #constitution (read-only), post pinned summary, register channel id in output.
 *
 *   node scripts/setup-constitution-channel.mjs
 *   node scripts/setup-constitution-channel.mjs --confirm
 */
import { loadRootMcEnv, rootMcBotToken } from "./lib/rootmc-env.mjs";
import { ROOTMC_GUILD_ID, ROOTMC_CHANNELS, postDiscordMessage } from "./lib/rootmc-discord.mjs";

const API = "https://discord.com/api/v10";
const CHANNEL_NAME = "constitution";
const RULES_CHANNEL_ID = ROOTMC_CHANNELS.rules;

const VIEW = 1n << 10n;
const SEND = 1n << 11n;
const READ_HISTORY = 1n << 16n;
const MANAGE_MESSAGES = 1n << 13n;
const PIN_MESSAGES = 1n << 24n;

function perm(...bits) {
  return bits.reduce((a, b) => a | b, 0n).toString();
}

async function discordReq(token, method, route, body) {
  const res = await fetch(`${API}${route}`, {
    method,
    headers: {
      Authorization: `Bot ${token}`,
      "Content-Type": "application/json; charset=utf-8",
      "User-Agent": "RootMC/setup-constitution-channel",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${route} → ${res.status}: ${text.slice(0, 500)}`);
  return text ? JSON.parse(text) : null;
}

const confirm = process.argv.includes("--confirm");
const token = rootMcBotToken(loadRootMcEnv());

const PINNED = `📜 **RootMC Constitution** — authoritative rules for Gold, the Server Reserve, treasury grants, and governance.

**Read the full document:** https://rootmc.net/wiki/constitution/

**Covers**
• Closed-loop **Server Reserve** — what flows in/out, \`/reserve\`, rootmc.net/reserve
• **All Gold is redeemable** — mint peg, physical gold, treasury grant policy
• **Taxes & fees** — canonical rate table
• **Activity Dividend** — monthly rules (≥20h HST)
• **Governance voting power** — playtime-weighted shares (100% total); boost with verified \`/vote\` listing sites

This channel is **read-only**. Discuss in **#general** or **#economy**; staff update the wiki when policy changes.

_Economy how-to (not law): https://rootmc.net/wiki/economy/_`;

async function main() {
  const channels = await discordReq(token, "GET", `/guilds/${ROOTMC_GUILD_ID}/channels`);
  let ch = channels.find((c) => c.type === 0 && String(c.name).toLowerCase() === CHANNEL_NAME);

  if (!ch) {
    if (!confirm) {
      console.log("Dry run — pass --confirm to create #constitution");
    } else {
      const rulesCh = channels.find((c) => String(c.id) === RULES_CHANNEL_ID);
      const parentId = rulesCh?.parent_id || null;
      ch = await discordReq(token, "POST", `/guilds/${ROOTMC_GUILD_ID}/channels`, {
        name: CHANNEL_NAME,
        type: 0,
        topic: "RootMC Constitution — economy & reserve rules (read-only)",
        parent_id: parentId,
        reason: "RootMC Constitution canonical reference",
      });
      console.log("created channel", ch.id, `#${ch.name}`);
    }
  } else {
    console.log("existing channel", ch.id, `#${ch.name}`);
  }

  if (!ch) {
    console.log("No channel to configure.");
    return;
  }

  const channelId = String(ch.id);

  if (confirm) {
    await discordReq(token, "PUT", `/channels/${channelId}/permissions/${ROOTMC_GUILD_ID}`, {
      id: ROOTMC_GUILD_ID,
      type: 0,
      allow: perm(VIEW, READ_HISTORY),
      deny: perm(SEND, PIN_MESSAGES, MANAGE_MESSAGES),
    });
    console.log("applied @everyone read-only overwrites");
  }

  const posted = await postDiscordMessage({
    channelId,
    content: PINNED,
    token,
    userAgent: "RootMC/setup-constitution-channel",
  });
  console.log("posted message", posted.id);

  if (confirm) {
    await discordReq(token, "PUT", `/channels/${channelId}/pins/${posted.id}`);
    console.log("pinned message", posted.id);
  }

  console.log("\nAdd to ROOTMC_CHANNELS in rootmc-discord.mjs:");
  console.log(`  constitution: "${channelId}",`);
}

main().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
