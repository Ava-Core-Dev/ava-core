/**
 * Governance voting power — digital EC shards (listing votes) + paid shards × membership multiplier → share of 100%.
 * Pro ×2 · Lifetime ×3 · Pro+Lifetime ×5. Playtime does not multiply.
 * Policy: https://rootmc.net/wiki/constitution/#governance-voting
 */

import type { D1Database } from "@cloudflare/workers-types";

import {
  canonicalListingSiteId,
  canonicalListingSiteIds,
  LISTING_SITE_MAX_POINTS,
  votePointsFromTotalVotes,
  VOTE_POINT_BASELINE,
} from "./rootmc-listing-sites";
import type { RootMcHyperdriveEnv } from "./rootmc-hyperdrive";
import {
  LIFETIME_VOTE_SITE_MULTIPLIER,
  loadPaidVoteShardBalances,
} from "./rootmc-paid-vote-shards";
import { loadSharedPlaytimeMap } from "./rootmc-shared-playtime";
import { playtimeStatsForPlayer } from "./rootstat-minecraft";

/** Active Pro (paid / redeemed window, or standalone pro_unlocked) multiplies EC shard weight. */
export const PRO_VOTE_MULTIPLIER = 2;
/** Lifetime member multiplies EC shard weight. Stacks additively with Pro → ×5. */
export const LIFETIME_VOTE_MULTIPLIER = 3;
/** Pro + Lifetime together (2 + 3). */
export const PRO_PLUS_LIFETIME_VOTE_MULTIPLIER = 5;

export type MembershipVoteFlags = {
  pro_unlocked?: number | boolean | null;
  life_member?: number | boolean | null;
  pro_paid_until?: string | null;
  pro_redeemed_until?: string | null;
};

/** Ava Ivy Discord app / bot user — Council seat. */
export const AVA_COUNCIL_DISCORD_ID = "1532751879875072070";
/** Ava_Ivy Microsoft account (ex-wildecho94). */
export const AVA_COUNCIL_UUID = "78c3de61-0fd6-4800-9eda-cc178eaae34b";
/** Retired synthetic Council UUID — still treated as Ava if present. */
export const AVA_COUNCIL_UUID_LEGACY = "a0a10000-0000-4000-a000-000000000001";
export const AVA_COUNCIL_USERNAME = "Ava_Ivy";
/** Ava holds this fraction of total Council share at all times. */
export const AVA_EQUAL_SHARE_FRAC = 0.25;
/** @deprecated Use {@link AVA_EQUAL_SHARE_FRAC}. Kept so old imports keep compiling. */
export const ALEX_TO_AVA_SHARE_FRAC = AVA_EQUAL_SHARE_FRAC;
export const ALEX_TRANSFER_USERNAME = "alexrs94";

export type GovernancePowerRow = {
  minecraft_uuid: string;
  minecraft_username: string | null;
  discord_user_id: string | null;
  /** Informational only — not used in raw weight. */
  playtime_seconds: number;
  gen1_playtime_seconds?: number;
  gen2_playtime_seconds?: number;
  /** @deprecated Not used in voting power — always 0. */
  net_worth: number;
  /** @deprecated Not used in voting power — always 0. */
  stake: number;
  /** All-time verified listing votes (informational / mint source). */
  total_votes: number;
  /**
   * Digital EC shard weight (listing-vote count). Prefer {@link ec_vote_shard_count}.
   */
  vote_points: number;
  /** Same as vote_points — explicit EC shard weight. */
  ec_vote_shard_count: number;
  /** Paid Stripe / donation shards ($1 = 100). Not weekly awards. */
  paid_vote_shards: number;
  /** 1 / Pro ×2 / Lifetime ×3 / Pro+Lifetime ×5. */
  pro_multiplier: number;
  /** True when standalone Pro (subscription / paid / redeemed) applies — not Lifetime-only. */
  is_pro: boolean;
  /** True when RootMC Lifetime is active. */
  is_lifetime: boolean;
  /** ec_vote_shard_count × pro_multiplier. */
  effective_vote_points: number;
  /** Additive Ava-reaction quality bonus (capped). */
  ava_reaction_bonus: number;
  ava_reaction_good: number;
  ava_reaction_bad: number;
  /** Listing vote-site multiplier (Lifetime ×2, else 1). */
  site_multiplier: number;
  raw_weight: number;
  share_percent: number;
  /** Distinct canonical listing sites voted all-time (informational). */
  sites_voted: string[];
};

