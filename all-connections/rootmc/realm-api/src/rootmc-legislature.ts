/**
 * Weekly legislature  -  citizen proposals â†' compiled bill â†' amendments â†' Council vote.
 * Policy: https://rootmc.net/wiki/constitution/#governance-voting
 */

import type { D1Database } from "@cloudflare/workers-types";

import { discordBotFetch, createForumPostThread, sendChannelMessage, type DiscordEmbed } from "./discord-rootmc-api";
import { resolveLinkedPlayerByDiscord } from "./discord-rootmc-economy";
import { closeCommunityProposal, createCommunityProposal } from "./rootmc-community-proposals";
import { allocateGovernanceCode, forumThreadName } from "./rootmc-governance-ids";
import {
  effectiveBillDescription,
  effectiveItemDescription,
  synthesizePendingItemsForWeek,
  synthesizeWeeklyBill,
} from "./rootmc-proposal-synthesis";
import {
  currentHstWeekKey,
  isWeeklyReportCronSlot,
  nextHstWeekKey,
  previousCompletedHstWeekKey,
} from "./rootmc-hst-week";
import { governancePowerForUuid, isGovernanceEligible } from "./rootmc-governance-voting";
import { termsAcceptedForDiscord } from "./rootmc-governance-terms";
import { resolveServerId } from "./rootmc-daily-report";
import type { RootMcHyperdriveEnv } from "./rootmc-hyperdrive";
import { ROOTMC_SYSTEM_REPORT_USER_ID } from "./rootmc-system-report";

export type LegislatureEnv = {
  DB: D1Database;
  DISCORD_ROOTMC_BOT_TOKEN?: string;
  DISCORD_ROOTMC_GUILD_ID?: string;
  DISCORD_ROOTMC_PROPOSALS_CHANNEL_ID?: string;
  DISCORD_ROOTMC_GOVERNANCE_CHANNEL_ID?: string;
  DISCORD_ROOTMC_VOTING_CHANNEL_ID?: string;
  GROK_API_BEARER_TOKEN?: string;
  GROK_API_URL?: string;
  GROK_MODEL?: string;
} & RootMcHyperdriveEnv;

export type LegislationCategory = "constitution" | "governance" | "plugin" | "metric";

const AMENDMENT_HOURS = 48;
const VOTE_DAYS = 7;
/** Proposals must be published at least this long before Sunday compile (e.g. Saturday posts roll to next week). */
const MIN_PUBLICATION_DAYS = 3;
const MIN_PUBLICATION_MS = MIN_PUBLICATION_DAYS * 24 * 60 * 60 * 1000;
const EMBED_GREEN = 0x2d6a4f;
const EMBED_GOLD = 0xc9a227;

const SITE_BASE = "https://rootmc.net";

function proposalUrl(id: string): string {
  return `${SITE_BASE}/governance/proposal/?id=${encodeURIComponent(id)}`;
}

function billUrl(id: string): string {
  return `${SITE_BASE}/governance/bill/?id=${encodeURIComponent(id)}`;
}

async function findCitizenPollId(db: D1Database, itemId: string): Promise<string | null> {
  const url = proposalUrl(itemId);
  const row = await db
    .prepare(`SELECT id FROM rootmc_community_proposals WHERE bill_url = ? LIMIT 1`)
    .bind(url)
    .first<{ id: string }>();
  return row?.id ? str(row.id) : null;
}

export async function openCitizenProposalPoll(
  env: LegislatureEnv,
  params: {
    itemId: string;
    title: string;
    description: string;
    discordUserId: string;
    category: LegislationCategory;
  },
): Promise<string | null> {
  const existing = await findCitizenPollId(env.DB, params.itemId);
  if (existing) return existing;

  const poll = await createCommunityProposal(env, {
    id: params.itemId,
    title: params.title,
    description: params.description,
    days: 7,
    createdByDiscordId: params.discordUserId,
    kind: "legislation",
    pollChannel: "voting",
    billUrl: proposalUrl(params.itemId),
    billSummary: `Citizen proposal  -  ${CATEGORY_LABEL[params.category]}`,
  });
  return poll.proposalId || null;
}

