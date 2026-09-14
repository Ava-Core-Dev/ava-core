/**
 * HTTP routes  -  governance voting power for linked players.
 */

import type { D1Database } from "@cloudflare/workers-types";

import { json } from "./cors";
import { resolveLinkedPlayerByDiscord } from "./discord-rootmc-economy";
import { resolveServerId } from "./rootmc-daily-report";
import {
  computeGovernancePowerSnapshot,
  formatGovernancePowerLine,
  governancePowerForDiscordId,
  governancePowerForUuid,
  isGovernanceEligible,
  upsertAvaReactionVoteFactors,
  AVA_COUNCIL_DISCORD_ID,
} from "./rootmc-governance-voting";
import { syncCouncilVotersRoleForDiscordUser } from "./rootmc-governance-council";
import type { RootMcHyperdriveEnv } from "./rootmc-hyperdrive";
import { validateDevWorkstationAuth } from "./rootmc-dev-workstation";

export type GovernanceRoutesEnv = {
  DB: D1Database;
  DISCORD_ROOTMC_VOTING_CHANNEL_ID?: string;
  DISCORD_ROOTMC_GUILD_ID?: string;
  SITE_URL?: string;
  ROOTMC_DEV_WORKSTATION_KEY?: string;
} & Parameters<typeof syncCouncilVotersRoleForDiscordUser>[0] &
  RootMcHyperdriveEnv;

function str(v: unknown): string {
  return String(v ?? "").trim();
}

export async function handleGovernanceRoutes(
  request: Request,
  env: GovernanceRoutesEnv,
  sub: string,
  method: string,
): Promise<Response | null> {
  // Ava workstation: sync reaction → vote-factor bonuses
  if (method === "POST" && sub === "governance/ava-reaction-factors") {
    if (!validateDevWorkstationAuth(request, env)) {
      return json({ ok: false, detail: "unauthorized" }, 401);
    }
    let body: { factors?: unknown } = {};
    try {
      body = (await request.json()) as { factors?: unknown };
    } catch {
      return json({ ok: false, detail: "invalid_json" }, 400);
    }
    const factors = Array.isArray(body.factors) ? body.factors : [];
    try {
      const result = await upsertAvaReactionVoteFactors(
        env.DB,
        factors as Array<{
          discord_user_id: string;
          good_count?: number;
          bad_count?: number;
          neutral_count?: number;
          quality_score?: number;
        }>,
      );
      return json({ ok: true, ...result });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return json({ ok: false, detail: msg }, 500);
    }
  }

  if (method !== "GET") return null;

  const votingChannelId = str(env.DISCORD_ROOTMC_VOTING_CHANNEL_ID);
  const votingChannelUrl = votingChannelId
    ? `https://discord.com/channels/${str(env.DISCORD_ROOTMC_GUILD_ID) || "1516108585740800042"}/${votingChannelId}`
    : "https://rootmc.net/wiki/constitution/#governance-voting";

  if (sub === "governance/voting-power") {
    const url = new URL(request.url);
    const uuid = str(url.searchParams.get("uuid"));
    const discordUserId = str(url.searchParams.get("discord_user_id"));
    const serverId = await resolveServerId(env.DB);

    let targetUuid = uuid;
    let power = null as Awaited<ReturnType<typeof governancePowerForUuid>>;
    if (!targetUuid && discordUserId === AVA_COUNCIL_DISCORD_ID) {
      power = await governancePowerForDiscordId(env.DB, serverId, AVA_COUNCIL_DISCORD_ID, undefined, env);
      targetUuid = power?.minecraft_uuid || "";
    } else if (!targetUuid && discordUserId) {
      const linked = await resolveLinkedPlayerByDiscord(env.DB, discordUserId);
      targetUuid = str(linked?.minecraftUuid);
    }
    if (!targetUuid && !power) {
      return json({ ok: false, eligible: false, detail: "not_linked" }, 404);
    }

    if (!power) {
      power = await governancePowerForUuid(env.DB, serverId, targetUuid, undefined, env);
    }
    const eligible = isGovernanceEligible(power);
    const openPolls = await env.DB.prepare(
      `SELECT id, title FROM rootmc_community_proposals
       WHERE status = 'open' AND closes_at > datetime('now')
       ORDER BY created_at DESC LIMIT 10`,
    ).all<{ id: string; title: string }>();
    const polls = (openPolls.results || []).map((p) => ({
      id: str(p.id),
      title: str(p.title),
      url: `https://rootmc.net/governance/vote/?id=${encodeURIComponent(str(p.id))}`,
    }));
    return json({
      ok: true,
      eligible,
      minecraft_uuid: targetUuid,
      minecraft_username: power?.minecraft_username ?? null,
      discord_user_id: power?.discord_user_id ?? (discordUserId || null),
      share_percent: power?.share_percent ?? 0,
      playtime_seconds: power?.playtime_seconds ?? 0,
      gen1_playtime_seconds: power?.gen1_playtime_seconds ?? 0,
      gen2_playtime_seconds: power?.gen2_playtime_seconds ?? 0,
      net_worth: power?.net_worth ?? 0,
      site_multiplier: power?.site_multiplier ?? 1,
      total_votes: power?.total_votes ?? 0,
      vote_points: power?.vote_points ?? 1,
      is_pro: power?.is_pro ?? false,
      is_lifetime: power?.is_lifetime ?? false,
      pro_multiplier: power?.pro_multiplier ?? 1,
      effective_vote_points: power?.effective_vote_points ?? power?.vote_points ?? 1,
      ec_vote_shard_count: power?.ec_vote_shard_count ?? power?.vote_points ?? 0,
      ava_reaction_bonus: power?.ava_reaction_bonus ?? 0,
      ava_reaction_good: power?.ava_reaction_good ?? 0,
      ava_reaction_bad: power?.ava_reaction_bad ?? 0,
      sites_voted: power?.sites_voted ?? [],
      open_polls_count: polls.length,
      open_polls: polls,
      proposal_vote_reward_g: 3,
      voting_channel_id: votingChannelId || null,
      voting_channel_url: votingChannelUrl,
      constitution_url: "https://rootmc.net/wiki/constitution/#governance-voting",
      council_url: "https://rootmc.net/council/",
      summary: power ? formatGovernancePowerLine(power) : null,
    });
  }

  if (sub === "governance/leaderboard") {
    const serverId = await resolveServerId(env.DB);
    const snap = await computeGovernancePowerSnapshot(env.DB, serverId, env);
    return json({
      ok: true,
      eligible_count: snap.eligible_count,
      leaders: snap.rows.slice(0, 25).map((r) => ({
        minecraft_username: r.minecraft_username,
        share_percent: r.share_percent,
        ava_reaction_bonus: r.ava_reaction_bonus ?? 0,
        playtime_seconds: r.playtime_seconds,
        vote_points: r.vote_points,
        ec_vote_shard_count: r.ec_vote_shard_count,
        effective_vote_points: r.effective_vote_points,
        is_pro: r.is_pro,
        is_lifetime: r.is_lifetime,
        pro_multiplier: r.pro_multiplier,
        total_votes: r.total_votes,
        site_multiplier: r.site_multiplier,
      })),
    });
  }

  return null;
}

