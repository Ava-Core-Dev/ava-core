/**
 * Queue Claims treasury credits for historical listing votes not yet paid.
 * Usage: node scripts/trigger-claims-vote-backfill.mjs
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

function readTownyOrClaimsCloud() {
  for (const p of [
    process.env.ROOTMC_CLOUD_YML,
    "D:/.1 Work Stations/RootMC/2. RootMC - Towny/plugins/RootMC/cloud.yml",
    "D:/.1 Work Stations/RootMC/1. RootMC - Claims/plugins/RootMC/cloud.yml",
  ].filter(Boolean)) {
    if (!fs.existsSync(p)) continue;
    const text = fs.readFileSync(p, "utf8");
    const serverId = text.match(/server-id:\s*([0-9a-f-]{36})/i)?.[1] || "";
    const serverSecret = text.match(/server-secret:\s*([0-9a-f]{64})/i)?.[1] || "";
    if (serverId && serverSecret) return { serverId, serverSecret, path: p };
  }
  return readCloudYml();
}

const fileEnv = readEnvFile(findCredentialsPath());
const cloud = readTownyOrClaimsCloud();
const serverId = String(
  process.env.ROOTSTAT_SERVER_ID || fileEnv.ROOTSTAT_SERVER_ID || cloud?.serverId || "",
).trim();
const serverSecret = String(
  process.env.ROOTSTAT_SERVER_SECRET || fileEnv.ROOTSTAT_SERVER_SECRET || cloud?.serverSecret || "",
).trim();

if (!serverId || !serverSecret) {
  console.error("Need server-id + server-secret (cloud.yml or ROOTSTAT_*).");
  process.exit(1);
}

console.log("Claims vote backfillâ€¦", cloud?.path || "env");
const res = await fetch(`${ROOTMC_API.replace(/\/$/, "")}/api/rootmc/votes/claims-backfill`, {
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
  console.error("failed", res.status, JSON.stringify(data).slice(0, 800));
  process.exit(1);
}
console.log("ok scanned=", data.scanned, "queued=", data.queued, "claims=", data.claims_server_id);
