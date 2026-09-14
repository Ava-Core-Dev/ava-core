import { readUserAccountAccessFlags } from "./accounts";

export const FREE_DAILY_AI_LIMIT = 1;
export const PRO_MONTHLY_AI_LIMIT = 100;
export const REPORT_LIST_LIMIT = 10;

export function utcDayKey(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

export function utcMonthKey(now: Date = new Date()): string {
  return now.toISOString().slice(0, 7);
}

export async function loadProFlags(
  db: D1Database,
  userId: string,
): Promise<{ pro: boolean }> {
  if (!userId.startsWith("user:")) return { pro: false };
  const email = userId.slice("user:".length).trim().toLowerCase();
  if (!email) return { pro: false };
  try {
    const flags = await readUserAccountAccessFlags(db, email);
    if (!flags) return { pro: false };
    return { pro: Boolean(flags.pro_unlocked || flags.life_member) };
  } catch {
    return { pro: false };
  }
}
