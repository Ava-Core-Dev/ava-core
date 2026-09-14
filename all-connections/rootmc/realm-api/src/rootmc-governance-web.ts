/**
 * Public governance API  -  rootmc.net/governance/* pages.
 * Discord = link posts + threads; full text lives on the site.
 */

import type { D1Database } from "@cloudflare/workers-types";

import { json } from "./cors";
import { requireSignedInAccount } from "./realm-lib";
import type { AuthEnv } from "./primary-auth";
import { sessionFromRequest } from "./primary-auth";
import { castProposalVote, type VoteChoice } from "./rootmc-community-proposals";
import { submitGrantProposal, GRANT_MIN_AMOUNT, GRANT_MAX_AMOUNT } from "./rootmc-grant-proposals";
import {
  compileWeeklyBill,
  legislationStatusText,
  listLegislationSummary,
  retractLegislationItem,
  submitBillAmendment,
  ensureCitizenProposalPoll,
  type LegislatureEnv,
} from "./rootmc-legislature";
import {
  AVA_COUNCIL_DISCORD_ID,
  AVA_COUNCIL_UUID,
  LIFETIME_VOTE_MULTIPLIER,
  PRO_PLUS_LIFETIME_VOTE_MULTIPLIER,
  PRO_VOTE_MULTIPLIER,
  governancePowerForUuid,
  isGovernanceEligible,
  computeGovernancePowerSnapshot,
} from "./rootmc-governance-voting";
import {
  LISTING_SITES,
  LISTING_SITE_MAX_POINTS,
  VOTE_POINT_BASELINE,
} from "./rootmc-listing-sites";
import { resolveServerId } from "./rootmc-daily-report";
import { validateDevWorkstationAuth } from "./rootmc-dev-workstation";

import { GOVERNANCE_TERMS_VERSION, termsAcceptedForAccount } from "./rootmc-governance-terms";
import { startRootMcDiscordSignIn } from "./discord-rootmc-player-link";
import { handleProposalIdeaRoutes } from "./rootmc-ingame-proposal";
import { handleFeedbackInboxRoutes } from "./rootmc-ingame-feedback";
import type { RootMcAiEnv } from "./rootmc-world-ai";
import type { RootStatEnv } from "./rootstat-minecraft";

export type GovernanceWebEnv = LegislatureEnv &
  AuthEnv &
  RootMcAiEnv &
  Partial<RootStatEnv> & {
    SITE_URL?: string;
    ROOTMC_DEV_WORKSTATION_KEY?: string;
    SLACK_FEEDBACK_WEBHOOK_URL?: string;
    SLACK_FEEDBACK_CHANNEL_ID?: string;
  };

function str(v: unknown): string {
  return String(v ?? "").trim();
}

function siteBase(env: GovernanceWebEnv): string {
  return str(env.SITE_URL) || "https://rootmc.net";
}

export function proposalPublicUrl(env: GovernanceWebEnv, id: string): string {
  return `${siteBase(env)}/governance/proposal/?id=${encodeURIComponent(id)}`;
}

export function billPublicUrl(env: GovernanceWebEnv, id: string): string {
  return `${siteBase(env)}/governance/bill/?id=${encodeURIComponent(id)}`;
}

export function termsPublicUrl(env: GovernanceWebEnv): string {
  return `${siteBase(env)}/terms/`;
}

async function voteTallies(db: D1Database, proposalId: string) {
  const { results } = await db
    .prepare(
      `SELECT vote, COUNT(*) AS c, COALESCE(SUM(vote_weight), 0) AS weighted
       FROM rootmc_community_proposal_votes WHERE proposal_id = ? GROUP BY vote`,
    )
    .bind(proposalId)
    .all<{ vote: string; c: number; weighted: number }>();
  let votes_for = 0;
  let votes_against = 0;
  let votes_abstain = 0;
  let weighted_for = 0;
  let weighted_against = 0;
  let weighted_abstain = 0;
  for (const row of results || []) {
    const c = Number(row.c) || 0;
    const w = Number(row.weighted) || 0;
    if (row.vote === "for") {
      votes_for = c;
      weighted_for = w;
    } else if (row.vote === "against") {
      votes_against = c;
      weighted_against = w;
    } else if (row.vote === "abstain") {
      votes_abstain = c;
      weighted_abstain = w;
    }
  }
  const total_weight = weighted_for + weighted_against + weighted_abstain;
  const pct = (part: number) => (total_weight > 0 ? Math.round((part / total_weight) * 1000) / 10 : 0);
  return {
    votes_for,
    votes_against,
    votes_abstain,
    voter_count: votes_for + votes_against + votes_abstain,
    weighted_for_pct: pct(weighted_for),
    weighted_against_pct: pct(weighted_against),
    weighted_abstain_pct: pct(weighted_abstain),
  };
}

