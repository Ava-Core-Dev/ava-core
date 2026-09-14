/**
 * Update live constitution ratification poll (D1 + Discord embed).
 *
 *   node scripts/update-constitution-ratification-poll.mjs --confirm
 */
import { loadRootMcEnv, rootMcBotToken } from "./lib/rootmc-env.mjs";
import {
  CONSTITUTION_RATIFY_CLOSES_ISO,
  CONSTITUTION_RATIFY_POLL_ID,
  CONSTITUTION_WIKI_URL,
  constitutionBillSummary,
  constitutionPollDescription,
  constitutionPollTitle,
  formatPollClosesLine,
} from "./lib/rootmc-constitution.mjs";

const API = "https://discord.com/api/v10";
const VOTE_PREFIX = "rootmc_prop:vote:";
const D1_DATABASE_ID = "6cf71128-67e3-47b2-a802-d6c23d6489e0";
const EMBED_BLUE = 0x2d6a4f;
const QUORUM = 5;

const confirm = process.argv.includes("--confirm");
const proposalId = process.argv.find((a) => a.startsWith("--id="))?.slice(5) || CONSTITUTION_RATIFY_POLL_ID;

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

async function discordPatch(token, route, body) {
  const res = await fetch(`${API}${route}`, {
    method: "PATCH",
    headers: {
      Authorization: `Bot ${token}`,
      "Content-Type": "application/json; charset=utf-8",
      "User-Agent": "RootMC/update-constitution-ratification-poll",
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`PATCH ${route} → ${res.status}: ${text.slice(0, 600)}`);
  return text ? JSON.parse(text) : {};
}

function esc(s) {
  return String(s).replace(/'/g, "''");
}

function formatWeight(n) {
  return `${Math.round(Math.max(0, n) * 100) / 100}%`;
}

function parseTallies(voteRows) {
  let votesFor = 0;
  let votesAgainst = 0;
  let votesAbstain = 0;
  let weightedFor = 0;
  let weightedAgainst = 0;
  let weightedAbstain = 0;
  for (const row of voteRows || []) {
    const c = Number(row.c) || 0;
    const w = Number(row.weighted) || 0;
    if (row.vote === "for") {
      votesFor = c;
      weightedFor = w;
    } else if (row.vote === "against") {
      votesAgainst = c;
      weightedAgainst = w;
    } else if (row.vote === "abstain") {
      votesAbstain = c;
      weightedAbstain = w;
    }
  }
  const totalWeight = weightedFor + weightedAgainst + weightedAbstain;
  const pct = (part) => (totalWeight > 0 ? Math.round((part / totalWeight) * 1000) / 10 : 0);
  return {
    votesFor,
    votesAgainst,
    votesAbstain,
    total: votesFor + votesAgainst + votesAbstain,
    weightedForPct: pct(weightedFor),
    weightedAgainstPct: pct(weightedAgainst),
    weightedAbstainPct: pct(weightedAbstain),
  };
}

const title = constitutionPollTitle();
const description = constitutionPollDescription();
const billSummary = constitutionBillSummary();
const billUrl = CONSTITUTION_WIKI_URL;
const closesAt = CONSTITUTION_RATIFY_CLOSES_ISO;

console.log("Proposal id:", proposalId);
console.log("New title:", title);
console.log("New closes_at:", closesAt);

const rowRes = await d1Query(
  `SELECT id, title, status, channel_id, message_id, closes_at FROM rootmc_community_proposals WHERE id = '${esc(proposalId)}' LIMIT 1`,
);
const row = rowRes.result?.[0]?.results?.[0];
if (!row) {
  console.error("Proposal not found:", proposalId);
  process.exit(1);
}
if (row.status !== "open") {
  console.error("Proposal is not open:", row.status);
  process.exit(1);
}

const voteRes = await d1Query(
  `SELECT vote, COUNT(*) AS c, COALESCE(SUM(vote_weight), 0) AS weighted
   FROM rootmc_community_proposal_votes WHERE proposal_id = '${esc(proposalId)}' GROUP BY vote`,
);
const tallies = parseTallies(voteRes.result?.[0]?.results);

const embed = {
  title: `Official poll — ${title}`,
  description: [
    `_Bill summary:_ ${billSummary}`,
    `_Full bill:_ ${billUrl}`,
    description,
    "",
    `**Weighted For:** ${formatWeight(tallies.weightedForPct)} · **Against:** ${formatWeight(tallies.weightedAgainstPct)} · **Abstain:** ${formatWeight(tallies.weightedAbstainPct)}`,
    `**Head count:** ${tallies.votesFor} for · ${tallies.votesAgainst} against · ${tallies.votesAbstain} abstain`,
    `**Linked voters:** ${tallies.total} (quorum for pass: ${QUORUM})`,
    formatPollClosesLine(closesAt),
  ].join("\n").slice(0, 4096),
  color: EMBED_BLUE,
  footer: { text: `Proposal ${proposalId} · Council of Voters · weighted shares` },
};

console.log("Current closes_at:", row.closes_at);
console.log("Discord message:", row.channel_id, row.message_id);

if (!confirm) {
  console.log("Dry run — pass --confirm to UPDATE D1 and PATCH Discord embed.");
  process.exit(0);
}

await d1Query(
  `UPDATE rootmc_community_proposals
   SET title = '${esc(title.slice(0, 200))}',
       description = '${esc(description.slice(0, 4000))}',
       closes_at = '${esc(closesAt)}',
       bill_summary = '${esc(billSummary)}',
       bill_url = '${esc(billUrl)}'
   WHERE id = '${esc(proposalId)}'`,
);

const env = loadRootMcEnv();
const token = rootMcBotToken(env);
await discordPatch(
  token,
  `/channels/${encodeURIComponent(row.channel_id)}/messages/${encodeURIComponent(row.message_id)}`,
  { embeds: [embed], components: voteButtons(proposalId, false) },
);

console.log("Updated constitution ratification poll:", proposalId);
console.log(`https://rootmc.net/governance/vote/?id=${proposalId}`);
