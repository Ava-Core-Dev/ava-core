import type { D1Database } from "@cloudflare/workers-types";

import { json } from "./cors";
import { normalizeItemKey } from "./rootmc-economy";
import { referencePriceForItem } from "./rootmc-market-reference";
import { displayItemName } from "./rootmc-item-display";
import { formatGoldCompact } from "./gold-format";
import { FEATURED_SERVER_DEFAULTS } from "./rootmc-server";
import { resolveEconomyServerId } from "./realm-lib";

export type ItemValueRow = {
  item_key: string;
  avg_price: number;
  sample_count: number;
  stack_size: number;
  price_per_each: number;
  price_per_stack: number;
  min_listing_price: number | null;
  max_listing_price: number | null;
  listing_count: number;
  synced_at: string | null;
};

export type PriceHistoryPoint = {
  avg_price: number;
  recorded_at: string;
};

const CHART_WINDOWS_DAYS = [7, 14, 28, 365] as const;
const SPARKLINE_WIDTH = 20;
const SPARK_CHARS = ["▁", "▂", "▃", "▄", "▅", "▆", "▇", "█"] as const;

function str(v: unknown): string {
  return String(v ?? "").trim();
}

export { formatGoldCompact as formatGold } from "./gold-format";

/** Default max stack size for market valuation (Minecraft conventions). */
export function minecraftDefaultStackSize(itemKey: string): number {
  const k = itemKey.toUpperCase();
  if (
    /_(SWORD|PICKAXE|AXE|SHOVEL|HOE|HELMET|CHESTPLATE|LEGGINGS|BOOTS|ELYTRA|SHIELD|BOW|CROSSBOW|TRIDENT|FISHING_ROD|SHEARS|FLINT_AND_STEEL|CARROT_ON_A_STICK|WARPED_FUNGUS_ON_A_STICK)$/.test(
      k,
    )
  ) {
    return 1;
  }
  if (k.includes("POTION") || k.includes("BUCKET") || k.includes("BOTTLE")) return 1;
  if (k.includes("BANNER") || k.includes("_BED") || k.includes("BOAT") || k.includes("MINECART")) return 1;
  if (
    k.includes("EGG") ||
    k.includes("SNOWBALL") ||
    k.includes("SIGN") ||
    k.includes("PEARL") ||
    k.includes("BOTTLE_O_ENCHANTING")
  ) {
    return 16;
  }
  return 64;
}

async function resolveFeaturedServerId(db: D1Database): Promise<string> {
  return resolveEconomyServerId(db, FEATURED_SERVER_DEFAULTS.server_id);
}

async function listingStats(
  db: D1Database,
  serverId: string,
  itemKey: string,
): Promise<{ min: number | null; max: number | null; count: number }> {
  const row = await db
    .prepare(
      `SELECT MIN(price) AS min_p, MAX(price) AS max_p, COUNT(*) AS c
       FROM rootstat_shop_listings
       WHERE server_id = ? AND item_key = ? AND listing_type = 'sell' AND price > 0`,
    )
    .bind(serverId, itemKey)
    .first<{ min_p: number; max_p: number; c: number }>();
  const count = Number(row?.c) || 0;
  if (count === 0) return { min: null, max: null, count: 0 };
  return {
    min: Number(row?.min_p) || null,
    max: Number(row?.max_p) || null,
    count,
  };
}

async function priceRow(
  db: D1Database,
  serverId: string,
  itemKey: string,
): Promise<{ avg_price: number; sample_count: number; synced_at: string | null } | null> {
  const row = await db
    .prepare(
      `SELECT avg_price, sample_count, synced_at
       FROM rootstat_shop_prices
       WHERE server_id = ? AND item_key = ? AND avg_price > 0
       LIMIT 1`,
    )
    .bind(serverId, itemKey)
    .first<{ avg_price: number; sample_count: number; synced_at: string | null }>();
  if (!row) return null;
  return {
    avg_price: Number(row.avg_price) || 0,
    sample_count: Number(row.sample_count) || 0,
    synced_at: row.synced_at || null,
  };
}

export async function searchItemKeys(
  db: D1Database,
  serverId: string,
  query: string,
  limit = 8,
): Promise<string[]> {
  const normalized = normalizeItemKey(query.replace(/\s+/g, "_"));
  if (!normalized) return [];

  const exact = await priceRow(db, serverId, normalized);
  if (exact) return [normalized];

  const like = normalized.replace(/_/g, "%");
  const { results } = await db
    .prepare(
      `SELECT item_key FROM rootstat_shop_prices
       WHERE server_id = ? AND avg_price > 0 AND item_key LIKE ?
       ORDER BY sample_count DESC, avg_price DESC
       LIMIT ?`,
    )
    .bind(serverId, `%${like}%`, limit)
    .all<{ item_key: string }>();
  return (results || []).map((r) => str(r.item_key)).filter(Boolean);
}

