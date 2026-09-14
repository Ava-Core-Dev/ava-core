#!/usr/bin/env node
/**
 * One-shot: delete Ava's darkside / server-down spam from Discord channels.
 * Keeps ava-ivy running. Safe: only deletes bot messages matching dark-stall patterns.
 */
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const ROOT = process.env.AVA_WORKSPACE
  ? path.join(process.env.AVA_WORKSPACE, "Web Files", "rootmc-ava")
  : "/mnt/e/.1 Work Stations/RootMC/Web Files/rootmc-ava";
const HANDOFF = process.env.AVA_HANDOFF || "/mnt/e/.Ava_Ivy";
const ENV_FILE =
  process.env.ROOTMC_ENV_FILE || "/mnt/e/.1 Work Stations/RootMC/.env";
const BOT_ID = "1532751879875072070";

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
  env.DISCORD_ROOTMC_BOT_TOKEN ||
  env.DISCORD_BOT_TOKEN ||
  env.AVA_DISCORD_TOKEN ||
  "";
if (!token) {
  console.error("no discord token");
  process.exit(1);
}

const { isDarkStallText, clearDarkLastReplies, markDarkStall } = await import(
  pathToFileURL(path.join(ROOT, "src", "darkStall.mjs")).href
);

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
    throw err;
  }
  return body;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

const outbound = path.join(HANDOFF, "data", "logs", "outbound.jsonl");
const cut = Date.now() - 48 * 60 * 60 * 1000;
const targets = new Map();
const channels = new Set();

for (const line of fs.readFileSync(outbound, "utf8").split(/\r?\n/)) {
  if (!line.trim()) continue;
  let row;
  try {
    row = JSON.parse(line);
  } catch {
    continue;
  }
  const at = Number(row.at || 0);
  if (at && at < cut) continue;
  const surface = String(row.surface || "");
  if (surface !== "discord" && surface !== "discord-dm") continue;
  const content = String(row.content || row.text || "");
  const ch = String(row.channelId || "");
  if (ch && !ch.startsWith("tg:") && !ch.startsWith("C")) channels.add(ch);
  if (!isDarkStallText(content)) continue;
  const mid = row.messageId;
  if (!mid || !ch) continue;
  targets.set(String(mid), ch);
}

try {
  const lr = JSON.parse(
    fs.readFileSync(path.join(HANDOFF, "data", "last-reply.json"), "utf8"),
  );
  for (const k of Object.keys(lr)) {
    if (/^\d+$/.test(k)) channels.add(k);
  }
} catch {
  /* ignore */
}

console.log(`scanning ${channels.size} channel(s); seed targets ${targets.size}`);

for (const ch of channels) {
  let before;
  let pages = 0;
  while (pages < 8) {
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
      if (!isDarkStallText(m.content || "")) continue;
      targets.set(String(m.id), ch);
    }
    before = batch[batch.length - 1].id;
    if (batch.length < 100) break;
    await sleep(300);
  }
  markDarkStall(ch);
}

console.log(`dark messages to delete: ${targets.size}`);
let deleted = 0;
let failed = 0;
for (const [mid, ch] of targets) {
  try {
    await api("DELETE", `/channels/${ch}/messages/${mid}`);
    deleted += 1;
    process.stdout.write(".");
    await sleep(350);
  } catch (err) {
    failed += 1;
    const code = err?.body?.code || err?.message;
    process.stdout.write(`x(${code})`);
    await sleep(400);
  }
}
console.log("");
const cleared = clearDarkLastReplies();
console.log(
  JSON.stringify({
    deleted,
    failed,
    channels: channels.size,
    lastReplyCleared: cleared.cleared,
  }),
);
