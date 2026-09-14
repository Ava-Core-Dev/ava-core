import type { D1Database } from "@cloudflare/workers-types";

/**
 * Per-product categories for the Root Record Global Updater bot (`/root categories`).
 * Ops broadcasts and automated feeds use `id` as the routing key.
 * Live Kīlauea monitoring uses the Kīlauea Alerts Discord bot (not this updater).
 * Keep `appScope` aligned with `developer-messages` / mobile feed scopes where applicable.
 */
export const ROOT_UPDATE_CATEGORIES = [
  { id: "all", label: "All product updates (opt-in)", appScope: "all" },
  { id: "releases", label: "Root Record version releases & platform notes", appScope: "releases" },
  { id: "weather", label: "Weather Manager", appScope: "weather" },
  { id: "bm", label: "Business Manager", appScope: "bm" },
  { id: "token_manager", label: "Token Manager", appScope: "token_manager" },
  { id: "account_hub", label: "Account Hub app updates", appScope: "account_hub" },
  { id: "rootmc", label: "Block Notes", appScope: "rootmc" },
  { id: "root_goals", label: "Root Goals", appScope: "root_goals" },
  { id: "root_farms", label: "Root Farms", appScope: "root_farms" },
  { id: "solana", label: "Solana Tools (solana.rootrecord.info)", appScope: "solana" },
  { id: "visiting_hawaii", label: "Visiting Hawaii", appScope: "visiting_hawaii" },
] as const;

/** Never fan-out to third-party `/root` servers — internal ops / accounting only. */
export const ROOT_UPDATE_FORBIDDEN_FANOUT_CATEGORIES = new Set([
  "internal",
  "economy",
  "accounting",
  "treasury",
  "roots_economy",
  "custodial",
  "mint",
]);

/** Automated + ops fan-out allowlist (product-facing only). */
export const ROOT_UPDATE_EXTERNAL_FANOUT_CATEGORIES = new Set<string>(
  ROOT_UPDATE_CATEGORIES.map((c) => c.id),
);

export type RootUpdateCategoryId = (typeof ROOT_UPDATE_CATEGORIES)[number]["id"];

const VALID_CATEGORY_IDS = new Set<string>(ROOT_UPDATE_CATEGORIES.map((c) => c.id));

/** Reject treasury / ledger / mint-style payloads from multi-server fan-out. */
export function looksLikeInternalOpsBroadcast(content: string): boolean {
  const t = String(content || "").toLowerCase();
  if (!t) return false;
  const markers = [
    "root record global updater pubkey",
    "internal circulation",
    "custodial wallet",
    "treasury",
    "mint complete",
    "roots mint",
    "rr_earn",
    "lamports sweep",
    "x-rr-push-admin",
    "provision-custodial",
    "withdrawal intent",
  ];
  return markers.some((m) => t.includes(m));
}

export function assertCategoryAllowedForExternalFanout(category: string): { ok: true } | { ok: false; reason: string } {
  const cat = String(category || "").trim().toLowerCase();
  if (ROOT_UPDATE_FORBIDDEN_FANOUT_CATEGORIES.has(cat)) {
    return { ok: false, reason: `Category "${cat}" is internal-only and cannot fan-out to other servers.` };
  }
  if (!ROOT_UPDATE_EXTERNAL_FANOUT_CATEGORIES.has(cat)) {
    return { ok: false, reason: `Unknown or non-fan-out category "${cat}".` };
  }
  return { ok: true };
}

export type RootUpdatesDiscordEnv = {
  DB: D1Database;
  DISCORD_BOT_TOKEN?: string;
};

export type RootUpdatesGuildConfigRow = {
  guild_id: string;
  channel_id: string;
  categories_json: string;
  configured_by_discord_id: string | null;
  updated_at: string;
};

export type RootUpdatesGuildDestination = {
  guild_id: string;
  channel_id: string;
  categories: string[];
};

const DISCORD_CONTENT_LIMIT = 1900;

function nowIso(): string {
  return new Date().toISOString();
}

/** Parse category picks; returns empty when nothing valid (no implicit `all`). */
export function normalizeRootUpdateCategories(raw: unknown): string[] {
  let items: string[] = [];
  if (Array.isArray(raw)) {
    items = raw.map((v) => String(v || "").trim().toLowerCase()).filter(Boolean);
  } else if (typeof raw === "string") {
    items = raw
      .split(/[,;\s]+/)
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);
  }
  const out = new Set<string>();
  for (const id of items) {
    if (VALID_CATEGORY_IDS.has(id)) out.add(id);
  }
  if (out.has("all")) return ["all"];
  return [...out].sort();
}

export function parseStoredCategories(json: string | null | undefined): string[] {
  if (!json) return [];
  try {
    return normalizeRootUpdateCategories(JSON.parse(json));
  } catch {
    return normalizeRootUpdateCategories(json);
  }
}

