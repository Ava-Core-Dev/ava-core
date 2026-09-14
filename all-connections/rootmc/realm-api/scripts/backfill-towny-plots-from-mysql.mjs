/**
 * Backfill D1 town plot_count + town_balance_gold from Towny MySQL, then re-post towns brief.
 *
 * Usage (after rootmc-api deploy with Hyperdrive):
 *   node scripts/backfill-towny-plots-from-mysql.mjs
 *   node scripts/backfill-towny-plots-from-mysql.mjs --skip-report
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

function readCloudYmlLocal() {
  const hit = readCloudYml();
  return hit ? { serverId: hit.serverId, serverSecret: hit.serverSecret } : null;
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

const cloud = readCloudYmlLocal();
const fileEnv = readEnvFile(findCredentialsPath());
const serverId = process.env.ROOTSTAT_SERVER_ID || fileEnv.ROOTSTAT_SERVER_ID || cloud?.serverId;
const serverSecret = process.env.ROOTSTAT_SERVER_SECRET || fileEnv.ROOTSTAT_SERVER_SECRET || cloud?.serverSecret;

if (!serverId || !serverSecret) {
  console.error("Need server-id + server-secret (cloud.yml or ROOTSTAT_*).");
  process.exit(1);
}

const enrich = await apiPost("/api/rootmc/towny/enrich-from-mysql", serverId, serverSecret);
console.log("Towny MySQL enrichment:", enrich);

if (!process.argv.includes("--skip-report")) {
  const row = await apiPost("/api/rootmc/daily-report/trigger-category/towns", serverId, serverSecret);
  console.log("Towns report:", row.dayKey, row.detail);
}