export type GovernancePowerSnapshot = {
  eligible_count: number;
  total_raw: number;
  rows: GovernancePowerRow[];
};

function str(v: unknown): string {
  return String(v ?? "").trim();
}

function normalizeUuid(raw: unknown): string {
  return str(raw).toLowerCase();
}

export function isAvaCouncilUuid(uuid: unknown): boolean {
  const u = normalizeUuid(uuid);
  return u === normalizeUuid(AVA_COUNCIL_UUID) || u === normalizeUuid(AVA_COUNCIL_UUID_LEGACY);
}

/** @deprecated Net worth is not used in governance voting power. */
export function stakeFromNetWorth(_netWorth: number): number {
  return 0;
}

export function isLifetimeMember(flags: MembershipVoteFlags | null | undefined): boolean {
  if (!flags) return false;
  return Boolean(flags.life_member) || Number(flags.life_member) === 1;
}

/** Paid Stripe window only — weekly award `pro_redeemed_until` does not count for vote shards. */
export function hasActiveProWindow(flags: MembershipVoteFlags | null | undefined, nowMs = Date.now()): boolean {
  if (!flags) return false;
  const paid = flags.pro_paid_until ? Date.parse(String(flags.pro_paid_until)) : NaN;
  if (Number.isFinite(paid) && paid > nowMs) return true;
  return false;
}

/**
 * Pro product for vote math: paid Stripe window or standalone pro_unlocked (subscription).
 * Weekly award Pro does not grant shards or ×2. Lifetime-only is not a second Pro product.
 */
export function isProForVote(flags: MembershipVoteFlags | null | undefined, nowMs = Date.now()): boolean {
  if (!flags) return false;
  if (hasActiveProWindow(flags, nowMs)) return true;
  const unlocked = Boolean(flags.pro_unlocked) || Number(flags.pro_unlocked) === 1;
  if (!unlocked) return false;
  if (isLifetimeMember(flags)) return false;
  return true;
}

/** Perk access (cosmetics / homes) — Lifetime still counts as Pro. */
export function isProAccessActive(flags: MembershipVoteFlags | null | undefined, nowMs = Date.now()): boolean {
  if (!flags) return false;
  if (isLifetimeMember(flags)) return true;
  if (Boolean(flags.pro_unlocked) || Number(flags.pro_unlocked) === 1) return true;
  return hasActiveProWindow(flags, nowMs);
}

/** Pay-to-steer multiplier: Pro ×2, Lifetime ×3, both ×5, else 1. */
export function voteMembershipMultiplier(flags: MembershipVoteFlags | null | undefined, nowMs = Date.now()): number {
  const pro = isProForVote(flags, nowMs);
  const life = isLifetimeMember(flags);
  if (pro && life) return PRO_PLUS_LIFETIME_VOTE_MULTIPLIER;
  if (life) return LIFETIME_VOTE_MULTIPLIER;
  if (pro) return PRO_VOTE_MULTIPLIER;
  return 1;
}

async function allTimeListingVoteCount(db: D1Database, uuid: string): Promise<number> {
  const row = await db
    .prepare(
      `SELECT COUNT(*) as c FROM rootmc_listing_votes
       WHERE minecraft_uuid = ?`,
    )
    .bind(normalizeUuid(uuid))
    .first<{ c: number }>();
  return Math.max(0, Math.floor(Number(row?.c) || 0));
}

