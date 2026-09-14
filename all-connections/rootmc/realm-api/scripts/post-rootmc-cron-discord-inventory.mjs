/**
 * Post RootMC dedicated Cloudflare (rootmc-api) cron reference (legacy Discord mirror).
 *
 * Canonical home is Slack:
 *   #crons-automation (C0BLMHKTCTH)
 *   Canvas: https://rootmcworkspace.slack.com/docs/T0BM02SM1FE/F0BLZK9RHHT
 * Migrated from Discord #crons-automation (1520387570004135956).
 *
 * Usage:
 *   node scripts/post-rootmc-cron-discord-inventory.mjs
 *   node scripts/post-rootmc-cron-discord-inventory.mjs --channel 1520387570004135956 --pin
 */
import { loadRootMcEnv, rootMcBotToken } from "./lib/rootmc-env.mjs";
import { ROOTMC_SLACK_CANVASES } from "./lib/rootmc-slack-channels.mjs";

const API = "https://discord.com/api/v10";
const GUILD_ID = "1516108585740800042";
/** Legacy Discord mirror only — prefer Slack #crons-automation + canvas. */
const DEFAULT_CHANNEL = "1520387570004135956";

const channelArgIdx = process.argv.indexOf("--channel");
const CHANNEL_ID =
  channelArgIdx >= 0
    ? String(process.argv[channelArgIdx + 1] || "").trim()
    : DEFAULT_CHANNEL;
const PIN_FIRST = process.argv.includes("--pin");

const env = loadRootMcEnv();
const token = rootMcBotToken(env);

if (!/^\d{10,}$/.test(CHANNEL_ID)) {
  console.error("Invalid --channel id");
  process.exit(1);
}
if (token.length < 40) {
  console.error("Need DISCORD_ROOTMC_BOT_TOKEN");
  process.exit(1);
}

