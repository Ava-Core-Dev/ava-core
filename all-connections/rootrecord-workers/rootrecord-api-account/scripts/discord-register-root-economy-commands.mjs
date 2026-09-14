/**
 * Register global slash commands for the Root Economy Discord bot.
 *
 * Usage (from Web/cloudflare/rootrecord-api-account/):
 *   node scripts/discord-register-root-economy-commands.mjs
 *
 * Secrets in credentials.env:
 *   DISCORD_ECONOMY_BOT_TOKEN
 *   DISCORD_ECONOMY_CLIENT_ID  (or DISCORD_ECONOMY_CLIENT_ID in wrangler.toml [vars])
 *
 * Interactions endpoint (Economy application → General Information):
 *   https://api.rootrecord.online/v1/discord/economy/interactions
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

function readWranglerVar(p, name) {
  if (!fs.existsSync(p)) return "";
  const m = fs.readFileSync(p, "utf8").match(new RegExp(`^${name}\\s*=\\s*"([^"]*)"`, "m"));
  return m ? m[1] : "";
}

const credPath = findCredentialsPath();
const fileEnv = readEnvFile(credPath);
const wranglerPath = path.join(process.cwd(), "wrangler.toml");
const token = String(
  process.env.DISCORD_ECONOMY_BOT_TOKEN || fileEnv.DISCORD_ECONOMY_BOT_TOKEN || "",
)
  .replace(/^bot\s+/i, "")
  .trim();
const clientId = String(
  process.env.DISCORD_ECONOMY_CLIENT_ID ||
    fileEnv.DISCORD_ECONOMY_CLIENT_ID ||
    readWranglerVar(wranglerPath, "DISCORD_ECONOMY_CLIENT_ID") ||
    "",
).trim();

if (token.length < 40 || !clientId) {
  console.error(
    "Need DISCORD_ECONOMY_BOT_TOKEN and DISCORD_ECONOMY_CLIENT_ID (credentials.env or wrangler.toml [vars]).",
  );
  process.exit(1);
}

const assetOption = {
  type: 3,
  name: "asset",
  description: "ROOTS = Root Units points. SOL = deposit-wallet transfer (/send user).",
  required: true,
  choices: [
    { name: "ROOTS", value: "ROOTS" },
    { name: "SOL (on-chain)", value: "SOL" },
  ],
};

const sendOptions = [
  {
    type: 1,
    name: "user",
    description: "One linked recipient — ROOTS or SOL",
    options: [
      assetOption,
      { type: 6, name: "member", description: "Linked user", required: true },
      {
        type: 10,
        name: "amount",
        description: "SOL: decimal (e.g. 0.00001). ROOTS: decimal ROOTS",
        required: true,
        min_value: 0.00000001,
        max_value: 10,
      },
    ],
  },
  {
    type: 1,
    name: "everyone",
    description: "Split all other linked members (ROOTS)",
    options: [
      assetOption,
      {
        type: 10,
        name: "amount",
        description: "Total Roots to split (decimal, e.g. 0.00224631)",
        required: true,
        min_value: 0.00000001,
        max_value: 10,
      },
    ],
  },
  {
    type: 1,
    name: "active",
    description: "Linked + recent discord_user_activity (ROOTS)",
    options: [
      assetOption,
      {
        type: 10,
        name: "amount",
        description: "Total Roots to split (decimal); window from DISCORD_ACTIVE_LOOKBACK_DAYS",
        required: true,
        min_value: 0.00000001,
        max_value: 10,
      },
    ],
  },
  {
    type: 1,
    name: "role",
    description: "Split linked members who have this role (ROOTS)",
    options: [
      assetOption,
      { type: 8, name: "role", description: "Server role", required: true },
      {
        type: 10,
        name: "amount",
        description: "Total Roots to split (decimal, e.g. 0.01)",
        required: true,
        min_value: 0.00000001,
        max_value: 10,
      },
    ],
  },
];

const commands = [
  { name: "bal", description: "ROOTS + custodial SOL/SPL balances (linked account).", type: 1 },
  { name: "economy", description: "Root Economy leaderboard + total internal ROOTS circulation", type: 1 },
  { name: "send", description: "Send ROOTS, or SOL with user: user / everyone / active / role", type: 1, options: sendOptions },
  { name: "swap", description: "Quote or buy internal ROOTS with SOL at 100 ROOTS = $3", type: 1, options: [
    { type: 1, name: "quote", description: "Preview SOL → internal ROOTS", options: [{ type: 10, name: "amount", description: "SOL to spend", required: true, min_value: 0.00001, max_value: 1 }] },
    { type: 1, name: "buy", description: "Move SOL to treasury and credit ROOTS", options: [{ type: 10, name: "amount", description: "SOL to spend", required: true, min_value: 0.00001, max_value: 1 }] },
    { type: 1, name: "all", description: "Move all spendable SOL to treasury and credit ROOTS" },
  ]},
  { name: "wallet", description: "Custodial Solana address + QR (SOL/SPL deposit)", type: 1 },
  { name: "deposit", description: "Same as /wallet — address + QR", type: 1 },
  { name: "menu", description: "Root Economy command menu", type: 1 },
  { name: "dice", description: "Wager ROOTS vs another user (accept button)", type: 1, options: [
    { type: 6, name: "opponent", description: "User you challenge", required: true },
    { type: 10, name: "amount", description: "Roots each (decimal; winner takes 2x)", required: true, min_value: 0.00000001, max_value: 10 },
  ]},
];

const meRes = await fetch(`${API}/oauth2/applications/@me`, {
  headers: { Authorization: `Bot ${token}`, "User-Agent": "RootRecord/discord-register-root-economy" },
});
const meText = await meRes.text();
if (!meRes.ok) {
  console.error("GET /oauth2/applications/@me", meRes.status, meText.slice(0, 400));
  process.exit(1);
}
const me = JSON.parse(meText);
const verifyKey = typeof me.verify_key === "string" ? me.verify_key.trim() : "";
console.log("Set wrangler.toml [vars] DISCORD_ECONOMY_PUBLIC_KEY =");
console.log(`DISCORD_ECONOMY_PUBLIC_KEY="${verifyKey}"`);
console.log(`DISCORD_ECONOMY_CLIENT_ID="${clientId}"`);

const url = `${API}/applications/${encodeURIComponent(clientId)}/commands`;
const putRes = await fetch(url, {
  method: "PUT",
  headers: {
    Authorization: `Bot ${token}`,
    "Content-Type": "application/json; charset=utf-8",
    "User-Agent": "RootRecord/discord-register-root-economy",
  },
  body: JSON.stringify(commands),
});
const putText = await putRes.text();
if (!putRes.ok) {
  console.error("Register global Economy commands failed", putRes.status, putText.slice(0, 1200));
  process.exit(1);
}

console.log("Registered global Root Economy commands:", putText.slice(0, 400));
console.log("");
console.log("Interactions endpoint:");
console.log("https://api.rootrecord.online/v1/discord/economy/interactions");
console.log("");
console.log("Invite:");
console.log(
  `https://discord.com/api/oauth2/authorize?client_id=${clientId}&permissions=84992&scope=bot%20applications.commands`,
);
