/**
 * Sunday 10:00 HST  -  combined Discord + in-game weekly awards (roles reset each week).
 */

import type { D1Database } from "@cloudflare/workers-types";

import {
  addGuildMemberRole,
  discordBotFetch,
  removeGuildMemberRole,
} from "./discord-rootmc-api";
import { resolveDiscordChannel } from "./rootmc-discord-channels";
import {
  weeklyActiveParticipantWinners,
  formatParticipatorScoreLine,
  type ActiveParticipantWinner,
  type RootMcActiveParticipantEnv,
} from "./rootmc-active-participant";
import { MIN_ACTIVITY_SCORE, TOP_PARTICIPATOR_N } from "./rootmc-activity-scoring";
import { hstWeekBoundsMs, previousHstWeekKey } from "./rootmc-hst-week";
import { resolveServerId } from "./rootmc-daily-report";
import {
  capturePlaytimeWeekSnapshots,
  seedPlaytimeBaselineIfNeeded,
  weeklyTopActivePlayerWinners,
  grantWeeklyProMembership,
  revokeWeeklyProIfNotReturning,
  TOP_ACTIVE_N,
  type TopActivePlayerWinner,
  MIN_WEEKLY_SECONDS,
} from "./rootmc-top-active-player";

export type RootMcWeeklyActivityAwardsEnv = RootMcActiveParticipantEnv & {
  DISCORD_ROOTMC_TOP_ACTIVE_PLAYER_ROLE_ID?: string;
};

function str(v: unknown): string {
  return String(v ?? "").trim();
}

function nowIso(): string {
  return new Date().toISOString();
}

function mention(userId: string): string {
  return `<@${userId}>`;
}

export async function weeklyActivityAwardsPosted(db: D1Database, weekKey: string): Promise<boolean> {
  const row = await db
    .prepare(`SELECT 1 FROM rootmc_weekly_activity_awards WHERE week_key = ? LIMIT 1`)
    .bind(weekKey)
    .first();
  return Boolean(row);
}

async function resetWeeklyActivityAwardsForRepost(
  env: RootMcWeeklyActivityAwardsEnv,
  weekKey: string,
): Promise<void> {
  const token = str(env.DISCORD_ROOTMC_BOT_TOKEN);
  const guildId = str(env.DISCORD_ROOTMC_GUILD_ID);
  const channelId = resolveDiscordChannel(env, "general", { allowBlank: true });
  const participantRoleId = str(env.DISCORD_ROOTMC_ACTIVE_PARTICIPANT_ROLE_ID);
  const playtimeRoleId = str(env.DISCORD_ROOTMC_TOP_ACTIVE_PLAYER_ROLE_ID);

  if (!token || !guildId) return;

  // Delete prior award message(s) from #general-chat before re-posting.
  if (channelId) {
    try {
      const msgRows = await env.DB.prepare(
        `SELECT message_id FROM rootmc_weekly_activity_awards
         WHERE week_key = ? AND message_id IS NOT NULL AND length(trim(message_id)) > 0`,
      )
        .bind(weekKey)
        .all<{ message_id: string }>();
      for (const row of msgRows.results || []) {
        const mid = str(row.message_id);
        if (!mid) continue;
        try {
          await discordBotFetch(
            token,
            `/channels/${encodeURIComponent(channelId)}/messages/${encodeURIComponent(mid)}`,
            { method: "DELETE" },
          );
        } catch (e) {
          console.warn(
            JSON.stringify({
              msg: "rootmc_weekly_awards_delete_failed",
              weekKey,
              messageId: mid,
              detail: e instanceof Error ? e.message : String(e),
            }),
          );
        }
      }
    } catch (e) {
      console.warn(
        JSON.stringify({
          msg: "rootmc_weekly_awards_message_lookup_failed",
          weekKey,
          detail: e instanceof Error ? e.message : String(e),
        }),
      );
    }
  }

  const partRows = await env.DB.prepare(
    `SELECT discord_user_id FROM rootmc_active_participant_awards WHERE week_key = ? AND role_granted = 1`,
  )
    .bind(weekKey)
    .all<{ discord_user_id: string }>();

  const ptRows = await env.DB.prepare(
    `SELECT discord_user_id FROM rootmc_top_active_player_awards WHERE week_key = ? AND role_granted = 1`,
  )
    .bind(weekKey)
    .all<{ discord_user_id: string }>();

  for (const row of partRows.results || []) {
    const uid = str(row.discord_user_id);
    if (!uid) continue;
    await removeGuildMemberRole(token, guildId, uid, participantRoleId);
  }
  for (const row of ptRows.results || []) {
    const uid = str(row.discord_user_id);
    if (!uid) continue;
    await removeGuildMemberRole(token, guildId, uid, playtimeRoleId);
  }

  await env.DB.prepare(`DELETE FROM rootmc_active_participant_awards WHERE week_key = ?`).bind(weekKey).run();
  await env.DB.prepare(`DELETE FROM rootmc_top_active_player_awards WHERE week_key = ?`).bind(weekKey).run();
  await env.DB.prepare(`DELETE FROM rootmc_weekly_activity_awards WHERE week_key = ?`).bind(weekKey).run();
  await env.DB.prepare(
    `DELETE FROM rootmc_weekly_activity_ai_runs WHERE week_key = ? AND kind = 'discord_participator'`,
  )
    .bind(weekKey)
    .run();
}