async function allTimeListingCanonicalSites(
  db: D1Database,
  uuid: string,
): Promise<string[]> {
  const { results } = await db
    .prepare(
      `SELECT DISTINCT service FROM rootmc_listing_votes
       WHERE minecraft_uuid = ?
       ORDER BY service ASC`,
    )
    .bind(normalizeUuid(uuid))
    .all<{ service: string }>();
  const raw = (results || []).map((r) => str(r.service)).filter(Boolean);
  return canonicalListingSiteIds(raw);
}

/** Sum EC Vote Shard weights across all synced hosts for each UUID. */
async function loadEcVoteShardWeights(db: D1Database): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  try {
    const { results } = await db
      .prepare(
        `SELECT minecraft_uuid, SUM(weight) AS w
         FROM rootmc_ec_vote_shards
         GROUP BY minecraft_uuid`,
      )
      .all<{ minecraft_uuid: string; w: number }>();
    for (const row of results || []) {
      const uuid = normalizeUuid(row.minecraft_uuid);
      const w = Math.max(0, Math.floor(Number(row.w) || 0));
      if (uuid && w > 0) out.set(uuid, w);
    }
  } catch {
    // Table may not exist until migration 0162 is applied.
  }
  return out;
}

/**
 * Upsert EC Vote Shard weights reported by a Paper host (server-auth).
 * Each host reports its own double-/ec weights; rows are keyed by uuid+server_id.
 */
export async function upsertEcVoteShards(
  db: D1Database,
  serverId: string,
  players: Array<{ minecraft_uuid: string; weight: number }>,
): Promise<number> {
  const sid = str(serverId) || "rootmc";
  let n = 0;
  for (const p of players) {
    const uuid = normalizeUuid(p.minecraft_uuid);
    if (!uuid) continue;
    const weight = Math.max(0, Math.floor(Number(p.weight) || 0));
    await db
      .prepare(
        `INSERT INTO rootmc_ec_vote_shards (minecraft_uuid, server_id, weight, updated_at)
         VALUES (?, ?, ?, datetime('now'))
         ON CONFLICT(minecraft_uuid, server_id) DO UPDATE SET
           weight = excluded.weight,
           updated_at = excluded.updated_at`,
      )
      .bind(uuid, sid, weight)
      .run();
    n++;
  }
  return n;
}

async function loadMembershipFlagsByAccountId(
  db: D1Database,
  accountIds: string[],
): Promise<Map<string, MembershipVoteFlags>> {
  const out = new Map<string, MembershipVoteFlags>();
  const ids = [...new Set(accountIds.map((a) => str(a)).filter(Boolean))];
  if (!ids.length) return out;
  const chunkSize = 80;
  for (let i = 0; i < ids.length; i += chunkSize) {
    const chunk = ids.slice(i, i + chunkSize);
    const placeholders = chunk.map(() => "?").join(",");
    const { results } = await db
      .prepare(
        `SELECT account_id, pro_unlocked, life_member, pro_paid_until, pro_redeemed_until
         FROM user_accounts
         WHERE account_id IN (${placeholders})`,
      )
      .bind(...chunk)
      .all<{
        account_id: string;
        pro_unlocked: number | null;
        life_member: number | null;
        pro_paid_until: string | null;
        pro_redeemed_until: string | null;
      }>();
    for (const row of results || []) {
      out.set(str(row.account_id), {
        pro_unlocked: row.pro_unlocked,
        life_member: row.life_member,
        pro_paid_until: row.pro_paid_until,
        pro_redeemed_until: row.pro_redeemed_until,
      });
    }
  }
  return out;
}

