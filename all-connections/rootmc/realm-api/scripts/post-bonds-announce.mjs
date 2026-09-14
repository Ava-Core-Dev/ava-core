/**
 * Post bonds announcement to #economy (UTF-8 safe — all punctuation via \\u escapes).
 */
import { discordMessageUrl, postDiscordMessageChunks } from "./lib/rootmc-discord.mjs";

const BUL = "\u2022";
const MID = "\u00B7";
const EM = "\u2014";
const ARR = "\u2192";

const content =
  `\u{1F3DB}\uFE0F **Server Reserve Bonds ${EM} citizen savings are live**\n\n` +
  `Bonds let **every player** park Gold in the **Server Reserve**, earn reserve income, and redeem to **physical gold** anytime ${EM} no mayor permissions, no locked town vaults.\n\n` +
  `**Quick start**\n` +
  `${BUL} Join ${ARR} run **\`/bonds\`**\n` +
  `${BUL} **Get bonded notes** ${ARR} pick amount ${ARR} confirm\n` +
  `${BUL} Wallet **G** ${ARR} reserve; you get a **Bonded note** (paper)\n` +
  `${BUL} Store notes safely ${EM} empty **ender chest** works well\n` +
  `${BUL} **\`/bonds\`** again to **claim earnings** or **redeem** principal\n` +
  `**Backup:** \`/bonds create <amount>\`\n\n` +
  `**What is a bond?**\n` +
  `Paper backed 1:1 by Gold in the **Server Reserve** ${EM} not abstract credit.\n` +
  `${BUL} **Issue** ${EM} wallet debits; reserve holds backing; you hold the note\n` +
  `${BUL} **Earn** ${EM} each Minecraft day, share reserve inflows\n` +
  `${BUL} **Redeem** ${EM} note in hand, **Redeem note** in \`/bonds\` ${ARR} physical gold (blocks/ingots/nuggets)\n\n` +
  `**Coupons:** **25%** of each day's reserve inflows ${ARR} bond pool, split pro-rata by outstanding principal. Gold appears in your \`/bonds\` vault ${EM} **claim within 48h** or it returns to reserve.\n\n` +
  `**Town/nation banks** participate automatically. Inactive players/groups (7d grace) earn nothing until someone returns.\n\n` +
  `**Links:** https://rootmc.net/economy/bonds/ ${MID} https://rootmc.net/wiki/constitution/\n` +
  `**In-game:** \`play.rootmc.net\` ${MID} \`/bonds\` ${MID} \`/reserve\`\n\n` +
  `Questions ${ARR} **#general-chat** or tag staff.`;

const posted = await postDiscordMessageChunks({
  channelId: "economy",
  content,
  userAgent: "RootMC/post-bonds-announce",
});

console.log("posted", posted.length, "chunk(s); first id:", posted[0].id);
console.log(discordMessageUrl("economy", posted[0].id));
