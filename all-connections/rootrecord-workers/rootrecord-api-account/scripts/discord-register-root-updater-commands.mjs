/**
 * Register global `/root` slash commands for the Root Record Global Updater bot.
 * Economy: discord-register-root-economy-commands.mjs · Kīlauea: discord-register-kilauea-commands.mjs
 *
 * Usage (from Web/cloudflare/rootrecord-api-account/):
 *   node scripts/discord-register-root-updater-commands.mjs
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
  if (process.env.CREDENTIALS_ENV && fs.existsSync(process.env.CREDENTIALS_ENV)) {
    return process.env.CREDENTIALS_ENV;
  }
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

function readWranglerClientId(p) {
  if (!fs.existsSync(p)) return "";
  const m = fs.readFileSync(p, "utf8").match(/^DISCORD_CLIENT_ID\s*=\s*"([^"]*)"/m);
  return m ? m[1] : "";
}

const credPath = findCredentialsPath();
const fileEnv = readEnvFile(credPath);
const wranglerPath = path.join(process.cwd(), "wrangler.toml");
const token = String(process.env.DISCORD_BOT_TOKEN || fileEnv.DISCORD_BOT_TOKEN || "")
  .replace(/^bot\s+/i, "")
  .trim();
const clientId = String(
  process.env.DISCORD_CLIENT_ID || fileEnv.DISCORD_CLIENT_ID || readWranglerClientId(wranglerPath) || "",
).trim();

if (token.length < 40 || !clientId) {
  console.error("Need DISCORD_BOT_TOKEN (credentials.env) and DISCORD_CLIENT_ID (env or wrangler.toml [vars]).");
  process.exit(1);
}

const categoryPickDescription = "Comma-separated category ids, or all (see /root categories list)";

const commands = [
  {
    name: "root",
    description: "Root Record product release feeds — channel + category setup",
    type: 1,
    options: [
      {
        type: 1,
        name: "help",
        description: "How to subscribe this server to Root Record updates",
      },
      {
        type: 2,
        name: "channel",
        description: "Where update posts are delivered",
        options: [
          {
            type: 1,
            name: "set",
            description: "Set the text channel for Root Record updates",
            options: [
              {
                type: 7,
                name: "channel",
                description: "Text channel for update posts",
                required: true,
                channel_types: [0, 5],
              },
            ],
          },
          {
            type: 1,
            name: "show",
            description: "Show the configured updates channel",
          },
        ],
      },
      {
        type: 2,
        name: "categories",
        description: "Which product lines this server receives",
        options: [
          {
            type: 1,
            name: "list",
            description: "List all update category ids",
          },
          {
            type: 1,
            name: "show",
            description: "Show categories subscribed on this server",
          },
          {
            type: 1,
            name: "set",
            description: "Set subscribed categories (comma-separated ids or all)",
            options: [
              {
                type: 3,
                name: "pick",
                description: categoryPickDescription,
                required: true,
              },
            ],
          },
        ],
      },
    ],
  },
];

const url = `${API}/applications/${encodeURIComponent(clientId)}/commands`;
const res = await fetch(url, {
  method: "PUT",
  headers: {
    Authorization: `Bot ${token}`,
    "Content-Type": "application/json; charset=utf-8",
    "User-Agent": "RootRecord/discord-register-root-updater",
  },
  body: JSON.stringify(commands),
});
const text = await res.text();
if (!res.ok) {
  console.error("Register global /root commands failed", res.status, text.slice(0, 1200));
  process.exit(1);
}

console.log("Registered global /root commands:", text.slice(0, 400));
console.log("");
console.log("Bot invite (Send Messages + Use Application Commands):");
console.log(
  `https://discord.com/api/oauth2/authorize?client_id=${clientId}&permissions=84992&scope=bot%20applications.commands`,
);
console.log("");
console.log("Interactions endpoint (Global Updater application only):");
console.log("https://api.rootrecord.online/v1/discord/interactions");
console.log("");
console.log("Ops broadcast: POST /api/internal/discord-updates-broadcast");
console.log('  { "category": "blocknotes", "content": "…", "embeds": […] }');
console.log("");
console.log("Kīlauea live feeds → Kīlauea Alerts bot. ROOTS → Root Economy bot.");