export async function ensureCitizenProposalPoll(
  env: LegislatureEnv,
  row: Record<string, unknown>,
): Promise<string | null> {
  const id = str(row.id);
  if (!id) return null;
  const existing = await findCitizenPollId(env.DB, id);
  if (existing) return existing;
  const status = str(row.status);
  if (status !== "pending" && status !== "included") return null;
  const cat = parseCategory(str(row.category));
  if (!cat) return null;
  return openCitizenProposalPoll(env, {
    itemId: id,
    title: str(row.title),
    description: str(row.synthesized_description) || str(row.description),
    discordUserId: str(row.created_by_discord_id),
    category: cat,
  });
}
const CATEGORY_LABEL: Record<LegislationCategory, string> = {
  constitution: "Constitution",
  governance: "Governance body",
  plugin: "Plugin / server rules",
  metric: "Server metric / policy",
};

function str(v: unknown): string {
  return String(v ?? "").trim();
}

function nowIso(): string {
  return new Date().toISOString();
}

export function isEligibleForWeeklyCompile(createdAtIso: string, compileAt = new Date()): boolean {
  const created = Date.parse(str(createdAtIso));
  if (!Number.isFinite(created)) return false;
  return compileAt.getTime() - created >= MIN_PUBLICATION_MS;
}

function compileEligibilityCutoffIso(compileAt = new Date()): string {
  return new Date(compileAt.getTime() - MIN_PUBLICATION_MS).toISOString();
}

async function rollDeferredProposals(
  db: D1Database,
  items: Array<Record<string, unknown>>,
  fromWeekKey: string,
  compileAt: Date,
): Promise<number> {
  const nextWeek = nextHstWeekKey(fromWeekKey);
  let rolled = 0;
  for (const item of items) {
    if (isEligibleForWeeklyCompile(str(item.created_at), compileAt)) continue;
    const id = str(item.id);
    if (!id) continue;
    await db
      .prepare(
        `UPDATE rootmc_legislation_items SET week_key = ? WHERE id = ? AND status = 'pending'`,
      )
      .bind(nextWeek, id)
      .run();
    rolled++;
  }
  return rolled;
}

function shortId(): string {
  return crypto.randomUUID().slice(0, 8);
}

function parseCategory(raw: string): LegislationCategory | null {
  const c = str(raw).toLowerCase();
  if (c === "constitution" || c === "governance" || c === "plugin" || c === "metric") return c;
  return null;
}

async function requireEligibleProposer(
  env: LegislatureEnv,
  discordUserId: string,
  opts?: { requireVoteShards?: boolean },
) {
  const db = env.DB;
  const linked = await resolveLinkedPlayerByDiscord(db, discordUserId);
  if (!linked?.minecraftUuid) {
    return { ok: false as const, message: "Link Minecraft at https://rootmc.net/verify before submitting." };
  }
  const serverId = await resolveServerId(db);
  const power = await governancePowerForUuid(db, serverId, linked.minecraftUuid, undefined, env);
  const requireShards = opts?.requireVoteShards !== false;
  if (requireShards && !isGovernanceEligible(power)) {
    return {
      ok: false as const,
      message:
        "Need Vote Shards in **/ec** and governance power. Run **`/vote`** to check eligibility.",
    };
  }
  const termsOk = await termsAcceptedForDiscord(db, discordUserId);
  if (!termsOk) {
    return {
      ok: false as const,
      message: "Accept Terms of Service at https://rootmc.net/terms/ before submitting or amending.",
    };
  }
  return {
    ok: true as const,
    uuid: linked.minecraftUuid,
    username: str(linked.minecraftUsername) || "player",
    weight: power?.share_percent ?? 0,
  };
}

