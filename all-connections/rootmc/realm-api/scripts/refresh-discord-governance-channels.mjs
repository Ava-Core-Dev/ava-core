/**
 * Refresh #constitution, #proposals, #voting — delete stale bot posts, repost pinned intros.
 * Keeps active Council poll messages (vote button components) in #voting.
 *
 *   node scripts/refresh-discord-governance-channels.mjs --confirm
 */
import { loadRootMcEnv, rootMcBotToken } from "./lib/rootmc-env.mjs";
import {
  ROOTMC_CHANNELS,
  postDiscordMessage,
  postDiscordMessageChunks,
  splitDiscordContent,
} from "./lib/rootmc-discord.mjs";

const API = "https://discord.com/api/v10";
const VOTE_PREFIX = "rootmc_prop:vote:";

const CHANNELS = {
  constitution: ROOTMC_CHANNELS.constitution,
  proposals: ROOTMC_CHANNELS.proposals,
  voting: ROOTMC_CHANNELS.voting,
  governance: ROOTMC_CHANNELS.governance,
};

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function discordReq(token, method, route, body) {
  const res = await fetch(`${API}${route}`, {
    method,
    headers: {
      Authorization: `Bot ${token}`,
      "Content-Type": "application/json; charset=utf-8",
      "User-Agent": "RootMC/refresh-discord-governance-channels",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (res.status === 429) {
    const j = await res.json().catch(() => ({}));
    await sleep(Math.ceil((j.retry_after || 1) * 1000) + 300);
    return discordReq(token, method, route, body);
  }
  const text = await res.text();
  if (!res.ok && res.status !== 404) {
    throw new Error(`${method} ${route} → ${res.status}: ${text.slice(0, 400)}`);
  }
  return text ? JSON.parse(text) : null;
}

function isActivePollMessage(msg) {
  const components = msg.components || [];
  for (const row of components) {
    for (const btn of row.components || []) {
      if (String(btn.custom_id || "").startsWith(VOTE_PREFIX)) return true;
    }
  }
  return false;
}

async function fetchAllMessages(token, channelId) {
  const out = [];
  let before = null;
  for (let page = 0; page < 30; page++) {
    const q = before ? `?limit=100&before=${before}` : "?limit=100";
    const batch = await discordReq(token, "GET", `/channels/${channelId}/messages${q}`);
    if (!batch?.length) break;
    out.push(...batch);
    before = batch[batch.length - 1].id;
    if (batch.length < 100) break;
    await sleep(350);
  }
  return out;
}

async function clearPins(token, channelId) {
  const pins = await discordReq(token, "GET", `/channels/${channelId}/pins`);
  for (const pin of pins || []) {
    await discordReq(token, "DELETE", `/channels/${channelId}/pins/${pin.id}`);
    await sleep(300);
  }
}

async function deleteMessage(token, channelId, messageId) {
  await discordReq(token, "DELETE", `/channels/${channelId}/messages/${messageId}`);
  await sleep(350);
}

async function refreshChannel(token, channelId, name, { keepPolls = false, pinChunks }) {
  console.log(`\n=== #${name} (${channelId}) ===`);
  const messages = await fetchAllMessages(token, channelId);
  console.log(`Fetched ${messages.length} messages`);

  await clearPins(token, channelId);

  let deleted = 0;
  let kept = 0;
  for (const msg of messages) {
    if (keepPolls && isActivePollMessage(msg)) {
      kept++;
      continue;
    }
    try {
      await deleteMessage(token, channelId, msg.id);
      deleted++;
    } catch (e) {
      console.warn("delete failed", msg.id, e.message);
    }
  }
  console.log(`Deleted ${deleted}, kept ${kept}`);

  const chunks = Array.isArray(pinChunks) ? pinChunks : splitDiscordContent(pinChunks);
  const posted = [];
  for (const chunk of chunks) {
    posted.push(
      await postDiscordMessage({
        channelId,
        content: chunk,
        token,
        userAgent: "RootMC/refresh-discord-governance-channels",
      }),
    );
    await sleep(400);
  }
  await discordReq(token, "PUT", `/channels/${channelId}/pins/${posted[0].id}`);
  console.log("Pinned intro", posted[0].id);
  return posted[0].id;
}

const CONSTITUTION_BODY = `📜 **RootMC Constitution**

**Version \`2026-07-06\`** · ratified **July 6, 2026 (HST)** (poll \`549cf16c\`)

Authoritative policy for **Gold**, **Gold-backed Notes**, the **Server Reserve**, treasury grants, and governance.

**Full document:** https://rootmc.net/wiki/constitution/

**Vote requirements:** https://rootmc.net/council/#vote-requirements

**Core rules**
• Closed-loop reserve — automated payouts debit the treasury
• **All Gold is redeemable** at the mint peg (\`/mint\`)
• Dynamic transaction tax while Notes are over-issued — \`/tax\`
• Live economy &amp; Server Reserve: https://rootmc.net/economy/

**Citizen legislature (web-first)**
• Hub: https://rootmc.net/council/
• Propose: in-game \`/proposal <idea>\` (64 G) — any linked player; Ava publishes
• **#proposals** — discussion threads · **#voting** — weighted polls
• Vote Shards in \`/ec\` + linked Discord + terms to vote

**This channel is read-only.** Wiki updates first; Discord mirrors policy.

Guides: https://rootmc.net/wiki/economy/ · https://rootmc.net/wiki/player/`;

const PROPOSALS_BODY = `📋 **Citizen proposals**

Full proposal text lives on **rootmc.net**. This channel posts **links + public discussion threads** only.

**Submit a proposal (only way)**
• In-game: \`/proposal <your idea>\` (64 G → Server Reserve)
• Any linked player can propose (Terms accepted). Ava publishes the formal proposal — including catch-up from the official queue if she was offline.
• https://rootmc.net/governance/submit/ explains the flow

**Discuss** in each proposal's thread — any **verified (Linked)** player can talk. Thread discussion is summarized into the weekly bill before the Council vote.

**Weekly pipeline**
1. Ava publishes from the in-game queue (must be published **≥3 days** before Sunday compile)
2. **Sunday (HST)** — eligible pending items compile into a **weekly bill** (late-week posts roll to next week)
3. **48h** — amendments on https://rootmc.net/governance/bills/
4. **#voting** — weighted Council vote (text or site; Ava seeds vote_yes/vote_no/➖)

**Commands:** \`/proposals list\` · \`/proposals discuss id:<id>\` · \`/proposals retract id:<id>\`
Law: <#${CHANNELS.constitution}> · Hub: https://rootmc.net/governance/`;

const VOTING_BODY = `🗳️ **Council of Voters — official polls**

This channel is **read-only**. Bot polls here use **weighted governance %** (not one player = one vote).

**How to vote**
• Reply with text on each poll (or use the site form) — Discord buttons retired; Ava seeds vote_yes / vote_no / ➖ at open
• Site: https://rootmc.net/governance/ (same linked account)
• Accept **Terms of Service** first: https://rootmc.net/terms/

**Before you vote**
1. Link at https://rootmc.net/verify/ (in-game \`/link\` + Discord)
2. Hold **Vote Shards in \`/ec\`** (merge with \`/voteshard merge\`)
3. \`/vote\` — shows your **% of total governance power** and open polls

**Metrics on each poll:** weighted For / Against / Abstain % · voter count · closes UTC

**Vote rules:** https://rootmc.net/council/#vote-requirements
**Power:** Vote Shards in \`/ec\` × Pro multiplier → your **% of 100%** (playtime / net worth do not count)

Anyone linked may **propose** in-game with \`/proposal\`. Only voters cast weighted votes.

Proposals & threads: <#${CHANNELS.proposals}> · Constitution: <#${CHANNELS.constitution}>`;

const GOVERNANCE_BODY = `🗳️ **Governance discussion**

Linked players discuss policy here. **Official text and votes live on rootmc.net.**

• Hub: https://rootmc.net/governance/
• Propose: in-game \`/proposal <idea>\` (64 G) — https://rootmc.net/governance/submit/
• Terms (required to vote): https://rootmc.net/terms/

**Weekly pipeline:** Ava publishes (≥**3 days** before Sunday compile) → Sunday bill → **48h** amendments → <#${CHANNELS.voting}> vote (**7 days**, **>50%** weighted)

**Power formula:** Vote Shards in \`/ec\` × Pro → your **% of 100%**
Check \`/vote\` · Policy: https://rootmc.net/wiki/constitution/#governance-voting · Rules: https://rootmc.net/council/

**Not the same as** vote-site Gold (1–20 G) — that's a separate wallet reward from the reserve.

Proposal threads: <#${CHANNELS.proposals}> · Council votes: <#${CHANNELS.voting}> · Law: <#${CHANNELS.constitution}>`;

const confirm = process.argv.includes("--confirm");
const token = rootMcBotToken(loadRootMcEnv());

if (!confirm) {
  console.log("Dry run — would refresh constitution, proposals, voting, governance pins.");
  console.log("Pass --confirm to delete stale messages and repost.");
  process.exit(0);
}

await refreshChannel(token, CHANNELS.constitution, "constitution", {
  pinChunks: CONSTITUTION_BODY,
});

await refreshChannel(token, CHANNELS.proposals, "proposals", {
  pinChunks: PROPOSALS_BODY,
});

await refreshChannel(token, CHANNELS.voting, "voting", {
  keepPolls: true,
  pinChunks: VOTING_BODY,
});

await refreshChannel(token, CHANNELS.governance, "governance", {
  pinChunks: GOVERNANCE_BODY,
});

console.log("\nDone — governance Discord channels refreshed.");
