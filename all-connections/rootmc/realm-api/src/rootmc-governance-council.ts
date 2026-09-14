/**
 * Council of Voters role  -  linked accounts with governance eligibility.
 */

import type { D1Database } from "@cloudflare/workers-types";

import { addGuildMemberRole, removeGuildMemberRole } from "./discord-rootmc-api";
import {
  computeGovernancePowerSnapshot,
  governancePowerForUuid,
  isGovernanceEligible,
} from "./rootmc-governance-voting";
import { resolveServerId } from "./rootmc-daily-report";
import type { RootMcHyperdriveEnv } from "./rootmc-hyperdrive";

export type CouncilVotersEnv = {
  DB: D1Database;
  DISCORD_ROOTMC_BOT_TOKEN?: string;
  DISCORD_ROOTMC_GUILD_ID?: string;
  DISCORD_ROOTMC_COUNCIL_VOTERS_ROLE_ID?: string;
} & RootMcHyperdriveEnv;

function str(v: unknown): string {
  return String(v ?? "").trim();
}

export async function syncCouncilVotersRoleForDiscordUser(
  env: CouncilVotersEnv,
  discordUserId: string,
): Promise<{ granted: boolean; sharePercent?: number }> {
  const token = str(env.DISCORD_ROOTMC_BOT_TOKEN);
  const guildId = str(env.DISCORD_ROOTMC_GUILD_ID);
  const roleId = str(env.DISCORD_ROOTMC_COUNCIL_VOTERS_ROLE_ID);
  if (!token || !guildId || !roleId || !discordUserId) {
    return { granted: false };
  }

  const link = await env.DB.prepare(
    `SELECT m.minecraft_uuid FROM rootstat_minecraft_links m
     INNER JOIN discord_account_links d ON d.account_id = m.account_id
     WHERE d.discord_user_id = ? LIMIT 1`,
  )
    .bind(discordUserId)
    .first<{ minecraft_uuid: string }>();

  const uuid = str(link?.minecraft_uuid);
  if (!uuid) {
    await removeGuildMemberRole(token, guildId, discordUserId, roleId);
    return { granted: false };
  }

  const serverId = await resolveServerId(env.DB);
  const power = await governancePowerForUuid(env.DB, serverId, uuid, undefined, env);
  const eligible = isGovernanceEligible(power);

  if (eligible) {
    await addGuildMemberRole(token, guildId, discordUserId, roleId);
    return { granted: true, sharePercent: power?.share_percent };
  }
  await removeGuildMemberRole(token, guildId, discordUserId, roleId);
  return { granted: false, sharePercent: power?.share_percent };
}

export async function syncAllCouncilVotersRoles(env: CouncilVotersEnv): Promise<number> {
  const token = str(env.DISCORD_ROOTMC_BOT_TOKEN);
  const guildId = str(env.DISCORD_ROOTMC_GUILD_ID);
  const roleId = str(env.DISCORD_ROOTMC_COUNCIL_VOTERS_ROLE_ID);
  if (!token || !guildId || !roleId) return 0;

  const serverId = await resolveServerId(env.DB);
  const snap = await computeGovernancePowerSnapshot(env.DB, serverId, env);
  let granted = 0;
  for (const row of snap.rows) {
    const uid = str(row.discord_user_id);
    if (!uid) continue;
    await addGuildMemberRole(token, guildId, uid, roleId);
    granted++;
  }
  return granted;
}
