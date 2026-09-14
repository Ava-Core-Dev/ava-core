/**
 * RootMC Terminal PWA  -  daily check-in + vote claim routes.
 * Grants debit treasury via rootmc_gold_transfers (sources app_checkin / app_vote).
 */

import type { D1Database } from "@cloudflare/workers-types";

import { json } from "./cors";
import { TOWNY_SERVER_USERNAME, TOWNY_SERVER_UUID } from "./rootmc-economy-accounts";
import { resolveServerId } from "./rootmc-daily-report";
import { requireSignedInAccount } from "./realm-lib";
import { canonicalListingSiteId } from "./rootmc-listing-sites";
import type { AuthEnv } from "./primary-auth";
import type { RootStatEnv } from "./rootstat-minecraft";
import { getPlayerBalance, roundGold } from "./discord-rootmc-economy";

const CHECKIN_COOLDOWN_MS = 22 * 60 * 60 * 1000;
const STREAK_RESET_MS = 48 * 60 * 60 * 1000;
const VOTE_COOLDOWN_MS = 24 * 60 * 60 * 1000;
const VOTE_VERIFY_MS = 24 * 60 * 60 * 1000;

const CHECKIN_TIERS = [10, 15, 20, 25, 35, 50, 100];

export const APP_VOTE_SITES = [
  { id: "minecraft-mp", name: "Minecraft-MP", reward: 15, url: "https://minecraft-mp.com/server/359724/vote/" },
  { id: "minecraftservers.org", name: "MinecraftServers.org", reward: 20, url: "https://minecraftservers.org/vote/689134" },
  { id: "minecraft-server-list", name: "Minecraft Server List", reward: 15, url: "https://minecraft-server-list.com/server/521165/vote/" },
  { id: "minecraft.buzz", name: "Minecraft.Buzz", reward: 15, url: "https://minecraft.buzz/vote/21857" },
  { id: "topminecraftservers", name: "TopMinecraftServers", reward: 20, url: "https://topminecraftservers.org/vote/43816" },
  { id: "minerank", name: "MineRank", reward: 15, url: "https://www.minerank.com/rootmc-top-tier-economy-server/vote" },
  { id: "minecraftlist.org", name: "MinecraftList.org", reward: 15, url: "https://minecraftlist.org/vote/34144" },
  { id: "planetminecraft", name: "Planet Minecraft", reward: 15, url: "https://www.planetminecraft.com/server/rootmc/vote/" },
] as const;

function nowIso(): string {
  return new Date().toISOString();
}

function str(v: unknown): string {
  return v == null ? "" : String(v).trim();
}

type McLink = { minecraft_uuid: string; minecraft_username: string | null };

async function requireMcLink(
  request: Request,
  env: AuthEnv & { DB: D1Database },
): Promise<McLink | Response> {
  const auth = await requireSignedInAccount(request, env);
  if (auth instanceof Response) return auth;
  const row = await env.DB.prepare(
    `SELECT minecraft_uuid, minecraft_username FROM rootstat_minecraft_links WHERE account_id = ? LIMIT 1`,
  )
    .bind(auth.accountId)
    .first<{ minecraft_uuid: string; minecraft_username: string | null }>();
  const uuid = str(row?.minecraft_uuid).toLowerCase();
  if (!uuid) return json({ detail: "Link Minecraft in-game with /link first." }, 403);
  return { minecraft_uuid: uuid, minecraft_username: str(row?.minecraft_username) || null };
}

function checkinReward(streak: number): { gold: number; tier: number; tier_label: string } {
  const idx = Math.min(Math.max(0, streak), 6);
  return { gold: CHECKIN_TIERS[idx], tier: idx + 1, tier_label: `Day ${idx + 1}` };
}

async function loadCheckinState(
  db: D1Database,
  serverId: string,
  uuid: string,
): Promise<{ streak_count: number; last_claim_at: string | null }> {
  const row = await db
    .prepare(
      `SELECT streak_count, last_claim_at FROM rootmc_app_checkin_state
       WHERE server_id = ? AND minecraft_uuid = ? LIMIT 1`,
    )
    .bind(serverId, uuid)
    .first<{ streak_count: number; last_claim_at: string | null }>();
  return {
    streak_count: Math.max(0, Math.floor(Number(row?.streak_count) || 0)),
    last_claim_at: row?.last_claim_at ? str(row.last_claim_at) : null,
  };
}

async function queueTreasuryGrant(
  db: D1Database,
  serverId: string,
  toUuid: string,
  toName: string,
  amount: number,
  source: "app_checkin" | "app_vote",
): Promise<string> {
  const transferId = crypto.randomUUID();
  const ts = nowIso();
  await db
    .prepare(
      `INSERT INTO rootmc_gold_transfers (
         id, server_id, from_uuid, from_username, to_uuid, to_username, amount,
         source, discord_from_user_id, discord_to_user_id, status, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, 'pending', ?)`,
    )
    .bind(
      transferId,
      serverId,
      TOWNY_SERVER_UUID,
      TOWNY_SERVER_USERNAME,
      toUuid,
      toName,
      roundGold(amount),
      source,
      ts,
    )
    .run();
  return transferId;
}