export function categoryLabel(id: string): string {
  const row = ROOT_UPDATE_CATEGORIES.find((c) => c.id === id);
  return row?.label || id;
}

export function guildReceivesCategory(subscribed: string[], broadcastCategory: string): boolean {
  if (!subscribed.length) return false;
  const cat = String(broadcastCategory || "").trim().toLowerCase();
  if (!cat) return false;
  if (subscribed.includes("all")) return true;
  if (cat === "all") return false;
  return subscribed.includes(cat);
}

export async function getRootUpdatesGuildConfig(
  db: D1Database,
  guildId: string,
): Promise<RootUpdatesGuildConfigRow | null> {
  const gid = String(guildId || "").trim();
  if (!gid) return null;
  const row = await db
    .prepare(`SELECT * FROM root_updates_discord_guild_config WHERE guild_id = ?`)
    .bind(gid)
    .first<RootUpdatesGuildConfigRow>();
  return row || null;
}

export async function listRootUpdatesGuildDestinations(db: D1Database): Promise<RootUpdatesGuildDestination[]> {
  const { results } = await db
    .prepare(`SELECT guild_id, channel_id, categories_json FROM root_updates_discord_guild_config WHERE channel_id != ''`)
    .all<{ guild_id: string; channel_id: string; categories_json: string }>();
  return (results || [])
    .map((r) => ({
      guild_id: String(r.guild_id),
      channel_id: String(r.channel_id),
      categories: parseStoredCategories(r.categories_json),
    }))
    .filter((d) => d.categories.length > 0);
}

export async function setRootUpdatesGuildChannel(
  db: D1Database,
  guildId: string,
  channelId: string,
  configuredByDiscordId: string,
  categories?: string[],
): Promise<void> {
  const gid = String(guildId || "").trim();
  const cid = String(channelId || "").trim();
  if (!gid || !cid) throw new Error("guild_id and channel_id required");
  const existing = await getRootUpdatesGuildConfig(db, gid);
  const cats = categories ?? parseStoredCategories(existing?.categories_json);
  const categoriesJson = JSON.stringify(normalizeRootUpdateCategories(cats));
  await db
    .prepare(
      `INSERT INTO root_updates_discord_guild_config
       (guild_id, channel_id, categories_json, configured_by_discord_id, updated_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(guild_id) DO UPDATE SET
         channel_id = excluded.channel_id,
         categories_json = excluded.categories_json,
         configured_by_discord_id = excluded.configured_by_discord_id,
         updated_at = excluded.updated_at`,
    )
    .bind(gid, cid, categoriesJson, configuredByDiscordId || null, nowIso())
    .run();
}

export async function setRootUpdatesGuildCategories(
  db: D1Database,
  guildId: string,
  categories: string[],
  configuredByDiscordId: string,
): Promise<void> {
  const gid = String(guildId || "").trim();
  if (!gid) throw new Error("guild_id required");
  const normalized = normalizeRootUpdateCategories(categories);
  if (!normalized.length) throw new Error("categories_required");
  const existing = await getRootUpdatesGuildConfig(db, gid);
  if (!existing?.channel_id) throw new Error("channel_not_configured");
  const categoriesJson = JSON.stringify(normalized);
  await db
    .prepare(
      `UPDATE root_updates_discord_guild_config
       SET categories_json = ?, configured_by_discord_id = ?, updated_at = ?
       WHERE guild_id = ?`,
    )
    .bind(categoriesJson, configuredByDiscordId || null, nowIso(), gid)
    .run();
}

export function chunkDiscordContent(text: string, max = DISCORD_CONTENT_LIMIT): string[] {
  const normalized = text.replace(/\r\n/g, "\n").trim();
  if (!normalized) return [];
  const out: string[] = [];
  let s = normalized;
  while (s.length > 0) {
    if (s.length <= max) {
      out.push(s);
      break;
    }
    let cut = s.lastIndexOf("\n\n", max);
    if (cut < max / 2) cut = s.lastIndexOf("\n", max);
    if (cut < max / 2) cut = max;
    out.push(s.slice(0, cut).trimEnd());
    s = s.slice(cut).trimStart();
  }
  return out.filter(Boolean);
}

function botToken(env: RootUpdatesDiscordEnv): string {
  return String(env.DISCORD_BOT_TOKEN || "")
    .replace(/^bot\s+/i, "")
    .trim();
}

