/**
 * Exiled Discord users — never include in reports or activity stats.
 * Canonical data: src/rootmc-exiled-discord-users.json
 */
import exiledUsers from "../../src/rootmc-exiled-discord-users.json" with { type: "json" };

export const EXILED_DISCORD_USERS = exiledUsers;

export const EXILED_DISCORD_IDS = new Set(exiledUsers.map((u) => u.id));

export function isExiledDiscordUser(id) {
  return EXILED_DISCORD_IDS.has(String(id ?? "").trim());
}

/** Merge permanent exiles with optional extra IDs (e.g. CLI --exclude-ids). */
export function reportExclusionSet(extraIds = []) {
  const out = new Set(EXILED_DISCORD_IDS);
  for (const id of extraIds) {
    const s = String(id ?? "").trim();
    if (s) out.add(s);
  }
  return out;
}
