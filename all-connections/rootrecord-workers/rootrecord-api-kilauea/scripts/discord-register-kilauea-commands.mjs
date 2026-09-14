/**
 * Register global slash commands for Kīlauea Alerts bot.
 *
 * Usage: node scripts/discord-register-kilauea-commands.mjs
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
  for (const p of [path.join(here, "../../../../credentials.env"), path.join(here, "../../../credentials.env")]) {
    if (fs.existsSync(p)) return p;
  }
  return path.join(here, "../../../credentials.env");
}

const fileEnv = readEnvFile(findCredentialsPath());
const token = String(process.env.DISCORD_KILAUEA_BOT_TOKEN || fileEnv.DISCORD_KILAUEA_BOT_TOKEN || process.env.DISCORD_BOT_TOKEN || fileEnv.DISCORD_BOT_TOKEN || "").replace(/^bot\s+/i, "").trim();
const clientId = String(process.env.DISCORD_KILAUEA_CLIENT_ID || fileEnv.DISCORD_KILAUEA_CLIENT_ID || "1510049729776713728").trim();

if (!token || token.length < 40) {
  console.error("Need DISCORD_KILAUEA_BOT_TOKEN in credentials.env");
  process.exit(1);
}

const commands = [
  {
    name: "config",
    description: "Configure alert channel for this server",
    type: 1,
    default_member_permissions: "32",
    options: [
      {
        type: 1,
        name: "set",
        description: "Set the channel for USGS quakes and AI summaries",
        options: [
          {
            type: 7,
            name: "channel",
            description: "Text channel for Kilauea alerts",
            required: true,
            channel_types: [0],
          },
        ],
      },
      {
        type: 1,
        name: "show",
        description: "Show current server configuration",
      },
    ],
  },
  {
    name: "data",
    description: "Submit a Kīlauea field observation",
    type: 1,
  },
  {
    name: "kilauea",
    description: "Generate a Kilauea hazards AI report",
    type: 1,
  },
];

const url = `${API}/applications/${clientId}/commands`;
const res = await fetch(url, {
  method: "PUT",
  headers: { Authorization: `Bot ${token}`, "Content-Type": "application/json" },
  body: JSON.stringify(commands),
});
const text = await res.text();
if (!res.ok) {
  console.error("Register failed", res.status, text);
  process.exit(1);
}
console.log("Registered global Kīlauea bot commands:", text);
console.log("\nInteractions Endpoint URL:");
console.log("https://api.rootrecord.online/v1/discord/kilauea/interactions");
