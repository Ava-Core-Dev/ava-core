/**
 * One-shot website update → Discord (Root Record Global Updater bot).
 *
 * Usage:
 *   node scripts/discord-post-website-announcement.mjs --channel 1512245745166581821
 *   node scripts/discord-post-website-announcement.mjs --dry-run
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_CHANNEL = "1512245745166581821";

function readEnvFile(p) {
  const out = {};
  if (!fs.existsSync(p)) return out;
  for (const raw of fs.readFileSync(p, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const i = line.indexOf("=");
    if (i <= 0) continue;
    let v = line.slice(i + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    out[line.slice(0, i).trim()] = v;
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
const token = String(process.env.DISCORD_BOT_TOKEN || env.DISCORD_BOT_TOKEN || "")
  .replace(/^bot\s+/i, "")
  .trim();

if (token.length < 40 && !dryRun) {
  console.error("Missing DISCORD_BOT_TOKEN in credentials.env (Root Record Global Updater bot)");
  process.exit(1);
}

const mdPath = path.resolve(__dirname, "WEBSITE-EDITS-DISCORD-ANNOUNCEMENT.md");
const raw = fs.readFileSync(mdPath, "utf8");

function toDiscordText(md) {
  return md
    .replace(/^#+\s+/gm, "")
    .replace(/^---\s*$/gm, "──────────")
    .replace(/\[(.+?)\]\((.+?)\)/g, "$1 ($2)")
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

const embed = {
  title: "rootrecord.info — website update",
  description:
    "Homepage, product pages, Realm hub, and operator charts refreshed on the main marketing site.",
  color: 0x2d6a4f,
  fields: [
    { name: "Browse", value: "https://rootrecord.info/", inline: false },
    { name: "Products", value: "https://rootrecord.info/products", inline: true },
    { name: "Charts", value: "https://rootrecord.info/charts/", inline: true },
    { name: "RootMC", value: "https://rootmc.net/", inline: true },
  ],
  footer: { text: "Root Record Software Solutions" },
};

async function post(payload) {
  const res = await fetch(`https://discord.com/api/v10/channels/${encodeURIComponent(channelId)}/messages`, {
    method: "POST",
    headers: {
      Authorization: `Bot ${token}`,
      "Content-Type": "application/json; charset=utf-8",
      "User-Agent": "RootRecord/website-announcement",
    },
    body: JSON.stringify({ ...payload, allowed_mentions: { parse: [] } }),
  });
  const text = await res.text().catch(() => "");
  if (!res.ok) throw new Error(`Discord HTTP ${res.status}: ${text.slice(0, 400)}`);
  return JSON.parse(text);
}

if (dryRun) {
  console.log("dry-run channel", channelId);
  console.log(JSON.stringify(embed, null, 2));
  console.log("---");
  console.log(chunks.join("\n\n---\n\n"));
  process.exit(0);
}

const first = await post({ embeds: [embed] });
console.log("posted embed", first.id);

for (let i = 0; i < chunks.length; i++) {
  const prefix = chunks.length > 1 ? `(${i + 1}/${chunks.length})\n\n` : "";
  const msg = await post({ content: prefix + chunks[i] });
  console.log("posted body", i + 1, msg.id);
  if (i < chunks.length - 1) await new Promise((r) => setTimeout(r, 800));
}

console.log("done", "channel", channelId);
