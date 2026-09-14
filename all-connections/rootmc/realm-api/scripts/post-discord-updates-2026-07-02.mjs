/**
 * Post July 2026 feature announcements to #updates (multiple messages).
 *
 *   node scripts/post-discord-updates-2026-07-02.mjs
 *   node scripts/post-discord-updates-2026-07-02.mjs --dry-run
 */
import { postDiscordMessageChunks, ROOTMC_CHANNELS } from "./lib/rootmc-discord.mjs";

const dryRun = process.argv.includes("--dry-run");
const governanceMention = process.env.GOVERNANCE_CHANNEL_ID
  ? `<#${process.env.GOVERNANCE_CHANNEL_ID}>`
  : "**#governance**";
const constitutionMention = process.env.CONSTITUTION_CHANNEL_ID
  ? `<#${process.env.CONSTITUTION_CHANNEL_ID}>`
  : "**#constitution**";

const POSTS = [
  `📜 **RootMC Constitution & wiki**

We published the **RootMC Constitution** — the authoritative rules for Gold, the **Server Reserve**, taxes, treasury grants, and governance.

• **Wiki:** https://rootmc.net/wiki/constitution/
• **Read-only Discord:** ${constitutionMention} (pinned summary)
• **Economy how-to:** https://rootmc.net/wiki/economy/
• **Reserve dashboard:** https://rootmc.net/reserve/ · in-game \`/reserve\`

All automated grants debit the **Server Reserve** (never mint). **All Gold is redeemable** at the mint peg.`,

  `🗳️ **Citizen legislature (web-first)**

Full proposals, bills, and votes: **https://rootmc.net/governance/**

• Submit: https://rootmc.net/governance/submit/ · \`/proposals submit\`
• **#proposals** — links + discussion threads (Grok → weekly bill)
• **#voting** — weighted Council polls (linked + terms)
• Pipeline: submit Mon–Sun (**≥3 days** before Sunday compile) → Sunday bill → 48h amendments → vote
• \`/vote\` · Terms: https://rootmc.net/terms/

Policy: https://rootmc.net/wiki/constitution/#governance-voting`,

  `🏦 **Server Reserve & treasury (recap)**

The reserve (\`towny-server\`) recycles taxes, fees, and Towny sinks — dividends, vote Gold, grants, and loans **debit the reserve**, not player wallets.

• \`/reserve\` · \`/baltop\` (no args shows reserve balance)
• Web ledger: https://rootmc.net/reserve/
• Activity Dividend: ≥20h prior HST month · 50% of pool on the 1st

Full rates: Constitution **Taxes & fees** section`,

  `🗺️ **Returning players — map grant**

Fresh map launch; town banks kept. One-time **1000 G** from the reserve:

• \`/link\` → **https://rootmc.net/verify**
• \`/rootmc claim-return\` (once per account)

Eligible: **first join before 1 Jul 2026 (HST)**, any playtime, Discord linked. Town resettlement recipients are pre-claimed — do not double-claim.

Also live: \`/back\`, 24h new-player grace (\`/rtp\`, keep inv), embassy plots **100 G**, \`/buy\` fix, loan cap \`min_both\`.`,

  `📋 **Command testing onboarding (\`/cmdtest\`)**

Learn commands once, earn up to **1000 G** from the treasury (split across commands you can use).

• Reminders until each command is run · **one free test** + fee refund on paid commands
• \`/cmdtest\` · \`/cmdtest list\` · \`/cmdtest report <key>\` if something breaks

Requires **roothelp 1.1.0** on the live server after upload + restart.`,

  `📣 **Public reachout & hourly treasury summary**

Large treasury events (grants, vote totals, Discord activity payouts) broadcast in-game and relay to **#ingame-chat** when configured.

**root-announcer** prepends an hourly line with grant/vote/Discord counts from the reserve.

Wiki hub: https://rootmc.net/wiki/ · questions in **#general** or \`/feedback\` in-game.`,
];

async function main() {
  for (let i = 0; i < POSTS.length; i++) {
    const body = POSTS[i];
    if (dryRun) {
      console.log(`--- post ${i + 1}/${POSTS.length} ---\n${body}\n`);
      continue;
    }
    const posted = await postDiscordMessageChunks({
      channelId: ROOTMC_CHANNELS.updates,
      content: body,
      userAgent: "RootMC/post-discord-updates-2026-07-02",
    });
    console.log(`posted ${i + 1}/${POSTS.length}`, posted[0]?.id);
    await new Promise((r) => setTimeout(r, 1200));
  }
}

main().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