function splitDiscordContent(text: string, maxLen = 2000): string[] {
  if (text.length <= maxLen) return [text];
  const chunks: string[] = [];
  let rest = text;
  while (rest.length > maxLen) {
    let cut = rest.lastIndexOf("\n", maxLen);
    if (cut < Math.floor(maxLen * 0.4)) cut = maxLen;
    chunks.push(rest.slice(0, cut));
    rest = rest.slice(cut).replace(/^\n+/, "");
  }
  if (rest.length > 0) chunks.push(rest);
  return chunks;
}

async function postDiscordContent(token: string, channelId: string, content: string): Promise<string | null> {
  const chunks = splitDiscordContent(content);
  let firstId: string | null = null;
  for (const chunk of chunks) {
    const postRes = await discordBotFetch(token, `/channels/${encodeURIComponent(channelId)}/messages`, {
      method: "POST",
      body: JSON.stringify({ content: chunk }),
    });
    if (!postRes.ok) {
      const errBody = await postRes.text().catch(() => "");
      throw new Error(`discord post failed ${postRes.status}: ${errBody.slice(0, 200)}`);
    }
    const posted = (await postRes.json().catch(() => ({}))) as { id?: string };
    const messageId = str(posted.id) || null;
    if (!firstId && messageId) firstId = messageId;
  }
  return firstId;
}

async function revokeRoleIdsFromTable(
  db: D1Database,
  token: string,
  guildId: string,
  roleId: string,
  table: "rootmc_active_participant_awards" | "rootmc_top_active_player_awards",
  previousWeekKey: string,
): Promise<void> {
  const rows = await db
    .prepare(`SELECT discord_user_id FROM ${table} WHERE week_key = ? AND role_granted = 1`)
    .bind(previousWeekKey)
    .all<{ discord_user_id: string }>();

  for (const row of rows.results || []) {
    const uid = str(row.discord_user_id);
    if (!uid) continue;
    await removeGuildMemberRole(token, guildId, uid, roleId);
  }
}