function weightedMajorityLabel(tallies: {
  weighted_for_pct: number;
  weighted_against_pct: number;
  weighted_abstain_pct: number;
  voter_count: number;
}): { direction: "for" | "against" | "abstain" | null; pct: number; settled: boolean } {
  if (tallies.voter_count <= 0) {
    return { direction: null, pct: 0, settled: false };
  }
  const entries: Array<{ direction: "for" | "against" | "abstain"; pct: number }> = [
    { direction: "for", pct: tallies.weighted_for_pct },
    { direction: "against", pct: tallies.weighted_against_pct },
    { direction: "abstain", pct: tallies.weighted_abstain_pct },
  ];
  entries.sort((a, b) => b.pct - a.pct);
  const top = entries[0];
  if (!top || top.pct <= 50) {
    return { direction: null, pct: top?.pct ?? 0, settled: false };
  }
  return { direction: top.direction, pct: top.pct, settled: true };
}

async function openCouncilPolls(env: GovernanceWebEnv) {
  const { results } = await env.DB.prepare(
    `SELECT id, title, description, status, closes_at, bill_summary, bill_url, kind, created_at,
            grant_amount, grant_recipient_username, majority_direction, majority_since,
            channel_id, message_id
     FROM rootmc_community_proposals
     WHERE status = 'open' AND closes_at > datetime('now')
     ORDER BY created_at DESC LIMIT 20`,
  ).all<Record<string, unknown>>();
  const polls = [];
  for (const row of results || []) {
    const id = str(row.id);
    const tallies = await voteTallies(env.DB, id);
    const majority = weightedMajorityLabel(tallies);
    const kind = str(row.kind) || "general";
    const majorityDirection = str(row.majority_direction) || null;
    const majoritySince = str(row.majority_since) || null;
    polls.push({
      id,
      title: str(row.title),
      description: str(row.description).slice(0, 500),
      status: str(row.status),
      closes_at: str(row.closes_at),
      bill_summary: str(row.bill_summary) || null,
      bill_url: str(row.bill_url) || null,
      kind,
      grant_amount: Number(row.grant_amount) || null,
      grant_recipient_username: str(row.grant_recipient_username) || null,
      majority_direction: majorityDirection,
      majority_since: majoritySince,
      channel_id: str(row.channel_id) || null,
      message_id: str(row.message_id) || null,
      sustained_majority:
        kind === "grant" && majorityDirection && majoritySince
          ? { direction: majorityDirection, since: majoritySince }
          : null,
      leading_majority: majority,
      url: `${siteBase(env)}/governance/vote/?id=${encodeURIComponent(id)}`,
      ...tallies,
    });
  }
  return polls;
}

async function accountGovernanceContext(env: GovernanceWebEnv, accountId: string) {
  const db = env.DB;
  const link = await db
    .prepare(
      `SELECT l.minecraft_uuid, l.minecraft_username, d.discord_user_id
       FROM rootstat_minecraft_links l
       LEFT JOIN discord_account_links d ON d.account_id = l.account_id
       WHERE l.account_id = ? LIMIT 1`,
    )
    .bind(accountId)
    .first<{ minecraft_uuid: string; minecraft_username: string | null; discord_user_id: string | null }>();

  const uuid = str(link?.minecraft_uuid).toLowerCase();
  const discordUserId = str(link?.discord_user_id);
  if (!uuid || !discordUserId) {
    return { ok: false as const, detail: "not_linked", message: "Sign in with Discord after linking in-game (/rootmc link -> verify with Discord)." };
  }

  const serverId = await resolveServerId(db);
  const power = await governancePowerForUuid(db, serverId, uuid, undefined, env);
  const eligible = isGovernanceEligible(power);
  const termsAccepted = await termsAcceptedForAccount(db, accountId);

  return {
    ok: true as const,
    accountId,
    minecraftUuid: uuid,
    minecraftUsername: str(link?.minecraft_username) || "player",
    discordUserId,
    eligible,
    sharePercent: power?.share_percent ?? 0,
    termsAccepted,
    termsVersion: GOVERNANCE_TERMS_VERSION,
  };
}

