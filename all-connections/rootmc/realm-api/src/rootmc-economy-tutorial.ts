/**
 * RootMC economy player guide  -  posted to the economy announcements Discord channel.
 */

import {
  ROOTMC_DISCORD_INVITE,
  ROOTMC_PLAY_HOST,
  ROOTMC_REALM_HOME,
  ROOTMC_VERIFY,
  ROOTMC_WIKI_ECONOMY,
  ROOTMC_SHOPS,
  ROOTMC_MARKET,
} from "./rootmc-site";
import { sendChannelMessage, type DiscordEmbed } from "./discord-rootmc-api";
import { EMBED_GOLD } from "./rootmc-daily-report";

/** Economy channel daily brief category key (see rootmc-daily-category-reports.ts). */
export const ROOTMC_ECONOMY_DAILY_CATEGORY = "economy_intel" as const;

export const ROOTMC_ECONOMY_TUTORIAL_EMBEDS: DiscordEmbed[] = [
  {
    title: "RootMC Economy  -  Gold-Backed G",
    description:
      "RootMC runs a **closed player economy**. The server does **not** print free money  -  you earn **G** (gold) by playing, minting physical gold, selling items, and trading with other players.\n\n" +
      "**Join:** `" + ROOTMC_PLAY_HOST + "`\n" +
      "**Wiki:** " + ROOTMC_WIKI_ECONOMY + "\n" +
      "**Market:** " + ROOTMC_MARKET + "/\n" +
      "**Stock market charts:** " + ROOTMC_MARKET,
    color: EMBED_GOLD,
  },
  {
    title: "What is G?",
    description:
      "**G** is your spendable balance (Vault + Root Essentials, stored in MySQL).\n\n" +
      "**Physical gold -> balance**\n" +
      "- Gold nugget -> **¹⁄₉ G** each\n" +
      "- Gold ingot -> **1 G** each\n" +
      "- Gold block -> **9 G** each\n\n" +
      "Use **`/mint hand`** or **`/mint all`** to convert gold items in your inventory into G (items are consumed).\n\n" +
      "New players start at **0 G**. Plan to mine gold before founding a town (**400 G**).",
    color: EMBED_GOLD,
  },
  {
    title: "Earning G",
    fields: [
      {
        name: "Mine & mint",
        value: "Mine gold ore -> smelt -> **`/mint`** for spendable G.",
        inline: false,
      },
      {
        name: "Sell items",
        value:
          "**`/sell hand`**  -  **`/sell all`**  -  **`/sell blocks`**\n" +
          "Prices use **live chest-shop rolling averages** when available, else the server worth table.",
        inline: false,
      },
      {
        name: "Player shops",
        value: "Stock a chest/barrel shop and sell to other players (see **Player shops** below).",
        inline: false,
      },
      {
        name: "Services & trade",
        value: "Pay other players with **`/pay`** (0.1% tax -> Server Reserve), Towny fees, jobs, barter  -  no admin money faucet.",
        inline: false,
      },
    ],
    color: EMBED_GOLD,
  },
  {
    title: "Spending G",
    fields: [
      {
        name: "Player shops",
        value: "**`/buy <item> [qty]`**  -  buys from the **cheapest in-stock** player chest shop (up to 2304). No server NPC shop.",
        inline: false,
      },
      {
        name: "Towny",
        value:
          "**`/town new`**  -  **400 G**  -  **Nation**  -  **2000 G**\n" +
          "Chunk claims cost G. **No daily town/plot taxes** on RootMC.",
        inline: false,
      },
      {
        name: "Pay players",
        value: "**`/pay <player> <amount>`**  -  **`/paytoggle`** to opt out of receiving payments.",
        inline: false,
      },
    ],
    color: EMBED_GOLD,
  },
  {
    title: "Core commands",
    description:
      "```\n" +
      "/balance  -  /bal           -  your G balance\n" +
      "/pay <player> <amount>    -  send G\n" +
      "/mint hand  -  /mint all      -  gold items -> G\n" +
      "/sell hand  -  /sell all    -  sell priced items\n" +
      "/worth [item]             -  market avg or worth table\n" +
      "/buy <item> [qty]         -  cheapest player shop\n" +
      "/baltop                   -  leaderboard help + Server Reserve\n" +
      "/baltop players|towns|nations  -  top 10; line 11 = your rank\n" +
      "/reserve                  -  treasury stats (balance, inflows/outflows)\n" +
      "```",
    color: EMBED_GOLD,
  },
  {
    title: "Server Reserve & treasury",
    description:
      "RootMC runs a **closed-loop treasury** (hidden server account). A **0.1% tax** on `/pay` and shop trades, **100% of vote gold**, and **40% of PvP death fees** feed the reserve.\n\n" +
      "**In-game:** `/reserve`  -  reserve balance, monthly inflows/outflows, your playtime and tax MTD.\n\n" +
      "**Wiki:** " + ROOTMC_WIKI_ECONOMY,
    color: EMBED_GOLD,
  },
  {
    title: "Opening a player shop (rootmc-shops)",
    description:
      "1. Place a **chest or barrel** and stock the item you sell.\n" +
      "2. **Hold the same item** in your hand.\n" +
      "3. **Left-click** the container  -  type the **price per item** in chat (`cancel` to abort).\n" +
      "4. A wall sign appears on the container with price and qty.\n\n" +
      "**Buyers:** right-click the container for a quote, or use **`/buy`** server-wide.\n" +
      "**Owners:** right-click the **sign** to edit price or remove the shop.\n" +
      "**`/shop avg <item>`**  -  rolling average + price cap.",
    color: EMBED_GOLD,
  },
  {
    title: "Fair market & price cap",
    description:
      "Shop prices are capped at **10% above** the server **rolling average** for that item (from active player listings).\n\n" +
      "If your price is too high, chat shows the max allowed and current average.\n\n" +
      "Averages sync to the web every ~**5 minutes** and power:\n" +
      "- " + ROOTMC_SHOPS + "\n" +
      "- Stock market charts (blended buy-side reference + history)\n" +
      "- Discord **`/value`** / **`/worth`** (with trend sparklines)\n" +
      "- Net worth shop-stock valuation (qty x reference  -  not your sign price)",
    color: EMBED_GOLD,
  },
  {
    title: "Discord & app",
    fields: [
      {
        name: "RootMC Discord (linked account)",
        value:
          "**`/balance`**  -  **`/bal`**  -  your in-game G\n" +
          "**`/pay`**  -  send G to another linked member (min 0.01)\n" +
          "**`/value item:<name>`**  -  price + 7/14/28/365-day charts",
        inline: false,
      },
      {
        name: "RootMC Android app",
        value:
          "Stock market list, shop browser, vault claims (**`/rootmc vault`** in-game after link).\n" +
          "Link: **`/rootmc link`** -> " + ROOTMC_VERIFY,
        inline: false,
      },
      {
        name: "Net worth leaderboard",
        value: "Vault balance + valued inventory + shop stock at blended buy-side reference (not listing sign prices).",
        inline: false,
      },
    ],
    footer: { text: "Daily AI economy briefs post here each day at midnight HST." },
    color: EMBED_GOLD,
  },
];

export async function postRootMcEconomyTutorial(
  token: string,
  channelId: string,
): Promise<string | null> {
  const cleanToken = token.replace(/^bot\s+/i, "").trim();
  if (!cleanToken || !channelId) return null;

  const headerId = await sendChannelMessage(cleanToken, channelId, {
    content:
      "**RootMC Economy Guide**  -  how **G** works, earning, spending, shops, and web tools.\n" +
      "_Pinned reference  -  daily AI economy briefs post here each day at midnight HST._",
  });
  if (!headerId) return null;

  const bodyId = await sendChannelMessage(cleanToken, channelId, {
    embeds: ROOTMC_ECONOMY_TUTORIAL_EMBEDS,
  });
  return bodyId || headerId;
}