export async function postRootUpdateDiscordMessage(
  env: RootUpdatesDiscordEnv,
  channelId: string,
  payload: Record<string, unknown>,
): Promise<boolean> {
  const token = botToken(env);
  const cid = String(channelId || "").trim();
  if (token.length < 40 || !/^\d{10,}$/.test(cid)) return false;
  const res = await fetch(`https://discord.com/api/v10/channels/${encodeURIComponent(cid)}/messages`, {
    method: "POST",
    headers: {
      Authorization: `Bot ${token}`,
      "Content-Type": "application/json; charset=utf-8",
      "User-Agent": "RootRecord/global-updater",
    },
    body: JSON.stringify({ ...payload, allowed_mentions: { parse: [] } }),
  });
  if (!res.ok) {
    console.warn(
      "root_updates_discord_post",
      JSON.stringify({ status: res.status, channel_id: cid, snippet: (await res.text().catch(() => "")).slice(0, 200) }),
    );
  }
  return res.ok;
}

export type RootUpdateBroadcastInput = {
  category: string;
  content?: string;
  embeds?: Record<string, unknown>[];
  /** When set, skip broadcast if this (category, source_id) was already posted (automated feeds). */
  dedupeSourceId?: string;
};

async function markRootUpdateEventPosted(db: D1Database, category: string, sourceId: string): Promise<void> {
  await db
    .prepare(
      `INSERT INTO root_updates_discord_event_post (category, source_id, posted_at)
       VALUES (?, ?, ?)
       ON CONFLICT(category, source_id) DO NOTHING`,
    )
    .bind(category, sourceId, nowIso())
    .run();
}

async function rootUpdateEventAlreadyPosted(db: D1Database, category: string, sourceId: string): Promise<boolean> {
  const row = await db
    .prepare(`SELECT 1 AS ok FROM root_updates_discord_event_post WHERE category = ? AND source_id = ? LIMIT 1`)
    .bind(category, sourceId)
    .first<{ ok: number }>();
  return row?.ok === 1;
}

export async function broadcastRootUpdate(
  env: RootUpdatesDiscordEnv,
  input: RootUpdateBroadcastInput,
): Promise<{ ok: boolean; category: string; posted: number; skipped: number; destinations: number; deduped?: boolean; blocked?: string }> {
  const category = String(input.category || "").trim().toLowerCase();
  const catCheck = assertCategoryAllowedForExternalFanout(category);
  if (!catCheck.ok) {
    console.warn(JSON.stringify({ msg: "root_updates_broadcast_blocked", category, reason: catCheck.reason }));
    return { ok: false, category, posted: 0, skipped: 0, destinations: 0, blocked: catCheck.reason };
  }

  const dedupeId = String(input.dedupeSourceId || "").trim();
  if (dedupeId && (await rootUpdateEventAlreadyPosted(env.DB, category, dedupeId))) {
    return { ok: true, category, posted: 0, skipped: 0, destinations: 0, deduped: true };
  }

  const content = String(input.content || "").trim();
  if (content && looksLikeInternalOpsBroadcast(content)) {
    const reason = "Content looks like internal ops/accounting; fan-out to other servers is blocked.";
    console.warn(JSON.stringify({ msg: "root_updates_broadcast_blocked", category, reason }));
    return { ok: false, category, posted: 0, skipped: 0, destinations: 0, blocked: reason };
  }

  const embeds = Array.isArray(input.embeds) ? input.embeds : [];
  if (!content && embeds.length === 0) {
    return { ok: false, category, posted: 0, skipped: 0, destinations: 0 };
  }

  const dests = (await listRootUpdatesGuildDestinations(env.DB)).filter((d) =>
    guildReceivesCategory(d.categories, category),
  );
  if (!dests.length) {
    if (dedupeId) await markRootUpdateEventPosted(env.DB, category, dedupeId);
    return { ok: true, category, posted: 0, skipped: 0, destinations: 0 };
  }

  const chunks = content ? chunkDiscordContent(content) : [];
  let posted = 0;
  let skipped = 0;

  for (const dest of dests) {
    let guildOk = false;

    if (embeds.length > 0) {
      guildOk = await postRootUpdateDiscordMessage(env, dest.channel_id, { embeds });
    }

    for (let i = 0; i < chunks.length; i++) {
      const prefix = chunks.length > 1 ? `(${i + 1}/${chunks.length})\n\n` : "";
      const ok = await postRootUpdateDiscordMessage(env, dest.channel_id, { content: prefix + chunks[i] });
      if (ok) guildOk = true;
      if (i < chunks.length - 1) await new Promise((r) => setTimeout(r, 400));
    }

    if (guildOk) posted += 1;
    else skipped += 1;
    await new Promise((r) => setTimeout(r, 300));
  }

  if (dedupeId && posted > 0) {
    await markRootUpdateEventPosted(env.DB, category, dedupeId);
  }

  console.log(
    JSON.stringify({
      msg: "root_updates_broadcast_ok",
      category,
      dedupe_id: dedupeId || null,
      posted_guilds: posted,
      skipped_guilds: skipped,
      destinations: dests.length,
    }),
  );

  return { ok: true, category, posted, skipped, destinations: dests.length };
}
