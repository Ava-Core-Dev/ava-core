/**
 * Weekly Top Active Player  -  in-game playtime delta; top 3 earn role + [Top Active Player] prefix;
 * #1 only gets one-week Pro membership.
 */

import type { D1Database } from "@cloudflare/workers-types";

import { extendProRedeemedUntil, upsertUserAccountFromLicense } from "./accounts";
import { previousHstWeekKey } from "./rootmc-hst-week";
import { formatPlaytime } from "./rootmc-daily-report";
import { isExiledDiscordUser, sqlExiledDiscordNotInClause } from "./rootmc-exiled-discord";

export type RootMcTopActivePlayerEnv = {
  DB: D1Database;
};

const MIN_WEEKLY_SECONDS = 3600;
const TOP_ACTIVE_N = 3;
const WEEKLY_PRO_DAYS = 7;
/** Only rank 1 receives weekly award Pro. */
const WEEKLY_PRO_RANK = 1;

function str(v: unknown): string {
  return String(v ?? "").trim();
}

function nowIso(): string {
  return new Date().toISOString();
}

export type TopActivePlayerWinner = {
  minecraft_uuid: string;
  minecraft_username: string;
  discord_user_id: string;
  discord_display_name: string;
  weekly_playtime_seconds: number;
  weekly_playtime_label: string;
  rank: number;
  pro_granted: boolean;
};

export async function capturePlaytimeWeekSnapshots(
  db: D1Database,
  serverId: string,
  weekKey: string,
): Promise<number> {
  const rows = await db
    .prepare(
      `SELECT minecraft_uuid, minecraft_username, total_playtime_seconds
       FROM rootstat_player_playtime WHERE server_id = ?`,
    )
    .bind(serverId)
    .all<{
      minecraft_uuid: string;
      minecraft_username: string | null;
      total_playtime_seconds: number;
    }>();

  let count = 0;
  const ts = nowIso();
  for (const row of rows.results || []) {
    const uuid = str(row.minecraft_uuid).toLowerCase();
    if (!uuid) continue;
    await db
      .prepare(
        `INSERT INTO rootmc_playtime_week_snapshots
           (server_id, week_key, minecraft_uuid, minecraft_username, total_playtime_seconds, snapshot_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(server_id, week_key, minecraft_uuid) DO UPDATE SET
           minecraft_username = excluded.minecraft_username,
           total_playtime_seconds = excluded.total_playtime_seconds,
           snapshot_at = excluded.snapshot_at`,
      )
      .bind(
        serverId,
        weekKey,
        uuid,
        str(row.minecraft_username) || null,
        Math.max(0, Math.floor(Number(row.total_playtime_seconds) || 0)),
        ts,
      )
      .run();
    count += 1;
  }
  return count;
}

export async function playtimeBaselineExists(
  db: D1Database,
  serverId: string,
  weekKey: string,
): Promise<boolean> {
  const row = await db
    .prepare(`SELECT 1 FROM rootmc_playtime_week_snapshots WHERE server_id = ? AND week_key = ? LIMIT 1`)
    .bind(serverId, weekKey)
    .first();
  return Boolean(row);
}

/** Seed prior-week totals so the first award week measures real deltas only. */
export async function seedPlaytimeBaselineIfNeeded(
  db: D1Database,
  serverId: string,
  weekKey: string,
): Promise<boolean> {
  const prevWeek = previousHstWeekKey(weekKey);
  if (await playtimeBaselineExists(db, serverId, prevWeek)) {
    return false;
  }
  await capturePlaytimeWeekSnapshots(db, serverId, prevWeek);
  return true;
}

export async function weeklyTopActivePlayerWinners(
  db: D1Database,
  serverId: string,
  weekKey: string,
): Promise<TopActivePlayerWinner[]> {
  const prevWeek = previousHstWeekKey(weekKey);
  if (!(await playtimeBaselineExists(db, serverId, prevWeek))) {
    return [];
  }

  const rows = await db
    .prepare(
      `SELECT cur.minecraft_uuid,
              COALESCE(cur.minecraft_username, m.minecraft_username) AS minecraft_username,
              MAX(0, cur.total_playtime_seconds - COALESCE(prev.total_playtime_seconds, 0)) AS weekly_seconds,
              d.discord_user_id,
              COALESCE(d.discord_global_name, d.discord_username, d.discord_user_id) AS discord_display_name
       FROM rootmc_playtime_week_snapshots cur
       INNER JOIN rootstat_minecraft_links m ON LOWER(m.minecraft_uuid) = cur.minecraft_uuid
       INNER JOIN discord_account_links d ON d.account_id = m.account_id
       LEFT JOIN rootmc_playtime_week_snapshots prev
         ON prev.server_id = cur.server_id
        AND prev.minecraft_uuid = cur.minecraft_uuid
        AND prev.week_key = ?
       WHERE cur.server_id = ? AND cur.week_key = ?
         AND d.discord_user_id IS NOT NULL AND TRIM(d.discord_user_id) != ''
         AND ${sqlExiledDiscordNotInClause("d.discord_user_id")}
       GROUP BY cur.minecraft_uuid
       HAVING weekly_seconds >= ?
       ORDER BY weekly_seconds DESC, cur.minecraft_uuid ASC
       LIMIT ?`,
    )
    .bind(prevWeek, serverId, weekKey, MIN_WEEKLY_SECONDS, TOP_ACTIVE_N)
    .all<{
      minecraft_uuid: string;
      minecraft_username: string | null;
      weekly_seconds: number;
      discord_user_id: string;
      discord_display_name: string;
    }>();

  return (rows.results || [])
    .filter((row) => !isExiledDiscordUser(row.discord_user_id))
    .map((row, idx) => {
    const weeklySeconds = Math.max(0, Math.floor(Number(row.weekly_seconds) || 0));
    return {
      minecraft_uuid: str(row.minecraft_uuid).toLowerCase(),
      minecraft_username: str(row.minecraft_username) || "Unknown",
      discord_user_id: str(row.discord_user_id),
      discord_display_name: str(row.discord_display_name) || str(row.discord_user_id),
      weekly_playtime_seconds: weeklySeconds,
      weekly_playtime_label: formatPlaytime(weeklySeconds),
      rank: idx + 1,
      pro_granted: false,
    };
  });
}

