/**
 * Close or re-resolve a community proposal (D1 + Discord embed).
 *
 *   node scripts/close-community-proposal.mjs --id=549cf16c --confirm
 *   node scripts/close-community-proposal.mjs --id=549cf16c --force=passed --confirm
 */
import { loadRootMcEnv, rootMcBotToken } from "./lib/rootmc-env.mjs";
import { postDiscordMessage, ROOTMC_CHANNELS } from "./lib/rootmc-discord.mjs";

const API = "https://discord.com/api/v10";
const VOTE_PREFIX = "rootmc_prop:vote:";
const D1_DATABASE_ID = "6cf71128-67e3-47b2-a802-d6c23d6489e0";
const EMBED_BLUE = 0x2d6a4f;
const EMBED_GOLD = 0xc9a227;
const EMBED_RED = 0x8b2635;
const QUORUM = 5;

const confirm = process.argv.includes("--confirm");
const proposalId = process.argv.find((a) => a.startsWith("--id="))?.slice(5)?.trim();
const forceArg = process.argv.find((a) => a.startsWith("--force"));
const forceStatus = forceArg
  ? (forceArg.includes("=") ? forceArg.slice(forceArg.indexOf("=") + 1) : process.argv[process.argv.indexOf(forceArg) + 1] || "")
      .trim()
      .toLowerCase()
  : "";

if (!proposalId) {
  console.error("Usage: node scripts/close-community-proposal.mjs --id=<proposalId> [--force=passed|failed|cancelled] --confirm");
  process.exit(1);
}

function esc(s) {
  return String(s).replace(/'/g, "''");
}

function formatWeight(n) {
  return `${Math.round(Math.max(0, n) * 100) / 100}%`;
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
      "User-Agent": "RootMC/close-community-proposal",
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`PATCH ${route} → ${res.status}: ${text.slice(0, 600)}`);
  return text ? JSON.parse(text) : {};
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

function buildEmbed(row, tallies, status, summary) {
  const isGrant = String(row.kind || "") === "grant";
  const lines = [
    row.bill_summary ? `_Bill summary:_ ${row.bill_summary}` : "",
    row.bill_url ? `_Full bill:_ ${row.bill_url}` : "",
    String(row.description || "").slice(0, 1600),
    "",
    `**Weighted For:** ${formatWeight(tallies.weightedForPct)} · **Against:** ${formatWeight(tallies.weightedAgainstPct)} · **Abstain:** ${formatWeight(tallies.weightedAbstainPct)}`,
    `**Head count:** ${tallies.votesFor} for · ${tallies.votesAgainst} against · ${tallies.votesAbstain} abstain`,
    isGrant
      ? `_Treasury grant poll_`
      : `**Linked voters:** ${tallies.total} (quorum for pass: ${QUORUM})`,
    `_Status: **${status}**_`,
    "",
    summary,
  ].filter(Boolean);
  return {
    title: `Closed — ${row.title}`,
    description: lines.join("\n").slice(0, 4096),
    color: status === "passed" ? EMBED_GOLD : status === "cancelled" ? EMBED_BLUE : EMBED_RED,
    footer: { text: `Proposal ${proposalId} · Council of Voters · weighted shares` },
  };
}

const rowRes = await d1Query(
  `SELECT * FROM rootmc_community_proposals WHERE id = '${esc(proposalId)}' LIMIT 1`,
);
const row = rowRes.result?.[0]?.results?.[0];
if (!row) {
  console.error("Proposal not found:", proposalId);
  process.exit(1);
}

const voteRes = await d1Query(
  `SELECT vote, COUNT(*) AS c, COALESCE(SUM(vote_weight), 0) AS weighted
   FROM rootmc_community_proposal_votes WHERE proposal_id = '${esc(proposalId)}' GROUP BY vote`,
);
const tallies = parseTallies(voteRes.result?.[0]?.results);
const isGrant = String(row.kind || "") === "grant";

let status = forceStatus;
if (!status) {
  if (String(row.status) === "open") {
    if (isGrant) {
      status = tallies.weightedForPct > tallies.weightedAgainstPct ? "passed" : "failed";
    } else if (tallies.total < QUORUM) {
      status = "failed";
    } else if (tallies.weightedForPct > tallies.weightedAgainstPct) {
      status = "passed";
    } else {
      status = "failed";
    }
  } else {
    console.error("Proposal already closed:", row.status, "— use --force=passed|failed|cancelled");
    process.exit(1);
  }
}

if (!["passed", "failed", "cancelled"].includes(status)) {
  console.error("Invalid --force value:", status);
  process.exit(1);
}

const summary =
  status === "passed"
    ? isGrant
      ? `**Result: PASSED** — treasury grant approved (weighted ${formatWeight(tallies.weightedForPct)} for · ${formatWeight(tallies.weightedAgainstPct)} against · ${tallies.total} voters)`
      : `**Result: PASSED** (weighted ${formatWeight(tallies.weightedForPct)} for · ${formatWeight(tallies.weightedAgainstPct)} against · ${tallies.total} voters)`
    : status === "cancelled"
      ? "**Result: CANCELLED** by staff."
      : isGrant
        ? `**Result: VETOED** (weighted ${formatWeight(tallies.weightedForPct)} for · ${formatWeight(tallies.weightedAgainstPct)} against)`
        : `**Result: FAILED** (weighted ${formatWeight(tallies.weightedForPct)} for · ${formatWeight(tallies.weightedAgainstPct)} against — need ${QUORUM}+ voters & weighted majority)`;

console.log("Proposal:", proposalId, row.title);
console.log("Current status:", row.status);
console.log("New status:", status);
console.log("Tallies:", tallies);
console.log("Summary:", summary);

if (!confirm) {
  console.log("Dry run — pass --confirm to UPDATE D1 and PATCH Discord.");
  process.exit(0);
}

const closedAt = new Date().toISOString();
await d1Query(
  `UPDATE rootmc_community_proposals
   SET status = '${esc(status)}',
       closed_at = '${esc(closedAt)}',
       result_summary = '${esc(summary)}'
   WHERE id = '${esc(proposalId)}'`,
);

const env = loadRootMcEnv();
const token = rootMcBotToken(env);
const embed = buildEmbed(row, tallies, status, summary);

if (row.channel_id && row.message_id) {
  await discordPatch(
    token,
    `/channels/${encodeURIComponent(row.channel_id)}/messages/${encodeURIComponent(row.message_id)}`,
    { embeds: [embed], components: voteButtons(proposalId, true) },
  );
  console.log("Patched Discord poll message.");
}

const governanceId = ROOTMC_CHANNELS.governance;
if (governanceId) {
  await postDiscordMessage({
    channelId: governanceId,
    content: `**Community vote closed — ${row.title}**\n${summary}\n_Proposal \`${proposalId}\`_`,
    token,
    userAgent: "RootMC/close-community-proposal",
  });
  console.log("Posted governance announcement.");
}

console.log(`Done: https://rootmc.net/governance/vote/?id=${proposalId}`);
