/**
 * Post every RootMC dedicated Cloudflare API route/handle to Discord (legacy mirror).
 *
 * Canonical home is Slack:
 *   #api-description (C0BM6HN0WMA)
 *   Canvas: https://rootmcworkspace.slack.com/docs/T0BM02SM1FE/F0BLMFRPA8P
 * Migrated from Discord #api-references (1520385893653938236).
 *
 * Usage:
 *   node scripts/post-rootmc-api-inventory.mjs
 *   node scripts/post-rootmc-api-inventory.mjs --channel 1520385893653938236 --pin
 */
import { loadRootMcEnv, rootMcBotToken, ROOTMC_URLS } from "./lib/rootmc-env.mjs";
import { ROOTMC_SLACK_CANVASES } from "./lib/rootmc-slack-channels.mjs";

const API = "https://discord.com/api/v10";
const GUILD_ID = "1516108585740800042";
/** Legacy Discord mirror only — prefer Slack #api-description + canvas. */
const DEFAULT_CHANNEL = "1520385893653938236";
const BASE = ROOTMC_URLS.api;

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
  `# RootMC — API reference (pinned)

**Canonical list** of RootMC Cloudflare endpoints — not RootRecord shards (\`rootrecord-api-*\`), legacy \`rootrecord-primary\`, or weather/business/token apps.

| Service | Base URL |
|---|---|
| **REST API** | \`${BASE}\` |
| **Website** | \`${ROOTMC_URLS.site}\` |
| **Map tiles** | \`${ROOTMC_URLS.map}\` |
| **Play server** | \`${ROOTMC_URLS.play}\` |
| **MC↔account link** | \`${ROOTMC_URLS.verify}\` |
| **Discord OAuth callback** | \`${BASE}/v1/discord/rootmc/oauth/callback\` |
| **Discord interactions** | \`POST ${BASE}/v1/discord/rootmc/interactions\` |

**Workers:** \`rootmc-api\` · \`rootmc-minecraft-map\` (map only)
**Source:** \`Web/cloudflare/rootmc-realm-api/src/realm-router.ts\`

_Paths use \`/api/…\` unless noted. Auth routes also mirror at \`/v1/…\`. \`{sid}\` = server id (usually \`rootmc\`)._`,

  `## Health & auth (\`rootmc-api\`)

| Method | Path | Auth |
|---|---|---|
| GET | \`/\`, \`/health\`, \`/api/health\` | public |
| POST | \`/v1/auth/login\`, \`/api/auth/login\` | public + device_id |
| POST | \`/v1/auth/signup\`, \`/api/auth/signup\`, \`/api/auth/register\` | public + device_id |
| GET | \`/v1/me\`, \`/api/v1/me\`, \`/api/auth/me\` | Bearer |
| POST | \`/v1/auth/logout\`, \`/api/auth/logout\` | Bearer |
| POST | \`/v1/auth/logout-all\`, \`/api/auth/logout-all\` | Bearer |
| POST | \`/api/app-session/start\` | optional Bearer / guest |
| GET | \`/api/mobile/config\` | public (BlockNotes / RootMC app) |
| POST | \`/api/feedback\` | Bearer or X-Guest-Id |
| POST | \`/api/me/push-token\` | Bearer (FCM) |
| POST | \`/api/internal/push-broadcast\` | X-RR-Push-Admin-Key |`,

  `## Discord surface (\`rootmc-api\`)

| Method | Path | Notes |
|---|---|---|
| GET | \`/v1/discord/rootmc/oauth/callback\` | OAuth redirect (alias \`…/callback\`) |
| GET | \`/v1/discord/rootmc/interactions\` | GET = hint only |
| POST | \`/v1/discord/rootmc/interactions\` | Slash commands + buttons |

**Slash commands:** \`/help\` · \`/server\` · \`/value\` · \`/worth\` · \`/balance\` · \`/bal\` · \`/pay\` · \`/systemreport\` · \`/proposal\`
**Buttons:** proposal vote (for/against/abstain) · timezone role selects`,

  `## Reference data (GET, public)

• \`/api/reference/manifest\`
• \`/api/reference/{blocks|items|mobs|enchantments|potions|trades}\`

## Realm social (Bearer)

• \`/api/public/player/{idOrUsername}\` — public profile
• \`/api/rootmc/realm/profile/me\` GET/PUT
• \`/api/rootmc/realm/users/search?q=\`
• \`/api/rootmc/realm/friends\` · \`/friends/requests\`
• POST \`/friends/request\` · \`/friends/respond\`
• \`/api/rootmc/realm/groups\` GET/POST
• POST \`/groups/{id}/invite\` · \`/groups/invites/respond\`
• GET \`/groups/invites\`
• GET/PUT \`/groups/{id}/chambers\`
• GET/POST \`/groups/{id}/messages\`
• GET/PUT \`/api/sync/snapshot\` — BlockNotes cloud sync`,

  `## Server plugin auth (X-RootMC-Server-Key)

• POST \`/api/rootmc/server/heartbeat\`
• POST \`/api/rootmc/towny/sync\`
• POST \`/api/rootmc/ingame-chat\` · GET \`/ingame-chat/poll\`
• POST \`/api/rootmc/ingame-ask\` · \`/ingame-ask/feedback\`
• POST \`/api/rootmc/ingame-feedback\` · \`/ingame-report\`
• GET/POST \`/api/rootmc/ingame-events\` · POST \`/ingame-events/ack\`
• POST \`/api/realm/minecraft/economy/sync\`
• POST \`/api/realm/minecraft/economy/shop-listing\`
• POST \`/api/rootmc/blueprint/upload\`
• POST \`/api/rootmc/daily-report/preview\` · \`/reset-all\`
• POST \`/api/rootmc/daily-report/trigger-all\`
• POST \`/api/rootmc/daily-report/trigger-category/{economy_intel|towns|nations}\`
• POST \`/api/rootmc/daily-report/internal-category/{…}\` — JWT Bearer`,

  `## Economy & stats (public unless noted)

**Server:** GET \`/api/rootmc/server/config\` · \`/featured\` · \`/membership\` (Bearer)
GET \`/{sid}/playtime/me\` · \`/{sid}/mcmmo/me\` (Bearer)
GET \`/{sid}/playtime/leaderboard\` · \`/{sid}/mcmmo/leaderboard\`
GET \`/{sid}/shops\` · \`/{sid}/shops/prices\` · \`/{sid}/shops/player/{uuid}\`
GET \`/{sid}/economy/net-worth\` · \`/{sid}/economy/totals\` · \`/{sid}/economy/me\` (Bearer)
GET \`/api/rootmc/server/value?item=\` — item price lookup
GET \`/api/rootmc/towny/me\` (Bearer) · GET \`/api/rootmc/season\`
GET \`/api/rootmc/weekly-activity/highlights\` — public weekly awards (rootmc.net)

**Treasury:** GET \`/api/rootmc/treasury/{sid}/reserve\` · \`/{sid}/ledger\` · \`/{sid}/town-taxes\`
**Vault market:** GET \`/api/rootmc/stock-market\` · \`/items\` · \`/history\` · GET \`/api/rootmc/vault\` — POST \`/api/rootmc/buy\` · \`/api/rootmc/vault/claim\` (Bearer)`,

  `## Minecraft link & RootStat (\`/api/realm/minecraft/…\`)

| Method | Path | Auth |
|---|---|---|
| GET | \`/stats/{uuid}\` | public |
| GET | \`/players/search?q=\` | public |
| POST | \`/server/register\` | server key |
| GET | \`/server/mine\` | Bearer |
| POST | \`/link/start\` · \`/link/complete\` | mixed |
| GET | \`/link/preview\` · \`/link/status\` | public / Bearer |
| POST | \`/link/discord/start\` | link code body |
| GET | \`/sync\` | server key |
| POST | \`/mcmmo/sync\` | server key |
| GET | \`/me\` | Bearer |

**Plugin pending queues (server key):**
GET/POST \`/api/rootmc/economy/transfers/pending|complete\`
GET/POST \`/api/rootmc/treasury/dividends/pending|complete\`

**Shop alerts (Bearer):** GET/POST \`/api/rootmc/shop-alerts\` · PATCH/DELETE \`/shop-alerts/{id}\``,

  `## AI reports (Bearer, quota)

• GET/POST \`/api/rootmc/world-ai\` — per-world Grok brief
• GET/POST \`/api/rootmc/server-ai\` — multi-world server report

## Blueprints

• POST \`/api/rootmc/blueprint/upload\` — server key → R2
• GET \`/api/rootmc/blueprint/file/{id}?t={token}\` — signed download

## Other HTTP (RootMC Cloudflare account)

**\`map.rootmc.net\`** (\`rootmc-minecraft-map\`) — BlueMap tiles (R2 hybrid + origin proxy), \`/__bluemap-live\` marker proxy. Not JSON REST.

**\`rootmc-realm-api\` Worker** — retired 410; all traffic → \`api.rootmc.net\`

_Legacy Discord mirror. Canonical: Slack #api-description · ${ROOTMC_SLACK_CANVASES.apiReference}_
_Re-run Discord mirror: \`node scripts/post-rootmc-api-inventory.mjs --channel ${CHANNEL_ID}\`_`,
];

console.log(
  "Note: canonical API reference is Slack #api-description + canvas:",
  ROOTMC_SLACK_CANVASES.apiReference,
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
  const res = await fetch(
    `${API}/channels/${encodeURIComponent(CHANNEL_ID)}/pins/${encodeURIComponent(messageId)}`,
    {
      method: "PUT",
      headers: { Authorization: `Bot ${token}` },
    },
  );
  if (!res.ok) throw new Error(`Pin failed ${res.status}: ${await res.text().catch(() => "")}`);
}

let first;
let last;
for (let i = 0; i < MESSAGES.length; i++) {
  const msg = await sendMessage(MESSAGES[i]);
  if (i === 0) first = msg;
  last = msg;
  await new Promise((r) => setTimeout(r, 600));
}
if (PIN_FIRST && first?.id) {
  await pinMessage(first.id);
  console.log(`Pinned ${first.id}`);
}
console.log(`Posted ${MESSAGES.length} messages → ${CHANNEL_ID}`);
console.log(`https://discord.com/channels/${GUILD_ID}/${CHANNEL_ID}/${last?.id || ""}`);