function itemEmbed(row: {
  id: string;
  title: string;
  description: string;
  category: string;
  minecraft_username: string | null;
  submit_weight: number;
  week_key: string;
  status: string;
}): DiscordEmbed {
  const cat = CATEGORY_LABEL[row.category as LegislationCategory] || row.category;
  return {
    title: `Proposal ${row.id}  -  ${row.title}`,
    description: [
      `_Category:_ **${cat}**  -  _Week:_ \`${row.week_key}\``,
      `_Author:_ **${str(row.minecraft_username) || "linked player"}** (${Number(row.submit_weight).toFixed(3)}% power)`,
      "",
      row.description.slice(0, 1800),
      "",
      row.status === "pending"
        ? "_Pending weekly compilation  -  `/proposal retract id:" + row.id + "` by author_"
        : `_Status: **${row.status}**_`,
    ]
      .filter(Boolean)
      .join("\n")
      .slice(0, 4096),
    color: EMBED_GREEN,
    footer: { text: `Legislation item ${row.id}  -  Council pipeline` },
  };
}

export async function submitLegislationItem(
  env: LegislatureEnv,
  params: {
    discordUserId: string;
    title: string;
    description: string;
    category: string;
    /** Ava formalize from in-game queue — linked + terms only (no Vote Shard gate). */
    requireVoteShards?: boolean;
  },
): Promise<{ ok: boolean; detail: string; itemId?: string }> {
  const token = str(env.DISCORD_ROOTMC_BOT_TOKEN);
  const channelId = str(env.DISCORD_ROOTMC_PROPOSALS_CHANNEL_ID);

  const cat = parseCategory(params.category);
  if (!cat) {
    return {
      ok: false,
      detail: "Category must be **constitution**, **governance**, **plugin**, or **metric**.",
    };
  }

  const proposer = await requireEligibleProposer(env, params.discordUserId, {
    requireVoteShards: params.requireVoteShards,
  });
  if (!proposer.ok) return { ok: false, detail: proposer.message };

  const title = params.title.slice(0, 200);
  const description = params.description.slice(0, 4000);
  if (!title || !description) {
    return { ok: false, detail: "Provide **title** and **description**." };
  }

  const id = await allocateGovernanceCode(env.DB, "PROP");
  const weekKey = currentHstWeekKey();
  const createdAt = nowIso();
  const url = proposalUrl(id);
  const catLabel = CATEGORY_LABEL[cat];

  await env.DB.prepare(
    `INSERT INTO rootmc_legislation_items
       (id, week_key, title, description, category, status, created_by_discord_id,
        minecraft_uuid, minecraft_username, submit_weight, channel_id, message_id, created_at)
     VALUES (?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      id,
      weekKey,
      title,
      description,
      cat,
      params.discordUserId,
      proposer.uuid,
      proposer.username,
      proposer.weight,
      channelId || null,
      null,
      createdAt,
    )
    .run();

  let threadId = "";
  if (token && channelId) {
    const thread = await createForumPostThread(token, channelId, forumThreadName(id, title), {
      content: [
        `**New citizen proposal**  -  ${catLabel}  -  **${id}**`,
        `**${title}**`,
        `By **${proposer.username}**  -  ${proposer.weight.toFixed(3)}% governance power`,
        "",
        `Read & discuss on the site: ${url}`,
        "",
        "**Discuss your case in this forum post**  -  replies are summarized into the weekly bill text before the Council vote.",
        `_Must be published **>=${MIN_PUBLICATION_DAYS} days** before Sunday compile to join that week's bill (late-week posts roll forward)._`,
        "_Site has full text  -  Discord is for discussion  -  vote in #voting or on rootmc.net (linked accounts + terms)_",
        "",
        `<${url}>`,
      ].join("\n"),
    });
    threadId = str(thread?.id);
    if (threadId) {
      await env.DB.prepare(`UPDATE rootmc_legislation_items SET discord_thread_id = ? WHERE id = ?`)
        .bind(threadId, id)
        .run();
    }
  }

  await openCitizenProposalPoll(env, {
    itemId: id,
    title,
    description,
    discordUserId: params.discordUserId,
    category: cat,
  }).catch((e) => console.warn("rootmc_citizen_poll", id, e));

  return {
    ok: true,
    detail: threadId
      ? `Proposal **${id}** published at ${url}  -  discuss in <#${threadId}>`
      : `Proposal **${id}** published at ${url}`,
    itemId: id,
  };
}

