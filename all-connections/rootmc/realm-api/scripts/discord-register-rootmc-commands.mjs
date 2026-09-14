/**

 * Register slash commands for the RootMC Discord bot.

 *

 * Registers on the RootMC guild first (shows in Discord within seconds).

 * Clears stale global commands so old help/server-only entries do not linger.

 *

 * Usage (from Web/cloudflare/rootmc-realm-api/):

 *   node scripts/discord-register-rootmc-commands.mjs

 */

import fs from "node:fs";

import path from "node:path";
import { loadRootMcEnv } from "./lib/rootmc-env.mjs";
import { wranglerTomlPath } from "./lib/rootmc-paths.mjs";

const API = "https://discord.com/api/v10";

function readWranglerVar(p, name) {
  if (!fs.existsSync(p)) return "";
  const m = fs.readFileSync(p, "utf8").match(new RegExp(`^${name}\\s*=\\s*"([^"]*)"`, "m"));
  return m ? m[1] : "";
}

const fileEnv = loadRootMcEnv();
const wranglerPath = wranglerTomlPath();

const token = String(process.env.DISCORD_ROOTMC_BOT_TOKEN || fileEnv.DISCORD_ROOTMC_BOT_TOKEN || "")
  .replace(/^bot\s+/i, "")
  .trim();

const clientId = String(

  process.env.DISCORD_ROOTMC_CLIENT_ID ||

    fileEnv.DISCORD_ROOTMC_CLIENT_ID ||

    readWranglerVar(wranglerPath, "DISCORD_ROOTMC_CLIENT_ID") ||

    "1511794429986345020",

).trim();

const guildId = String(

  process.env.DISCORD_ROOTMC_GUILD_ID ||

    fileEnv.DISCORD_ROOTMC_GUILD_ID ||

    readWranglerVar(wranglerPath, "DISCORD_ROOTMC_GUILD_ID") ||

    "1516108585740800042",

).trim();



if (token.length < 40 || !clientId || !guildId) {

  console.error("Need DISCORD_ROOTMC_BOT_TOKEN, DISCORD_ROOTMC_CLIENT_ID, DISCORD_ROOTMC_GUILD_ID.");

  process.exit(1);

}



const itemOption = {

  type: 3,

  name: "item",

  description: "Item name (e.g. diamond, oak_log, iron_ingot)",

  required: true,

};