/** @deprecated Use weeklyTopActivePlayerWinners  -  returns first winner or null. */
export async function weeklyTopActivePlayerWinner(
  db: D1Database,
  serverId: string,
  weekKey: string,
): Promise<TopActivePlayerWinner | null> {
  const winners = await weeklyTopActivePlayerWinners(db, serverId, weekKey);
  return winners[0] || null;
}

/** Grant one-week Pro membership (app) to the #1 Top Active Player only. */
export async function grantWeeklyProMembership(
  db: D1Database,
  winners: TopActivePlayerWinner[],
): Promise<number> {
  let granted = 0;
  for (const w of winners) {
    if (w.rank !== WEEKLY_PRO_RANK) {
      w.pro_granted = false;
      continue;
    }
    const link = await db
      .prepare(`SELECT email, account_id FROM discord_account_links WHERE discord_user_id = ? LIMIT 1`)
      .bind(w.discord_user_id)
      .first<{ email: string; account_id: string }>();
    const email = str(link?.email).toLowerCase();
    const accountId = str(link?.account_id);
    if (!email || !accountId) continue;

    await upsertUserAccountFromLicense(db, {
      email,
      account_id: accountId,
      pro_unlocked: false,
      life_member: false,
    });

    const life = await db
      .prepare(`SELECT life_member FROM user_accounts WHERE email = ? LIMIT 1`)
      .bind(email)
      .first<{ life_member: number }>();
    if (life && Number(life.life_member) === 1) {
      w.pro_granted = false;
      continue;
    }
    const until = await extendProRedeemedUntil(db, email, WEEKLY_PRO_DAYS);
    if (until) {
      w.pro_granted = true;
      granted += 1;
    }
  }
  return granted;
}

/**
 * Clear award Pro windows for last week's #1 who did not place #1 again.
 * Leaves paid {@code pro_unlocked} and life members untouched.
 */
export async function revokeWeeklyProIfNotReturning(
  db: D1Database,
  previousWeekKey: string,
  currentWinners: TopActivePlayerWinner[],
): Promise<number> {
  const keep = new Set(
    currentWinners
      .filter((w) => w.rank === WEEKLY_PRO_RANK)
      .map((w) => str(w.discord_user_id))
      .filter(Boolean),
  );
  const prev = await db
    .prepare(
      `SELECT discord_user_id FROM rootmc_top_active_player_awards
       WHERE week_key = ? AND pro_granted = 1`,
    )
    .bind(previousWeekKey)
    .all<{ discord_user_id: string }>();

  let cleared = 0;
  const clearedAt = nowIso();
  for (const row of prev.results || []) {
    const uid = str(row.discord_user_id);
    if (!uid || keep.has(uid)) continue;

    const link = await db
      .prepare(`SELECT email FROM discord_account_links WHERE discord_user_id = ? LIMIT 1`)
      .bind(uid)
      .first<{ email: string }>();
    const email = str(link?.email).toLowerCase();
    if (!email) continue;

    const acct = await db
      .prepare(
        `SELECT pro_unlocked, life_member, pro_paid_until FROM user_accounts WHERE email = ? LIMIT 1`,
      )
      .bind(email)
      .first<{ pro_unlocked: number; life_member: number; pro_paid_until: string | null }>();
    if (!acct) continue;
    if (Number(acct.life_member) === 1 || Number(acct.pro_unlocked) === 1) {
      continue;
    }
    const paidUntil = acct.pro_paid_until ? String(acct.pro_paid_until).trim() : "";
    if (paidUntil && Date.parse(paidUntil) > Date.now()) {
      continue;
    }

    await db
      .prepare(
        `UPDATE user_accounts SET pro_redeemed_until = ?, updated_at = ? WHERE email = ?`,
      )
      .bind(clearedAt, clearedAt, email)
      .run();
    cleared += 1;
  }
  return cleared;
}

export { formatPlaytime, MIN_WEEKLY_SECONDS, TOP_ACTIVE_N, WEEKLY_PRO_RANK };

/** True when uuid is among the latest posted week's top-N Top Active winners. */
export async function isCurrentTopActivePlayer(
  db: D1Database,
  minecraftUuid: string,
): Promise<boolean> {
  const uuid = str(minecraftUuid).toLowerCase();
  if (!uuid) return false;
  const latest = await db
    .prepare(
      `SELECT week_key FROM rootmc_weekly_activity_awards
       ORDER BY posted_at DESC LIMIT 1`,
    )
    .first<{ week_key: string }>();
  const weekKey = str(latest?.week_key);
  if (!weekKey) return false;
  const row = await db
    .prepare(
      `SELECT 1 AS ok FROM rootmc_top_active_player_awards
       WHERE week_key = ? AND minecraft_uuid = ? AND rank <= ?
       LIMIT 1`,
    )
    .bind(weekKey, uuid, TOP_ACTIVE_N)
    .first();
  return Boolean(row);
}