export async function retractLegislationItem(
  env: LegislatureEnv,
  itemId: string,
  discordUserId: string,
): Promise<{ ok: boolean; detail: string }> {
  const row = await env.DB.prepare(
    `SELECT id, status, created_by_discord_id, channel_id, message_id, title
     FROM rootmc_legislation_items WHERE id = ? LIMIT 1`,
  )
    .bind(itemId)
    .first<Record<string, unknown>>();

  if (!row) return { ok: false, detail: "Unknown proposal id." };
  if (str(row.status) !== "pending") {
    return { ok: false, detail: "Only **pending** items can be retracted." };
  }
  if (str(row.created_by_discord_id) !== discordUserId) {
    return { ok: false, detail: "Only the author can retract this proposal." };
  }

  await env.DB.prepare(
    `UPDATE rootmc_legislation_items SET status = 'retracted', retracted_at = ? WHERE id = ?`,
  )
    .bind(nowIso(), itemId)
    .run();

  const pollId = await findCitizenPollId(env.DB, itemId);
  if (pollId) {
    await closeCommunityProposal(env, pollId, "cancelled").catch((e) =>
      console.warn("rootmc_retract_poll", itemId, e),
    );
  }

  const token = str(env.DISCORD_ROOTMC_BOT_TOKEN);
  const channelId = str(row.channel_id);
  const messageId = str(row.message_id);
  if (token && channelId && messageId) {
    await discordBotFetch(
      token,
      `/channels/${encodeURIComponent(channelId)}/messages/${encodeURIComponent(messageId)}`,
      {
        method: "PATCH",
        body: JSON.stringify({
          content: `_Retracted by author  -  was: **${str(row.title)}**_`,
          embeds: [],
        }),
      },
    );
  }

  return { ok: true, detail: `Proposal **${itemId}** retracted.` };
}

export async function submitBillAmendment(
  env: LegislatureEnv,
  params: { billId: string; discordUserId: string; text: string; itemId?: string },
): Promise<{ ok: boolean; detail: string }> {
  const proposer = await requireEligibleProposer(env, params.discordUserId);
  if (!proposer.ok) return { ok: false, detail: proposer.message };

  const bill = await env.DB.prepare(
    `SELECT id, status, amendment_period_ends_at, week_key, title
     FROM rootmc_weekly_bills WHERE id = ? LIMIT 1`,
  )
    .bind(params.billId)
    .first<Record<string, unknown>>();

  if (!bill) return { ok: false, detail: "Unknown bill id." };
  if (str(bill.status) !== "amendments") {
    return { ok: false, detail: "This bill is not in the **amendment** period." };
  }
  if (Date.parse(str(bill.amendment_period_ends_at)) < Date.now()) {
    return { ok: false, detail: "Amendment period ended." };
  }

  const text = params.text.slice(0, 2000);
  if (!text) return { ok: false, detail: "Provide amendment **text**." };

  const amendId = shortId();
  await env.DB.prepare(
    `INSERT INTO rootmc_bill_amendments
       (id, bill_id, item_id, amendment_text, created_by_discord_id, minecraft_username, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      amendId,
      params.billId,
      params.itemId || null,
      text,
      params.discordUserId,
      proposer.username,
      nowIso(),
    )
    .run();

  const token = str(env.DISCORD_ROOTMC_BOT_TOKEN);
  const threadId = str(bill.discord_thread_id);
  const url = billUrl(params.billId);
  if (token && threadId) {
    await sendChannelMessage(token, threadId, {
      content: [
        `ðŸ" **Amendment** \`${amendId}\` from **${proposer.username}**`,
        params.itemId ? `_Re: proposal ${params.itemId}_` : "",
        "",
        text.slice(0, 1800),
        "",
        `_Full bill & all amendments: ${url}_`,
      ]
        .filter(Boolean)
        .join("\n"),
    });
  }

  return {
    ok: true,
    detail: `Amendment **${amendId}** recorded for bill **${params.billId}**. View at ${url}`,
  };
}

