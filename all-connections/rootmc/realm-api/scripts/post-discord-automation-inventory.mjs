/**
 * Post Discord automation inventory (MonoRepo source of truth).
 *
 * Usage (from Web/cloudflare/rootmc-realm-api/):
 *   node scripts/post-discord-automation-inventory.mjs
 *   node scripts/post-discord-automation-inventory.mjs --channel 1520366347194990682
 */
import { loadRootMcEnv, rootMcBotToken } from "./lib/rootmc-env.mjs";

const API = "https://discord.com/api/v10";
const DEFAULT_CHANNEL = "1520366347194990682";

const channelArgIdx = process.argv.indexOf("--channel");
const CHANNEL_ID =
  channelArgIdx >= 0
    ? String(process.argv[channelArgIdx + 1] || "").trim()
    : DEFAULT_CHANNEL;

const env = loadRootMcEnv();
const token = rootMcBotToken(env);

if (!/^\d{10,}$/.test(CHANNEL_ID)) {
  console.error("Invalid --channel id");
  process.exit(1);
}
if (token.length < 40) {
  console.error("Need DISCORD_ROOTMC_BOT_TOKEN in credentials.env or Desktop RootMC .env");
  process.exit(1);
}

const MESSAGES = [
  `# Discord automations inventory
_Scan of MonoRepo — ${new Date().toISOString().slice(0, 10)}. Guild \`1516108585740800042\` = **RootMC**; \`1497039564345442406\` = **RootRecord** (main product Discord)._

## RootMC Worker (\`rootmc-api\` / api.rootmc.net)

**Crons** (\`wrangler.toml\`):
• \`*/10 * * * *\` — town/nation channel reconcile, shop price alerts (FCM, not Discord), Discord activity ingest, paper token price, MySQL→D1 economy pull
• \`0 10 * * *\` — daily AI reports (~midnight HST)
• \`0 20 * * 1\` — weekly awards + intelligence (Sun 10:00 HST)
• \`0 10 1 * *\` — monthly Activity Dividend (in-game; no Discord post)`,

  `### RootMC — fixed channel IDs

| Channel ID | Config key | Function |
|---|---|---|
| \`1545284354157187083\` | DISCORD_ROOTMC_GENERAL_CHAT_CHANNEL_ID | Public chat; weekly activity awards; season-arc tips; proposal result pings; link welcome |
| \`1545284399107547179\` | DISCORD_ROOTMC_INGAME_CHAT_CHANNEL_ID | **In-game ↔ Discord chat bridge** (MC→Discord POST, MC polls Discord GET) |
| \`1516828735536365669\` | (legacy) DISCORD_ROOTMC_INGAME_FEEDBACK_CHANNEL_ID | Migrated → Slack #feedback \`C0BLMGBVAMD\` + \`SLACK_FEEDBACK_WEBHOOK_URL\` |
| \`1517360597686157605\` | DISCORD_ROOTMC_REPORT_TICKETS_CATEGORY_ID | In-game \`/report\` (Root-Admin) → private ticket channels/threads |
| \`1516395175780286615\` | DISCORD_ROOTMC_DAILY_REPORT_CHANNEL_ID | **Daily combined AI summary** (midnight HST) + weekly combined report |
| \`1516804780884889621\` | DISCORD_ROOTMC_ECONOMY_ANNOUNCE_CHANNEL_ID | Economy guide + **daily/weekly economy_intel** Grok briefs |
| \`1516282373426249878\` | DISCORD_ROOTMC_TOWN_INFO_CHANNEL_ID | **Daily/weekly towns** briefs + Towny founded/fallen announcements |
| \`1516283667364974602\` | DISCORD_ROOTMC_NATION_INFO_CHANNEL_ID | **Daily/weekly nations** briefs + nation founded/fallen announcements |
| \`1516143406315737169\` | DISCORD_ROOTMC_OPERATIONS_FORUM_CHANNEL_ID / APPEALS | Community proposals forum threads; daily ops digest input; appeals |
| \`1516391754625187921\` | DISCORD_FEEDBACK_CHANNEL_ID / BOT_SPAM | Legacy feedback + bot-spam (excluded from activity scoring) |
| \`1516121832493678612\` | DISCORD_ROOTMC_ADMINS_CHANNEL_ID | Staff/admin; link notifications; permission-locked channel |
| \`1511922772983545947\` | DISCORD_ROOTMC_AI_ARCHIVE_CHANNEL_ID | Successful in-game **world AI** report copies (BlockNotes) |
| \`1545283818146242642\` | DISCORD_ROOTMC_AI_RAW_ARCHIVE_CHANNEL_ID | Raw Grok JSON for daily/weekly AI (RootRecord business Discord) |
| \`1516392367869919243\` | DISCORD_ROOTMC_RULES_CHANNEL_ID | Rules (manual script \`post-rootmc-rules.mjs\`; read-only perms) |
| \`1519249871326937138\` | DISCORD_ROOTMC_UNVERIFIED_CHANNEL_ID | Unverified onboarding guide (\`post-rootmc-unverified-guide.mjs\`) |
| \`1545278495750361171\` | DISCORD_APP_SESSION_CHANNEL_ID | **App session starts** (all RootRecord apps via shared notify) |`,

  `### RootMC — dynamic / category automations

| ID | Function |
|---|---|
| \`1516282271848726628\` | **Town category (DISABLED)** — private channel create/delete automation off |
| \`1516283613283483749\` | **Nation category (DISABLED)** — same |
| D1 \`rootmc_discord_town_channels\` | Per-town channel IDs (not fixed; created at runtime) |
| D1 \`rootmc_discord_nation_channels\` | Per-nation channel IDs (not fixed) |

**RootMC bot** (\`POST /v1/discord/rootmc/interactions\`): slash \`/server\`, \`/value\`, \`/balance\`, \`/pay\`, \`/proposal\`, timezone roles — interactive, not scheduled.

**Link flow** (\`/realm/verify\`, OAuth): assigns roles \`1516396491973984256\` (linked), \`1516733173998813214\` (MC sync); posts to general + admins.`,

  `## RootRecord main Discord (\`rootrecord-api-account\`)

**Cron \`* * * * *\`** (every minute, account shard):
• **Discord developer sync** → reads \`1512245745166581821\` (DISCORD_ANNOUNCEMENTS_CHANNEL_ID) → D1 \`developer_messages\` + activity tables
• Root Economy Discord ping → **disabled** unless \`ROOT_ECONOMY_DISCORD_CRON_ENABLED=1\` (webhook secret, channel not in repo)
• Farms varmint / custodial deposit / on-chain buy monitors — mostly non-Discord

| Channel ID | Config key | Function |
|---|---|---|
| \`1512245745166581821\` | DISCORD_ANNOUNCEMENTS / GLOBAL_RELEASES | Dev announcements ingest (every minute) |
| \`1497160346358644767\` | DISCORD_WELCOME_CHANNEL_ID | Welcome (ops perm script) |
| \`1497039565461000214\` | DISCORD_VERIFIED_CHAT_CHANNEL_ID | Post on successful RootRecord↔Discord link |
| \`1505853241915736154\` | DISCORD_ROOTS_BUY_CHANNEL_ID | On-chain ROOTS buy notifications |
| \`1499489364147835090\` | DISCORD_PARTNERSHIP_REPORT_CHANNEL_ID | Partnership signup Grok reports |
| \`1545283785803960393\` | DISCORD_KILAUEA_REPORT / ALERTS | Kīlauea USGS quake embeds + reports (also kilauea worker) |
| \`1545283818146242642\` | DISCORD_KILAUEA_AI_ARCHIVE | Kīlauea AI raw archive |

**Global Updater bot**: \`/root\` slash → multi-guild fan-out (D1 \`root_updates_discord_guild_config\`; per-guild channel IDs in DB, not hardcoded).

**Root Economy bot** (separate app): \`/economy\` interactions — manual slash, webhook cron optional.

**Webhook-only** (no channel ID in git): DISCORD_FEEDBACK_WEBHOOK_URL, DISCORD_WEBHOOK_SOLANA_TOOLS, DISCORD_TOKEN_CREATE_WEBHOOK_URL, DISCORD_ROOT_ECONOMY_WEBHOOK_URL`,

  `## Kīlauea Worker (\`rootrecord-api-kilauea\`)

**Cron \`*/10 * * * *\`**: USGS earthquake poll → Discord alert channels (per-guild config + default \`1545283785803960393\`); Kīlauea AI analysis when triggered.

| Channel ID | Function |
|---|---|
| \`1545283785803960393\` | USGS / Kīlauea alert embeds |
| \`1545283818146242642\` | AI prompt/response archive |
| \`1499515809767096443\` | Kīlauea app feedback (bot or webhook) |

**Kīlauea Discord bot**: slash commands (register script); not a posting cron.

## Other shards (developer sync only)

\`rootrecord-api-weather\`, \`rootrecord-api-token\`, \`rootrecord-solana-tx\`, legacy \`rootrecord-primary\`: **same pattern** — cron/read \`1512245745166581821\` → D1 developer feed (account worker is canonical writer today).

## Manual one-shot post scripts

| Script | Target channel |
|---|---|
| \`post-rootmc-admin-backend.mjs\` | \`1516121832493678612\` |
| \`post-rootmc-unverified-guide.mjs\` | \`1519249871326937138\` |
| \`post-rootmc-economy-tutorial.mjs\` | \`1516804780884889621\` |
| \`discord-post-website-announcement.mjs\` | arg (default \`1512245745166581821\`) |
| \`discord-post-kilauea-announcement.mjs\` | Kīlauea alerts channel |
| \`discord-guild-ops.mjs\` | bulk permission sync (no auto-post) |

## In-game → API → Discord (not Worker crons)

• **Global chat** → \`1545284399107547179\`
• **Feedback** → Slack #feedback \`C0BLMGBVAMD\` (Discord legacy \`1516828735536365669\`)
• **Reports** → ticket category \`1517360597686157605\`
• **Towny sync** (plugin) → triggers town/nation announce + channel reconcile

_No Cursor IDE automations found in MonoRepo for Discord._`,

  `_Source: \`Web/cloudflare/rootmc-api/wrangler.toml\`, \`rootmc-realm-api/src/realm-index.ts\`, \`rootrecord-api-account/wrangler.toml\`, \`rootrecord-api-kilauea/wrangler.toml\`. Re-run: \`node scripts/post-discord-automation-inventory.mjs --channel ${CHANNEL_ID}\`_`,
];

async function sendMessage(content) {
  const res = await fetch(`${API}/channels/${encodeURIComponent(CHANNEL_ID)}/messages`, {
    method: "POST",
    headers: {
      Authorization: `Bot ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ content: content.slice(0, 2000) }),
  });
  if (!res.ok) {
    throw new Error(`Discord ${res.status}: ${await res.text().catch(() => "")}`);
  }
  return res.json();
}

let last;
for (const part of MESSAGES) {
  last = await sendMessage(part);
  await new Promise((r) => setTimeout(r, 600));
}
console.log(`Posted ${MESSAGES.length} messages to channel ${CHANNEL_ID}`);
console.log(`https://discord.com/channels/1516108585740800042/${CHANNEL_ID}/${last?.id || ""}`);
