/**
 * RootMC Discord bot helpers for local ops scripts.
 * Token: DISCORD_ROOTMC_BOT_TOKEN in RootMC Workspace\.env (via loadRootMcEnv).
 */
import { loadRootMcEnv, rootMcBotToken } from "./rootmc-env.mjs";

export const DISCORD_API = "https://discord.com/api/v10";

/** RootMC guild (play.rootmc.net Discord). */
export const ROOTMC_GUILD_ID = "1516108585740800042";

/** Common channel IDs — use names with resolveRootMcChannel(). */
export const ROOTMC_CHANNELS = {
  updates: "1545284423740563528",
  general: "1545284354157187083",
  admins: "1516121832493678612",
  rules: "1516392367869919243",
  economy: "1516804780884889621",
  dailyReport: "1539779979280257054",
  /** Ava home — automated reports + daily digest live here now. */
  automatedReports: "1539779979280257054",
  ingameChat: "1545284399107547179",
  ingameFeedback: "1516828735536365669", // Legacy — delivery is Slack #feedback (C0BLMGBVAMD)
  feedback: "1516391754625187921",
  townInfo: "",
  nationInfo: "",
  operationsForum: "1516143406315737169",
  constitution: "1522406019152478210",
  governance: "1522406451413385317",
  voting: "1522413185364398090",
  /** #server-logs moved to Slack C0BMX0QKSTS (Incoming Webhook). Discord id kept as dead fallback only. */
  logs: "1529414449088172064",
  /** Production wrangler (canonical text #proposals — forum 152666… is discussion threads only). */
  proposals: "1533012499320934602",
  /** Forum for proposal discussion threads (legacy id; type=15). */
  proposalsForum: "1526664180491358419",
  /** Gen 2 isolated dump — silent posts only (api2). */
  gen2: "1527451269252382890",
  /** Hourly Gen1 + Gen2 realm snapshots (combined). */
  hourlySnapshots: "1539779979280257054",
  /** Public paid plugin sales research / planning. Migrated to Slack #plugin-sales (C0BLZCVAC3X). */
  pluginSales: "1529247837420912751",
  /** Pinned API endpoint reference. Migrated to Slack #api-description (C0BM6HN0WMA) + canvas F0BLMFRPA8P. */
  apiReferences: "1520385893653938236",
  /** Discord channel ID inventory. Migrated to Slack #discord-channels (C0BM4QT5U0Z) + canvas F0BLMFYJYEB. */
  discordIds: "1520386796406706216",
  /** Worker cron inventory. Migrated to Slack #crons-automation (C0BLMHKTCTH) + canvas F0BLZK9RHHT. */
  cronsAutomation: "1520387570004135956",
  /** Root-Try QA / rewarded tryout checklist. */
  tasks: "1529753661901639761",
};

const CHANNEL_ALIASES = {
  "#updates": "updates",
  updates: "updates",
  "#general": "general",
  "general-chat": "general",
  general: "general",
  admins: "admins",
  rules: "rules",
  constitution: "constitution",
  governance: "governance",
  voting: "voting",
  proposals: "proposals",
  economy: "economy",
  "#economy-guide": "economy",
  "daily-report": "dailyReport",
  dailyReport: "dailyReport",
  "automated-reports": "automatedReports",
  automatedReports: "automatedReports",
  gen2: "gen2",
  "gen-2": "gen2",
  g2: "gen2",
  hourlySnapshots: "hourlySnapshots",
  "hourly-snapshots": "hourlySnapshots",
  hourly: "hourlySnapshots",
  pluginSales: "pluginSales",
  "plugin-sales": "pluginSales",
  "#plugin-sales": "pluginSales",
  apiReferences: "apiReferences",
  "api-references": "apiReferences",
  "#api-references": "apiReferences",
  "api-description": "apiReferences",
  discordIds: "discordIds",
  "discord-ids": "discordIds",
  "#discord-ids": "discordIds",
  "discord-channels": "discordIds",
  cronsAutomation: "cronsAutomation",
  "crons-automation": "cronsAutomation",
  "#crons-automation": "cronsAutomation",
  tasks: "tasks",
  "#tasks": "tasks",
  try: "tasks",
  "root-try": "tasks",
  logs: "logs",
  "#logs": "logs",
  "server-logs": "logs",
};

export function resolveRootMcChannel(nameOrId) {
  const raw = String(nameOrId || "updates").trim();
  if (/^\d{10,}$/.test(raw)) return raw;
  const key = CHANNEL_ALIASES[raw] || CHANNEL_ALIASES[raw.toLowerCase()] || raw;
  const id = ROOTMC_CHANNELS[key];
  if (!id) throw new Error(`Unknown channel "${raw}". Use a numeric id or: ${Object.keys(ROOTMC_CHANNELS).join(", ")}`);
  return id;
}

export function discordMessageUrl(channelId, messageId, guildId = ROOTMC_GUILD_ID) {
  return `https://discord.com/channels/${guildId}/${channelId}/${messageId || ""}`;
}

export function splitDiscordContent(text, maxLen = 2000) {
  const body = String(text || "");
  if (body.length <= maxLen) return [body];
  const chunks = [];
  let rest = body;
  while (rest.length > maxLen) {
    let cut = rest.lastIndexOf("\n", maxLen);
    if (cut < Math.floor(maxLen * 0.35)) cut = maxLen;
    chunks.push(rest.slice(0, cut));
    rest = rest.slice(cut).replace(/^\n+/, "");
  }
  if (rest) chunks.push(rest);
  return chunks;
}

export async function postDiscordMessage({
  channelId,
  content,
  token,
  userAgent = "RootMC/discord-post",
}) {
  const bot = String(token || rootMcBotToken(loadRootMcEnv())).replace(/^bot\s+/i, "").trim();
  if (bot.length < 40) throw new Error("DISCORD_ROOTMC_BOT_TOKEN missing in RootMC Workspace\\.env");
  const cid = resolveRootMcChannel(channelId);
  const res = await fetch(`${DISCORD_API}/channels/${cid}/messages`, {
    method: "POST",
    headers: {
      Authorization: `Bot ${bot}`,
      "Content-Type": "application/json",
      "User-Agent": userAgent,
    },
    body: JSON.stringify({ content: String(content).slice(0, 2000) }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Discord ${res.status}: ${text.slice(0, 400)}`);
  return JSON.parse(text);
}

export async function postDiscordMessageChunks({
  channelId,
  content,
  token,
  userAgent = "RootMC/discord-post",
}) {
  const chunks = splitDiscordContent(content);
  const posted = [];
  for (const chunk of chunks) {
    posted.push(await postDiscordMessage({ channelId, content: chunk, token, userAgent }));
  }
  return posted;
}