async function buildBillDescription(
  db: D1Database,
  weekKey: string,
  items: Array<Record<string, unknown>>,
  amendments: Array<Record<string, unknown>>,
): Promise<string> {
  const lines = [
    `**Weekly bill  -  HST week starting ${weekKey}**`,
    "",
    "The following citizen proposals are bundled for Council vote:",
    "",
  ];
  for (const item of items) {
    const cat = CATEGORY_LABEL[str(item.category) as LegislationCategory] || str(item.category);
    lines.push(
      `### ${str(item.id)}  -  ${str(item.title)}`,
      `_Category:_ ${cat}  -  _Author:_ ${str(item.minecraft_username)} (${Number(item.submit_weight).toFixed(3)}%)`,
      effectiveItemDescription(item).slice(0, 600),
      "",
    );
  }
  if (amendments.length) {
    lines.push("---", "**Amendments submitted:**", "");
    for (const a of amendments) {
      lines.push(
        `- \`${str(a.id)}\` **${str(a.minecraft_username)}**${a.item_id ? ` (re: ${str(a.item_id)})` : ""}: ${str(a.amendment_text).slice(0, 400)}`,
      );
    }
    lines.push("");
  }
  lines.push(
    "_If passed, staff implements constitution, governance, plugin, and metric changes per each item._",
  );
  return lines.join("\n").slice(0, 3900);
}

