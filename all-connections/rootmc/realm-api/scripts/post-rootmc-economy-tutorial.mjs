/**
 * Post the RootMC economy tutorial to the economy announcements Discord channel.
 *
 * Usage (from Web/cloudflare/rootmc-realm-api/):
 *   node scripts/post-rootmc-economy-tutorial.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { findCredentialsPath, wranglerTomlPath } from "./lib/rootmc-paths.mjs";
import { ROOTMC_URLS, loadRootMcEnv, rootMcBotToken } from "./lib/rootmc-env.mjs";

const API = "https://discord.com/api/v10";
const EMBED_GOLD = 0xc9a227;

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
  process.env.DISCORD_ROOTMC_ECONOMY_ANNOUNCE_CHANNEL_ID ||
    fileEnv.DISCORD_ROOTMC_ECONOMY_ANNOUNCE_CHANNEL_ID ||
    readWranglerVar(wranglerPath, "DISCORD_ROOTMC_ECONOMY_ANNOUNCE_CHANNEL_ID") ||
    "1516804780884889621",
).trim();

if (token.length < 40) {
  console.error("Need DISCORD_ROOTMC_BOT_TOKEN in credentials.env");
  process.exit(1);
}

const TUTORIAL_EMBEDS = [
  {
    title: "RootMC Economy — Gold-Backed G",
    description:
      "RootMC runs a **closed player economy**. The server does **not** print free money — you earn **G** (gold) by playing, minting physical gold, selling items, and trading with other players.\n\n" +
      "**Join:** `" + ROOTMC_URLS.play + "`\n" +
      "**Wiki:** " + ROOTMC_URLS.wikiEconomy + "\n" +
      "**Shops browser:** " + ROOTMC_URLS.shops + "\n" +
      "**Stock market charts:** " + ROOTMC_URLS.market,
    color: EMBED_GOLD,
  },
  {
    title: "What is G?",
    description:
      "**G** is your spendable balance (Vault + Root Essentials, stored in MySQL).\n\n" +
      "**Physical gold → balance**\n" +
      "• Gold nugget → **¹⁄₉ G** each\n" +
      "• Gold ingot → **1 G** each\n" +
      "• Gold block → **9 G** each\n\n" +
      "Use **`/mint hand`** or **`/mint all`** to convert gold items in your inventory into G (items are consumed).\n\n" +
      "New players start at **0 G**. Plan to mine gold before founding a town (**400 G**).",
    color: EMBED_GOLD,
  },
  {
    title: "Earning G",
    fields: [
      { name: "Mine & mint", value: "Mine gold ore → smelt → **`/mint`** for spendable G.", inline: false },
      {
        name: "Sell items",
        value:
          "**`/sell hand`** · **`/sell all`** · **`/sell blocks`**\nPrices use **live chest-shop rolling averages** when available, else the server worth table.",
        inline: false,
      },
      { name: "Player shops", value: "Stock a chest/barrel shop and sell to other players.", inline: false },
      { name: "Services & trade", value: "Pay other players with **`/pay`**, Towny fees, jobs, barter.", inline: false },
    ],
    color: EMBED_GOLD,
  },
  {
    title: "Spending G",
    fields: [
      {
        name: "Player shops",
        value: "**`/buy <item> [qty]`** — cheapest in-stock player chest shop (up to 2304). No server NPC shop.",
        inline: false,
      },
      {
        name: "Towny",
        value: "**`/town new`** — **400 G** · **Nation** — **2000 G**. Chunk claims cost G. **No daily taxes.**",
        inline: false,
      },
      { name: "Pay players", value: "**`/pay <player> <amount>`** · **`/paytoggle`**", inline: false },
    ],
    color: EMBED_GOLD,
  },
  {
    title: "Core commands",
    description:
      "```\n/balance · /bal          — your G balance\n/pay <player> <amount>   — send G\n/mint hand · /mint all     — gold items → G\n/sell hand · /sell all   — sell priced items\n/worth [item]            — market avg or worth table\n/buy <item> [qty]        — cheapest player shop\n/baltop                  — leaderboard help + Server Reserve\n/baltop players|towns|nations — top 10; line 11 = your rank\n/reserve                 — treasury stats + dividend eligibility\n```",
    color: EMBED_GOLD,
  },
  {
    title: "Opening a player shop",
    description:
      "1. **Chest or barrel** stocked with the item.\n2. **Hold the item** · **left-click** the container.\n3. Type **price per item** in chat (`cancel` to abort).\n\n**Buyers:** right-click container or **`/buy`**. **Owners:** right-click **sign** to edit.",
    color: EMBED_GOLD,
  },
  {
    title: "Fair market & price cap",
    description:
      "Prices capped at **10% above** the server rolling average (from active listings).\n\nAverages sync ~every **5 min** to the web, Realm stock market, and Discord **`/value`**.",
    color: EMBED_GOLD,
  },
  {
    title: "Discord & app",
    fields: [
      {
        name: "Discord (linked)",
        value: "**`/balance`** · **`/pay`** · **`/value item:<name>`** (trend charts)",
        inline: false,
      },
      {
        name: "RootMC app",
        value: "Shops + stock market + vault. Link: **`/rootmc link`** → " + ROOTMC_URLS.verify,
        inline: false,
      },
    ],
    footer: { text: "Daily AI economy briefs post in this channel." },
    color: EMBED_GOLD,
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
    "**RootMC Economy Guide** — how **G** works, earning, spending, shops, and web tools.\n" +
    "_Pinned reference — daily AI economy updates will also post here._",
});
console.log("Posted header:", header.id);

const body = await sendMessage({ embeds: TUTORIAL_EMBEDS });
console.log("Posted tutorial embeds:", body.id);
console.log(`https://discord.com/channels/1516108585740800042/${channelId}/${body.id}`);