const MESSAGES = [
  `# RootMC crons — dedicated Cloudflare (\`rootmc-api\`)

**Worker:** \`rootmc-api\` on api.rootmc.net · **Account:** RootMC Cloudflare (not RootRecord shards)
**Source:** \`Web/cloudflare/rootmc-api/wrangler.toml\` → \`rootmc-realm-api/src/realm-index.ts\`

## Registered cron expressions (4)

| Schedule | When (UTC) | When (HST) |
|---|---|---|
| \`*/10 * * * *\` | Every 10 min | Every 10 min |
| \`0 10 * * *\` | Daily 10:00 | Daily 00:00 (midnight) |
| \`0 20 * * 1\` | Sun 20:00 | Sun 10:00 |
| \`0 10 1 * *\` | 1st of month 10:00 | 1st 00:00 |

_Note: Daily AI reports use the \`0 10 * * *\` slot but **retry every 10 min** during UTC hour 10 until posted._`,

  `## Every 10 minutes — all jobs (\`*/10\`)

| Job | Discord? | Channel / target |
|---|---|---|
| **Town/nation channel reconcile** | ❌ disabled | Categories \`1516282271848726628\` / \`1516283613283483749\` removed; create/delete/DM automation off until categories return |
| **Community proposal expiry** | ✅ | Updates vote embed in forum \`1516143406315737169\`; result ping → \`1545284354157187083\` (#general-chat) |
| **Discord activity sync** | 📥 ingest | Reads guild messages (excludes \`1516391754625187921\`, \`1516395175780286615\`, \`1545283818146242642\`) → D1 for weekly awards |
| **Shop price alerts** | ❌ | FCM push only (no Discord) |
| **Paper token price** | ❌ | D1 price history only |
| **MySQL economy pull** | ❌ | Hyperdrive → Shockbyte MySQL → D1 (website/market read model) |
| **Proposal DB expire helper** | — | Same row as proposal expiry above |`,

  `## Daily — midnight HST (\`0 10 * * *\` + */10 retries in UTC hour 10)

| Report | Discord channel ID | Channel |
|---|---|---|
| Combined daily summary (Grok) | \`1516395175780286615\` | #daily-summary |
| Economy intel brief | \`1516804780884889621\` | #economy-guide |
| Towns brief | \`1516282373426249878\` | town info |
| Nations brief | \`1516283667364974602\` | nation info |
| Raw Grok JSON archive | \`1545283818146242642\` | RootRecord business Discord (AI raw) |

**Also reads** (no post): \`1545284354157187083\` + forum \`1516143406315737169\` for ops highlights in daily prompt.`,

  `## Weekly — Sunday 10:00 HST (\`0 20 * * 1\`, retried on */10 ticks while UTC hour = 20)

| Job | Discord channel ID | What posts |
|---|---|---|
| **Top Participator + Top Active Player awards** | \`1545284354157187083\` | Role grants + announcement in #general-chat |
| **Weekly combined intelligence** | \`1516395175780286615\` | Grok weekly summary |
| **Weekly economy_intel** | \`1516804780884889621\` | Category brief |
| **Weekly towns** | \`1516282373426249878\` | Category brief |
| **Weekly nations** | \`1516283667364974602\` | Category brief |
| Raw Grok archive | \`1545283818146242642\` | weekly_combined + weekly_category JSON |`,

  `## Monthly — 1st midnight HST (\`0 10 1 * *\`, slot check: HST day=1 & UTC hour=10)

| Job | Discord channel ID | What posts |
|---|---|---|
| **Activity Dividend** (treasury payout queue + Grok report) | \`1516804780884889621\` | #economy-guide — monthly dividend brief with **exact per-player Gold**; wallet credits queued in-game |

_Retry:_ \`maybePostMonthlyDividendDiscordReport\` on every \`*/10\` tick when UTC hour = 10 if run exists but Discord post missing._

---

## Not crons (event-driven Discord posts on same Worker)

• **In-game chat** → \`1545284399107547179\` · **Feedback** → Slack #feedback (\`C0BLMGBVAMD\`; Discord legacy \`1516828735536365669\`) · **Reports** → category \`1517360597686157605\`
• **Towny founded/fallen** (plugin sync) → \`1516282373426249878\` / \`1516283667364974602\`
• **MC↔Discord link** → \`1545284354157187083\` + \`1516121832493678612\`
• **World AI success** → \`1511922772983545947\` · **App session starts** → \`1545278495750361171\` (RootRecord guild)

## RootMC bot (slash — not scheduled)

\`/server\`, \`/value\`, \`/balance\`, \`/pay\`, \`/proposal\` — interactive via \`POST /v1/discord/rootmc/interactions\`

**Link flow** (\`/realm/verify\` OAuth): roles \`1516396491973984256\` (linked), \`1516733173998813214\` (MC sync); posts general + admins.

## Minecraft plugin → API (Shockbyte, not Worker crons)

• **Towny snapshot** — MySQL + D1 town/nation rows → triggers founded/fallen Discord posts (private channel reconcile disabled)
• **In-game chat poll** — reads \`1545284399107547179\`, posts MC chat to Discord
• **Feedback / report** — RootHelp + Root-Admin → feedback + ticket channels

## Manual one-shot scripts (\`rootmc-realm-api/scripts/\`)

| Script | Target |
|---|---|
| \`post-rootmc-rules.mjs\` | \`1516392367869919243\` |
| \`post-rootmc-unverified-guide.mjs\` | \`1519249871326937138\` |
| \`post-rootmc-economy-tutorial.mjs\` | \`1516804780884889621\` |
| \`post-rootmc-admin-backend.mjs\` | \`1516121832493678612\` |
| \`post-rootmc-monthly-dividend-test.mjs\` | \`1516804780884889621\` (TEST — no payouts) |

_Legacy Discord mirror. Canonical: Slack #crons-automation · ${ROOTMC_SLACK_CANVASES.cronsAutomation}_
_Re-run Discord mirror: \`node scripts/post-rootmc-cron-discord-inventory.mjs --channel ${CHANNEL_ID} --pin\`_`,
];

console.log(
  "Note: canonical cron inventory is Slack #crons-automation + canvas:",
  ROOTMC_SLACK_CANVASES.cronsAutomation,
);

async function sendMessage(content) {
  const res = await fetch(`${API}/channels/${encodeURIComponent(CHANNEL_ID)}/messages`, {
    method: "POST",
    headers: {
      Authorization: `Bot ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ content: content.slice(0, 2000) }),
  });
  if (!res.ok) throw new Error(`Discord ${res.status}: ${await res.text().catch(() => "")}`);
  return res.json();
}

async function pinMessage(messageId) {
  const res = await fetch(`${API}/channels/${encodeURIComponent(CHANNEL_ID)}/pins/${messageId}`, {
    method: "PUT",
    headers: { Authorization: `Bot ${token}` },
  });
  if (!res.ok) throw new Error(`Pin ${res.status}`);
}

let first;
let last;
for (const part of MESSAGES) {
  const msg = await sendMessage(part);
  if (!first) first = msg;
  last = msg;
  await new Promise((r) => setTimeout(r, 600));
}
if (PIN_FIRST && first?.id) {
  await pinMessage(first.id);
  console.log(`Pinned ${first.id}`);
}
console.log(`Posted ${MESSAGES.length} messages → ${CHANNEL_ID}`);
console.log(`https://discord.com/channels/${GUILD_ID}/${CHANNEL_ID}/${last?.id || ""}`);
