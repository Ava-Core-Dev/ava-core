#!/usr/bin/env node
/**
 * Phase 2: purge junk Ava Discord messages (pack dumps, local-core fail loops,
 * dig-theater). Keeps PROP / solar / pins / power status.
 *
 * Usage (on ava-core):
 *   node scripts/purge-junk-ava.mjs
 *   node scripts/purge-junk-ava.mjs --dry-run
 */
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const ROOT = process.env.AVA_WORKSPACE
  ? path.join(process.env.AVA_WORKSPACE, "Web Files", "rootmc-ava")
  : "/mnt/e/.1 Work Stations/RootMC/Web Files/rootmc-ava";
const ENV_FILE =
  process.env.ROOTMC_ENV_FILE || "/mnt/e/.1 Work Stations/RootMC/.env";
const BOT_ID = "1532751879875072070";
const DRY = process.argv.includes("--dry-run");

const CHANNELS = [
  "1531432703675596942", // random-facts
  "1520665313631408251", // updates
  "1522406451413385317", // governance
  "1532929974154166522", // development
  "1533268458668687392", // ava-media
  "1516121832493678612", // admins
  "1516389376198840421", // memes
];

const EXTRA = [];

function loadDotEnv(file) {
  const out = {};
  try {
    const raw = fs.readFileSync(file, "utf8").replace(/^\uFEFF/, "");
    for (const line of raw.split(/\r?\n/)) {
      const t = line.trim();
      if (!t || t.startsWith("#") || !t.includes("=")) continue;
      const i = t.indexOf("=");
      const k = t.slice(0, i).trim();
      let v = t.slice(i + 1).trim();
      if (
        (v.startsWith('"') && v.endsWith('"')) ||
        (v.startsWith("'") && v.endsWith("'"))
      ) {
        v = v.slice(1, -1);
      }
      out[k] = v;
    }
  } catch {
    /* ignore */
  }
  return out;
}

const env = { ...loadDotEnv(ENV_FILE), ...process.env };
const token =
  env.AVA_DISCORD_BOT_TOKEN ||
  env.DISCORD_ROOTMC_BOT_TOKEN ||
  env.DISCORD_BOT_TOKEN ||
  env.AVA_DISCORD_TOKEN ||
  "";
if (!token) {
  console.error("no discord token");
  process.exit(1);
}

const { isDarkStallText } = await import(
  pathToFileURL(path.join(ROOT, "src", "darkStall.mjs")).href
);
const { isPackDumpText, isLocalCoreFailText } = await import(
  pathToFileURL(path.join(ROOT, "src", "scrub.mjs")).href
);

const KEEP_RE = [
  /\bPROP-\d+/i,
  /\*\*Power status\*\*/i,
  /ava\.rootmc\.net\/solar/i,
  /\bsolar tracking page is live\b/i,
  /\bCouncil voting shares\b/i,
  /surface\s*split/i,
  /\*\*RootMC Pro\*\*/i,
  /\bpinned\b/i,
];

function isKeeper(content = "") {
  return KEEP_RE.some((re) => re.test(String(content || "")));
}

function isJunk(content = "") {
  const t = String(content || "");
  if (!t.trim()) return false;
  if (isKeeper(t)) return false;
  if (isPackDumpText(t)) return true;
  if (isLocalCoreFailText(t)) return true;
  if (isDarkStallText(t)) return true;
  if (/\b(okaay searching|kk - digging|pulling it\.|wiki peek|mm digging files)\b/i.test(t) && t.length < 120) {
    return true;
  }
  if (/\bcatching (this |up|#)/i.test(t) && t.length > 400) return true;
  return false;
}

async function api(method, urlPath) {
  const res = await fetch(`https://discord.com/api/v10${urlPath}`, {
    method,
    headers: { Authorization: `Bot ${token}` },
  });
  if (res.status === 204) return null;
  const text = await res.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  if (!res.ok) {
    const err = new Error(`discord ${res.status} ${urlPath}`);
    err.body = body;
    err.status = res.status;
    throw err;
  }
  return body;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

const channels = [...new Set([...CHANNELS, ...EXTRA])];
const targets = [];

for (const ch of channels) {
  let before;
  let pages = 0;
  while (pages < 12) {
    pages += 1;
    const q = before ? `?limit=100&before=${before}` : "?limit=100";
    let batch;
    try {
      batch = await api("GET", `/channels/${ch}/messages${q}`);
    } catch (err) {
      console.warn("list fail", ch, err.message);
      break;
    }
    if (!Array.isArray(batch) || !batch.length) break;
    for (const m of batch) {
      if (String(m.author?.id) !== BOT_ID) continue;
      if (!isJunk(m.content || "")) continue;
      targets.push({ id: String(m.id), ch, preview: String(m.content || "").slice(0, 80) });
    }
    before = batch[batch.length - 1].id;
    if (batch.length < 100) break;
    await sleep(280);
  }
}

console.log(`junk messages: ${targets.length} (dry=${DRY})`);
let deleted = 0;
let failed = 0;
for (const t of targets) {
  if (DRY) {
    console.log("DRY", t.ch, t.id, t.preview.replace(/\n/g, " / "));
    continue;
  }
  try {
    await api("DELETE", `/channels/${t.ch}/messages/${t.id}`);
    deleted += 1;
    process.stdout.write(".");
    await sleep(380);
  } catch (err) {
    failed += 1;
    process.stdout.write(`x(${err.status || err.message})`);
    await sleep(500);
  }
}
console.log("");
console.log(JSON.stringify({ scannedChannels: channels.length, junk: targets.length, deleted, failed, dry: DRY }));
