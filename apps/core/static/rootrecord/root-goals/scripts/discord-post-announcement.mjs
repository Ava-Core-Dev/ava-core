/**
 * Post Root Goals announcement to a Discord channel (one run = one batch).
 *
 * Reads DISCORD_BOT_TOKEN from repo-root credentials.env.
 *
 * Usage:
 *   node scripts/discord-post-announcement.mjs --channel 1511833934416056501
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function readEnvFile(p) {
  const out = {};
  const text = fs.readFileSync(p, "utf8");
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const i = line.indexOf("=");
    if (i <= 0) continue;
    const k = line.slice(0, i).trim();
    const v = line.slice(i + 1).trim();
    if (k) out[k] = v;
  }
  return out;
}

function arg(name) {
  const idx = process.argv.indexOf(name);
  if (idx === -1) return "";
  return String(process.argv[idx + 1] || "").trim();
}

const channelId = arg("--channel");
if (!/^\d{10,}$/.test(channelId)) {
  console.error("Usage: node scripts/discord-post-announcement.mjs --channel <channelId>");
  process.exit(1);
}

const credPath = process.env.CREDENTIALS_ENV || path.resolve(__dirname, "../../../../credentials.env");
const env = readEnvFile(credPath);
const token = String(env.DISCORD_BOT_TOKEN || env.DISCORD_ROOTMC_BOT_TOKEN || "").trim();
if (token.length < 40) {
  console.error("Missing DISCORD_BOT_TOKEN (or DISCORD_ROOTMC_BOT_TOKEN) in credentials.env");
  process.exit(1);
}

const mdPath = path.resolve(__dirname, "../ROOT-GOALS-DISCORD-ANNOUNCEMENT.md");
const raw = fs.readFileSync(mdPath, "utf8");

/** Strip markdown headings for Discord plain text; keep structure readable. */
function toDiscordText(md) {
  return md
    .replace(/^#+\s+/gm, "")
    .replace(/^---\s*$/gm, "──────────")
    .replace(/\[(.+?)\]\((.+?)\)/g, "$1 ($2)")
    .replace(/\*\*(.+?)\*\*/g, "**$1**")
    .trim();
}

const body = toDiscordText(raw);
const MAX = 1900;

function splitMessages(text) {
  const parts = [];
  let rest = text;
  while (rest.length > MAX) {
    let cut = rest.lastIndexOf("\n\n", MAX);
    if (cut < MAX / 2) cut = rest.lastIndexOf("\n", MAX);
    if (cut < MAX / 2) cut = MAX;
    parts.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest) parts.push(rest);
  return parts;
}

const chunks = splitMessages(body);

async function post(content) {
  const res = await fetch(`https://discord.com/api/v10/channels/${encodeURIComponent(channelId)}/messages`, {
    method: "POST",
    headers: {
      Authorization: `Bot ${token}`,
      "Content-Type": "application/json; charset=utf-8",
      "User-Agent": "RootRecord/root-goals-announcement",
    },
    body: JSON.stringify({ content, allowed_mentions: { parse: [] } }),
  });
  const text = await res.text().catch(() => "");
  if (!res.ok) {
    throw new Error(`Discord HTTP ${res.status}: ${text.slice(0, 400)}`);
  }
  return JSON.parse(text);
}

for (let i = 0; i < chunks.length; i++) {
  const prefix = chunks.length > 1 ? `( ${i + 1}/${chunks.length} )\n\n` : "";
  const msg = await post(prefix + chunks[i]);
  console.log("posted", i + 1, msg.id);
  if (i < chunks.length - 1) await new Promise((r) => setTimeout(r, 800));
}

console.log("done", chunks.length, "message(s)");
