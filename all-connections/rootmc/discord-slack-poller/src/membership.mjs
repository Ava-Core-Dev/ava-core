/**
 * Resolve RootMC membership for Cursor soft-gate (unlimited when member).
 * Sources: AVA_MEMBER_ROLE_IDS (csv) on guild member, or profile.member flag.
 */
import { savePlayerProfileMut, loadPlayerProfile } from "./playerProfiles.mjs";

function memberRoleIds(env = {}) {
  const raw =
    process.env.AVA_MEMBER_ROLE_IDS ||
    env.AVA_MEMBER_ROLE_IDS ||
    process.env.DISCORD_ROOTMC_MEMBER_ROLE_ID ||
    "";
  return String(raw)
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * @returns {Promise<{ member: boolean, source: string }>}
 */
export async function resolveMembership(fetchJson, { guildId, userId, env } = {}) {
  if (!userId) return { member: false, source: "none" };
  const prev = loadPlayerProfile(userId);
  if (prev?.member) return { member: true, source: "profile" };

  const roles = memberRoleIds(env || {});
  if (!roles.length || !fetchJson || !guildId) {
    return { member: false, source: "unconfigured" };
  }

  try {
    const m = await fetchJson(`/guilds/${guildId}/members/${userId}`);
    const have = new Set((m?.roles || []).map(String));
    const hit = roles.some((r) => have.has(String(r)));
    if (hit) {
      savePlayerProfileMut(userId, (p) => {
        p.member = true;
        return p;
      });
      return { member: true, source: "discord_role" };
    }
  } catch (err) {
    console.warn("membership lookup:", err.message);
  }
  return { member: false, source: "no_role" };
}
