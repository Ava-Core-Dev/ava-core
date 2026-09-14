/**
 * Wipe RootMC daily report state (D1 + Discord bot posts) and regenerate cleanly.
 *
 * Usage (from Web/cloudflare/rootmc-realm-api/):
 *   node scripts/reset-and-trigger-rootmc-daily-reports.mjs
 *   node scripts/reset-and-trigger-rootmc-daily-reports.mjs --categories=economy_intel
 *   node scripts/reset-and-trigger-rootmc-daily-reports.mjs --trigger-only --categories=economy_intel
 *   node scripts/reset-and-trigger-rootmc-daily-reports.mjs --discord-only
 *   node scripts/reset-and-trigger-rootmc-daily-reports.mjs --no-trigger
 */
import fs from "node:fs";
import path from "node:path";
import { findCredentialsPath, readCloudYml } from "./lib/rootmc-paths.mjs";

const API = "https://discord.com/api/v10";
const ROOTMC_API =
  process.env.ROOTMC_API_URL || "https://api.rootmc.info";

const REPORT_CHANNELS = [
  { name: "daily", id: "1516395175780286615" },
  { name: "economy", id: "1516804780884889621" },
  { name: "towns", id: "1516282373426249878" },
  { name: "nations", id: "1516283667364974602" },
];

const REPORT_MARKERS = [
  "# RootMC Daily Summary",
  "# Economy Brief",
  "# Towns Brief",
  "# Nations Brief",
  "RootMC Daily Intelligence",
  "RootMC Daily Summary",
  "RootMC — Daily Intelligence Summary",
  "RootMC — Economy Brief",
  "RootMC — Towns Brief",
  "RootMC — Nations Brief",
  "No new information to generate a new report.",
];

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

function readCloudYmlLocal() {
  const hit = readCloudYml();
  return hit ? { serverId: hit.serverId, serverSecret: hit.serverSecret } : null;
}

function str(v) {
  return String(v ?? "").trim();
}

function isReportMessage(content) {
  const text = str(content);
  if (!text) return false;
  if (text.includes("RootMC Economy Guide")) return false;
  return REPORT_MARKERS.some((m) => text.includes(m));
}

async function discordFetch(token, route, init = {}) {
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bot ${token}`);
  if (init.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  return fetch(`${API}${route}`, { ...init, headers });
}

async function deleteDiscordReports(token, botUserId) {
  let deleted = 0;
  for (const ch of REPORT_CHANNELS) {
    let before = undefined;
    for (let page = 0; page < 10; page++) {
      const qs = new URLSearchParams({ limit: "100" });
      if (before) qs.set("before", before);
      const res = await discordFetch(token, `/channels/${ch.id}/messages?${qs}`);
      const messages = await res.json().catch(() => []);
      if (!Array.isArray(messages) || messages.length === 0) break;
      before = messages[messages.length - 1]?.id;

      for (const msg of messages) {
        if (str(msg.author?.id) !== botUserId) continue;
        if (!isReportMessage(msg.content)) continue;
        const del = await discordFetch(token, `/channels/${ch.id}/messages/${msg.id}`, { method: "DELETE" });
        if (del.status === 204) {
          deleted++;
          console.log("deleted", ch.name, msg.id);
        } else {
          console.warn("delete failed", ch.name, msg.id, del.status);
        }
        await new Promise((r) => setTimeout(r, 350));
      }
      if (messages.length < 100) break;
    }
  }
  return deleted;
}

async function apiPost(path, serverId, serverSecret, body = "{}") {
  const res = await fetch(`${ROOTMC_API.replace(/\/$/, "")}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-RootStat-Server-Id": serverId,
      "X-RootStat-Server-Secret": serverSecret,
    },
    body,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.ok !== true) {
    throw new Error(`${path} ${res.status}: ${JSON.stringify(data).slice(0, 500)}`);
  }
  return data;
}

async function resetD1(serverId, serverSecret) {
  return apiPost("/api/rootmc/daily-report/reset-all", serverId, serverSecret);
}

async function triggerAllSequential(serverId, serverSecret, categories) {
  const wantsDaily = categories.includes("daily");
  const cats = categories.filter((c) => c !== "daily");
  if (wantsDaily) {
    const preview = await apiPost("/api/rootmc/daily-report/preview", serverId, serverSecret);
    console.log("daily summary posted", preview.messageId, preview.dayKey);
  }
  for (const category of cats) {
    await new Promise((r) => setTimeout(r, 2000));
    const row = await apiPost(
      `/api/rootmc/daily-report/trigger-category/${category}`,
      serverId,
      serverSecret,
    );
    console.log("category posted", category, row.dayKey, row.detail);
  }
}

const args = new Set(process.argv.slice(2));
const discordOnly = args.has("--discord-only");
const noTrigger = args.has("--no-trigger");
const triggerOnly = args.has("--trigger-only");
const categoriesArg = process.argv.find((a) => a.startsWith("--categories="));
const DEFAULT_CATEGORIES = ["daily", "economy_intel", "towns", "nations"];
const triggerCategories = categoriesArg
  ? categoriesArg.slice("--categories=".length).split(",").map((s) => s.trim()).filter(Boolean)
  : DEFAULT_CATEGORIES;

const fileEnv = readEnvFile(findCredentialsPath());
const token = str(process.env.DISCORD_ROOTMC_BOT_TOKEN || fileEnv.DISCORD_ROOTMC_BOT_TOKEN).replace(/^bot\s+/i, "");
const cloud = readCloudYml();
const serverId = str(process.env.ROOTSTAT_SERVER_ID || fileEnv.ROOTSTAT_SERVER_ID || cloud?.serverId);
const serverSecret = str(
  process.env.ROOTSTAT_SERVER_SECRET || fileEnv.ROOTSTAT_SERVER_SECRET || cloud?.serverSecret,
);

if (!serverId || !serverSecret) {
  console.error("Need server-id + server-secret (cloud.yml or ROOTSTAT_* in credentials.env).");
  process.exit(1);
}
if (token.length < 40) {
  console.error("Need DISCORD_ROOTMC_BOT_TOKEN in credentials.env");
  process.exit(1);
}

const me = await discordFetch(token, "/users/@me").then((r) => r.json());
const botUserId = str(me.id);
if (!botUserId) {
  console.error("Could not resolve bot user id", me);
  process.exit(1);
}

console.log("Deleting RootMC daily report messages from Discord…");
const deleted = triggerOnly ? 0 : await deleteDiscordReports(token, botUserId);
console.log(`Discord cleanup done (${deleted} messages).`);

if (!discordOnly && !triggerOnly) {
  console.log("Clearing D1 report rows for server", serverId, "…");
  const reset = await resetD1(serverId, serverSecret);
  console.log("D1 reset ok", reset.detail);
}

if (!noTrigger && !discordOnly) {
  console.log("Triggering fresh reports (sequential — one Grok call per request)…", triggerCategories.join(", "));
  await triggerAllSequential(serverId, serverSecret, triggerCategories);
  console.log("all reports triggered");
}