export async function compileWeeklyBill(
  env: LegislatureEnv,
  weekKey: string,
  force = false,
  compileAt = new Date(),
): Promise<{ ok: boolean; detail: string; billId?: string }> {
  const existing = await env.DB.prepare(
    `SELECT id FROM rootmc_weekly_bills WHERE week_key = ? LIMIT 1`,
  )
    .bind(weekKey)
    .first<{ id: string }>();
  if (existing?.id && !force) {
    return { ok: false, detail: `Bill for week \`${weekKey}\` already exists (**${existing.id}**).` };
  }

  const cutoffIso = compileEligibilityCutoffIso(compileAt);

  const { results: items } = await env.DB.prepare(
    `SELECT * FROM rootmc_legislation_items
     WHERE week_key = ? AND status = 'pending'
     ORDER BY submit_weight DESC, created_at ASC`,
  )
    .bind(weekKey)
    .all<Record<string, unknown>>();

  const pending = items || [];
  if (!pending.length) {
    return { ok: false, detail: `No pending proposals for week \`${weekKey}\`.` };
  }

  const rolled = await rollDeferredProposals(env.DB, pending, weekKey, compileAt);
  const eligible = pending.filter((item) => isEligibleForWeeklyCompile(str(item.created_at), compileAt));
  if (!eligible.length) {
    const nextWeek = nextHstWeekKey(weekKey);
    return {
      ok: false,
      detail:
        rolled > 0
          ? `No proposals met the **${MIN_PUBLICATION_DAYS}-day** publication minimum for week \`${weekKey}\`  -  ${rolled} deferred to \`${nextWeek}\`.`
          : `No proposals met the **${MIN_PUBLICATION_DAYS}-day** publication minimum for week \`${weekKey}\`.`,
    };
  }

  const eligibleIds = eligible.map((item) => str(item.id)).filter(Boolean);
  const synth = await synthesizePendingItemsForWeek(env, weekKey, eligibleIds).catch((e) => {
    console.warn("rootmc_proposal_synthesis_week", weekKey, e);
    return { synthesized: 0, skipped: eligible.length };
  });
  console.log("rootmc_proposal_synthesis_week", weekKey, synth);

  const idPlaceholders = eligibleIds.map(() => "?").join(",");
  const { results: refreshed } = await env.DB.prepare(
    `SELECT * FROM rootmc_legislation_items
     WHERE week_key = ? AND status = 'pending' AND id IN (${idPlaceholders})
       AND created_at <= ?
     ORDER BY submit_weight DESC, created_at ASC`,
  )
    .bind(weekKey, ...eligibleIds, cutoffIso)
    .all<Record<string, unknown>>();
  const pendingItems = refreshed || eligible;

  if (!pendingItems.length) {
    return { ok: false, detail: `No eligible proposals remained for week \`${weekKey}\`.` };
  }

  const billId = await allocateGovernanceCode(env.DB, "BILL");
  const createdAt = nowIso();
  const amendmentEnds = new Date(Date.now() + AMENDMENT_HOURS * 60 * 60 * 1000).toISOString();
  const title = `Weekly bill  -  week of ${weekKey}`;
  const description = await buildBillDescription(env.DB, weekKey, pendingItems, []);

  const token = str(env.DISCORD_ROOTMC_BOT_TOKEN);
  const channelId = str(env.DISCORD_ROOTMC_PROPOSALS_CHANNEL_ID);
  const url = billUrl(billId);

  await env.DB.prepare(
    `INSERT INTO rootmc_weekly_bills
       (id, week_key, status, title, description, item_count, amendment_period_ends_at,
        channel_id, message_id, created_at)
     VALUES (?, ?, 'amendments', ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      billId,
      weekKey,
      title,
      description,
      pendingItems.length,
      amendmentEnds,
      channelId || null,
      null,
      createdAt,
    )
    .run();

  if (token && channelId) {
    const rolledNote =
      rolled > 0
        ? `\n_${rolled} proposal(s) deferred (< ${MIN_PUBLICATION_DAYS} days published) -> next week._`
        : "";
    const thread = await createForumPostThread(
      token,
      channelId,
      forumThreadName(billId, `Week ${weekKey}`),
      {
        content: [
          `**Weekly bill compiled**  -  ${pendingItems.length} proposal(s)  -  **${billId}**`,
          `**48h amendment period**  -  vote opens in <#${str(env.DISCORD_ROOTMC_VOTING_CHANNEL_ID) || "voting"}> after amendments close`,
          rolledNote,
          "",
          `Read full bill, submit amendments, and track status: ${url}`,
          "",
          `<${url}>`,
        ]
          .filter(Boolean)
          .join("\n"),
      },
    );
    const threadId = str(thread?.id);
    if (threadId) {
      await env.DB.prepare(`UPDATE rootmc_weekly_bills SET discord_thread_id = ? WHERE id = ?`)
        .bind(threadId, billId)
        .run();
    }
  }

  for (const item of pendingItems) {
    await env.DB.prepare(
      `UPDATE rootmc_legislation_items SET status = 'included', bill_id = ? WHERE id = ?`,
    )
      .bind(billId, str(item.id))
      .run();
  }

  return {
    ok: true,
    detail:
      (rolled > 0
        ? `Compiled bill **${billId}** with ${pendingItems.length} item(s); ${rolled} deferred (< ${MIN_PUBLICATION_DAYS} days). `
        : `Compiled bill **${billId}** with ${pendingItems.length} item(s). `) +
      `View at ${url}  -  amendments until ${amendmentEnds.replace("T", " ").slice(0, 19)} UTC.`,
    billId,
  };
}

