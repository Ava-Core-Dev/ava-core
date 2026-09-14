/**
 * Register guild-only dev/ops slash commands for Root Economy on the primary Root Record server.
 * Public ROOTS commands (`/bal`, `/send`, …) are global on the Economy bot —
 * see discord-register-root-economy-commands.mjs.
 *
 * Usage:
 *   node scripts/discord-register-root-units-commands.mjs
 */
import fs from "node:fs";
import path from "path";

const API = "https://discord.com/api/v10";

function readEnvFile(p) {
  const out = {};
  if (!fs.existsSync(p)) return out;
  for (const raw of fs.readFileSync(p, "utf8").split(/\r?\n/)) {
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

function findCredentialsPath() {
  if (process.env.CREDENTIALS_ENV && fs.existsSync(process.env.CREDENTIALS_ENV)) return process.env.CREDENTIALS_ENV;
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

function readWranglerStringVars(p) {
  const out = {};
  if (!fs.existsSync(p)) return out;
  const text = fs.readFileSync(p, "utf8");
  for (const name of ["DISCORD_GUILD_ID", "DISCORD_CLIENT_ID"]) {
    const re = new RegExp(`^${name}\\s*=\\s*"([^"]*)"`, "m");
    const m = text.match(re);
    if (m) out[name] = m[1];
  }
  return out;
}

const credPath = findCredentialsPath();
const fileEnv = readEnvFile(credPath);
const wranglerPathFs = path.join(process.cwd(), "wrangler.toml");
const wranglerVars = readWranglerStringVars(wranglerPathFs);
const token = String(
  process.env.DISCORD_ECONOMY_BOT_TOKEN ||
    fileEnv.DISCORD_ECONOMY_BOT_TOKEN ||
    process.env.DISCORD_BOT_TOKEN ||
    fileEnv.DISCORD_BOT_TOKEN ||
    "",
).trim();
const guildId = String(
  process.env.DISCORD_GUILD_ID || fileEnv.DISCORD_GUILD_ID || wranglerVars.DISCORD_GUILD_ID || "",
).trim();
const appId = String(
  process.env.DISCORD_ECONOMY_CLIENT_ID ||
    fileEnv.DISCORD_ECONOMY_CLIENT_ID ||
    process.env.DISCORD_CLIENT_ID ||
    fileEnv.DISCORD_CLIENT_ID ||
    wranglerVars.DISCORD_CLIENT_ID ||
    "",
).trim();

if (!token || !guildId || !appId) {
  console.error(
    "Need DISCORD_ECONOMY_BOT_TOKEN (or DISCORD_BOT_TOKEN), DISCORD_GUILD_ID, and DISCORD_ECONOMY_CLIENT_ID.",
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
  {
    name: "bal",
    description: "ROOTS + custodial SOL/SPL balances (linked account).",
    type: 1,
  },
  {
    name: "economy",
    description: "Root Economy leaderboard + total internal ROOTS circulation",
    type: 1,
  },
  {
    name: "screenshot",
    description: "Developer-only Root Record ecosystem report with Grok summary",
    type: 1,
  },
  {
    name: "snapshot",
    description: "Developer-only Root Record ecosystem snapshot with usage and AI activity context",
    type: 1,
  },
  {
    name: "activity",
    description: "Developer-only Discord activity AI report",
    type: 1,
  },
  {
    name: "userreport",
    description: "Developer-only AI report on RootRecord user/app behavior",
    type: 1,
    options: [
      {
        type: 1,
        name: "all",
        description: "Full-system user, app, web, mobile, Discord, and ROOTS behavior coverage",
      },
      {
        type: 1,
        name: "role",
        description: "Report on verified Discord-linked users who hold a server role",
        options: [
          {
            type: 8,
            name: "role",
            description: "Discord role to scan",
            required: true,
          },
        ],
      },
      {
        type: 1,
        name: "user",
        description: "Report on one account by email, account id, user id, Discord name/id, or Solana wallet",
        options: [
          {
            type: 3,
            name: "query",
            description: "Email, account id, user:<email>, Discord id/name, or Solana wallet",
            required: true,
          },
        ],
      },
      {
        type: 1,
        name: "member",
        description: "Report on one linked Discord member",
        options: [
          {
            type: 6,
            name: "member",
            description: "Discord member",
            required: true,
          },
        ],
      },
    ],
  },
  {
    name: "token",
    description: "Developer-only ROOTS token, LP market, holders, and usage AI report",
    type: 1,
  },
  {
    name: "mint",
    description: "Developer-only mint/top-up for official ROOTS tokens",
    type: 1,
    options: [
      {
        type: 10,
        name: "amount",
        description: "ROOTS to mint; omit to top up Global Updater to internal circulation",
        required: false,
        min_value: 0.00000001,
      },
      {
        type: 3,
        name: "wallet",
        description: "Destination owner wallet; defaults to Root Record Global Updater",
        required: false,
      },
      {
        type: 3,
        name: "note",
        description: "Optional memo/note for the Discord result",
        required: false,
      },
    ],
  },
  {
    name: "send",
    description: "Send ROOTS, or SOL with user: user / everyone / active / role",
    type: 1,
    options: sendOptions,
  },
  {
    name: "swap",
    description: "Quote or buy internal ROOTS with SOL at 100 ROOTS = $3",
    type: 1,
    options: [
      {
        type: 1,
        name: "quote",
        description: "Preview SOL → internal ROOTS; SOL goes to treasury",
        options: [
          {
            type: 10,
            name: "amount",
            description: "SOL to spend, e.g. 0.01",
            required: true,
            min_value: 0.00001,
            max_value: 1,
          },
        ],
      },
      {
        type: 1,
        name: "buy",
        description: "Move SOL to treasury and credit ROOTS internally",
        options: [
          {
            type: 10,
            name: "amount",
            description: "SOL to spend, e.g. 0.01",
            required: true,
            min_value: 0.00001,
            max_value: 1,
          },
        ],
      },
      {
        type: 1,
        name: "all",
        description: "Move all spendable SOL to treasury and credit ROOTS internally",
      },
    ],
  },
  {
    name: "wallet",
    description: "Custodial Solana address + QR (SOL/SPL deposit)",
    type: 1,
  },
  {
    name: "deposit",
    description: "Same as /wallet — address + QR",
    type: 1,
  },
  {
    name: "menu",
    description: "Quick picker (balance, wallet, faucet claim, help)",
    type: 1,
  },
  {
    name: "faucet",
    description: "Random ROOTS from pool (12h) or deposit into pool",
    type: 1,
    options: [
      { type: 1, name: "claim", description: "Random amount if pool has balance" },
      {
        type: 1,
        name: "deposit",
        description: "Add your ROOTS to the pool",
        options: [
          {
            type: 10,
            name: "amount",
            description: "Roots to add to pool (decimal)",
            required: true,
            min_value: 0.00000001,
            max_value: 10,
          },
        ],
      },
    ],
  },
  {
    name: "withdraw",
    description: "Withdraw SPL (coming soon)",
    type: 1,
    options: [
      { type: 1, name: "token", description: "One SPL mint (soon)" },
      { type: 1, name: "all", description: "All tokens (soon)" },
    ],
  },
  {
    name: "airdrop",
    description: "Airdrops (coming soon)",
    type: 1,
    options: [
      { type: 1, name: "claim", description: "Claim an airdrop (soon)" },
      { type: 1, name: "create", description: "Create an airdrop (soon)" },
    ],
  },
  {
    name: "dice",
    description: "Wager ROOTS vs another user (accept button)",
    type: 1,
    options: [
      { type: 6, name: "opponent", description: "User you challenge", required: true },
      {
        type: 10,
        name: "amount",
        description: "Roots each (decimal; winner takes 2x)",
        required: true,
        min_value: 0.00000001,
        max_value: 10,
      },
    ],
  },
];

const meRes = await fetch(`${API}/oauth2/applications/@me`, {
  headers: { Authorization: `Bot ${token}`, "User-Agent": "RootRecord/discord-register-root-units" },
});
const meText = await meRes.text();
if (!meRes.ok) {
  console.error("GET /oauth2/applications/@me", meRes.status, meText.slice(0, 400));
  process.exit(1);
}
const me = JSON.parse(meText);
const verifyKey = typeof me.verify_key === "string" ? me.verify_key.trim() : "";
console.log("--- If you rotate the app, update wrangler.toml [vars] DISCORD_PUBLIC_KEY in rootrecord-api-account ---");
console.log(`DISCORD_PUBLIC_KEY=${verifyKey}`);
console.log(
  "--- REQUIRED: Developer Portal → ROOT ECONOMY APPLICATION → General Information → Interactions Endpoint URL ---",
);
console.log("https://api.rootrecord.online/v1/discord/economy/interactions");

const putRes = await fetch(`${API}/applications/${encodeURIComponent(appId)}/guilds/${encodeURIComponent(guildId)}/commands`, {
  method: "PUT",
  headers: {
    Authorization: `Bot ${token}`,
    "Content-Type": "application/json; charset=utf-8",
    "User-Agent": "RootRecord/discord-register-root-units",
  },
  body: JSON.stringify(commands),
});
const putText = await putRes.text();
if (!putRes.ok) {
  console.error("PUT guild commands", putRes.status, putText.slice(0, 1200));
  process.exit(1);
}
console.log("ok PUT guild commands", putRes.status, putText.slice(0, 200));
