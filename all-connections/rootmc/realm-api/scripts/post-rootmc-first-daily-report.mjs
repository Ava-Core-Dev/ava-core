/**
 * Post RootMC daily intelligence via rootmc Worker (same Grok path as RootMC AI).
 *
 * Usage (from Web/cloudflare/rootmc-realm-api/):
 *   node scripts/post-rootmc-first-daily-report.mjs
 *   node scripts/post-rootmc-first-daily-report.mjs --delete <messageId>
 */
import fs from "node:fs";
import { findCredentialsPath, readCloudYml } from "./lib/rootmc-paths.mjs";

const API = "https://discord.com/api/v10";
const ROOTMC_API =
  process.env.ROOTMC_API_URL || "https://api.rootmc.info";

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

function str(v) {
  return String(v ?? "").trim();
}

async function deleteMessage(token, channelId, messageId) {
  const res = await fetch(`${API}/channels/${channelId}/messages/${messageId}`, {
    method: "DELETE",
    headers: { Authorization: `Bot ${token}` },
  });
  if (res.status !== 204) throw new Error(`delete failed ${res.status}`);
}

async function triggerRootMcDailyPreview(serverId, serverSecret) {
  const res = await fetch(`${ROOTMC_API.replace(/\/$/, "")}/api/rootmc/daily-report/preview`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-RootStat-Server-Id": serverId,
      "X-RootStat-Server-Secret": serverSecret,
    },
    body: "{}",
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.ok !== true) {
    throw new Error(`rootmc preview ${res.status}: ${JSON.stringify(data).slice(0, 500)}`);
  }
  return data;
}

const fileEnv = readEnvFile(findCredentialsPath());
const rootmcToken = str(process.env.DISCORD_ROOTMC_BOT_TOKEN || fileEnv.DISCORD_ROOTMC_BOT_TOKEN).replace(/^bot\s+/i, "");
const dailyChannelId = str(
  process.env.DISCORD_ROOTMC_DAILY_REPORT_CHANNEL_ID ||
    fileEnv.DISCORD_ROOTMC_DAILY_REPORT_CHANNEL_ID ||
    "1516395175780286615",
);

const cloud = readCloudYml();
const serverId = str(process.env.ROOTSTAT_SERVER_ID || fileEnv.ROOTSTAT_SERVER_ID || cloud?.serverId);
const serverSecret = str(
  process.env.ROOTSTAT_SERVER_SECRET || fileEnv.ROOTSTAT_SERVER_SECRET || cloud?.serverSecret,
);

const deleteIdx = process.argv.indexOf("--delete");
const deleteId = deleteIdx >= 0 ? str(process.argv[deleteIdx + 1]) : "";

if (!serverId || !serverSecret) {
  console.error("Need server-id + server-secret (RootMC plugins/RootRecord/cloud.yml or ROOTSTAT_* in credentials.env).");
  process.exit(1);
}

if (rootmcToken.length >= 40) {
  for (const id of [deleteId, "1517101397093519390", "1517092047809679380"].filter(Boolean)) {
    try {
      await deleteMessage(rootmcToken, dailyChannelId, id);
      console.log("deleted", id);
    } catch {
      /* already gone */
    }
  }
}

console.log("Triggering rootmc daily preview (worker Grok, same as RootMC app AI)…");
const result = await triggerRootMcDailyPreview(serverId, serverSecret);
console.log("posted", result.messageId, "day", result.dayKey);
