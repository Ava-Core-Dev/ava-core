/**
 * Post or replace RootMC server rules in the rules Discord channel.
 *
 * Usage (from Web/cloudflare/rootmc-realm-api/):
 *   node scripts/post-rootmc-rules.mjs
 *   node scripts/post-rootmc-rules.mjs --replace   (delete prior bot rules posts first)
 */
import fs from "node:fs";
import path from "node:path";
import { findCredentialsPath, wranglerTomlPath } from "./lib/rootmc-paths.mjs";
import { ROOTMC_URLS, loadRootMcEnv, rootMcBotToken } from "./lib/rootmc-env.mjs";

const API = "https://discord.com/api/v10";
const GUILD_ID = "1516108585740800042";
const GENERAL_CHANNEL_ID = "1545284354157187083";
const RULES_COLOR = 0x2d6a2d;
const APPEALS_FORUM_ID = "1516143406315737169";
const APPEALS_URL = `https://discord.com/channels/${GUILD_ID}/${APPEALS_FORUM_ID}`;

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

const replace = process.argv.includes("--replace") || !process.argv.includes("--no-replace");
const fileEnv = { ...readEnvFile(findCredentialsPath()), ...loadRootMcEnv() };
const wranglerPath = wranglerTomlPath();

const token = rootMcBotToken(fileEnv);
const channelId = String(
  process.env.DISCORD_ROOTMC_RULES_CHANNEL_ID ||
    fileEnv.DISCORD_ROOTMC_RULES_CHANNEL_ID ||
    readWranglerVar(wranglerPath, "DISCORD_ROOTMC_RULES_CHANNEL_ID") ||
    "1516392367869919243",
).trim();

if (token.length < 40) {
  console.error("Need DISCORD_ROOTMC_BOT_TOKEN in Desktop\\RootMC\\.env or credentials.env");
  process.exit(1);
}

const EMBEDS_PART_1 = [
  {
    title: "Staff authority & appeals",
    description:
      "**All admins may make rulings using their best judgment.** Staff are trusted to decide what action fits the situation — warning, mute, kick, temp ban, or permanent ban.\n\n" +
      "• A **warning is not required** before other action; it is up to each admin whether to warn first.\n" +
      "• Context matters: intent, history, and impact on others all weigh in.\n" +
      "• Staff decisions are final in the moment; be respectful when staff are handling an issue.\n\n" +
      `**Appeals:** open a thread in <#${APPEALS_FORUM_ID}> (${APPEALS_URL}).\n` +
      "Include your in-game name, what happened, and why you believe the action should be reviewed. One appeal per incident; spam or harassment in appeals may be removed.",
    color: RULES_COLOR,
  },
  {
    title: "1 — Be respectful",
    description:
      "Treat players and staff with basic respect.\n\n" +
      "• No harassment, bullying, dogpiling, or sustained hostility toward a player.\n" +
      "• No slurs, hate speech, or attacks on real-world identity (race, gender, religion, orientation, disability, etc.).\n" +
      "• No threats of violence or doxxing — in-game, in Discord, or in DMs related to RootMC.\n" +
      "• Trash talk in PvP is fine; crossing into personal attacks is not.\n" +
      "• If someone is bothering you: `/ignore`, leave the area, or ask staff — don’t escalate.",
    color: RULES_COLOR,
  },
  {
    title: "2 — Chat & communication",
    description:
      "Keep global and Discord chat usable for everyone.\n\n" +
      "• No spam, character spam, repeated caps, or macro-flooding chat.\n" +
      "• No advertising other servers, scams, or malicious links.\n" +
      "• No NSFW or shock content in public channels (including map art and signs visible to others).\n" +
      "• English is preferred in public chat so staff can moderate; private groups may use any language.\n" +
      "• In-game chat may be bridged to Discord `#ingame` — behave as if staff can see it.",
    color: RULES_COLOR,
  },
  {
    title: "3 — No cheating or unfair advantage",
    description:
      "Play fair. RootMC is a survival SMP with long-term progression (mcMMO, economy, towns).\n\n" +
      "• **Banned:** x-ray, dupes, item generators, inventory hacks, fly/god/speed on survival, kill aura, reach, auto-clickers for combat/mining.\n" +
      "• **Banned:** using alt accounts to bypass punishments, spy on towns, or stockpile unfair economic advantage.\n" +
      "• **Allowed:** vanilla-friendly QoL (e.g. inventory sorting) unless staff say otherwise.\n" +
      "• Report suspected cheaters to staff with evidence when possible — false reports in bad faith may be actioned.",
    color: RULES_COLOR,
  },
  {
    title: "4 — Griefing & stealing",
    description:
      "Wilderness is open; claimed land is protected.\n\n" +
      "• **Do not grief, steal from, or trap inside Towny claims** — including towns you were invited to and later left.\n" +
      "• Wilderness (unclaimed chunks): building and breaking are allowed, but don’t harass others by blocking spawns, trapping portals, or lava-casting player builds outside claims.\n" +
      "• Nether and End are **wild resource worlds** — not claimable; take reasonable precautions with your gear.\n" +
      "• Do not exploit map borders, chunk errors, or plugin bugs to bypass protection.",
    color: RULES_COLOR,
  },
];