export async function governancePowerForUuid(
  db: D1Database,
  serverId: string,
  uuid: string,
  snapshot?: GovernancePowerSnapshot,
  env?: RootMcHyperdriveEnv,
): Promise<GovernancePowerRow | null> {
  const snap = snapshot || (await computeGovernancePowerSnapshot(db, serverId, env));
  return snap.rows.find((r) => normalizeUuid(r.minecraft_uuid) === normalizeUuid(uuid)) || null;
}

export async function governancePowerForDiscordId(
  db: D1Database,
  serverId: string,
  discordUserId: string,
  snapshot?: GovernancePowerSnapshot,
  env?: RootMcHyperdriveEnv,
): Promise<GovernancePowerRow | null> {
  const id = str(discordUserId);
  if (!id) return null;
  const snap = snapshot || (await computeGovernancePowerSnapshot(db, serverId, env));
  return snap.rows.find((r) => str(r.discord_user_id) === id) || null;
}

/**
 * Ava Ivy synthetic Council seat: always holds {@link AVA_EQUAL_SHARE_FRAC} (25%).
 * Raw weight = frac/(1-frac) × sum of every other eligible voter — she does not drain Alex.
 * Example: A100 + B200 + C100 → Ava 133.33 → Ava 25% of 533.33.
 */
export function avaSeatRawFromOthers(othersTotal: number, frac = AVA_EQUAL_SHARE_FRAC): number {
  const o = Number(othersTotal) || 0;
  const f = Number(frac) || 0;
  if (o <= 0 || f <= 0 || f >= 1) return 0;
  return Math.round(((f / (1 - f)) * o) * 100) / 100;
}

export function applyAvaEqualCouncilSeat(rows: GovernancePowerRow[]): void {
  for (let i = rows.length - 1; i >= 0; i--) {
    const r = rows[i];
    if (
      str(r.discord_user_id) === AVA_COUNCIL_DISCORD_ID ||
      isAvaCouncilUuid(r.minecraft_uuid)
    ) {
      rows.splice(i, 1);
    }
  }

  const othersTotal =
    Math.round(rows.reduce((s, r) => s + r.raw_weight, 0) * 100) / 100;
  if (othersTotal <= 0) return;

  const avaRaw = avaSeatRawFromOthers(othersTotal);
  const shardWeight = Math.max(1, Math.round(avaRaw));

  rows.push({
    minecraft_uuid: AVA_COUNCIL_UUID,
    minecraft_username: AVA_COUNCIL_USERNAME,
    discord_user_id: AVA_COUNCIL_DISCORD_ID,
    playtime_seconds: 0,
    gen1_playtime_seconds: 0,
    gen2_playtime_seconds: 0,
    net_worth: 0,
    stake: 0,
    total_votes: shardWeight,
    vote_points: shardWeight,
    ec_vote_shard_count: shardWeight,
    paid_vote_shards: 0,
    pro_multiplier: 1,
    is_pro: false,
    is_lifetime: false,
    effective_vote_points: shardWeight,
    ava_reaction_bonus: 0,
    ava_reaction_good: 0,
    ava_reaction_bad: 0,
    site_multiplier: 1,
    raw_weight: avaRaw,
    share_percent: 0,
    sites_voted: [],
  });
}

/**
 * @deprecated Name kept for call-sites — now applies {@link applyAvaEqualCouncilSeat} (25%).
 */
export function applyAlexToAvaVoteTransfer(rows: GovernancePowerRow[]): void {
  applyAvaEqualCouncilSeat(rows);
}


