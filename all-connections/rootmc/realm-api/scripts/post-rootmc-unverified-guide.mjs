/**
 * Post how to unlock Discord chat via in-game /link to #unverified.
 *
 * Usage (from Web/cloudflare/rootmc-realm-api/):
 *   node scripts/post-rootmc-unverified-guide.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { ROOTMC_URLS, loadRootMcEnv, rootMcBotToken } from "./lib/rootmc-env.mjs";

const API = "https://discord.com/api/v10";
const GUILD_ID = "1516108585740800042";
const DEFAULT_CHANNEL_ID = "1519249871326937138";
const LINKED_ROLE_ID = "1516396491973984256";
const EMBED_COLOR = 0x3b82f6;

function readWranglerVar(p, name) {
  if (!fs.existsSync(p)) return "";
  const m = fs.readFileSync(p, "utf8").match(new RegExp(`^${name}\\s*=\\s*"([^"]*)"`, "m"));
  return m ? m[1] : "";
}

const fileEnv = loadRootMcEnv();
const wranglerPath = path.join(process.cwd(), "wrangler.toml");

const token = rootMcBotToken(fileEnv);
const channelId = String(
  process.env.DISCORD_ROOTMC_UNVERIFIED_CHANNEL_ID ||
    fileEnv.DISCORD_ROOTMC_UNVERIFIED_CHANNEL_ID ||
    readWranglerVar(wranglerPath, "DISCORD_ROOTMC_UNVERIFIED_CHANNEL_ID") ||
    DEFAULT_CHANNEL_ID,
).trim();

if (token.length < 40) {
  console.error("Need DISCORD_ROOTMC_BOT_TOKEN in credentials.env or RootMC .env");
  process.exit(1);
}

const EMBEDS = [
  {
    title: "Why you can't chat yet",
    description:
      "Most RootMC channels are **read-only** until your Minecraft player is linked to this Discord account.\n\n" +
      "That keeps bots and drive-by spam out of community chat. Once linked, you get the <@&" +
      LINKED_ROLE_ID +
      "> role and can **send messages** in public channels.",
    color: EMBED_COLOR,
  },
  {
    title: "Step 1 — Join the server",
    description:
      "You need to be on the RootMC Minecraft server at least once.\n\n" +
      "**Address:** `" +
      ROOTMC_URLS.play +
      "`\n" +
      "**Java:** 1.21+ (Paper)\n\n" +
      "New here? See the player wiki: " +
      ROOTMC_URLS.wiki,
    color: EMBED_COLOR,
  },
  {
    title: "Step 2 — Run /link in-game",
    description:
      "While logged in, open chat and run:\n\n" +
      "```\n/link\n```\n" +
      "You'll get a **6-character code** and a link to the verify page.\n\n" +
      "Same command as `/rootmc link` if you use the legacy hub command.",
    color: EMBED_COLOR,
  },
  {
    title: "Step 3 — Verify on the web",
    description:
      "1. Open **" +
      ROOTMC_URLS.verify +
      "** (or click the link from in-game).\n" +
      "2. Enter your **6-character code**.\n" +
      "3. Click **Link with Discord** and approve the OAuth prompt.\n\n" +
      "No separate sign-up required — linking is enough to unlock chat.",
    color: EMBED_COLOR,
  },
  {
    title: "What you get when linked",
    fields: [
      {
        name: "Discord",
        value:
          "• **Speak** in public channels (this restriction lifts)\n" +
          "• Server nickname set to your **in-game name**\n" +
          "• Optional bot commands like `/balance` where enabled",
        inline: false,
      },
      {
        name: "In-game",
        value:
          "• **100 G** one-time welcome bonus (treasury transfer — join to receive)\n" +
          "• Stats, verify perks, and app features on " +
          ROOTMC_URLS.site,
        inline: false,
      },
    ],
    footer: { text: "Codes expire — run /link again if yours times out." },
    color: EMBED_COLOR,
  },
  {
    title: "Still stuck?",
    description:
      "• **Code expired?** Run `/link` in-game again for a fresh code.\n" +
      "• **Already linked another player?** One Discord account per Minecraft profile for chat unlock.\n" +
      "• **Need staff?** Ask in this channel if you can read replies, or open a ticket per server rules.\n\n" +
      "Verify page: " +
      ROOTMC_URLS.verify,
    color: EMBED_COLOR,
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

const header = await sendMessage({
  content:
    "**Unlock Discord chat** — link your Minecraft player with **`/link`** in-game, then finish on the verify page.\n" +
    "_Read the steps below. When you're linked, you can talk in the rest of the server._",
});
console.log("Posted header:", header.id);

const body = await sendMessage({ embeds: EMBEDS });
console.log("Posted guide embeds:", body.id);
console.log(`https://discord.com/channels/${GUILD_ID}/${channelId}/${body.id}`);
