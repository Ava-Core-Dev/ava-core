/**
 * Open constitution ratification poll in #voting (Council of Voters, weighted).
 *
 *   node scripts/post-constitution-approval-poll.mjs --confirm
 */
import fs from "node:fs";
import { loadRootMcEnv, rootMcBotToken } from "./lib/rootmc-env.mjs";
import { ROOTMC_GUILD_ID, ROOTMC_CHANNELS } from "./lib/rootmc-discord.mjs";
import { wranglerTomlPath } from "./lib/rootmc-paths.mjs";
import {
  CONSTITUTION_RATIFY_CLOSES_ISO,
  CONSTITUTION_WIKI_URL,
  constitutionBillSummary,
  constitutionPollDescription,
  constitutionPollTitle,
  formatPollClosesLine,
} from "./lib/rootmc-constitution.mjs";

const API = "https://discord.com/api/v10";
const VOTE_PREFIX = "rootmc_prop:vote:";
const STAFF_DISCORD_ID = "1497037418979786823";
const D1_DATABASE_ID = "6cf71128-67e3-47b2-a802-d6c23d6489e0";
const EMBED_BLUE = 0x2d6a4f;

const confirm = process.argv.includes("--confirm");

function readWranglerVar(name) {
  const p = wranglerTomlPath();
  if (!fs.existsSync(p)) return "";
  const m = fs.readFileSync(p, "utf8").match(new RegExp(`^${name}\\s*=\\s*"([^"]*)"`, "m"));
  return m ? m[1] : "";
}

function proposalId() {
  return crypto.randomUUID().slice(0, 8);
}

function voteButtons(id, disabled = false) {
  const style = disabled ? 2 : 1;
  return [
    {
      type: 1,
      components: [
        { type: 2, style, label: "For", custom_id: `${VOTE_PREFIX}${id}:for`, disabled },
        { type: 2, style: disabled ? 2 : 4, label: "Against", custom_id: `${VOTE_PREFIX}${id}:against`, disabled },
        { type: 2, style: disabled ? 2 : 2, label: "Abstain", custom_id: `${VOTE_PREFIX}${id}:abstain`, disabled },
      ],
    },
  ];
}

async function discordPost(token, route, body) {
  const res = await fetch(`${API}${route}`, {
    method: "POST",
    headers: {
      Authorization: `Bot ${token}`,
      "Content-Type": "application/json; charset=utf-8",
      "User-Agent": "RootMC/post-constitution-approval-poll",
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`POST ${route} → ${res.status}: ${text.slice(0, 600)}`);
  return JSON.parse(text);
}

async function d1Query(sql) {
  const env = loadRootMcEnv();
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID || env.CLOUDFLARE_ACCOUNT_ID;
  const token = process.env.CLOUDFLARE_API_TOKEN || env.CLOUDFLARE_API_TOKEN;
  if (!accountId || !token) throw new Error("Need CLOUDFLARE_ACCOUNT_ID + CLOUDFLARE_API_TOKEN");
  const res = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${accountId}/d1/database/${D1_DATABASE_ID}/query`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ sql }),
    },
  );
  const data = await res.json();
  if (!data.success) throw new Error(JSON.stringify(data.errors || data).slice(0, 400));
  return data;
}

const env = loadRootMcEnv();
const token = rootMcBotToken(env);
const votingChannelId =
  readWranglerVar("DISCORD_ROOTMC_VOTING_CHANNEL_ID") ||
  ROOTMC_CHANNELS.voting ||
  "";

if (!votingChannelId) {
  console.error("Set DISCORD_ROOTMC_VOTING_CHANNEL_ID or run setup-discord-voting-channel.mjs --confirm first.");
  process.exit(1);
}

const id = proposalId();
const createdAt = new Date().toISOString();
const closesAt = CONSTITUTION_RATIFY_CLOSES_ISO;
const title = constitutionPollTitle();
const description = constitutionPollDescription();
const billSummary = constitutionBillSummary();
const billUrl = CONSTITUTION_WIKI_URL;

const embed = {
  title: `Official poll — ${title}`,
  description: [
    `_Bill summary:_ ${billSummary}`,
    `_Full bill:_ ${billUrl}`,
    description,
    "",
    "**Weighted For:** 0% · **Against:** 0% · **Abstain:** 0%",
    "**Head count:** 0 for · 0 against · 0 abstain",
    "**Linked voters:** 0 (quorum for pass: 5)",
    formatPollClosesLine(closesAt),
  ].join("\n").slice(0, 4096),
  color: EMBED_BLUE,
  footer: { text: `Proposal ${id} · Council of Voters · weighted shares` },
};

const intro =
  `_Official poll — **Council of Voters**. Vote with buttons below or on the site: https://rootmc.net/governance/vote/?id=${id} · accept terms at https://rootmc.net/terms/_`;

console.log("Proposal id:", id);
console.log("Channel:", votingChannelId);

if (!confirm) {
  console.log("Dry run — pass --confirm to post poll and insert D1 row.");
  process.exit(0);
}

const posted = await discordPost(token, `/channels/${encodeURIComponent(votingChannelId)}/messages`, {
  content: intro,
  embeds: [embed],
  components: voteButtons(id, false),
});
const messageId = String(posted.id || "");
if (!messageId) throw new Error("No message id from Discord");

const esc = (s) => String(s).replace(/'/g, "''");
await d1Query(
  `INSERT INTO rootmc_community_proposals
     (id, title, description, status, created_by_discord_id, created_at, closes_at, channel_id, message_id,
      kind, season_theme, season_lines_json, bill_summary, bill_url, poll_channel)
   VALUES (
     '${esc(id)}',
     '${esc(title.slice(0, 200))}',
     '${esc(description.slice(0, 4000))}',
     'open',
     '${esc(STAFF_DISCORD_ID)}',
     '${esc(createdAt)}',
     '${esc(closesAt)}',
     '${esc(votingChannelId)}',
     '${esc(messageId)}',
     'official',
     NULL,
     NULL,
     '${esc(billSummary)}',
     '${esc(billUrl)}',
     'voting'
   );`,
);

console.log("Posted constitution approval poll:", id);
console.log(`https://discord.com/channels/${ROOTMC_GUILD_ID}/${votingChannelId}/${messageId}`);
