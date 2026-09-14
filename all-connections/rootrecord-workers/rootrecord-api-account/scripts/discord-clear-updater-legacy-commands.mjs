/**
 * Remove legacy guild slash commands (/economy, /bal, /send, …) from the Global Updater
 * Discord application. Those belong on the Root Economy bot now.
 *
 * Usage (from Web/cloudflare/rootrecord-api-account/):
 *   node scripts/discord-clear-updater-legacy-commands.mjs
 */
import fs from "node:fs";
import path from "node:path";

const API = "https://discord.com/api/v10";

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

function findCredentialsPath() {
  const here = process.cwd();
  for (const p of [
    path.join(here, "credentials.env"),
    path.join(here, "../../../credentials.env"),
    path.join(here, "../../../../credentials.env"),
  ]) {
    if (fs.existsSync(p)) return p;
  }
  return path.join(here, "../../../credentials.env");
}

function readWranglerVar(p, name) {
  if (!fs.existsSync(p)) return "";
  const m = fs.readFileSync(p, "utf8").match(new RegExp(`^${name}\\s*=\\s*"([^"]*)"`, "m"));
  return m ? m[1] : "";
}

const credPath = findCredentialsPath();
const fileEnv = readEnvFile(credPath);
const wranglerPath = path.join(process.cwd(), "wrangler.toml");
const token = String(process.env.DISCORD_BOT_TOKEN || fileEnv.DISCORD_BOT_TOKEN || "")
  .replace(/^bot\s+/i, "")
  .trim();
const appId = String(
  process.env.DISCORD_CLIENT_ID || fileEnv.DISCORD_CLIENT_ID || readWranglerVar(wranglerPath, "DISCORD_CLIENT_ID") || "",
).trim();
const guildId = String(
  process.env.DISCORD_GUILD_ID || fileEnv.DISCORD_GUILD_ID || readWranglerVar(wranglerPath, "DISCORD_GUILD_ID") || "",
).trim();

if (token.length < 40 || !appId || !guildId) {
  console.error("Need DISCORD_BOT_TOKEN, DISCORD_CLIENT_ID, DISCORD_GUILD_ID.");
  process.exit(1);
}

const headers = {
  Authorization: `Bot ${token}`,
  "Content-Type": "application/json; charset=utf-8",
  "User-Agent": "RootRecord/discord-clear-updater-legacy",
};

const guildUrl = `${API}/applications/${encodeURIComponent(appId)}/guilds/${encodeURIComponent(guildId)}/commands`;
const guildRes = await fetch(guildUrl, { method: "PUT", headers, body: "[]" });
const guildText = await guildRes.text();
if (!guildRes.ok) {
  console.error("Clear guild commands failed", guildRes.status, guildText.slice(0, 800));
  process.exit(1);
}
console.log("Cleared Global Updater guild commands for guild", guildId, "->", guildText || "[]");

const globalRes = await fetch(`${API}/applications/${encodeURIComponent(appId)}/commands`, { headers });
const globalText = await globalRes.text();
if (!globalRes.ok) {
  console.error("List global commands failed", globalRes.status, globalText.slice(0, 400));
  process.exit(1);
}
const global = JSON.parse(globalText);
const names = global.map((c) => c.name);
console.log("Global Updater global commands:", names.join(", ") || "(none)");
if (names.some((n) => n !== "root")) {
  console.warn("Run: node scripts/discord-register-root-updater-commands.mjs");
}
