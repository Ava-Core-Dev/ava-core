/**
 * Trigger RootMC weekly activity awards + intelligence suite via rootmc Worker.
 *
 * Usage:
 *   node scripts/post-rootmc-trigger-weekly-reports.mjs
 *   node scripts/post-rootmc-trigger-weekly-reports.mjs --week 2026-06-23
 *   node scripts/post-rootmc-trigger-weekly-reports.mjs --week 2026-06-22 --force
 */
import fs from "node:fs";
import { findCredentialsPath, readCloudYml } from "./lib/rootmc-paths.mjs";

const ROOTMC_API = process.env.ROOTMC_API_URL || "https://api.rootmc.info";

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

const weekArgIdx = process.argv.indexOf("--week");
const weekKey = weekArgIdx >= 0 ? String(process.argv[weekArgIdx + 1] || "").trim() : "";
const force = process.argv.includes("--force");

const fileEnv = readEnvFile(findCredentialsPath());
const cloud = readCloudYml();
const serverId = String(
  process.env.ROOTSTAT_SERVER_ID || fileEnv.ROOTSTAT_SERVER_ID || cloud?.serverId || "",
).trim();
const serverSecret = String(
  process.env.ROOTSTAT_SERVER_SECRET || fileEnv.ROOTSTAT_SERVER_SECRET || cloud?.serverSecret || "",
).trim();

if (!serverId || !serverSecret) {
  console.error("Need server-id + server-secret (cloud.yml or ROOTSTAT_* in credentials.env).");
  process.exit(1);
}

console.log("Triggering RootMC weekly awards + reports…", weekKey || "(current week)");
const res = await fetch(`${ROOTMC_API.replace(/\/$/, "")}/api/rootmc/weekly-report/trigger-all`, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "X-RootStat-Server-Id": serverId,
    "X-RootStat-Server-Secret": serverSecret,
  },
  body: JSON.stringify(weekKey ? { weekKey, ...(force ? { force: true } : {}) } : force ? { force: true } : {}),
});
const data = await res.json().catch(() => ({}));
if (!res.ok || data.ok !== true) {
  console.error("failed", res.status, JSON.stringify(data).slice(0, 800));
  process.exit(1);
}
console.log("ok", data.weekKey, "server", data.server_id);