export async function itemValueLookup(
  db: D1Database,
  query: string,
  serverId?: string,
): Promise<{ matches: ItemValueRow[]; query: string; server_id: string }> {
  const sid = serverId || (await resolveEconomyServerId(db, FEATURED_SERVER_DEFAULTS.server_id));
  const keys = await searchItemKeys(db, sid, query, 6);
  const matches: ItemValueRow[] = [];

  for (const itemKey of keys) {
    const price = await priceRow(db, sid, itemKey);
    if (!price) continue;
    const listings = await listingStats(db, sid, itemKey);
    const stackSize = minecraftDefaultStackSize(itemKey);
    const reference = await referencePriceForItem(db, sid, itemKey);
    const each = reference > 0 ? reference : price.avg_price;
    matches.push({
      item_key: itemKey,
      avg_price: each,
      sample_count: price.sample_count,
      stack_size: stackSize,
      price_per_each: each,
      price_per_stack: each * stackSize,
      min_listing_price: listings.min,
      max_listing_price: listings.max,
      listing_count: listings.count,
      synced_at: price.synced_at,
    });
  }

  return { server_id: sid, query, matches };
}

export async function fetchItemPriceHistory(
  db: D1Database,
  serverId: string,
  itemKey: string,
  maxDays = 365,
): Promise<PriceHistoryPoint[]> {
  const since = new Date(Date.now() - maxDays * 86_400_000).toISOString();
  const { results } = await db
    .prepare(
      `SELECT avg_price, recorded_at
       FROM rootmc_shop_price_history
       WHERE server_id = ? AND item_key = ? AND recorded_at >= ?
       ORDER BY recorded_at ASC`,
    )
    .bind(serverId, itemKey, since)
    .all<{ avg_price: number; recorded_at: string }>();
  return (results || [])
    .map((row) => ({
      avg_price: Number(row.avg_price) || 0,
      recorded_at: str(row.recorded_at),
    }))
    .filter((row) => row.avg_price > 0 && row.recorded_at);
}

/** Unicode sparkline for Discord (no external chart lib). */
export function sparkline(prices: number[], width = SPARKLINE_WIDTH): string {
  if (!prices.length) return " - ";
  if (prices.length === 1) return SPARK_CHARS[4].repeat(Math.min(3, width));

  const buckets: number[] = [];
  for (let i = 0; i < width; i++) {
    const start = Math.floor((i * prices.length) / width);
    const end = Math.floor(((i + 1) * prices.length) / width);
    const slice = prices.slice(start, Math.max(start + 1, end));
    buckets.push(slice.reduce((sum, p) => sum + p, 0) / slice.length);
  }

  const min = Math.min(...buckets);
  const max = Math.max(...buckets);
  if (max === min) return SPARK_CHARS[4].repeat(buckets.length);

  return buckets
    .map((p) => {
      const idx = Math.round(((p - min) / (max - min)) * 7);
      return SPARK_CHARS[Math.max(0, Math.min(7, idx))];
    })
    .join("");
}

export function formatWindowChart(
  label: string,
  points: PriceHistoryPoint[],
  days: number,
  width = SPARKLINE_WIDTH,
): string {
  const cutoff = Date.now() - days * 86_400_000;
  const window = points.filter((p) => new Date(p.recorded_at).getTime() >= cutoff);
  if (window.length < 2) {
    return `**${label}**  -  _not enough history yet_`;
  }
  const prices = window.map((p) => p.avg_price);
  const first = prices[0];
  const last = prices[prices.length - 1];
  const pct = first > 0 ? ((last - first) / first) * 100 : 0;
  const sign = pct >= 0 ? "+" : "";
  return `**${label}** \`${sparkline(prices, width)}\` ${formatGold(first)} -> ${formatGold(last)} (${sign}${pct.toFixed(1)}%)`;
}

export function formatItemValueDiscord(row: ItemValueRow): string {
  const name = displayItemName(row.item_key);
  const lines = [
    `**${name}** (\`${row.item_key}\`)`,
    `**Each:** ${formatGold(row.price_per_each)}`,
    `**Stack (${row.stack_size}):** ${formatGold(row.price_per_stack)}`,
    `Market samples: ${row.sample_count}`,
  ];
  if (row.listing_count > 0) {
    lines.push(
      `Active listings: ${row.listing_count}  -  ${formatGold(row.min_listing_price || 0)} - ${formatGold(row.max_listing_price || 0)}`,
    );
  }
  if (row.synced_at) {
    lines.push(`_Updated ${row.synced_at.replace("T", " ").replace(/\.\d{3}Z$/, " UTC")}_`);
  }
  return lines.join("\n");
}

export async function formatItemValueDiscordWithCharts(
  db: D1Database,
  serverId: string,
  row: ItemValueRow,
): Promise<string> {
  const base = formatItemValueDiscord(row);
  const history = await fetchItemPriceHistory(db, serverId, row.item_key, 365);
  if (history.length < 2) {
    return `${base}\n\n**Price trend**\n_History still building  -  averages record on each economy sync._`;
  }
  const charts = CHART_WINDOWS_DAYS.map((days) =>
    formatWindowChart(`${days}d`, history, days),
  );
  return `${base}\n\n**Price trend** (blended buy-side reference)\n${charts.join("\n")}`;
}

export async function handleItemValueRoute(
  request: Request,
  env: { DB: D1Database },
  subpath: string,
  method: string,
): Promise<Response | null> {
  if (method !== "GET" || subpath !== "/rootmc/server/value") return null;
  const url = new URL(request.url);
  const item = str(url.searchParams.get("item"));
  if (!item) {
    return Response.json({ detail: "item query parameter required" }, { status: 400 });
  }
  const serverId = str(url.searchParams.get("server_id"));
  const result = await itemValueLookup(env.DB, item, serverId || undefined);
  return json(result);
}
