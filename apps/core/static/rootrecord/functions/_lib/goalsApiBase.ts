/** Default Root Goals API Worker (no trailing slash). */
export const DEFAULT_ROOTRECORD_API_GOALS_BASE = "https://api-goals.rootrecord.info";

export function goalsApiBaseFromEnv(env: { ROOTRECORD_API_GOALS_BASE?: string }): string {
  let base = String(env.ROOTRECORD_API_GOALS_BASE || "")
    .trim()
    .replace(/\/+$/, "");
  if (!base) return DEFAULT_ROOTRECORD_API_GOALS_BASE;
  if (!/^https?:\/\//i.test(base)) base = `https://${base}`;
  try {
    const u = new URL(base);
    if (u.protocol !== "http:" && u.protocol !== "https:") return DEFAULT_ROOTRECORD_API_GOALS_BASE;
    return u.origin;
  } catch {
    return DEFAULT_ROOTRECORD_API_GOALS_BASE;
  }
}
