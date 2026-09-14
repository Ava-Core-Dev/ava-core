/**
 * Fan-out a Root Record update to every Discord server subscribed via /root.
 *
 * Reads RR_PUSH_ADMIN_KEY + optional RR_API_BASE from repo-root credentials.env.
 *
 * Usage:
 *   node scripts/discord-broadcast-update.mjs --category blocknotes --file path/to/announcement.md
 *   node scripts/discord-broadcast-update.mjs --category all --content "Short update text"
 */
import fs from "node:fs";
import path from "node:path";

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

function arg(name) {
  const idx = process.argv.indexOf(name);
  if (idx === -1) return "";
  return String(process.argv[idx + 1] || "").trim();
}

const category = arg("--category") || "all";
const filePath = arg("--file");
const inline = arg("--content");
const title = arg("--title");

if (!filePath && !inline) {
  console.error(
    "Usage: node scripts/discord-broadcast-update.mjs --category <id> (--file <md> | --content <text>) [--title <embed title>]",
  );
  process.exit(1);
}

const credPath =
  process.env.CREDENTIALS_ENV ||
  path.resolve(process.cwd(), "../../../credentials.env");
const env = readEnvFile(credPath);
const adminKey = String(env.RR_PUSH_ADMIN_KEY || env.RR_PUSH_ADMIN_SECRET || "").trim();
const base = String(process.env.RR_API_BASE || env.RR_API_BASE || "https://api.rootrecord.online/api").replace(/\/+$/, "");

if (!adminKey) {
  console.error("Missing RR_PUSH_ADMIN_KEY (or RR_PUSH_ADMIN_SECRET) in credentials.env");
  process.exit(1);
}

function toDiscordText(md) {
  return md
    .replace(/^#+\s+/gm, "")
    .replace(/^---\s*$/gm, "──────────")
    .replace(/\[(.+?)\]\((.+?)\)/g, "$1 ($2)")
    .trim();
}

let content = inline;
if (filePath) {
  const abs = path.resolve(filePath);
  content = toDiscordText(fs.readFileSync(abs, "utf8"));
}

const body = { category, content };
if (title) {
  body.embeds = [
    {
      title,
      description: content.slice(0, 4000),
      color: 0x2d6a4f,
      footer: { text: "Root Record Software Solutions" },
    },
  ];
  body.content = "";
}

const url = `${base}/internal/discord-updates-broadcast`;
const res = await fetch(url, {
  method: "POST",
  headers: {
    "Content-Type": "application/json; charset=utf-8",
    "X-RR-Push-Admin-Key": adminKey,
    "User-Agent": "RootRecord/discord-broadcast-update",
  },
  body: JSON.stringify(body),
});

const text = await res.text();
if (!res.ok) {
  console.error("Broadcast failed", res.status, text.slice(0, 600));
  process.exit(1);
}

console.log(text);