export async function handleGovernanceDiscordVote(
  env: GovernanceRoutesEnv,
  discordUserId: string,
): Promise<string> {
  if (discordUserId === AVA_COUNCIL_DISCORD_ID) {
    const serverId = await resolveServerId(env.DB);
    const power = await governancePowerForDiscordId(env.DB, serverId, AVA_COUNCIL_DISCORD_ID, undefined, env);
    const votingChannelId = str(env.DISCORD_ROOTMC_VOTING_CHANNEL_ID);
    const channelNote = votingChannelId ? `<#${votingChannelId}>` : "**#voting**";
    if (!isGovernanceEligible(power)) {
      return "Ava Ivy seat is not on the Council snapshot yet (needs Ava 25% locked seat (one-third sum of all others)).";
    }
    return [
      `**Governance voting power**  -  Ava Ivy (Ava 25% locked seat)`,
      "",
      formatGovernancePowerLine(power!),
      "",
      `Share: **${power!.share_percent.toFixed(3)}%**`,
      `Official polls: ${channelNote}  -  Ava casts by **text** only (no buttons).`,
    ].join("\n");
  }

  const linked = await resolveLinkedPlayerByDiscord(env.DB, discordUserId);
  if (!linked?.minecraftUuid) {
    return "Link Minecraft at **https://rootmc.net/verify** before checking governance voting power.";
  }

  const serverId = await resolveServerId(env.DB);
  const power = await governancePowerForUuid(env.DB, serverId, linked.minecraftUuid, undefined, env);
  const votingChannelId = str(env.DISCORD_ROOTMC_VOTING_CHANNEL_ID);
  const channelNote = votingChannelId ? `<#${votingChannelId}>` : "**#voting**";

  await syncCouncilVotersRoleForDiscordUser(env, discordUserId);

  if (!isGovernanceEligible(power)) {
    return [
      `**Governance voting power**  -  not eligible yet`,
      "",
      "Requires a **linked** account and **>=1 hour** playtime on RootMC.",
      "",
      `Listing sites (Gold + vote points): run \`/vote\` in-game or see https://rootmc.net/wiki/economy/#votes`,
      `Constitution: https://rootmc.net/wiki/constitution/#governance-voting`,
    ].join("\n");
  }

  return [
    `**Governance voting power**  -  ${str(linked.minecraftUsername) || "linked player"}`,
    "",
    formatGovernancePowerLine(power!),
    "",
    `Official polls: ${channelNote}  -  also at https://rootmc.net/council/`,
    "Vote with **text** (`for` / `against` / `abstain`) or on the site  -  weighted by your %. Buttons retired; Ava seeds vote_yes / vote_no / ➖ at open.",
    "Accept terms: https://rootmc.net/terms/  -  Policy: https://rootmc.net/wiki/constitution/#governance-voting",
  ].join("\n");
}
