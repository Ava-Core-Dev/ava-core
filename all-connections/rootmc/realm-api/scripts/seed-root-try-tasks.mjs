/**
 * Seed Discord #tasks with one message per Root-Try catalog entry.
 *
 * Source of truth: Plugin Building/Minecraft/plugins/root-try/src/main/resources/catalog.yml
 *
 * Usage:
 *   node scripts/seed-root-try-tasks.mjs
 *   node scripts/seed-root-try-tasks.mjs --dry-run
 *   node scripts/seed-root-try-tasks.mjs --limit 3
 *   node scripts/seed-root-try-tasks.mjs --host towny
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  discordMessageUrl,
  postDiscordMessage,
  resolveRootMcChannel,
} from "./lib/rootmc-discord.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const catalogPath = path.resolve(
  __dirname,
  "../../../Plugin Building/Minecraft/plugins/root-try/src/main/resources/catalog.yml",
);

function argValue(flag) {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? String(process.argv[i + 1] || "").trim() : "";
}

const dryRun = process.argv.includes("--dry-run");
const limit = Number(argValue("--limit") || "0") || 0;
const offset = Number(argValue("--offset") || "0") || 0;
const hostFilter = (argValue("--host") || "").toLowerCase();
const delayMs = Number(argValue("--delay-ms") || "600") || 600;

function parseCatalog(text) {
  const tries = [];
  const blocks = text.split(/\n\s*-\s+id:\s+/).slice(1);
  for (const block of blocks) {
    const id = block.match(/^([^\s\n]+)/)?.[1]?.trim();
    if (!id) continue;
    const title = block.match(/\n\s*title:\s*(.+)/)?.[1]?.trim() || id;
    const hint = block.match(/\n\s*hint:\s*(.+)/)?.[1]?.trim() || "";
    const host = block.match(/\n\s*host:\s*(.+)/)?.[1]?.trim() || "both";
    const matchLine = block.match(/\n\s*match:\s*\[([^\]]*)\]/)?.[1] || "";
    tries.push({ id, title, hint, host, match: matchLine.trim() });
  }
  return tries;
}

function formatPost(t) {
  const reward = "1 G";
  return [
    `**TEST \`${t.id}\`** — ${t.title}`,
    `Host: \`${t.host}\` · Reward: ${reward} (Server Reserve)`,
    `What to do: ${t.hint}`,
    t.match ? `Detect: \`${t.match}\`` : "Detect: feature hook",
    "Pass: run once in-game; completion is idempotent (no double pay).",
  ].join("\n");
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function postWithRetry(content, attempts = 6) {
  let lastErr;
  for (let i = 0; i < attempts; i++) {
    try {
      return await postDiscordMessage({
        channelId,
        content,
        userAgent: "RootMC/seed-root-try-tasks",
      });
    } catch (err) {
      lastErr = err;
      const msg = String(err?.message || err);
      const retryAfter = /retry_after["']?\s*:\s*([0-9.]+)/i.exec(msg);
      const wait = retryAfter
        ? Math.ceil(Number(retryAfter[1]) * 1000) + 250
        : Math.min(8000, 500 * Math.pow(2, i));
      if (!/429|rate limited/i.test(msg) && i > 1) throw err;
      console.warn(`retry ${i + 1}/${attempts} after ${wait}ms — ${msg.slice(0, 120)}`);
      await sleep(wait);
    }
  }
  throw lastErr;
}

if (!fs.existsSync(catalogPath)) {
  console.error("Catalog not found:", catalogPath);
  process.exit(1);
}

let tries = parseCatalog(fs.readFileSync(catalogPath, "utf8"));
if (hostFilter) {
  tries = tries.filter((t) => t.host === hostFilter || t.host === "both");
}
if (offset > 0) {
  tries = tries.slice(offset);
}
if (limit > 0) {
  tries = tries.slice(0, limit);
}

const channelId = resolveRootMcChannel("tasks");
console.log(`Seeding ${tries.length} try(s) → #tasks (${channelId})${dryRun ? " [dry-run]" : ""}${offset ? ` offset=${offset}` : ""}`);

let n = 0;
for (const t of tries) {
  const content = formatPost(t);
  if (dryRun) {
    console.log("---");
    console.log(content);
    n++;
    continue;
  }
  const posted = await postWithRetry(content);
  n++;
  console.log(`[${n}/${tries.length}] ${t.id} → ${discordMessageUrl(channelId, posted.id)}`);
  if (delayMs > 0) await sleep(delayMs);
}

console.log(dryRun ? `dry-run listed ${n} messages` : `posted ${n} messages`);
