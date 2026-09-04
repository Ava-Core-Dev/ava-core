/** Default Kīlauea API Worker (no trailing slash). */
export const DEFAULT_ROOTRECORD_API_KILAUEA_BASE = "https://rootrecord-api-kilauea.rootrecord.workers.dev";

export function kilaueaApiBaseFromEnv(env: { ROOTRECORD_API_KILAUEA_BASE?: string }): string {
  let base = String(env.ROOTRECORD_API_KILAUEA_BASE || "")
    .trim()
    .replace(/\/+$/, "");
  if (!base) return DEFAULT_ROOTRECORD_API_KILAUEA_BASE;
  if (!/^https?:\/\//i.test(base)) base = `https://${base}`;
  try {
    const u = new URL(base);
    if (u.protocol !== "http:" && u.protocol !== "https:") return DEFAULT_ROOTRECORD_API_KILAUEA_BASE;
    return u.origin;
  } catch {
    return DEFAULT_ROOTRECORD_API_KILAUEA_BASE;
  }
}