const EMBEDS_PART_2 = [
  {
    title: "5 — Towny & nations",
    description:
      "Towns exist in the **overworld only**.\n\n" +
      "• Founding and claiming cost **G** — don’t scam residents out of plots or town bank deposits.\n" +
      "• Mayors are responsible for who they invite; internal town drama is yours to manage unless it becomes harassment or griefing.\n" +
      "• Nation wars and PvP must stay within server systems — no bypassing combat rules with exploits.\n" +
      "• Staff may intervene in town names, nation names, or public town Discord channels that violate these rules.",
    color: RULES_COLOR,
  },
  {
    title: "6 — Economy & trading",
    description:
      "The economy is **player-driven**; scams hurt everyone.\n\n" +
      "• Chest shop prices are capped at **10% above** the rolling market average — don’t try to bypass caps with exploits.\n" +
      "• In-person trades are at your own risk; record deals if large sums are involved.\n" +
      "• No real-money trading (RMT) for in-game items, accounts, or G.\n" +
      "• Duplicating currency or items, or abusing `/pay`, vault, or shop plugins, is treated as cheating.",
    color: RULES_COLOR,
  },
  {
    title: "7 — PvP & combat",
    description:
      "Know where PvP applies before you fight.\n\n" +
      "• Respect town PvP flags and spawn protection.\n" +
      "• No combat logging to avoid a fair fight (disconnecting mid-combat to escape).\n" +
      "• No luring players into traps outside agreed PvP contexts.\n" +
      "• Staff arenas or events may have additional rules announced at the event.",
    color: RULES_COLOR,
  },
  {
    title: "8 — Accounts & linking",
    description:
      "One main survival identity per person unless staff approve an alt (e.g. shop alt, redstone alt).\n\n" +
      "• Link with **`/rootmc link`** → " + ROOTMC_URLS.verify + " for stats, Discord perks, and app sync.\n" +
      "• Don’t share accounts; you are responsible for what happens on your account.\n" +
      "• Impersonating staff or other players is not allowed.",
    color: RULES_COLOR,
  },
  {
    title: "9 — Discord community",
    description:
      "RootMC Discord follows the same spirit as in-game rules.\n\n" +
      "• Use channels for their purpose; keep bot commands in appropriate channels.\n" +
      "• No NSFW profile names or avatars visible in member list contexts staff moderate.\n" +
      "• Listen to staff and channel moderators.\n" +
      "• Invite: " + ROOTMC_URLS.discordInvite,
    color: RULES_COLOR,
  },
  {
    title: "10 — Staff, updates & wiki",
    description:
      "Rules may be updated as the server grows. Major changes will be announced in Discord.\n\n" +
      "• In-game: **`/rules`** · **`/discord`** · **`/cmds`**\n" +
      "• Wiki: " + ROOTMC_URLS.wiki + "\n" +
      "• Join: **`" + ROOTMC_URLS.play + "`**\n\n" +
      `Questions? Ask in <#${GENERAL_CHANNEL_ID}> or open an appeal in <#${APPEALS_FORUM_ID}> if you disagree with a staff action.`,
    color: RULES_COLOR,
  },
];

async function discordApi(path, opts = {}) {
  const res = await fetch(`${API}${path}`, {
    ...opts,
    headers: {
      Authorization: `Bot ${token}`,
      "Content-Type": "application/json",
      ...(opts.headers || {}),
    },
  });
  if (opts.method === "DELETE" && res.status === 204) return null;
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Discord ${res.status} ${path}: ${text}`);
  }
  if (res.status === 204) return null;
  return res.json();
}

async function botUserId() {
  const me = await discordApi("/users/@me");
  return String(me.id);
}

function isRulesMessage(msg, botId) {
  if (String(msg.author?.id) !== botId) return false;
  const content = String(msg.content || "");
  if (content.includes("RootMC Server Rules")) return true;
  const titles = (msg.embeds || []).map((e) => String(e.title || ""));
  return titles.some(
    (t) =>
      t === "Staff authority & appeals" ||
      t.startsWith("1 — ") ||
      t.startsWith("10 — Staff"),
  );
}

async function deleteOldRulesPosts(botId) {
  let deleted = 0;
  let before = undefined;
  for (let page = 0; page < 10; page++) {
    const qs = before ? `?limit=100&before=${before}` : "?limit=100";
    const messages = await discordApi(`/channels/${encodeURIComponent(channelId)}/messages${qs}`);
    if (!messages.length) break;
    for (const msg of messages) {
      if (isRulesMessage(msg, botId)) {
        await discordApi(
          `/channels/${encodeURIComponent(channelId)}/messages/${msg.id}`,
          { method: "DELETE" },
        );
        deleted++;
        console.log("Deleted old rules message:", msg.id);
      }
    }
    before = messages[messages.length - 1]?.id;
    if (messages.length < 100) break;
  }
  return deleted;
}

async function sendMessage(body) {
  return discordApi(`/channels/${encodeURIComponent(channelId)}/messages`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

if (replace) {
  const botId = await botUserId();
  const n = await deleteOldRulesPosts(botId);
  console.log(`Removed ${n} prior rules message(s).`);
}

const header = await sendMessage({
  content:
    "**RootMC Server Rules** — read before you play. Ignorance of the rules is not an excuse.\n" +
    `_Staff may act on judgment without a prior warning. Appeals: <#${APPEALS_FORUM_ID}>_\n` +
    "Pin this message if you are staff.",
});
console.log("Posted header:", header.id);

const part1 = await sendMessage({ embeds: EMBEDS_PART_1 });
console.log("Posted rules (part 1):", part1.id);

const part2 = await sendMessage({ embeds: EMBEDS_PART_2 });
console.log("Posted rules (part 2):", part2.id);
console.log(`https://discord.com/channels/${GUILD_ID}/${channelId}/${header.id}`);