export async function computeGovernancePowerSnapshot(
  db: D1Database,
  serverId: string,
  env?: RootMcHyperdriveEnv,
): Promise<GovernancePowerSnapshot> {
  const { results: links } = await db
    .prepare(
      `SELECT m.minecraft_uuid, m.minecraft_username, m.account_id, d.discord_user_id
       FROM rootstat_minecraft_links m
       INNER JOIN discord_account_links d ON d.account_id = m.account_id
       WHERE d.discord_user_id IS NOT NULL AND TRIM(d.discord_user_id) != ''`,
    )
    .all<{
      minecraft_uuid: string;
      minecraft_username: string | null;
      account_id: string;
      discord_user_id: string;
    }>();

  const sharedMap = env ? await loadSharedPlaytimeMap(env) : null;
  const flagsByAccount = await loadMembershipFlagsByAccountId(
    db,
    (links || []).map((l) => l.account_id),
  );
  const ecWeights = await loadEcVoteShardWeights(db);
  const paidShards = await loadPaidVoteShardBalances(db);
  const reactionBonus = await loadAvaReactionBonuses(db);

  const rows: GovernancePowerRow[] = [];
  for (const link of links || []) {
    const uuid = normalizeUuid(link.minecraft_uuid);
    if (!uuid) continue;

    const ecWeight = ecWeights.get(uuid) || 0;
    const paid = paidShards.get(uuid) || 0;
    if (ecWeight <= 0 && paid <= 0) continue;

    const shared = sharedMap?.get(uuid) || null;
    const playtime = shared ? null : await playtimeStatsForPlayer(db, serverId, uuid);
    const playtimeSeconds = Math.max(
      0,
      Math.floor(Number(shared?.total_playtime_seconds ?? playtime?.total_playtime_seconds) || 0),
    );

    const totalVotes = await allTimeListingVoteCount(db, uuid);
    const sites = await allTimeListingCanonicalSites(db, uuid);
    const flags = flagsByAccount.get(str(link.account_id)) || {};
    const isPro = isProForVote(flags);
    const isLifetime = isLifetimeMember(flags);
    const siteMult = isLifetime ? LIFETIME_VOTE_SITE_MULTIPLIER : 1;
    const siteBonus = totalVotes * Math.max(0, siteMult - 1);
    const shardScore = ecWeight + paid + siteBonus;
    const proMultiplier = voteMembershipMultiplier(flags);
    const effective = shardScore * proMultiplier;
    const discordId = str(link.discord_user_id) || "";
    const rx = reactionBonus.get(discordId) || {
      quality_score: 0,
      good_count: 0,
      bad_count: 0,
    };
    const bonus = Math.max(0, Number(rx.quality_score) || 0);
    const raw = effective + bonus;

    rows.push({
      minecraft_uuid: uuid,
      minecraft_username:
        str(link.minecraft_username) ||
        str(shared?.minecraft_username) ||
        str(playtime?.minecraft_username) ||
        null,
      discord_user_id: discordId || null,
      playtime_seconds: playtimeSeconds,
      gen1_playtime_seconds: shared?.gen1_seconds,
      gen2_playtime_seconds: shared?.gen2_seconds,
      net_worth: 0,
      stake: 0,
      total_votes: totalVotes,
      vote_points: shardScore,
      ec_vote_shard_count: ecWeight,
      paid_vote_shards: paid,
      pro_multiplier: proMultiplier,
      is_pro: isPro,
      is_lifetime: isLifetime,
      effective_vote_points: effective,
      ava_reaction_bonus: Math.round(bonus * 100) / 100,
      ava_reaction_good: Math.max(0, Math.floor(Number(rx.good_count) || 0)),
      ava_reaction_bad: Math.max(0, Math.floor(Number(rx.bad_count) || 0)),
      site_multiplier: siteMult,
      raw_weight: Math.round(raw * 100) / 100,
      share_percent: 0,
      sites_voted: sites,
    });
  }

  applyAlexToAvaVoteTransfer(rows);

  const totalRaw = rows.reduce((s, r) => s + r.raw_weight, 0);
  for (const row of rows) {
    row.share_percent =
      totalRaw > 0 ? Math.round((row.raw_weight / totalRaw) * 10000) / 100 : 0;
  }

  rows.sort((a, b) => b.share_percent - a.share_percent || b.raw_weight - a.raw_weight);
  return { eligible_count: rows.length, total_raw: totalRaw, rows };
}

