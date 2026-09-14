/**
 * Discoverable governance codes: PROP-01, BILL-02, ...
 * Legacy short UUID ids remain valid for existing rows.
 */

import type { D1Database } from "@cloudflare/workers-types";

export type GovernanceCodePrefix = "PROP" | "BILL" | "IDEA";

function str(v: unknown): string {
  return String(v ?? "").trim();
}

function maxSuffixFromIds(ids: string[], prefix: GovernanceCodePrefix): number {
  const re = new RegExp(`^${prefix}-(\\d+)$`, "i");
  let max = 0;
  for (const raw of ids) {
    const m = re.exec(str(raw));
    if (!m) continue;
    const n = Number(m[1]);
    if (Number.isFinite(n) && n > max) max = n;
  }
  return max;
}

async function collectIds(db: D1Database, table: string, prefix: GovernanceCodePrefix): Promise<string[]> {
  try {
    const { results } = await db
      .prepare(`SELECT id FROM ${table} WHERE id LIKE ?`)
      .bind(`${prefix}-%`)
      .all<{ id: string }>();
    return (results || []).map((r) => str(r.id)).filter(Boolean);
  } catch (e) {
    console.warn("governance_id_scan_skip", table, e instanceof Error ? e.message : String(e));
    return [];
  }
}

/** Next sequential code for citizen proposals (PROP), weekly bills (BILL), or idea queue (IDEA). */
export async function allocateGovernanceCode(
  db: D1Database,
  prefix: GovernanceCodePrefix,
): Promise<string> {
  const tables =
    prefix === "PROP"
      ? (["rootmc_legislation_items", "rootmc_community_proposals"] as const)
      : prefix === "IDEA"
        ? (["rootmc_proposal_ideas"] as const)
        : (["rootmc_weekly_bills"] as const);

  let max = 0;
  for (const table of tables) {
    const ids = await collectIds(db, table, prefix);
    max = Math.max(max, maxSuffixFromIds(ids, prefix));
  }
  return `${prefix}-${String(max + 1).padStart(2, "0")}`;
}

/** Discord forum thread name: "PROP-01  -  Title" (max 100). */
export function forumThreadName(id: string, title: string): string {
  const code = str(id) || "PROP";
  const rest = str(title).replace(/\s+/g, " ");
  const sep = "  -  ";
  const budget = 100 - code.length - sep.length;
  const clipped = rest.length > budget ? rest.slice(0, Math.max(0, budget - 1)).trimEnd() + "..." : rest;
  return `${code}${sep}${clipped}`.slice(0, 100);
}
