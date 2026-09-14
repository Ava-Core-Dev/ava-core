import { readUserAccountAccessFlags } from "./accounts";
import { isAvaOperatorEmail, isServerGoalUser } from "./goal-constants";
import { SERVER_GOAL_EMAIL } from "../../shared/ava-shards";

export const FREE_MAX_GOALS = 3;
export const MEMBER_MAX_GOALS = 42;
export const FREE_AI_REFRESH_DAYS = 3;
export const MEMBER_AI_REFRESH_PER_GOAL_PER_DAY = 3;
export const MEMBER_AI_GOALS_PER_DAY = 10;

export function utcDayKey(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

export async function loadMemberFlags(
  db: D1Database,
  userId: string,
): Promise<{ member: boolean; maxGoals: number }> {
  if (!userId.startsWith("user:")) {
    return { member: false, maxGoals: FREE_MAX_GOALS };
  }
  const email = userId.slice("user:".length).trim().toLowerCase();
  if (!email) return { member: false, maxGoals: FREE_MAX_GOALS };
  if (isAvaOperatorEmail(email) || email === SERVER_GOAL_EMAIL) {
    return { member: true, maxGoals: MEMBER_MAX_GOALS };
  }
  try {
    const flags = await readUserAccountAccessFlags(db, email);
    const member = Boolean(flags?.pro_unlocked || flags?.life_member);
    return { member, maxGoals: member ? MEMBER_MAX_GOALS : FREE_MAX_GOALS };
  } catch {
    return { member: false, maxGoals: FREE_MAX_GOALS };
  }
}

/** Operator always; other Root Record members (pro / life) may post and edit their own public goals. */
export async function canPostPublicGoals(db: D1Database, userId: string): Promise<boolean> {
  if (isServerGoalUser(userId)) return true;
  if (!userId.startsWith("user:")) return false;
  const { member } = await loadMemberFlags(db, userId);
  return member;
}

export async function activeGoalCount(db: D1Database, userId: string): Promise<number> {
  const row = await db
    .prepare(`SELECT COUNT(*) AS c FROM rg_goals WHERE user_id = ? AND deleted_at IS NULL`)
    .bind(userId)
    .first<{ c: number }>();
  return row && Number.isFinite(row.c) ? Number(row.c) : 0;
}
