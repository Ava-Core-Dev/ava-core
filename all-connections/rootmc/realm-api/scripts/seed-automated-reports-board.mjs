/**
 * Seed the Discord #automated-reports-legacy board message (one pinned post).
 * Ops home migrated to Slack #automated-reports (C0BM6KVFS0L) + canvas F0BMX9FP716.
 * After Worker deploy, the Discord board still auto-updates from D1 when reports post
 * (Slack Incoming Webhooks cannot edit a sticky board).
 *
 * Usage (from Web Files/rootmc-realm-api):
 *   node scripts/seed-automated-reports-board.mjs
 *   node scripts/seed-automated-reports-board.mjs --channel 1527441888443895958
 */
import {
  DISCORD_API,
  ROOTMC_CHANNELS,
  ROOTMC_GUILD_ID,
  discordMessageUrl,
  resolveRootMcChannel,
} from "./lib/rootmc-discord.mjs";
import { loadRootMcEnv, rootMcBotToken } from "./lib/rootmc-env.mjs";

const MARKER = "# Automated reports board";
const DEFAULT_CHANNEL = ROOTMC_CHANNELS.automatedReports || "1527441888443895958";

const channelArgIdx = process.argv.indexOf("--channel");
const CHANNEL_ID =
  channelArgIdx >= 0
    ? resolveRootMcChannel(String(process.argv[channelArgIdx + 1] || "").trim())
    : DEFAULT_CHANNEL;

const env = loadRootMcEnv();
const token = rootMcBotToken(env).replace(/^bot\s+/i, "").trim();

if (!/^\d{10,}$/.test(CHANNEL_ID)) {
  console.error("Invalid --channel id");
  process.exit(1);
}
if (token.length < 40) {
  console.error("Need DISCORD_ROOTMC_BOT_TOKEN in RootMC Workspace\\.env");
  process.exit(1);
}

const DAILY = "1516395175780286615";
const ECONOMY = "1516804780884889621";
const TOWNS = "1516282373426249878";
const NATIONS = "1516283667364974602";
const GENERAL = "1545284354157187083";

function content() {
  const now = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
  return [
    MARKER,
    `_Board refreshed: ${now}_`,
    `_Updates automatically when each report posts._`,
    "",
    "## Daily · 00:30 HST",
    `- **Combined summary** → <#${DAILY}>`,
    "  Last: _pending Worker refresh_",
    `- **Economy intel** → <#${ECONOMY}>`,
    "  Last: _pending Worker refresh_",
    `- **Towns brief** → <#${TOWNS}>`,
    "  Last: _pending Worker refresh_",
    `- **Nations brief** → <#${NATIONS}>`,
    "  Last: _pending Worker refresh_",
    "",
    "## Weekly · Sun 08:00 HST",
    `- **Activity awards** → <#${GENERAL}>`,
    "  Last: _pending Worker refresh_",
    `- **Weekly summary** → <#${DAILY}>`,
    "  Last: _pending Worker refresh_",
    `- **Weekly economy** → <#${ECONOMY}>`,
    "  Last: _pending Worker refresh_",
    `- **Weekly towns** → <#${TOWNS}>`,
    "  Last: _pending Worker refresh_",
    `- **Weekly nations** → <#${NATIONS}>`,
    "  Last: _pending Worker refresh_",
    "",
    "## Monthly · 1st 00:30 HST",
    `- **Activity Dividend** → <#${ECONOMY}>`,
    "  Last: _pending Worker refresh_",
  ].join("\n");
}

async function api(path, init = {}) {
  const res = await fetch(`${DISCORD_API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bot ${token}`,
      "Content-Type": "application/json",
      "User-Agent": "RootMC/seed-automated-reports-board",
      ...(init.headers || {}),
    },
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  if (!res.ok) {
    throw new Error(`Discord ${res.status}: ${text.slice(0, 400)}`);
  }
  return json;
}

async function findExisting() {
  const msgs = await api(`/channels/${CHANNEL_ID}/messages?limit=25`);
  if (!Array.isArray(msgs)) return null;
  for (const msg of msgs) {
    if (msg?.author?.bot && String(msg.content || "").startsWith(MARKER)) {
      return String(msg.id);
    }
  }
  return null;
}

const body = content();
let messageId = await findExisting();

if (messageId) {
  await api(`/channels/${CHANNEL_ID}/messages/${messageId}`, {
    method: "PATCH",
    body: JSON.stringify({ content: body.slice(0, 2000) }),
  });
  console.log("Updated existing board message");
} else {
  const created = await api(`/channels/${CHANNEL_ID}/messages`, {
    method: "POST",
    body: JSON.stringify({ content: body.slice(0, 2000) }),
  });
  messageId = String(created.id);
  console.log("Created board message");
}

try {
  await api(`/channels/${CHANNEL_ID}/pins/${messageId}`, {
    method: "PUT",
  });
  console.log("Pinned");
} catch (e) {
  console.warn("Pin skipped:", e instanceof Error ? e.message : String(e));
}

console.log(discordMessageUrl(CHANNEL_ID, messageId, ROOTMC_GUILD_ID));
console.log(
  "After deploy + D1 migration 0152, Worker will overwrite Last: lines from D1 on each report suite.",
);