function secondsUntil(cooldownEndMs: number): number {
  return Math.max(0, Math.floor((cooldownEndMs - Date.now()) / 1000));
}

async function checkinStatusPayload(
  db: D1Database,
  serverId: string,
  uuid: string,
): Promise<Record<string, unknown>> {
  const state = await loadCheckinState(db, serverId, uuid);
  let streak = state.streak_count;
  let canClaim = true;
  let secondsUntilNext = 0;
  const last = state.last_claim_at ? Date.parse(state.last_claim_at) : NaN;
  if (Number.isFinite(last)) {
    const elapsed = Date.now() - last;
    if (elapsed < CHECKIN_COOLDOWN_MS) {
      canClaim = false;
      secondsUntilNext = secondsUntil(last + CHECKIN_COOLDOWN_MS);
    }
    if (elapsed > STREAK_RESET_MS) streak = 0;
  }
  const nextReward = checkinReward(streak);
  const week = Array.from({ length: 7 }, (_, i) => checkinReward(i));
  return {
    can_claim: canClaim,
    seconds_until_next: secondsUntilNext,
    streak,
    next_reward: nextReward,
    week,
    last_claimed_at: state.last_claim_at,
  };
}

async function handleCheckinStatus(
  request: Request,
  env: RootStatEnv,
): Promise<Response> {
  const link = await requireMcLink(request, env);
  if (link instanceof Response) return link;
  const serverId = await resolveServerId(env.DB);
  return json(await checkinStatusPayload(env.DB, serverId, link.minecraft_uuid));
}

async function handleCheckinClaim(request: Request, env: RootStatEnv): Promise<Response> {
  const link = await requireMcLink(request, env);
  if (link instanceof Response) return link;
  const serverId = await resolveServerId(env.DB);
  const uuid = link.minecraft_uuid;
  const state = await loadCheckinState(env.DB, serverId, uuid);
  let streak = state.streak_count;
  const last = state.last_claim_at ? Date.parse(state.last_claim_at) : NaN;
  if (Number.isFinite(last)) {
    const elapsed = Date.now() - last;
    if (elapsed < CHECKIN_COOLDOWN_MS) {
      return json(
        { error: "cooldown", seconds: secondsUntil(last + CHECKIN_COOLDOWN_MS) },
        429,
      );
    }
    if (elapsed > STREAK_RESET_MS) streak = 0;
  }
  const reward = checkinReward(streak);
  const newStreak = streak < 7 ? streak + 1 : 1;
  const ts = nowIso();
  const toName = str(link.minecraft_username) || uuid.slice(0, 8);
  await queueTreasuryGrant(env.DB, serverId, uuid, toName, reward.gold, "app_checkin");
  await env.DB.prepare(
    `INSERT INTO rootmc_app_checkin_state (minecraft_uuid, server_id, streak_count, last_claim_at, updated_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(minecraft_uuid, server_id) DO UPDATE SET
       streak_count = excluded.streak_count,
       last_claim_at = excluded.last_claim_at,
       updated_at = excluded.updated_at`,
  )
    .bind(uuid, serverId, newStreak, ts, ts)
    .run();
  const bal = await getPlayerBalance(env.DB, serverId, uuid);
  return json({
    success: true,
    reward,
    new_streak: newStreak,
    new_wallet_balance: roundGold(bal.balance),
  });
}

async function lastVoteClaimAt(
  db: D1Database,
  serverId: string,
  uuid: string,
  siteId: string,
): Promise<string | null> {
  const row = await db
    .prepare(
      `SELECT claimed_at FROM rootmc_app_vote_claims
       WHERE server_id = ? AND minecraft_uuid = ? AND site_id = ?
       ORDER BY claimed_at DESC LIMIT 1`,
    )
    .bind(serverId, uuid, siteId)
    .first<{ claimed_at: string }>();
  return row?.claimed_at ? str(row.claimed_at) : null;
}

async function hasRecentListingVote(
  db: D1Database,
  uuid: string,
  siteId: string,
  sinceIso: string,
): Promise<boolean> {
  const { results } = await db
    .prepare(
      `SELECT service, voted_at FROM rootmc_listing_votes
       WHERE minecraft_uuid = ? AND voted_at >= ?
       ORDER BY voted_at DESC LIMIT 50`,
    )
    .bind(uuid, sinceIso)
    .all<{ service: string; voted_at: string }>();
  for (const row of results || []) {
    const canonical = canonicalListingSiteId(row.service) ?? str(row.service).toLowerCase();
    if (canonical === siteId) return true;
  }
  return false;
}