function buildCombinedPost(
  weekKey: string,
  discordWinners: ActiveParticipantWinner[],
  playtimeWinners: TopActivePlayerWinner[],
  participantRoleId: string,
  playtimeRoleId: string,
  playtimeBaselineSeeded: boolean,
  proGrantedCount: number,
): string {
  const { startMs, endMs } = hstWeekBoundsMs(weekKey);
  const startLabel = new Date(startMs).toLocaleDateString("en-US", {
    timeZone: "Pacific/Honolulu",
    month: "short",
    day: "numeric",
  });
  const endLabel = new Date(endMs).toLocaleDateString("en-US", {
    timeZone: "Pacific/Honolulu",
    month: "short",
    day: "numeric",
    year: "numeric",
  });

  const lines = [
    `# 🏅 Weekly Activity Awards  -  Week of ${weekKey}`,
    "",
    `**Period:** ${startLabel} - ${endLabel} (Mon-Sun, **HST**). Roles **reset every Sunday 10:00 HST**.`,
    "",
    "## 💬 Top Participator (Discord)",
    "",
    "**How we measured it**",
    "- **Message blocks**  -  1 pt each (consecutive posts until someone else speaks)",
    "- **Votes**  -  5 pts each (`/proposal`)",
    "- **Reactions**  -  1 pt each",
    "- Root-AI reviews saved activity and excludes spam before final ranks",
    `- **Top ${TOP_PARTICIPATOR_N}** by score earn the role (listed even below ${MIN_ACTIVITY_SCORE} pts when fewer qualify)`,
    "",
  ];

  if (discordWinners.length === 0) {
    lines.push("_No qualifying Discord activity this week._");
  } else {
    if (discordWinners.length < TOP_PARTICIPATOR_N) {
      lines.push(
        `_Only **${discordWinners.length}** participant(s) had scored Discord activity this week (up to **${TOP_PARTICIPATOR_N}** listed)._`,
        "",
      );
    }
    discordWinners.forEach((w, i) => {
      lines.push(
        `${i + 1}. ${mention(w.discord_user_id)} (**${w.display_name}**)  -  ${formatParticipatorScoreLine(w)}`,
      );
    });
    lines.push("", `Role: <@&${participantRoleId}>`);
  }

  lines.push("", "## ⛏ Top Active Players (In-game)", "", "**How we measured it**");
  lines.push(
    "- **Playtime this week**  -  delta from RootStat sync (end minus prior Sunday snapshot)",
    `- Linked Minecraft + Discord; minimum **${Math.floor(MIN_WEEKLY_SECONDS / 3600)} hour** this week`,
    `- **Top ${TOP_ACTIVE_N}** earn the Discord role + in-game \`[Top Active Player]\` prefix`,
    `- **#1 only** also gets **one-week Pro membership** (app + in-game \`[Pro]\` prefix)`,
    `- Must be **linked** at [rootmc.net](https://rootmc.net/account) (Minecraft + Discord)`,
    `- Last week's #1 Pro is **removed** if they are not #1 again (paid / life Pro stays)`,
  );

  if (playtimeBaselineSeeded) {
    lines.push("", "_First playtime baseline captured  -  in-game awards start next week._");
  } else if (playtimeWinners.length === 0) {
    lines.push("", "_No qualifying linked players met the playtime threshold this week._");
  } else {
    if (playtimeWinners.length < TOP_ACTIVE_N) {
      lines.push(
        "",
        `_Only **${playtimeWinners.length}** linked player(s) met the ${Math.floor(MIN_WEEKLY_SECONDS / 3600)}-hour threshold this week (up to **${TOP_ACTIVE_N}** awarded)._`,
      );
    }
    playtimeWinners.forEach((w) => {
      lines.push(
        `${w.rank}. ${mention(w.discord_user_id)} (**${w.minecraft_username}**)  -  **${w.weekly_playtime_label}** in-game`,
      );
    });
    lines.push("", `Role: <@&${playtimeRoleId}>`);
    if (proGrantedCount > 0) {
      lines.push(`Pro membership extended for the **#1** Top Active Player (7 days).`);
    }
  }

  lines.push(
    "",
    "_Discord: message blocks + votes + reactions in D1, judged by Root-AI. In-game: playtime snapshots._",
  );

  return lines.join("\n");
}