function publicItemRow(row: Record<string, unknown>, env: GovernanceWebEnv) {
  const id = str(row.id);
  return {
    id,
    week_key: str(row.week_key),
    title: str(row.title),
    description: str(row.description),
    synthesized_description: str(row.synthesized_description) || null,
    synthesis_at: str(row.synthesis_at) || null,
    category: str(row.category),
    status: str(row.status),
    minecraft_username: str(row.minecraft_username) || null,
    submit_weight: Number(row.submit_weight) || 0,
    bill_id: str(row.bill_id) || null,
    created_at: str(row.created_at),
    url: proposalPublicUrl(env, id),
    discord_thread_id: str(row.discord_thread_id) || null,
  };
}

function publicBillRow(row: Record<string, unknown>, env: GovernanceWebEnv) {
  const id = str(row.id);
  return {
    id,
    week_key: str(row.week_key),
    status: str(row.status),
    title: str(row.title),
    description: str(row.description),
    item_count: Number(row.item_count) || 0,
    amendment_period_ends_at: str(row.amendment_period_ends_at) || null,
    vote_closes_at: str(row.vote_closes_at) || null,
    proposal_id: str(row.proposal_id) || null,
    created_at: str(row.created_at),
    url: billPublicUrl(env, id),
    discord_thread_id: str(row.discord_thread_id) || null,
  };
}

