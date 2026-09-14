/**
 * One-shot public announcement via the Kīlauea Alerts Discord bot.
 *
 * Usage:
 *   node scripts/discord-post-kilauea-announcement.mjs
 *   node scripts/discord-post-kilauea-announcement.mjs --channel 1545283785803960393
 *   node scripts/discord-post-kilauea-announcement.mjs --dry-run
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_CHANNEL = "1545283785803960393";

function readEnvFile(p) {
  const out = {};
  if (!fs.existsSync(p)) return out;
  const text = fs.readFileSync(p, "utf8");
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const i = line.indexOf("=");
    if (i <= 0) continue;
    const k = line.slice(0, i).trim();
    let v = line.slice(i + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    if (k) out[k] = v;
  }
  return out;
}

function findCredentialsEnv() {
  if (process.env.CREDENTIALS_ENV && fs.existsSync(process.env.CREDENTIALS_ENV)) {
    return process.env.CREDENTIALS_ENV;
  }
  let probe = path.resolve(__dirname, "..");
  for (let i = 0; i < 14; i++) {
    const tryPath = path.join(probe, "credentials.env");
    if (fs.existsSync(tryPath)) return tryPath;
    const parent = path.dirname(probe);
    if (parent === probe) break;
    probe = parent;
  }
  return "";
}

function arg(name) {
  const idx = process.argv.indexOf(name);
  if (idx === -1) return "";
  return String(process.argv[idx + 1] || "").trim();
}

const dryRun = process.argv.includes("--dry-run");
const channelId = arg("--channel") || DEFAULT_CHANNEL;
if (!/^\d{10,}$/.test(channelId)) {
  console.error("Invalid --channel");
  process.exit(1);
}

const credPath = findCredentialsEnv();
const env = credPath ? readEnvFile(credPath) : {};
const token = String(
  process.env.DISCORD_KILAUEA_BOT_TOKEN ||
    env.DISCORD_KILAUEA_BOT_TOKEN ||
    process.env.DISCORD_BOT_TOKEN ||
    env.DISCORD_BOT_TOKEN ||
    "",
)
  .replace(/^bot\s+/i, "")
  .trim();

if (token.length < 40 && !dryRun) {
  console.error("Missing DISCORD_KILAUEA_BOT_TOKEN in credentials.env");
  process.exit(1);
}

const mdPath = path.resolve(__dirname, "KILAUEA-REPORT-REFINEMENT-ANNOUNCEMENT.md");
const body = fs.readFileSync(mdPath, "utf8").trim();
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
      "User-Agent": "RootRecord/kilauea-alerts-announcement",
    },
    body: JSON.stringify({ content, allowed_mentions: { parse: [] } }),
  });
  const text = await res.text().catch(() => "");
  if (!res.ok) throw new Error(`Discord HTTP ${res.status}: ${text.slice(0, 400)}`);
  return JSON.parse(text);
}

if (dryRun) {
  console.log("dry-run channel", channelId, "chunks", chunks.length);
  console.log(chunks.join("\n\n---\n\n"));
  process.exit(0);
}

for (let i = 0; i < chunks.length; i++) {
  const prefix = chunks.length > 1 ? `(${i + 1}/${chunks.length})\n\n` : "";
  const msg = await post(prefix + chunks[i]);
  console.log("posted", i + 1, msg.id);
  if (i < chunks.length - 1) await new Promise((r) => setTimeout(r, 800));
}

console.log("done", chunks.length, "message(s) to channel", channelId);