async function handleVoteSites(request: Request, env: RootStatEnv): Promise<Response> {
  const link = await requireMcLink(request, env);
  if (link instanceof Response) return link;
  const serverId = await resolveServerId(env.DB);
  const uuid = link.minecraft_uuid;
  const sites = [];
  let earnedToday = 0;
  const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { results: recentClaims } = await env.DB.prepare(
    `SELECT site_id, reward_gold, claimed_at FROM rootmc_app_vote_claims
     WHERE server_id = ? AND minecraft_uuid = ? AND claimed_at >= ?`,
  )
    .bind(serverId, uuid, dayAgo)
    .all<{ site_id: string; reward_gold: number; claimed_at: string }>();
  for (const c of recentClaims || []) {
    earnedToday += Number(c.reward_gold) || 0;
  }
  for (const site of APP_VOTE_SITES) {
    const lastClaim = await lastVoteClaimAt(env.DB, serverId, uuid, site.id);
    let canClaim = false;
    let secondsUntilSite = 0;
    if (lastClaim) {
      const lastMs = Date.parse(lastClaim);
      if (Number.isFinite(lastMs) && Date.now() - lastMs < VOTE_COOLDOWN_MS) {
        secondsUntilSite = secondsUntil(lastMs + VOTE_COOLDOWN_MS);
      } else {
        canClaim = await hasRecentListingVote(
          env.DB,
          uuid,
          site.id,
          new Date(Date.now() - VOTE_VERIFY_MS).toISOString(),
        );
      }
    } else {
      canClaim = await hasRecentListingVote(
        env.DB,
        uuid,
        site.id,
        new Date(Date.now() - VOTE_VERIFY_MS).toISOString(),
      );
    }
    sites.push({
      ...site,
      can_claim: canClaim,
      seconds_until: secondsUntilSite,
      last_claimed_at: lastClaim,
    });
  }
  return json({ sites, earned_today: roundGold(earnedToday) });
}

async function handleVoteClaim(request: Request, env: RootStatEnv): Promise<Response> {
  const link = await requireMcLink(request, env);
  if (link instanceof Response) return link;
  let body: { site_id?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return json({ detail: "Invalid JSON" }, 400);
  }
  const siteId = str(body.site_id);
  const site = APP_VOTE_SITES.find((s) => s.id === siteId);
  if (!site) return json({ detail: "unknown_site" }, 404);

  const serverId = await resolveServerId(env.DB);
  const uuid = link.minecraft_uuid;
  const lastClaim = await lastVoteClaimAt(env.DB, serverId, uuid, site.id);
  if (lastClaim) {
    const lastMs = Date.parse(lastClaim);
    if (Number.isFinite(lastMs) && Date.now() - lastMs < VOTE_COOLDOWN_MS) {
      return json(
        { error: "cooldown", seconds: secondsUntil(lastMs + VOTE_COOLDOWN_MS) },
        429,
      );
    }
  }
  const voted = await hasRecentListingVote(
    env.DB,
    uuid,
    site.id,
    new Date(Date.now() - VOTE_VERIFY_MS).toISOString(),
  );
  if (!voted) {
    return json(
      { detail: "No verified vote for this site in the last 24 hours. Vote on the listing, then claim." },
      409,
    );
  }
  const toName = str(link.minecraft_username) || uuid.slice(0, 8);
  const transferId = await queueTreasuryGrant(env.DB, serverId, uuid, toName, site.reward, "app_vote");
  const ts = nowIso();
  await env.DB.prepare(
    `INSERT INTO rootmc_app_vote_claims (id, server_id, minecraft_uuid, site_id, transfer_id, reward_gold, claimed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(crypto.randomUUID(), serverId, uuid, site.id, transferId, site.reward, ts)
    .run();
  const bal = await getPlayerBalance(env.DB, serverId, uuid);
  return json({
    success: true,
    reward_gold: site.reward,
    site: site.name,
    new_wallet_balance: roundGold(bal.balance),
  });
}

export async function handleRootMcAppRewards(
  request: Request,
  env: RootStatEnv,
  subpath: string,
  method: string,
): Promise<Response | null> {
  if (!subpath.startsWith("/rootmc/app/")) return null;
  const rest = subpath.slice("/rootmc/app".length) || "/";

  if (method === "GET" && rest === "/checkin/status") {
    return handleCheckinStatus(request, env);
  }
  if (method === "POST" && rest === "/checkin/claim") {
    return handleCheckinClaim(request, env);
  }
  if (method === "GET" && rest === "/vote/sites") {
    return handleVoteSites(request, env);
  }
  if (method === "POST" && rest === "/vote/claim") {
    return handleVoteClaim(request, env);
  }
  return null;
}