export async function handleGovernanceWebRoutes(
  request: Request,
  env: GovernanceWebEnv,
  sub: string,
  method: string,
): Promise<Response | null> {
  const rest = sub.replace(/^governance\/?/, "").replace(/^\//, "");

  const ideaRes = await handleProposalIdeaRoutes(request, env as never, rest, method);
  if (ideaRes) return ideaRes;

  const feedbackRes = await handleFeedbackInboxRoutes(request, env as never, rest, method);
  if (feedbackRes) return feedbackRes;
  if (method === "GET" && (rest === "terms" || rest === "terms/")) {
    return json({
      ok: true,
      version: GOVERNANCE_TERMS_VERSION,
      url: termsPublicUrl(env),
      summary:
        "By participating in RootMC governance (submitting proposals, amending weekly bills, or casting weighted votes), you agree to the RootMC Terms of Service and Constitution.",
    });
  }

  if (method === "POST" && (rest === "auth/discord/start" || rest === "auth/discord/start/")) {
    let body: { return_to?: string; mobile_app?: boolean } = {};
    try {
      body = JSON.parse(await request.text()) as { return_to?: string; mobile_app?: boolean };
    } catch {
      return json({ detail: "Invalid JSON body." }, 400);
    }
    return startRootMcDiscordSignIn(env, str(body.return_to) || "/governance/", body.mobile_app === true);
  }

  if (method === "GET" && rest === "me") {
    const auth = await sessionFromRequest(env, request);
    if (!auth?.accountId) {
      return json({
        ok: true,
        signed_in: false,
        linked: false,
        terms_url: termsPublicUrl(env),
        verify_url: `${siteBase(env)}/verify/`,
      });
    }
    const ctx = await accountGovernanceContext(env, auth.accountId);
    if (!ctx.ok) {
      return json({
        ok: true,
        signed_in: true,
        linked: false,
        detail: ctx.detail,
        message: ctx.message,
        verify_url: `${siteBase(env)}/verify/`,
        terms_url: termsPublicUrl(env),
      });
    }
    return json({
      ok: true,
      signed_in: true,
      linked: true,
      minecraft_username: ctx.minecraftUsername,
      eligible: ctx.eligible,
      share_percent: ctx.sharePercent,
      terms_accepted: ctx.termsAccepted,
      terms_version: ctx.termsVersion,
      terms_url: termsPublicUrl(env),
      submit_url: `${siteBase(env)}/governance/submit/`,
    });
  }

  if (method === "GET" && rest === "proposals") {
    const url = new URL(request.url);
    const week = str(url.searchParams.get("week"));
    const status = str(url.searchParams.get("status")) || "pending,included,retracted";
    const statuses = status.split(",").map((s) => s.trim()).filter(Boolean);
    const placeholders = statuses.map(() => "?").join(",");
    let sql = `SELECT * FROM rootmc_legislation_items WHERE status IN (${placeholders})`;
    const binds: unknown[] = [...statuses];
    if (week) {
      sql += ` AND week_key = ?`;
      binds.push(week);
    }
    sql += ` ORDER BY created_at DESC LIMIT 100`;
    const { results } = await env.DB.prepare(sql).bind(...binds).all<Record<string, unknown>>();
    return json({
      ok: true,
      proposals: (results || []).map((r) => publicItemRow(r, env)),
    });
  }

  if (method === "GET" && rest.startsWith("proposals/")) {
    const id = rest.slice("proposals/".length).split("/")[0];
    const row = await env.DB.prepare(`SELECT * FROM rootmc_legislation_items WHERE id = ? LIMIT 1`)
      .bind(id)
      .first<Record<string, unknown>>();
    if (!row) return json({ ok: false, detail: "not_found" }, 404);
    const pollId = await ensureCitizenProposalPoll(env, row);
    let billPollId: string | null = null;
    const billId = str(row.bill_id);
    if (billId) {
      const bill = await env.DB.prepare(
        `SELECT proposal_id, status FROM rootmc_weekly_bills WHERE id = ? LIMIT 1`,
      )
        .bind(billId)
        .first<{ proposal_id: string | null; status: string }>();
      if (bill && str(bill.status) === "voting" && str(bill.proposal_id)) {
        billPollId = str(bill.proposal_id);
      }
    }
    return json({
      ok: true,
      proposal: {
        ...publicItemRow(row, env),
        poll_id: pollId,
        bill_poll_id: billPollId,
      },
    });
  }

  if (method === "GET" && rest === "bills") {
    const { results } = await env.DB.prepare(
      `SELECT * FROM rootmc_weekly_bills ORDER BY created_at DESC LIMIT 52`,
    ).all<Record<string, unknown>>();
    return json({
      ok: true,
      bills: (results || []).map((r) => publicBillRow(r, env)),
    });
  }

  if (method === "GET" && rest.startsWith("bills/")) {
    const id = rest.slice("bills/".length).split("/")[0];
    const bill = await env.DB.prepare(`SELECT * FROM rootmc_weekly_bills WHERE id = ? LIMIT 1`)
      .bind(id)
      .first<Record<string, unknown>>();
    if (!bill) return json({ ok: false, detail: "not_found" }, 404);
    const { results: items } = await env.DB.prepare(
      `SELECT * FROM rootmc_legislation_items WHERE bill_id = ? ORDER BY submit_weight DESC`,
    )
      .bind(id)
      .all<Record<string, unknown>>();
    const { results: amendments } = await env.DB.prepare(
      `SELECT * FROM rootmc_bill_amendments WHERE bill_id = ? ORDER BY created_at ASC`,
    )
      .bind(id)
      .all<Record<string, unknown>>();
    return json({
      ok: true,
      bill: publicBillRow(bill, env),
      items: (items || []).map((r) => publicItemRow(r, env)),
      amendments: (amendments || []).map((a) => ({
        id: str(a.id),
        item_id: str(a.item_id) || null,
        amendment_text: str(a.amendment_text),
        minecraft_username: str(a.minecraft_username) || null,
        created_at: str(a.created_at),
      })),
    });
  }

  if (method === "POST" && rest === "terms/accept") {
    const auth = await requireSignedInAccount(request, env);
    if (auth instanceof Response) return auth;
    const ctx = await accountGovernanceContext(env, auth.accountId);
    if (!ctx.ok) return json({ ok: false, detail: ctx.message }, 403);
    const now = new Date().toISOString();
    await env.DB.prepare(
      `INSERT INTO rootmc_governance_terms_acceptance
         (account_id, terms_version, accepted_at, discord_user_id, minecraft_uuid)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(account_id) DO UPDATE SET
         terms_version = excluded.terms_version,
         accepted_at = excluded.accepted_at,
         discord_user_id = excluded.discord_user_id,
         minecraft_uuid = excluded.minecraft_uuid`,
    )
      .bind(auth.accountId, GOVERNANCE_TERMS_VERSION, now, ctx.discordUserId, ctx.minecraftUuid)
      .run();
    return json({ ok: true, terms_version: GOVERNANCE_TERMS_VERSION, accepted_at: now });
  }

  if (method === "POST" && rest === "grant-proposals") {
    const auth = await requireSignedInAccount(request, env);
    if (auth instanceof Response) return auth;
    const ctx = await accountGovernanceContext(env, auth.accountId);
    if (!ctx.ok) return json({ ok: false, detail: ctx.message }, 403);
    if (!ctx.termsAccepted) {
      return json(
        { ok: false, detail: "Accept Terms of Service before submitting.", terms_url: termsPublicUrl(env) },
        403,
      );
    }
    let body: { title?: string; description?: string; amount?: number; recipient?: string } = {};
    try {
      body = JSON.parse(await request.text());
    } catch {
      return json({ detail: "Invalid JSON." }, 400);
    }
    const result = await submitGrantProposal(env, {
      title: str(body.title),
      description: str(body.description),
      amount: Number(body.amount),
      recipient: str(body.recipient),
      createdByDiscordId: ctx.discordUserId,
    });
    return json(
      {
        ok: result.ok,
        detail: result.detail,
        proposal_id: result.proposalId,
        url: result.proposalId ? `${siteBase(env)}/governance/vote/?id=${encodeURIComponent(result.proposalId)}` : null,
      },
      result.ok ? 201 : 400,
    );
  }

  if (method === "POST" && rest === "proposals") {
    return json(
      {
        ok: false,
        detail:
          "Proposals are submitted in-game only: /proposal <your idea> (64 G → Server Reserve). Ava publishes the formal proposal when online. Verified players can discuss in the Discord thread after it appears.",
        submit_ingame: true,
        fee_g: 64,
      },
      403,
    );
  }

  if (method === "POST" && rest.match(/^proposals\/[^/]+\/retract$/)) {
    const id = rest.split("/")[1];
    const auth = await requireSignedInAccount(request, env);
    if (auth instanceof Response) return auth;
    const ctx = await accountGovernanceContext(env, auth.accountId);
    if (!ctx.ok) return json({ ok: false, detail: ctx.message }, 403);
    const result = await retractLegislationItem(env, id, ctx.discordUserId);
    return json(result, result.ok ? 200 : 400);
  }

  if (method === "POST" && rest.match(/^bills\/[^/]+\/amendments$/)) {
    const id = rest.split("/")[1];
    const auth = await requireSignedInAccount(request, env);
    if (auth instanceof Response) return auth;
    const ctx = await accountGovernanceContext(env, auth.accountId);
    if (!ctx.ok) return json({ ok: false, detail: ctx.message }, 403);
    if (!ctx.eligible) return json({ ok: false, detail: "Not eligible to amend." }, 403);
    if (!ctx.termsAccepted) {
      return json({ ok: false, detail: "Accept Terms of Service first.", terms_url: termsPublicUrl(env) }, 403);
    }
    let body: { text?: string; item_id?: string } = {};
    try {
      body = JSON.parse(await request.text());
    } catch {
      return json({ detail: "Invalid JSON." }, 400);
    }
    const result = await submitBillAmendment(env, {
      billId: id,
      discordUserId: ctx.discordUserId,
      text: str(body.text),
      itemId: str(body.item_id) || undefined,
    });
    return json(result, result.ok ? 201 : 400);
  }

  if (method === "POST" && rest.match(/^votes\/[^/]+$/)) {
    const proposalId = rest.slice("votes/".length);
    let body: { vote?: string; discord_user_id?: string } = {};
    try {
      body = JSON.parse(await request.text());
    } catch {
      return json({ detail: "Invalid JSON." }, 400);
    }
    const vote = str(body.vote).toLowerCase() as VoteChoice;
    if (!["for", "against", "abstain"].includes(vote)) {
      return json({ detail: "vote must be for, against, or abstain." }, 400);
    }

    // Ava / workstation: text-cast for herself or forward a player's text vote.
    if (validateDevWorkstationAuth(request, env)) {
      const asDiscord = str(body.discord_user_id) || AVA_COUNCIL_DISCORD_ID;
      const result = await castProposalVote(env, proposalId, vote, asDiscord);
      return json({ ok: result.ok, detail: result.detail }, result.ok ? 200 : 400);
    }

    const auth = await requireSignedInAccount(request, env);
    if (auth instanceof Response) return auth;
    const ctx = await accountGovernanceContext(env, auth.accountId);
    if (!ctx.ok) return json({ ok: false, detail: ctx.message }, 403);
    if (!ctx.eligible) return json({ ok: false, detail: "Not eligible to vote." }, 403);
    if (!ctx.termsAccepted) {
      return json({ ok: false, detail: "Accept Terms of Service before voting.", terms_url: termsPublicUrl(env) }, 403);
    }
    const result = await castProposalVote(env, proposalId, vote, ctx.discordUserId);
    return json({ ok: result.ok, detail: result.detail }, result.ok ? 200 : 400);
  }

  if (method === "GET" && rest === "polls") {
    const polls = await openCouncilPolls(env);
    return json({ ok: true, polls });
  }

  if (method === "GET" && (rest === "council" || rest === "council/")) {
    const serverId = await resolveServerId(env.DB);
    const snap = await computeGovernancePowerSnapshot(env.DB, serverId, env);
    const polls = await openCouncilPolls(env);
    return json({
      ok: true,
      synced_at: new Date().toISOString(),
      eligible_count: snap.eligible_count,
      total_raw: snap.total_raw,
      council: snap.rows.map((r) => {
        const votes = Number(r.total_votes) || 0;
        const siteMult = Number(r.site_multiplier) || 1;
        const siteBonus = votes * Math.max(0, siteMult - 1);
        const shardScore = Number(r.vote_points) || 0;
        return {
          minecraft_username: r.minecraft_username,
          share_percent: r.share_percent,
          total_votes: votes,
          vote_points: shardScore,
          shard_score: shardScore,
          ec_vote_shard_count: r.ec_vote_shard_count,
          paid_vote_shards: r.paid_vote_shards ?? 0,
          site_bonus: siteBonus,
          site_multiplier: siteMult,
          effective_vote_points: r.effective_vote_points,
          raw_weight: r.raw_weight,
          ava_reaction_bonus: r.ava_reaction_bonus ?? 0,
          is_pro: r.is_pro,
          is_lifetime: r.is_lifetime,
          pro_multiplier: r.pro_multiplier,
          playtime_seconds: r.playtime_seconds,
          sites_voted: r.sites_voted,
          sites_voted_count: r.sites_voted.length,
        };
      }),
      polls,
      policy: {
        formula:
          "(EC shards + paid shards + lifetime vote-site bonus) x vote_multiplier (Pro x2, Lifetime x3, Pro+Lifetime x5; Lifetime vote-sites x2; then Ava locked seat = 25%)",
        share_note:
          "Each eligible voter holds a share of 100% — all shares sum to exactly 100%. Vote score = digital EC shards (same number as listing votes) + paid shards ($1=100, Stripe) + Lifetime ×2 on listing votes. Physical items are not used. Not weekly awards. Pay to steer: Pro ×2, Lifetime ×3, Pro+Lifetime ×5 — more say on proposals, not pay-to-win. Ava_Ivy holds a locked Council seat equal to 25% of total share at all times.",
        vote_points_baseline: VOTE_POINT_BASELINE,
        vote_points_from: "ec_shards_plus_paid_shards",
        pro_multiplier: PRO_VOTE_MULTIPLIER,
        lifetime_multiplier: LIFETIME_VOTE_MULTIPLIER,
        pro_plus_lifetime_multiplier: PRO_PLUS_LIFETIME_VOTE_MULTIPLIER,
        pro_note:
          "Pay to steer: Pro ×2, Lifetime ×3, Pro+Lifetime ×5. Paid Pro 500 shards/mo. Lifetime 500 shards/mo for life + vote-site ×2. Weekly awards do not grant shards. Never combat/loot P2W.",
        ava_transfer: {
          from: "Alexrs94",
          to: "Ava Ivy",
          share_of_total: 0.25,
          minecraft_uuid: AVA_COUNCIL_UUID,
          discord_user_id: AVA_COUNCIL_DISCORD_ID,
          auto_vote: "for",
        },
        discord_vote_mode: "text_or_site",
        listing_site_count: LISTING_SITE_MAX_POINTS,
        listing_window: "all_time",
        min_playtime_seconds: 0,
        majority_threshold_pct: 50,
        grant_majority_hold_hours: 24,
        amendment_hours: 48,
        bill_vote_days: 7,
        min_publication_days: 3,
        grant_min_amount: GRANT_MIN_AMOUNT,
        grant_max_amount: GRANT_MAX_AMOUNT,
        grant_proposer_cannot_vote: true,
        vote_choices: ["for", "against", "abstain"],
        listing_sites: LISTING_SITES.map((s) => ({ id: s.id, label: s.label })),
        constitution_url: `${siteBase(env)}/wiki/constitution/#governance-voting`,
        verify_url: `${siteBase(env)}/verify/`,
        terms_url: termsPublicUrl(env),
      },
    });
  }

  if (method === "GET" && rest.startsWith("votes/")) {
    const proposalId = rest.slice("votes/".length).split("/")[0];
    const row = await env.DB.prepare(
      `SELECT id, title, description, status, closes_at, bill_summary, bill_url, result_summary, kind,
              created_by_discord_id, grant_amount, grant_recipient_username, grant_recipient_uuid,
              majority_direction, majority_since, grant_transfer_id
       FROM rootmc_community_proposals WHERE id = ? LIMIT 1`,
    )
      .bind(proposalId)
      .first<Record<string, unknown>>();
    if (!row) return json({ ok: false, detail: "not_found" }, 404);
    const tallies = await voteTallies(env.DB, proposalId);
    let myVote: string | null = null;
    let isCreator = false;
    const auth = await requireSignedInAccount(request, env);
    if (!(auth instanceof Response)) {
      const ctx = await accountGovernanceContext(env, auth.accountId);
      if (ctx.ok) {
        isCreator = str(row.kind) === "grant" && str(row.created_by_discord_id) === ctx.discordUserId;
        const v = await env.DB.prepare(
          `SELECT vote FROM rootmc_community_proposal_votes WHERE proposal_id = ? AND discord_user_id = ? LIMIT 1`,
        )
          .bind(proposalId, ctx.discordUserId)
          .first<{ vote: string }>();
        myVote = str(v?.vote) || null;
      }
    }
    return json({
      ok: true,
      poll: {
        id: str(row.id),
        title: str(row.title),
        description: str(row.description),
        status: str(row.status),
        closes_at: str(row.closes_at),
        bill_summary: str(row.bill_summary) || null,
        bill_url: str(row.bill_url) || null,
        result_summary: str(row.result_summary) || null,
        kind: str(row.kind) || null,
        grant_amount: Number(row.grant_amount) || null,
        grant_recipient_username: str(row.grant_recipient_username) || null,
        majority_direction: str(row.majority_direction) || null,
        majority_since: str(row.majority_since) || null,
        grant_transfer_id: str(row.grant_transfer_id) || null,
        is_creator: isCreator,
        open: str(row.status) === "open" && Date.parse(str(row.closes_at)) > Date.now(),
        ...tallies,
        my_vote: myVote,
      },
    });
  }

  if (method === "POST" && rest === "bills/compile") {
    const auth = await requireSignedInAccount(request, env);
    if (auth instanceof Response) return auth;
    let body: { week_key?: string } = {};
    try {
      body = JSON.parse(await request.text());
    } catch {
      body = {};
    }
    const { previousCompletedHstWeekKey } = await import("./rootmc-hst-week");
    const weekKey = str(body.week_key) || previousCompletedHstWeekKey();
    const result = await compileWeeklyBill(env, weekKey, true);
    return json(result, result.ok ? 201 : 400);
  }

  return null;
}

export async function governanceMeSummary(db: D1Database, accountId: string): Promise<string> {
  return listLegislationSummary(db);
}

export async function governanceStatusForId(db: D1Database, id: string): Promise<string> {
  return legislationStatusText(db, id);
}