export async function openWeeklyBillVote(env: LegislatureEnv, billId: string): Promise<{ ok: boolean; detail: string }> {
  const bill = await env.DB.prepare(`SELECT * FROM rootmc_weekly_bills WHERE id = ? LIMIT 1`)
    .bind(billId)
    .first<Record<string, unknown>>();
  if (!bill) return { ok: false, detail: "Unknown bill id." };
  if (str(bill.status) !== "amendments") {
    return { ok: false, detail: "Bill is not awaiting vote opening." };
  }
  if (Date.parse(str(bill.amendment_period_ends_at)) > Date.now()) {
    return { ok: false, detail: "Amendment period still open." };
  }
  if (str(bill.proposal_id)) {
    return { ok: false, detail: "Vote already opened." };
  }

  const { results: amendments } = await env.DB.prepare(
    `SELECT * FROM rootmc_bill_amendments WHERE bill_id = ? ORDER BY created_at ASC`,
  )
    .bind(billId)
    .all<Record<string, unknown>>();

  const { results: items } = await env.DB.prepare(
    `SELECT * FROM rootmc_legislation_items WHERE bill_id = ? ORDER BY submit_weight DESC`,
  )
    .bind(billId)
    .all<Record<string, unknown>>();

  const weekKey = str(bill.week_key);
  await synthesizeWeeklyBill(env, billId).catch((e) => console.warn("rootmc_bill_synthesis", billId, e));

  const billAfter = await env.DB.prepare(`SELECT * FROM rootmc_weekly_bills WHERE id = ? LIMIT 1`)
    .bind(billId)
    .first<Record<string, unknown>>();

  const fullDescription = effectiveBillDescription(billAfter || bill) ||
    (await buildBillDescription(
      env.DB,
      weekKey,
      items || [],
      amendments || [],
    ));

  await env.DB.prepare(`UPDATE rootmc_weekly_bills SET description = ? WHERE id = ?`)
    .bind(fullDescription, billId)
    .run();

  const poll = await createCommunityProposal(env, {
    id: billId,
    title: `Weekly bill  -  ${weekKey}`,
    description: fullDescription,
    days: VOTE_DAYS,
    createdByDiscordId: ROOTMC_SYSTEM_REPORT_USER_ID,
    kind: "official",
    pollChannel: "voting",
    billSummary: `${items?.length || 0} citizen proposal(s) + ${amendments?.length || 0} amendment(s)`,
    billUrl: billUrl(billId),
  });

  if (!poll.ok || !poll.proposalId) {
    return { ok: false, detail: poll.detail || "Could not open Council vote." };
  }

  const voteCloses = new Date(Date.now() + VOTE_DAYS * 24 * 60 * 60 * 1000).toISOString();
  await env.DB.prepare(
    `UPDATE rootmc_weekly_bills
     SET status = 'voting', proposal_id = ?, vote_closes_at = ?, description = ?
     WHERE id = ?`,
  )
    .bind(poll.proposalId, voteCloses, fullDescription, billId)
    .run();

  return {
    ok: true,
    detail: `Council vote opened  -  proposal **${poll.proposalId}** in <#${str(env.DISCORD_ROOTMC_VOTING_CHANNEL_ID) || "voting"}>.`,
  };
}

export async function maybeRunLegislatureCron(env: LegislatureEnv, at = new Date()): Promise<void> {
  if (isWeeklyReportCronSlot(at)) {
    const weekKey = previousCompletedHstWeekKey(at);
    const compiled = await compileWeeklyBill(env, weekKey).catch((e) => ({
      ok: false,
      detail: String(e),
    }));
    if (compiled.ok) {
      console.log("rootmc_legislature_compiled", weekKey, compiled.detail);
    }
  }

  const { results: dueBills } = await env.DB.prepare(
    `SELECT id FROM rootmc_weekly_bills
     WHERE status = 'amendments' AND amendment_period_ends_at <= ? AND proposal_id IS NULL`,
  )
    .bind(nowIso())
    .all<{ id: string }>();

  for (const row of dueBills || []) {
    const opened = await openWeeklyBillVote(env, str(row.id));
    console.log("rootmc_legislature_vote_open", row.id, opened.detail);
  }
}