const commands = [

  { name: "help", description: "RootMC — realm, server status, and commands", type: 1 },

  {
    name: "link",
    description: "Finish Minecraft verify with your in-game /link code",
    type: 1,
    options: [
      {
        type: 3,
        name: "code",
        description: "6-character code from /link in Minecraft",
        required: true,
        min_length: 6,
        max_length: 6,
      },
    ],
  },


  {

    name: "value",

    description: "Market price + 7/14/28/365-day trend charts",

    type: 1,

    options: [itemOption],

  },

  {

    name: "worth",

    description: "Same as /value — price + trend charts",

    type: 1,

    options: [itemOption],

  },

  {

    name: "balance",

    description: "Your linked in-game gold balance (requires Minecraft link)",

    type: 1,

  },

  {

    name: "bal",

    description: "Alias for /balance",

    type: 1,

  },

  {

    name: "pay",

    description: "Pay gold to another linked Discord member (min 0.01)",

    type: 1,

    options: [

      {

        type: 6,

        name: "member",

        description: "Linked member to pay",

        required: true,

      },

      {

        type: 10,

        name: "amount",

        description: "Gold amount (minimum 0.01)",

        required: true,

        min_value: 0.01,

      },

    ],

  },

  {

    name: "systemreport",

    description: "Manually push RootMC daily reports (owner only)",

    type: 1,

    options: [

      { type: 1, name: "all", description: "Daily summary + economy, towns, and nations briefs" },

      { type: 1, name: "daily", description: "Daily intelligence summary only" },

      { type: 1, name: "economy", description: "Economy brief only" },

      { type: 1, name: "towns", description: "Towns brief only" },

      { type: 1, name: "nations", description: "Nations brief only" },

    ],

  },

  {

    name: "devuptime",

    description: "Dev workstation / laptop / server uptime reports (dev role)",

    type: 1,

    options: [

      {
        type: 1,
        name: "weekly",
        description: "Last 7 HST days — sessions, timeouts, day-by-day uptime",
      },

      {
        type: 1,
        name: "monthly",
        description: "Last 30 HST days — totals, power cycles, top active days",
      },

      {
        type: 1,
        name: "yearly",
        description: "Last 365 HST days — totals by month and power cycles",
      },

    ],

  },

  {

    name: "vote",

    description: "Governance voting power % and link to official polls (linked accounts)",

    type: 1,

  },

  {

    name: "proposal",

    description: "Community votes — linked Minecraft accounts only",

    type: 1,

    options: [

      {
        type: 1,
        name: "submit",
        description: "Submit a citizen proposal (Council voting power required)",
        options: [
          { type: 3, name: "title", description: "Short title", required: true },
          { type: 3, name: "description", description: "What you want changed", required: true },
          {
            type: 3,
            name: "category",
            description: "constitution, governance, plugin, or metric",
            required: false,
            choices: [
              { name: "Constitution", value: "constitution" },
              { name: "Governance", value: "governance" },
              { name: "Plugin / rules", value: "plugin" },
              { name: "Server metric", value: "metric" },
            ],
          },
        ],
      },

      {
        type: 1,
        name: "retract",
        description: "Retract your pending proposal before weekly compile",
        options: [{ type: 3, name: "id", description: "Your proposal id", required: true }],
      },

      {
        type: 1,
        name: "amend",
        description: "Amend the weekly bill during the amendment period",
        options: [
          { type: 3, name: "bill", description: "Weekly bill id", required: true },
          { type: 3, name: "text", description: "Amendment text", required: true },
          { type: 3, name: "item", description: "Optional item id this amends", required: false },
        ],
      },

      {
        type: 1,
        name: "discuss",
        description: "Link to the Discord discussion thread for a proposal or bill",
        options: [{ type: 3, name: "id", description: "Proposal or bill id", required: true }],
      },

      {

        type: 1,

        name: "list",

        description: "List pending proposals, bills, and open votes",

      },

      {

        type: 1,

        name: "status",

        description: "Status for a proposal item, weekly bill, or vote poll",

        options: [

          { type: 3, name: "id", description: "Item, bill, or vote id", required: true },

        ],

      },

      {

        type: 1,

        name: "compile",

        description: "Staff: compile pending items into weekly bill",

        options: [

          { type: 3, name: "week", description: "HST week key YYYY-MM-DD (Monday)", required: false },

        ],

      },

      {

        type: 1,

        name: "create",

        description: "Staff: open an immediate vote (bypass weekly bill)",

        options: [

          { type: 3, name: "title", description: "Short title", required: true },

          { type: 3, name: "description", description: "What players are voting on", required: true },

          { type: 4, name: "days", description: "Days open (default 7, max 30)", required: false, min_value: 1, max_value: 30 },

          {
            type: 3,
            name: "kind",
            description: "general vote or season_arc (activates announcer on pass)",
            required: false,
            choices: [
              { name: "General", value: "general" },
              { name: "Season arc", value: "season_arc" },
            ],
          },

          { type: 3, name: "theme", description: "Season arc: short theme label", required: false },

          {
            type: 3,
            name: "lines",
            description: "Season arc: announcer tips separated by |",
            required: false,
          },

        ],

      },

      {

        type: 1,

        name: "close",

        description: "Staff: close vote and post result",

        options: [

          { type: 3, name: "id", description: "Proposal id", required: true },

        ],

      },

    ],

  },

  {
    name: "proposals",
    description: "Citizen legislature — submit, discuss in threads, weekly Council vote",
    type: 1,
    options: [
      {
        type: 1,
        name: "submit",
        description: "Submit a proposal (opens site page + Discord discussion thread)",
        options: [
          { type: 3, name: "title", description: "Short title", required: true },
          { type: 3, name: "description", description: "What you want changed", required: true },
          {
            type: 3,
            name: "category",
            description: "constitution, governance, plugin, or metric",
            required: false,
            choices: [
              { name: "Constitution", value: "constitution" },
              { name: "Governance", value: "governance" },
              { name: "Plugin / rules", value: "plugin" },
              { name: "Server metric", value: "metric" },
            ],
          },
        ],
      },
      {
        type: 1,
        name: "discuss",
        description: "Open the discussion thread for a proposal or bill",
        options: [{ type: 3, name: "id", description: "Proposal or bill id", required: true }],
      },
      { type: 1, name: "list", description: "Pending proposals, bills, and vote links" },
      {
        type: 1,
        name: "status",
        description: "Status for proposal, bill, or vote id",
        options: [{ type: 3, name: "id", description: "Id", required: true }],
      },
      {
        type: 1,
        name: "retract",
        description: "Retract your pending proposal",
        options: [{ type: 3, name: "id", description: "Your proposal id", required: true }],
      },
      {
        type: 1,
        name: "amend",
        description: "Amend the weekly bill during amendment period",
        options: [
          { type: 3, name: "bill", description: "Weekly bill id", required: true },
          { type: 3, name: "text", description: "Amendment text", required: true },
          { type: 3, name: "item", description: "Optional item id", required: false },
        ],
      },
    ],
  },

];



