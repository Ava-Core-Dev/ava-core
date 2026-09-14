/**
 * Canonical listing-site ids for Votifier callbacks and governance vote points.
 * Matches root-rewards.yml vote links (8 sites). Governance uses total vote count (all-time).
 */

export type ListingSiteDef = {
  id: string;
  label: string;
  match: RegExp;
};

/** Official vote sites  -  one canonical id per listing (1 site = 1 vote point). */
export const LISTING_SITES: ListingSiteDef[] = [
  { id: "minecraft-mp", label: "Minecraft-MP", match: /minecraft-?mp/i },
  { id: "minecraftservers.org", label: "MinecraftServers.org", match: /minecraftservers\.org/i },
  { id: "minecraft-server-list", label: "Minecraft Server List", match: /mcsl|minecraft[- ]?server[- ]?list/i },
  {
    id: "minecraftlist.org",
    label: "MinecraftList.org",
    match: /^minecraftserverslist$|minecraftlist\.org/i,
  },
  { id: "minecraft.buzz", label: "Minecraft.Buzz", match: /minecraft[\s._-]*buzz|mc[\s._-]*buzz/i },
  { id: "topminecraftservers", label: "TopMinecraftServers", match: /topminecraftservers/i },
  { id: "minerank", label: "MineRank", match: /minerank/i },
  { id: "planetminecraft", label: "Planet Minecraft", match: /planet\s*minecraft|planetminecraft/i },
];

export const LISTING_SITE_MAX_POINTS = LISTING_SITES.length;
export const VOTE_POINT_BASELINE = 1;

export function canonicalListingSiteId(raw: unknown): string | null {
  const s = String(raw ?? "").trim().toLowerCase();
  if (!s || s === "default") return null;
  for (const site of LISTING_SITES) {
    if (site.match.test(s)) return site.id;
  }
  return null;
}

export function canonicalListingSiteIds(rawServices: string[]): string[] {
  const seen = new Set<string>();
  for (const raw of rawServices) {
    const id = canonicalListingSiteId(raw);
    if (id) seen.add(id);
  }
  return [...seen].sort();
}

/** All-time verified listing callbacks -> vote points (baseline 1 when zero). */
export function votePointsFromTotalVotes(totalVotes: number): number {
  const n = Math.max(0, Math.floor(Number(totalVotes) || 0));
  return n > 0 ? n : VOTE_POINT_BASELINE;
}

/** @deprecated Distinct-site cap  -  governance uses votePointsFromTotalVotes. */
export function computeVotePoints(canonicalSiteIds: string[]): number {
  return votePointsFromTotalVotes(canonicalSiteIds.length);
}