export async function listLegislationSummary(db: D1Database): Promise<string> {
  const weekKey = currentHstWeekKey();
  const { results: pending } = await db
    .prepare(
      `SELECT id, title, category, minecraft_username, submit_weight, discord_thread_id
       FROM rootmc_legislation_items
       WHERE week_key = ? AND status = 'pending'
       ORDER BY submit_weight DESC LIMIT 15`,
    )
    .bind(weekKey)
    .all<Record<string, unknown>>();

  const { results: bills } = await db
    .prepare(
      `SELECT id, week_key, status, item_count, amendment_period_ends_at, proposal_id
       FROM rootmc_weekly_bills
       WHERE status IN ('amendments', 'voting')
       ORDER BY created_at DESC LIMIT 5`,
    )
    .all<Record<string, unknown>>();

  const lines = [`**Legislature  -  week \`${weekKey}\`**`, ""];
  if (pending?.length) {
    lines.push("**Pending (this week):**");
    const compileAt = new Date();
    for (const p of pending) {
      const tid = str(p.discord_thread_id);
      const threadNote = tid ? `  -  discuss <#${tid}>` : "";
      const ageNote = isEligibleForWeeklyCompile(str(p.created_at), compileAt)
        ? ""
        : `  -  _needs ${MIN_PUBLICATION_DAYS}d published  -  rolls if still pending Sunday_`;
      lines.push(
        `- \`${str(p.id)}\` **${str(p.title)}** (${str(p.category)})  -  ${str(p.minecraft_username)}  -  ${Number(p.submit_weight).toFixed(3)}%${threadNote}${ageNote}`,
        `  https://rootmc.net/governance/proposal/?id=${str(p.id)}`,
      );
    }
  } else {
    lines.push("_No pending proposals  -  submit in-game with **`/proposal <idea>`** (64 G)_");
  }
  lines.push("");
  if (bills?.length) {
    lines.push("**Active bills:**");
    for (const b of bills) {
      const note =
        str(b.status) === "amendments"
          ? `amendments until ${str(b.amendment_period_ends_at).replace("T", " ").slice(0, 16)} UTC`
          : `vote \`${str(b.proposal_id)}\``;
      lines.push(`- \`${str(b.id)}\` week \`${str(b.week_key)}\`  -  ${str(b.item_count)} items  -  ${note}`);
      lines.push(`  https://rootmc.net/governance/bill/?id=${str(b.id)}`);
    }
  }
  lines.push(
    "",
    "Submit: in-game **`/proposal <idea>`** (64 G · Ava publishes)  -  Discuss: proposal thread (verified)  -  Vote: **`/vote`** + #voting",
  );
  return lines.join("\n").slice(0, 2000);
}

export async function legislationStatusText(db: D1Database, id: string): Promise<string> {
  const item = await db
    .prepare(`SELECT * FROM rootmc_legislation_items WHERE id = ? LIMIT 1`)
    .bind(id)
    .first<Record<string, unknown>>();
  if (item) {
    const tid = str(item.discord_thread_id);
    const body = effectiveItemDescription(item);
    return [
      `**Item \`${id}\`**  -  ${str(item.title)}`,
      `Status: **${str(item.status)}**  -  Category: ${str(item.category)}  -  Week: \`${str(item.week_key)}\``,
      `Author: ${str(item.minecraft_username)} (${Number(item.submit_weight).toFixed(3)}%)`,
      tid ? `Discuss: <#${tid}>` : "",
      `Site: https://rootmc.net/governance/proposal/?id=${id}`,
      str(item.bill_id) ? `Bill: \`${str(item.bill_id)}\`` : "",
      str(item.synthesis_at) ? `_Discussion summary ${str(item.synthesis_at).slice(0, 19)} UTC_` : "",
      "",
      body.slice(0, 1200),
    ]
      .filter(Boolean)
      .join("\n");
  }

  const bill = await db
    .prepare(`SELECT * FROM rootmc_weekly_bills WHERE id = ? LIMIT 1`)
    .bind(id)
    .first<Record<string, unknown>>();
  if (bill) {
    const amendRow = await db
      .prepare(`SELECT COUNT(*) AS c FROM rootmc_bill_amendments WHERE bill_id = ?`)
      .bind(id)
      .first<{ c: number }>();
    return [
      `**Bill \`${id}\`**  -  week \`${str(bill.week_key)}\``,
      `Status: **${str(bill.status)}**  -  ${Number(bill.item_count)} items  -  ${Number(amendRow?.c) || 0} amendments`,
      str(bill.proposal_id) ? `Council vote: \`${str(bill.proposal_id)}\`` : "",
      str(bill.amendment_period_ends_at)
        ? `Amendments until: ${str(bill.amendment_period_ends_at).replace("T", " ").slice(0, 19)} UTC`
        : "",
      "",
      str(bill.description).slice(0, 1200),
    ]
      .filter(Boolean)
      .join("\n");
  }

  return `No legislation item or bill with id \`${id}\`.`;
}
