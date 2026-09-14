import type { D1Database } from "@cloudflare/workers-types";

import { cors, json } from "./cors";

export const REFERENCE_CATEGORIES = [
  "blocks",
  "items",
  "mobs",
  "enchantments",
  "potions",
  "trades",
] as const;

export type ReferenceCategory = (typeof REFERENCE_CATEGORIES)[number];

export async function getReferenceVersion(db: D1Database): Promise<string> {
  const row = await db
    .prepare("SELECT version FROM rootmc_reference_meta WHERE id = 1")
    .first<{ version: string }>();
  return String(row?.version || "").trim() || "unknown";
}

export async function handleRootMcReference(
  request: Request,
  env: { DB: D1Database },
  sub: string,
  method: string,
): Promise<Response | null> {
  if (method !== "GET") return null;

  if (sub === "/reference/manifest") {
    const meta = await env.DB.prepare(
      "SELECT version, updated_at FROM rootmc_reference_meta WHERE id = 1",
    ).first<{ version: string; updated_at: string }>();

    const bundles = await env.DB.prepare(
      `SELECT category, byte_size, content_sha256, updated_at
       FROM rootmc_reference_bundle
       ORDER BY category`,
    ).all<{
      category: string;
      byte_size: number;
      content_sha256: string;
      updated_at: string;
    }>();

    return json({
      version: meta?.version ?? "unknown",
      updated_at: meta?.updated_at ?? null,
      categories: (bundles.results ?? []).map((row) => ({
        category: row.category,
        byte_size: row.byte_size,
        sha256: row.content_sha256,
      })),
    });
  }

  const match = sub.match(/^\/reference\/([a-z_]+)$/);
  if (!match) return null;

  const category = match[1] as ReferenceCategory;
  if (!REFERENCE_CATEGORIES.includes(category)) {
    return json({ detail: "Unknown reference category" }, 404);
  }

  const row = await env.DB.prepare(
    "SELECT json_blob, content_sha256 FROM rootmc_reference_bundle WHERE category = ?",
  )
    .bind(category)
    .first<{ json_blob: string; content_sha256: string }>();

  if (!row?.json_blob) {
    return json({ detail: "Reference category not seeded" }, 404);
  }

  const etag = `"${row.content_sha256}"`;
  const headers: Record<string, string> = {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "public, max-age=86400",
    ETag: etag,
    ...cors(),
  };

  const ifNoneMatch = request.headers.get("If-None-Match");
  if (ifNoneMatch === etag) {
    return new Response(null, { status: 304, headers });
  }

  return new Response(row.json_blob, { status: 200, headers });
}