export async function runRootMcWeeklyActivityAwards(
  env: RootMcWeeklyActivityAwardsEnv,
  weekKey: string,
  options?: { force?: boolean },
): Promise<{
  ok: boolean;
  detail?: string;
  messageId?: string;
  discordWinners?: ActiveParticipantWinner[];
  playtimeWinners?: TopActivePlayerWinner[];
}> {
  const token = str(env.DISCORD_ROOTMC_BOT_TOKEN);
  const guildId = str(env.DISCORD_ROOTMC_GUILD_ID);
  const channelId = resolveDiscordChannel(env, "general", { allowBlank: true });
  const participantRoleId = str(env.DISCORD_ROOTMC_ACTIVE_PARTICIPANT_ROLE_ID);
  const playtimeRoleId = str(env.DISCORD_ROOTMC_TOP_ACTIVE_PLAYER_ROLE_ID);

  if (!token || !guildId || !channelId || !participantRoleId || !playtimeRoleId) {
    return { ok: false, detail: "missing bot, guild, general-chat, or reward role ids" };
  }

  if (await weeklyActivityAwardsPosted(env.DB, weekKey)) {
    if (!options?.force) {
      return { ok: true, detail: "already posted" };
    }
    await resetWeeklyActivityAwardsForRepost(env, weekKey);
    console.warn(JSON.stringify({ msg: "rootmc_weekly_awards_force_reset", weekKey }));
  }

  // Claim the week row BEFORE Discord post so concurrent cron retries cannot triple-post.
  // message_id starts as "pending"; overwritten after a successful post.
  try {
    await env.DB.prepare(
      `INSERT INTO rootmc_weekly_activity_awards (week_key, posted_at, message_id) VALUES (?, ?, ?)`,
    )
      .bind(weekKey, nowIso(), "pending")
      .run();
  } catch (claimErr) {
    // Unique week_key (or race) — another invocation already claimed / posted.
    if (await weeklyActivityAwardsPosted(env.DB, weekKey)) {
      return { ok: true, detail: "already posted (claim race)" };
    }
    const detail = claimErr instanceof Error ? claimErr.message : String(claimErr);
    console.warn(JSON.stringify({ msg: "rootmc_weekly_awards_claim_failed", weekKey, detail }));
    return { ok: false, detail: `claim failed: ${detail}` };
  }

  const existingParticipant = await env.DB.prepare(
    `SELECT 1 FROM rootmc_active_participant_awards WHERE week_key = ? LIMIT 1`,
  )
    .bind(weekKey)
    .first();
  if (existingParticipant) {
    await env.DB.prepare(`DELETE FROM rootmc_active_participant_awards WHERE week_key = ?`)
      .bind(weekKey)
      .run();
    await env.DB.prepare(`DELETE FROM rootmc_top_active_player_awards WHERE week_key = ?`)
      .bind(weekKey)
      .run();
    console.warn(JSON.stringify({ msg: "rootmc_weekly_awards_partial_reset", weekKey }));
  }

  const serverId = await resolveServerId(env.DB);
  const prevWeek = previousHstWeekKey(weekKey);

  const playtimeBaselineSeeded = await seedPlaytimeBaselineIfNeeded(env.DB, serverId, weekKey);
  await capturePlaytimeWeekSnapshots(env.DB, serverId, weekKey);

  const discordWinners = await weeklyActiveParticipantWinners(env.DB, env, weekKey);
  const playtimeWinners = playtimeBaselineSeeded
    ? []
    : await weeklyTopActivePlayerWinners(env.DB, serverId, weekKey);

  if (discordWinners.length === 0 && playtimeWinners.length === 0 && !playtimeBaselineSeeded) {
    console.warn(JSON.stringify({ msg: "rootmc_weekly_awards_skipped", weekKey, detail: "no qualifying winners" }));
    return { ok: false, detail: "no qualifying winners this week" };
  }

  await revokeRoleIdsFromTable(
    env.DB,
    token,
    guildId,
    participantRoleId,
    "rootmc_active_participant_awards",
    prevWeek,
  );
  await revokeRoleIdsFromTable(
    env.DB,
    token,
    guildId,
    playtimeRoleId,
    "rootmc_top_active_player_awards",
    prevWeek,
  );

  const proRevokedCount = await revokeWeeklyProIfNotReturning(env.DB, prevWeek, playtimeWinners).catch(
    (e) => {
      console.error(
        "rootmc_weekly_pro_revoke_failed",
        e instanceof Error ? e.message : String(e),
      );
      return 0;
    },
  );
  if (proRevokedCount > 0) {
    console.warn(
      JSON.stringify({ msg: "rootmc_weekly_pro_revoked", weekKey, prevWeek, cleared: proRevokedCount }),
    );
  }

  const proGrantedCount =
    playtimeWinners.length > 0
      ? await grantWeeklyProMembership(env.DB, playtimeWinners).catch((e) => {
          console.error(
            "rootmc_weekly_pro_grant_failed",
            e instanceof Error ? e.message : String(e),
          );
          return 0;
        })
      : 0;

  const content = buildCombinedPost(
    weekKey,
    discordWinners,
    playtimeWinners,
    participantRoleId,
    playtimeRoleId,
    playtimeBaselineSeeded,
    proGrantedCount,
  );

  let messageId: string | null;
  try {
    messageId = await postDiscordContent(token, channelId, content);
  } catch (postErr) {
    const detail = postErr instanceof Error ? postErr.message : String(postErr);
    console.error(JSON.stringify({ msg: "rootmc_weekly_awards_discord_post_failed", weekKey, detail }));
    // Release claim so the 10-min retry can try again
    await env.DB.prepare(`DELETE FROM rootmc_weekly_activity_awards WHERE week_key = ? AND message_id = ?`)
      .bind(weekKey, "pending")
      .run()
      .catch(() => null);
    return { ok: false, detail };
  }
  const ts = nowIso();

  await env.DB.prepare(
    `UPDATE rootmc_weekly_activity_awards SET posted_at = ?, message_id = ? WHERE week_key = ?`,
  )
    .bind(ts, messageId, weekKey)
    .run();

  for (let i = 0; i < discordWinners.length; i++) {
    const w = discordWinners[i];
    const roleOk = await addGuildMemberRole(token, guildId, w.discord_user_id, participantRoleId);
    if (!roleOk) {
      console.error(
        JSON.stringify({
          msg: "rootmc_weekly_awards_participant_role_failed",
          weekKey,
          discord_user_id: w.discord_user_id,
        }),
      );
    }
    await env.DB.prepare(
      `INSERT INTO rootmc_active_participant_awards
         (week_key, discord_user_id, rank, message_count, vote_count, reaction_count, activity_score,
          username, role_granted, posted_at, message_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        weekKey,
        w.discord_user_id,
        i + 1,
        w.message_count,
        w.vote_count,
        w.reaction_count,
        w.activity_score,
        w.display_name,
        roleOk ? 1 : 0,
        ts,
        messageId,
      )
      .run();
  }

  for (const w of playtimeWinners) {
    const roleOk = await addGuildMemberRole(token, guildId, w.discord_user_id, playtimeRoleId);
    if (!roleOk) {
      console.error(
        JSON.stringify({
          msg: "rootmc_weekly_awards_playtime_role_failed",
          weekKey,
          discord_user_id: w.discord_user_id,
          minecraft_uuid: w.minecraft_uuid,
        }),
      );
    }
    await env.DB.prepare(
      `INSERT INTO rootmc_top_active_player_awards
         (week_key, minecraft_uuid, discord_user_id, weekly_playtime_seconds, minecraft_username,
          discord_display_name, rank, pro_granted, role_granted, posted_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        weekKey,
        w.minecraft_uuid,
        w.discord_user_id,
        w.weekly_playtime_seconds,
        w.minecraft_username,
        w.discord_display_name,
        w.rank,
        w.pro_granted ? 1 : 0,
        roleOk ? 1 : 0,
        ts,
      )
      .run();
  }

  return {
    ok: true,
    detail: playtimeBaselineSeeded ? "posted (playtime baseline seeded)" : "posted",
    messageId: messageId || undefined,
    discordWinners,
    playtimeWinners,
  };
}