async function loadAvaReactionBonuses(
  db: D1Database,
): Promise<
  Map<string, { quality_score: number; good_count: number; bad_count: number }>
> {
  const map = new Map<
    string,
    { quality_score: number; good_count: number; bad_count: number }
  >();
  try {
    const { results } = await db
      .prepare(
        `SELECT discord_user_id, quality_score, good_count, bad_count
         FROM rootmc_ava_reaction_vote_factor`,
      )
      .all<{
        discord_user_id: string;
        quality_score: number;
        good_count: number;
        bad_count: number;
      }>();
    for (const r of results || []) {
      const id = str(r.discord_user_id);
      if (!id) continue;
      map.set(id, {
        quality_score: Math.max(0, Number(r.quality_score) || 0),
        good_count: Math.max(0, Math.floor(Number(r.good_count) || 0)),
        bad_count: Math.max(0, Math.floor(Number(r.bad_count) || 0)),
      });
    }
  } catch {
    // Table may not exist until migration 0165 is applied
  }
  return map;
}

export function formatGovernancePowerLine(row: GovernancePowerRow): string {
  const tier =
    row.is_pro && row.is_lifetime
      ? `Pro+Life ×${row.pro_multiplier}`
      : row.is_lifetime
        ? `Lifetime ×${row.pro_multiplier}`
        : row.is_pro
          ? `Pro ×${row.pro_multiplier}`
          : "";
  const rx =
    Number(row.ava_reaction_bonus) > 0 ? ` · +${row.ava_reaction_bonus} Ava` : "";
  const bits = [
    `score ${row.vote_points}`,
    tier || null,
    rx ? rx.replace(/^ · /, "") : null,
    `${row.share_percent}%`,
  ].filter(Boolean);
  return bits.join(" · ");
}

export async function upsertAvaReactionVoteFactors(
  db: D1Database,
  factors: Array<{
    discord_user_id: string;
    good_count?: number;
    bad_count?: number;
    neutral_count?: number;
    quality_score?: number;
  }>,
): Promise<{ upserted: number }> {
  let upserted = 0;
  for (const f of factors || []) {
    const id = str(f.discord_user_id);
    if (!id) continue;
    const good = Math.max(0, Math.floor(Number(f.good_count) || 0));
    const bad = Math.max(0, Math.floor(Number(f.bad_count) || 0));
    const neutral = Math.max(0, Math.floor(Number(f.neutral_count) || 0));
    const score = Math.max(0, Math.min(3, Number(f.quality_score) || 0));
    await db
      .prepare(
        `INSERT INTO rootmc_ava_reaction_vote_factor
           (discord_user_id, good_count, bad_count, neutral_count, quality_score, updated_at)
         VALUES (?, ?, ?, ?, ?, datetime('now'))
         ON CONFLICT(discord_user_id) DO UPDATE SET
           good_count = excluded.good_count,
           bad_count = excluded.bad_count,
           neutral_count = excluded.neutral_count,
           quality_score = excluded.quality_score,
           updated_at = datetime('now')`,
      )
      .bind(id, good, bad, neutral, score)
      .run();
    upserted += 1;
  }
  return { upserted };
}

export function formatHours(seconds: number): string {
  const h = Math.floor(Math.max(0, seconds) / 3600);
  const m = Math.floor((Math.max(0, seconds) % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

export function isGovernanceEligible(row: GovernancePowerRow | null): boolean {
  return row != null && row.share_percent > 0;
}

/** @deprecated Renamed — use canonicalListingSiteId from rootmc-listing-sites. */
export function siteBonusForService(service: string): number {
  return canonicalListingSiteId(service) ? 1 : 0;
}

/** @deprecated Vote points use total vote count, not distinct sites. */
export function computeSiteMultiplier(services: string[]): number {
  return votePointsFromTotalVotes(services.length);
}

export { VOTE_POINT_BASELINE, LISTING_SITE_MAX_POINTS };