async function putCommands(url, body, label) {

  const res = await fetch(url, {

    method: "PUT",

    headers: {

      Authorization: `Bot ${token}`,

      "Content-Type": "application/json; charset=utf-8",

      "User-Agent": "RootRecord/discord-register-rootmc",

    },

    body: JSON.stringify(body),

  });

  const text = await res.text();

  if (!res.ok) {

    console.error(`${label} failed`, res.status, text.slice(0, 1200));

    process.exit(1);

  }

  return text;

}



const guildUrl = `${API}/applications/${encodeURIComponent(clientId)}/guilds/${encodeURIComponent(guildId)}/commands`;

const globalUrl = `${API}/applications/${encodeURIComponent(clientId)}/commands`;

const interactionsBase = String(process.env.ROOTMC_API_URL || fileEnv.ROOTMC_API_URL || "https://api.rootmc.info").replace(
  /\/$/,
  "",
);
const interactionsUrl = `${interactionsBase}/v1/discord/rootmc/interactions`;

const endpointRes = await fetch(`${API}/applications/@me`, {
  method: "PATCH",
  headers: {
    Authorization: `Bot ${token}`,
    "Content-Type": "application/json; charset=utf-8",
    "User-Agent": "RootRecord/discord-register-rootmc",
  },
  body: JSON.stringify({ interactions_endpoint_url: interactionsUrl }),
});
const endpointText = await endpointRes.text();
if (!endpointRes.ok) {
  console.error("Interactions endpoint PATCH failed", endpointRes.status, endpointText.slice(0, 800));
  process.exit(1);
}
console.log("Interactions endpoint set:", interactionsUrl);

const guildResult = await putCommands(guildUrl, commands, "Guild command register");

await putCommands(globalUrl, [], "Global command clear");



console.log(`Registered ${commands.length} guild commands on ${guildId}:`);

console.log(commands.map((c) => c.name).join(", "));

console.log("Guild API response:", guildResult.slice(0, 500));

console.log("");

console.log("Interactions endpoint:");

console.log(interactionsUrl);

console.log("");

console.log(

  `Invite: https://discord.com/api/oauth2/authorize?client_id=${clientId}&permissions=268446736&scope=bot%20applications.commands`,

);


