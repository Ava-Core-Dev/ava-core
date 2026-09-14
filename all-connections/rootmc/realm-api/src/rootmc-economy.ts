import type { D1Database } from "@cloudflare/workers-types";

import { json } from "./cors";
import { requireSignedInAccount, str, record, resolvePublicServerId, resolveEconomyServerId } from "./realm-lib";
import type { RootStatEnv } from "./rootstat-minecraft";
import { validateServerAuth } from "./rootstat-minecraft";
import { pendingTransferUuidSet } from "./rootmc-gold-transfers";
import { displayItemName } from "./rootmc-item-display";
import { economySystemAccountSqlFilter, isEconomySystemAccount } from "./rootmc-economy-accounts";
import {
  blendMarketReferencePrice,
  historicalAveragePrices,
  referencePriceMapForServer,
} from "./rootmc-market-reference";
import {
  treasurySummaryForPlayer,
  upsertPlaytimeMonthlyRows,
  upsertTreasuryLedgerRows,
  replaceTownTaxRates,
} from "./rootmc-treasury";
import { upsertGoldFoundRows } from "./rootmc-gold-found";
import { upsertGoldItemEventRows } from "./rootmc-gold-item-events";
import { upsertPhysicalGoldScan } from "./rootmc-physical-gold";
import { goldSupplyReport, upsertSystemAccountBalances } from "./rootmc-gold-supply";
import { circulatingBalancesReport } from "./rootmc-circulating-balances";

function nowIso(): string {
  return new Date().toISOString();
}

function normalizeMinecraftUuid(raw: string): string | null {
  const uuid = str(raw).toLowerCase();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(uuid)) {
    return null;
  }
  return uuid;
}

export function normalizeItemKey(raw: string): string {
  return str(raw).toUpperCase().replace(/[^A-Z0-9_]/g, "_").slice(0, 64);
}

function parsePriceList(raw: unknown): number[] {
  if (!Array.isArray(raw)) return [];
  const out: number[] = [];
  for (const v of raw) {
    const n = Number(v);
    if (Number.isFinite(n) && n > 0) out.push(n);
  }
  return out;
}

/** Median in-stock sell prices  -  average price available to buyers (not per-shop listing cap). */
function shopPricesFromInStockListings(
  rows: Array<Record<string, unknown>>,
  source: string,
): Array<{ item_key: string; prices: number[]; source?: string }> {
  const byItem = new Map<string, number[]>();
  for (const raw of rows) {
    const itemKey = normalizeItemKey(str(raw.item_key));
    const price = Number(raw.price);
    const listingType = (str(raw.listing_type) || "sell").toLowerCase();
    const stockRaw = Number(raw.stock_quantity);
    const stock = Number.isFinite(stockRaw) ? Math.floor(stockRaw) : 0;
    if (!itemKey || !Number.isFinite(price) || price <= 0) continue;
    if (listingType === "buy") continue;
    if (stock === 0) continue;
    const list = byItem.get(itemKey) ?? [];
    list.push(price);
    byItem.set(itemKey, list);
  }
  const out: Array<{ item_key: string; prices: number[]; source: string }> = [];
  for (const [item_key, prices] of byItem) {
    if (prices.length > 0) out.push({ item_key, prices, source });
  }
  return out;
}

function medianPrice(prices: number[]): number {
  const sorted = prices.filter((p) => p > 0).sort((a, b) => a - b);
  if (sorted.length === 0) return 0;
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid]!;
  return (sorted[mid - 1]! + sorted[mid]!) / 2;
}

function parseItemMap(raw: unknown): Record<string, number> {
  const src = record(raw);
  const out: Record<string, number> = {};
  for (const [key, val] of Object.entries(src)) {
    const itemKey = normalizeItemKey(key);
    if (!itemKey) continue;
    const qty = Number(val);
    if (Number.isFinite(qty) && qty > 0) {
      out[itemKey] = Math.floor(qty);
    }
  }
  return out;
}

function shopsShareUrl(siteUrl: string, serverId: string, playerUuid?: string | null): string {
  const base = String(siteUrl || "https://rootmc.net").replace(/\/+$/, "");
  if (playerUuid) {
    return `${base}/player/?uuid=${encodeURIComponent(playerUuid)}&server=${encodeURIComponent(serverId)}`;
  }
  const params = new URLSearchParams({ server: serverId });
  return `${base}/market/?${params.toString()}`;
}

export async function replaceShopListings(
  db: D1Database,
  serverId: string,
  rows: Array<Record<string, unknown>>,
  syncedAt: string,
): Promise<number> {
  await db.prepare(`DELETE FROM rootstat_shop_listings WHERE server_id = ?`).bind(serverId).run();
  let count = 0;
  let stockColumn: boolean | null = null;
  for (const raw of rows) {
    const shopId = str(raw.shop_id);
    const itemKey = normalizeItemKey(str(raw.item_key));
    const price = Number(raw.price);
    const worldName = str(raw.world || raw.world_name);
    const x = Number(raw.x);
    const y = Number(raw.y);
    const z = Number(raw.z);
    if (!shopId || !itemKey || !Number.isFinite(price) || price <= 0 || !worldName) continue;
    const ownerUuid = normalizeMinecraftUuid(str(raw.owner_uuid)) || null;
    const ownerUsername = str(raw.owner_username) || null;
    const listingType = str(raw.listing_type) || "sell";
    const stockQuantity = Math.max(0, Math.floor(Number(raw.stock_quantity) || 0));

    if (stockColumn !== false) {
      try {
        await db
          .prepare(
            `INSERT INTO rootstat_shop_listings
               (server_id, shop_id, owner_uuid, owner_username, world_name, x, y, z, item_key, price, listing_type, stock_quantity, synced_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .bind(serverId, shopId, ownerUuid, ownerUsername, worldName, x, y, z, itemKey, price, listingType, stockQuantity, syncedAt)
          .run();
        stockColumn = true;
        count++;
        continue;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (!msg.includes("stock_quantity")) throw e;
        stockColumn = false;
        console.warn("replaceShopListings_legacy_no_stock_column", serverId);
      }
    }

    await db
      .prepare(
        `INSERT INTO rootstat_shop_listings
           (server_id, shop_id, owner_uuid, owner_username, world_name, x, y, z, item_key, price, listing_type, synced_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(serverId, shopId, ownerUuid, ownerUsername, worldName, x, y, z, itemKey, price, listingType, syncedAt)
      .run();
    count++;
  }
  return count;
}

export async function shopPriceCatalog(
  db: D1Database,
  serverId: string,
  limit = 100,
): Promise<Record<string, unknown>[]> {
  const { results } = await db
    .prepare(
      `SELECT item_key, avg_price, sample_count, synced_at
       FROM rootstat_shop_prices
       WHERE server_id = ?
       ORDER BY sample_count DESC, avg_price DESC
       LIMIT ?`,
    )
    .bind(serverId, Math.min(200, Math.max(1, limit)))
    .all<Record<string, unknown>>();
  return (results || []).map((row) => ({
    item_key: str(row.item_key),
    avg_price: Number(row.avg_price) || 0,
    sample_count: Number(row.sample_count) || 0,
    synced_at: row.synced_at || null,
  }));
}

export async function shopListingsForServer(
  db: D1Database,
  serverId: string,
  limit = 100,
): Promise<Record<string, unknown>[]> {
  const { results } = await db
    .prepare(
      `SELECT shop_id, owner_uuid, owner_username, world_name, x, y, z, item_key, price, listing_type, synced_at
       FROM rootstat_shop_listings
       WHERE server_id = ?
       ORDER BY item_key ASC, price ASC
       LIMIT ?`,
    )
    .bind(serverId, Math.min(500, Math.max(1, limit)))
    .all<Record<string, unknown>>();
  return (results || []).map((row) => ({
    shop_id: str(row.shop_id),
    owner_uuid: row.owner_uuid || null,
    owner_username: row.owner_username || null,
    world: str(row.world_name),
    x: Number(row.x) || 0,
    y: Number(row.y) || 0,
    z: Number(row.z) || 0,
    item_key: str(row.item_key),
    price: Number(row.price) || 0,
    listing_type: str(row.listing_type) || "sell",
    synced_at: row.synced_at || null,
  }));
}

export type ShopMarketSort =
  | "quantity_desc"
  | "quantity_asc"
  | "price_asc"
  | "price_desc"
  | "name_asc"
  | "name_desc"
  | "shops_desc"
  | "shops_asc"
  | "market_avg_desc"
  | "market_avg_asc"
  | "buy_price_desc"
  | "buy_capacity_desc";

export type ShopMarketItemRow = {
  item_key: string;
  display_name: string;
  total_quantity: number;
  shop_count: number;
  min_price: number;
  max_price: number;
  avg_listing_price: number;
  market_avg: number;
  market_samples: number;
  buy_capacity: number;
  buy_shop_count: number;
  max_buy_price: number;
  min_buy_price: number;
  change_24h_pct?: number | null;
};

function parseShopMarketSort(raw: string): ShopMarketSort {
  const allowed: ShopMarketSort[] = [
    "quantity_desc",
    "quantity_asc",
    "price_asc",
    "price_desc",
    "name_asc",
    "name_desc",
    "shops_desc",
    "shops_asc",
    "market_avg_desc",
    "market_avg_asc",
    "buy_price_desc",
    "buy_capacity_desc",
  ];
  const key = str(raw).toLowerCase() as ShopMarketSort;
  return allowed.includes(key) ? key : "quantity_desc";
}

function shopMarketOrderBy(sort: ShopMarketSort): string {
  switch (sort) {
    case "quantity_asc":
      return "total_quantity ASC, item_key ASC";
    case "price_asc":
      return "min_price ASC, item_key ASC";
    case "price_desc":
      return "min_price DESC, item_key ASC";
    case "name_asc":
      return "item_key ASC";
    case "name_desc":
      return "item_key DESC";
    case "shops_desc":
      return "shop_count DESC, total_quantity DESC";
    case "shops_asc":
      return "shop_count ASC, item_key ASC";
    case "market_avg_desc":
      return "market_avg DESC, total_quantity DESC";
    case "market_avg_asc":
      return "market_avg ASC, item_key ASC";
    case "buy_price_desc":
      return "max_buy_price DESC, buy_capacity DESC, item_key ASC";
    case "buy_capacity_desc":
      return "buy_capacity DESC, buy_shop_count DESC, item_key ASC";
    case "quantity_desc":
    default:
      return "total_quantity DESC, shop_count DESC, item_key ASC";
  }
}

export async function shopMarketItemsPage(
  db: D1Database,
  serverId: string,
  opts: {
    page?: number;
    perPage?: number;
    sort?: string;
    q?: string;
    minPrice?: number;
    maxPrice?: number;
    minQty?: number;
    maxQty?: number;
    minShops?: number;
    inStockOnly?: boolean;
  },
): Promise<{
  items: ShopMarketItemRow[];
  total: number;
  page: number;
  per_page: number;
  total_pages: number;
}> {
  const perPage = Math.min(25, Math.max(1, Number(opts.perPage) || 25));
  const page = Math.max(1, Number(opts.page) || 1);
  const sort = parseShopMarketSort(opts.sort || "quantity_desc");
  const q = normalizeItemKey(str(opts.q).replace(/\s+/g, "_"));
  const like = q ? `%${q.replace(/_/g, "%")}%` : null;

  const minPrice = Number.isFinite(opts.minPrice) ? Number(opts.minPrice) : null;
  const maxPrice = Number.isFinite(opts.maxPrice) ? Number(opts.maxPrice) : null;
  const minQty = Number.isFinite(opts.minQty) ? Math.max(0, Math.floor(Number(opts.minQty))) : null;
  const maxQty = Number.isFinite(opts.maxQty) ? Math.max(0, Math.floor(Number(opts.maxQty))) : null;
  const minShops = Number.isFinite(opts.minShops) ? Math.max(1, Math.floor(Number(opts.minShops))) : null;
  const inStockOnly = opts.inStockOnly === true;

  const baseSql = `
    SELECT
      l.item_key AS item_key,
      COALESCE(SUM(CASE WHEN l.listing_type = 'sell' THEN l.stock_quantity ELSE 0 END), 0) AS total_quantity,
      COALESCE(SUM(CASE WHEN l.listing_type = 'buy' THEN l.stock_quantity ELSE 0 END), 0) AS buy_capacity,
      COUNT(CASE WHEN l.listing_type = 'sell' THEN 1 END) AS shop_count,
      COUNT(CASE WHEN l.listing_type = 'buy' THEN 1 END) AS buy_shop_count,
      MIN(CASE WHEN l.listing_type = 'sell' AND l.stock_quantity > 0 THEN l.price END) AS min_price,
      MAX(CASE WHEN l.listing_type = 'sell' THEN l.price END) AS max_price,
      MAX(CASE WHEN l.listing_type = 'buy' AND l.stock_quantity > 0 THEN l.price END) AS max_buy_price,
      MIN(CASE WHEN l.listing_type = 'buy' AND l.stock_quantity > 0 THEN l.price END) AS min_buy_price,
      AVG(CASE WHEN l.listing_type = 'sell' THEN l.price END) AS avg_listing_price,
      COALESCE(p.avg_price, 0) AS market_avg,
      COALESCE(p.sample_count, 0) AS market_samples
    FROM rootstat_shop_listings l
    LEFT JOIN rootstat_shop_prices p
      ON p.server_id = l.server_id AND p.item_key = l.item_key
    WHERE l.server_id = ? AND l.price > 0
    GROUP BY l.item_key
  `;

  const filters: string[] = [];
  const binds: unknown[] = [serverId];

  if (like) {
    filters.push("item_key LIKE ?");
    binds.push(like);
  }
  if (minPrice != null) {
    filters.push("min_price >= ?");
    binds.push(minPrice);
  }
  if (maxPrice != null) {
    filters.push("min_price <= ?");
    binds.push(maxPrice);
  }
  if (minQty != null) {
    filters.push("total_quantity >= ?");
    binds.push(minQty);
  }
  if (maxQty != null) {
    filters.push("total_quantity <= ?");
    binds.push(maxQty);
  }
  if (minShops != null) {
    filters.push("shop_count >= ?");
    binds.push(minShops);
  }
  if (inStockOnly) {
    filters.push("(total_quantity > 0 OR buy_capacity > 0)");
  }

  const whereExtra = filters.length ? ` WHERE ${filters.join(" AND ")}` : "";
  const wrapped = `SELECT * FROM (${baseSql}) agg${whereExtra}`;

  const countRow = await db
    .prepare(`SELECT COUNT(*) AS c FROM (${wrapped})`)
    .bind(...binds)
    .first<{ c: number }>();
  const total = Number(countRow?.c) || 0;
  const totalPages = Math.max(1, Math.ceil(total / perPage));
  const safePage = Math.min(page, totalPages);
  const offset = (safePage - 1) * perPage;

  const { results } = await db
    .prepare(`${wrapped} ORDER BY ${shopMarketOrderBy(sort)} LIMIT ? OFFSET ?`)
    .bind(...binds, perPage, offset)
    .all<Record<string, unknown>>();

  const referencePrices = await referencePriceMapForServer(db, serverId);
  const items: ShopMarketItemRow[] = (results || []).map((row) => {
    const itemKey = str(row.item_key);
    const availableAvg = Number(row.market_avg) || 0;
    const referenceAvg = referencePrices.get(normalizeItemKey(itemKey)) ?? availableAvg;
    return {
      item_key: itemKey,
      display_name: displayItemName(itemKey),
      total_quantity: Number(row.total_quantity) || 0,
      shop_count: Number(row.shop_count) || 0,
      min_price: Number(row.min_price) || 0,
      max_price: Number(row.max_price) || 0,
      avg_listing_price: Number(row.avg_listing_price) || 0,
      market_avg: referenceAvg,
      market_samples: Number(row.market_samples) || 0,
      buy_capacity: Number(row.buy_capacity) || 0,
      buy_shop_count: Number(row.buy_shop_count) || 0,
      max_buy_price: Number(row.max_buy_price) || 0,
      min_buy_price: Number(row.min_buy_price) || 0,
    };
  });

  return {
    items,
    total,
    page: safePage,
    per_page: perPage,
    total_pages: totalPages,
  };
}

export async function shopListingsForPlayer(
  db: D1Database,
  serverId: string,
  uuid: string,
  limit = 100,
): Promise<Record<string, unknown>[]> {
  const { results } = await db
    .prepare(
      `SELECT shop_id, owner_uuid, owner_username, world_name, x, y, z, item_key, price, listing_type, synced_at
       FROM rootstat_shop_listings
       WHERE server_id = ? AND owner_uuid = ?
       ORDER BY item_key ASC, price ASC
       LIMIT ?`,
    )
    .bind(serverId, uuid, Math.min(200, Math.max(1, limit)))
    .all<Record<string, unknown>>();
  return (results || []).map((row) => ({
    shop_id: str(row.shop_id),
    owner_uuid: row.owner_uuid || null,
    owner_username: row.owner_username || null,
    world: str(row.world_name),
    x: Number(row.x) || 0,
    y: Number(row.y) || 0,
    z: Number(row.z) || 0,
    item_key: str(row.item_key),
    price: Number(row.price) || 0,
    listing_type: str(row.listing_type) || "sell",
    synced_at: row.synced_at || null,
  }));
}

async function upsertShopPrices(
  db: D1Database,
  serverId: string,
  rows: Array<{ item_key: string; prices: number[]; source?: string }>,
  syncedAt: string,
): Promise<number> {
  let count = 0;
  for (const row of rows) {
    const itemKey = normalizeItemKey(row.item_key);
    const prices = row.prices.filter((p) => p > 0);
    if (!itemKey || prices.length === 0) continue;
    const avg = medianPrice(prices);
    await db
      .prepare(
        `INSERT INTO rootstat_shop_prices
           (server_id, item_key, avg_price, sample_count, source, synced_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(server_id, item_key) DO UPDATE SET
           avg_price = excluded.avg_price,
           sample_count = excluded.sample_count,
           source = excluded.source,
           synced_at = excluded.synced_at,
           updated_at = excluded.updated_at`,
      )
      .bind(serverId, itemKey, avg, prices.length, str(row.source) || "sign_scan", syncedAt, syncedAt)
      .run();
    count++;
  }
  return count;
}

function valueItems(items: Record<string, number>, prices: Map<string, number>): number {
  let total = 0;
  for (const [itemKey, qty] of Object.entries(items)) {
    const price = prices.get(normalizeItemKey(itemKey)) ?? 0;
    if (price > 0 && qty > 0) total += price * qty;
  }
  return total;
}

/** Reconcile stored total with component sums (wallet + inventory + chest + shop stock). */
export function computeNetWorthTotal(parts: {
  balance_value?: number | null;
  inventory_value?: number | null;
  chest_value?: number | null;
  shop_stock_value?: number | null;
  total_value?: number | null;
}): number {
  const balance = Number(parts.balance_value) || 0;
  const inventory = Number(parts.inventory_value) || 0;
  const chest = Number(parts.chest_value) || 0;
  const shopStock = Number(parts.shop_stock_value) || 0;
  const sum = balance + inventory + chest + shopStock;
  const stored = Number(parts.total_value);
  if (!Number.isFinite(stored) || Math.abs(sum - stored) > 0.005) return sum;
  return stored;
}

async function shopStockByPlayer(
  db: D1Database,
  serverId: string,
): Promise<Map<string, { items: Record<string, number>; username: string | null }>> {
  try {
    const { results } = await db
      .prepare(
        `SELECT owner_uuid, owner_username, item_key, stock_quantity
         FROM rootstat_shop_listings
         WHERE server_id = ? AND listing_type = 'sell'`,
      )
      .bind(serverId)
      .all<Record<string, unknown>>();

    const map = new Map<string, { items: Record<string, number>; username: string | null }>();
    for (const row of results || []) {
      const uuid = normalizeMinecraftUuid(str(row.owner_uuid));
      const itemKey = normalizeItemKey(str(row.item_key));
      const qty = Math.max(0, Math.floor(Number(row.stock_quantity) || 0));
      if (!uuid || !itemKey || qty <= 0) continue;
      const entry = map.get(uuid) ?? { items: {}, username: null };
      entry.items[itemKey] = (entry.items[itemKey] ?? 0) + qty;
      const name = str(row.owner_username);
      if (name) entry.username = name;
      map.set(uuid, entry);
    }
    return map;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("stock_quantity")) {
      console.warn("shopStockByPlayer_skip_no_stock_column", serverId);
      return new Map();
    }
    throw e;
  }
}

/** Copy balances + inventory rows so slug alias (rootmc) net worth matches live server_id. */
async function mirrorNetWorthSources(
  db: D1Database,
  fromId: string,
  toId: string,
  syncedAt: string,
): Promise<void> {
  await db.prepare(`DELETE FROM rootstat_player_balances WHERE server_id = ?`).bind(toId).run();
  await db
    .prepare(
      `INSERT INTO rootstat_player_balances
         (server_id, minecraft_uuid, minecraft_username, balance, currency, synced_at, updated_at)
       SELECT ?, minecraft_uuid, minecraft_username, balance, currency, ?, ?
       FROM rootstat_player_balances WHERE server_id = ?`,
    )
    .bind(toId, syncedAt, syncedAt, fromId)
    .run();

  await db.prepare(`DELETE FROM rootstat_player_item_totals WHERE server_id = ?`).bind(toId).run();
  await db
    .prepare(
      `INSERT INTO rootstat_player_item_totals
         (server_id, minecraft_uuid, item_key, quantity, source, synced_at)
       SELECT ?, minecraft_uuid, item_key, quantity, source, ?
       FROM rootstat_player_item_totals WHERE server_id = ?`,
    )
    .bind(toId, syncedAt, fromId)
    .run();
}

export async function recomputeNetWorth(db: D1Database, serverId: string, syncedAt: string): Promise<number> {
  await db.prepare(`DELETE FROM rootstat_player_net_worth WHERE server_id = ?`).bind(serverId).run();

  // Blended buy-side reference  -  not individual shop listing prices.
  const prices = await referencePriceMapForServer(db, serverId);
  const shopStock = await shopStockByPlayer(db, serverId);

  const { results: balanceRows } = await db
    .prepare(
      `SELECT minecraft_uuid, minecraft_username, balance
       FROM rootstat_player_balances WHERE server_id = ?`,
    )
    .bind(serverId)
    .all<Record<string, unknown>>();

  const { results: itemRows } = await db
    .prepare(
      `SELECT minecraft_uuid, item_key, quantity
       FROM rootstat_player_item_totals WHERE server_id = ?`,
    )
    .bind(serverId)
    .all<Record<string, unknown>>();

  const itemsByPlayer = new Map<string, Record<string, number>>();
  for (const row of itemRows || []) {
    const uuid = str(row.minecraft_uuid);
    const itemKey = normalizeItemKey(str(row.item_key));
    const qty = Number(row.quantity) || 0;
    if (!uuid || !itemKey || qty <= 0) continue;
    const bucket = itemsByPlayer.get(uuid) ?? {};
    bucket[itemKey] = (bucket[itemKey] ?? 0) + qty;
    itemsByPlayer.set(uuid, bucket);
  }

  const uuids = new Set<string>();
  for (const row of balanceRows || []) {
    const uuid = str(row.minecraft_uuid);
    if (uuid) uuids.add(uuid);
  }
  for (const uuid of itemsByPlayer.keys()) uuids.add(uuid);
  for (const uuid of shopStock.keys()) uuids.add(uuid);

  let upserted = 0;
  for (const uuid of uuids) {
    const balanceRow = (balanceRows || []).find((r) => str(r.minecraft_uuid) === uuid);
    const username = str(balanceRow?.minecraft_username) || shopStock.get(uuid)?.username || null;
    if (isEconomySystemAccount(uuid, username)) continue;
    const balanceValue = Number(balanceRow?.balance) || 0;
    const shopEntry = shopStock.get(uuid);
    const items = itemsByPlayer.get(uuid) ?? {};
    const inventoryValue = valueItems(items, prices);
    const shopStockItems = shopEntry?.items ?? {};
    const shopStockValue = valueItems(shopStockItems, prices);
    const totalValue = balanceValue + inventoryValue + shopStockValue;

    await db
      .prepare(
        `INSERT INTO rootstat_player_net_worth
           (server_id, minecraft_uuid, minecraft_username, balance_value, inventory_value,
            chest_value, shop_stock_value, total_value, ranked_at, synced_at)
         VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?, ?)
         ON CONFLICT(server_id, minecraft_uuid) DO UPDATE SET
           minecraft_username = excluded.minecraft_username,
           balance_value = excluded.balance_value,
           inventory_value = excluded.inventory_value,
           shop_stock_value = excluded.shop_stock_value,
           total_value = excluded.total_value,
           ranked_at = excluded.ranked_at,
           synced_at = excluded.synced_at`,
      )
      .bind(serverId, uuid, username, balanceValue, inventoryValue, shopStockValue, totalValue, syncedAt, syncedAt)
      .run();
    upserted++;
  }
  return upserted;
}

/** Recompute net-worth rows from latest balances, inventory, and shop stock in D1. */
export async function refreshServerNetWorth(db: D1Database, serverId: string): Promise<number> {
  return recomputeNetWorth(db, serverId, nowIso());
}

export async function netWorthForPlayer(
  db: D1Database,
  serverId: string,
  uuid: string,
): Promise<Record<string, unknown> | null> {
  const row = await db
    .prepare(
      `SELECT server_id, minecraft_uuid, minecraft_username, balance_value, inventory_value,
              chest_value, shop_stock_value, total_value, ranked_at, synced_at
       FROM rootstat_player_net_worth
       WHERE server_id = ? AND minecraft_uuid = ?
       LIMIT 1`,
    )
    .bind(serverId, uuid)
    .first<Record<string, unknown>>();

  if (!row) return null;

  return {
    server_id: str(row.server_id),
    minecraft_uuid: str(row.minecraft_uuid),
    minecraft_username: row.minecraft_username || null,
    balance_value: Number(row.balance_value) || 0,
    inventory_value: Number(row.inventory_value) || 0,
    chest_value: Number(row.chest_value) || 0,
    shop_stock_value: Number(row.shop_stock_value) || 0,
    total_value: computeNetWorthTotal(row),
    ranked_at: row.ranked_at || null,
    synced_at: row.synced_at || null,
  };
}

export async function netWorthLeaderboard(
  db: D1Database,
  serverId: string,
  limit = 25,
): Promise<Record<string, unknown>[]> {
  const { results } = await db
    .prepare(
      `SELECT minecraft_uuid, minecraft_username, balance_value, inventory_value,
              chest_value, shop_stock_value, total_value, ranked_at, synced_at
       FROM rootstat_player_net_worth
       WHERE server_id = ?
       ${economySystemAccountSqlFilter}
       ORDER BY total_value DESC
       LIMIT ?`,
    )
    .bind(serverId, Math.min(100, Math.max(1, limit)))
    .all<Record<string, unknown>>();

  return (results || []).map((row, idx) => ({
    rank: idx + 1,
    minecraft_uuid: str(row.minecraft_uuid),
    minecraft_username: row.minecraft_username || null,
    balance_value: Number(row.balance_value) || 0,
    inventory_value: Number(row.inventory_value) || 0,
    chest_value: Number(row.chest_value) || 0,
    shop_stock_value: Number(row.shop_stock_value) || 0,
    total_value: computeNetWorthTotal(row),
    synced_at: row.synced_at || null,
  }));
}

export async function serverItemTotals(
  db: D1Database,
  serverId: string,
  limit = 50,
): Promise<Record<string, unknown>[]> {
  const { results } = await db
    .prepare(
      `SELECT s.item_key, s.total_quantity, s.synced_at, p.avg_price
       FROM rootstat_server_item_totals s
       LEFT JOIN rootstat_shop_prices p
         ON p.server_id = s.server_id AND p.item_key = s.item_key
       WHERE s.server_id = ?
       ORDER BY s.total_quantity DESC
       LIMIT ?`,
    )
    .bind(serverId, Math.min(200, Math.max(1, limit)))
    .all<Record<string, unknown>>();

  return (results || []).map((row) => ({
    item_key: str(row.item_key),
    total_quantity: Number(row.total_quantity) || 0,
    avg_price: Number(row.avg_price) || 0,
    synced_at: row.synced_at || null,
  }));
}

async function pruneShopPriceHistory(db: D1Database, serverId: string, keepDays = 14): Promise<number> {
  const cutoff = new Date(Date.now() - keepDays * 86_400_000).toISOString();
  const result = await db
    .prepare(`DELETE FROM rootmc_shop_price_history WHERE server_id = ? AND recorded_at < ?`)
    .bind(serverId, cutoff)
    .run();
  return Number(result.meta?.changes) || 0;
}

/** Append history only when price moved or last sample is stale  -  avoids D1 bloat on 5-min sync. */
async function recordShopPriceHistory(
  db: D1Database,
  serverId: string,
  syncedAt: string,
): Promise<number> {
  const prices = await shopPriceCatalog(db, serverId, 200);
  const historical = await historicalAveragePrices(db, serverId);
  let count = 0;
  const minGapMs = 3_600_000; // 1h between unchanged samples
  for (const row of prices) {
    const itemKey = normalizeItemKey(str(row.item_key));
    const availableAvg = Number(row.avg_price) || 0;
    const samples = Number(row.sample_count) || 0;
    if (!itemKey || availableAvg <= 0) continue;

    const referenceAvg = blendMarketReferencePrice(availableAvg, historical.get(itemKey) ?? 0);

    const latest = await db
      .prepare(
        `SELECT avg_price, recorded_at FROM rootmc_shop_price_history
         WHERE server_id = ? AND item_key = ?
         ORDER BY recorded_at DESC LIMIT 1`,
      )
      .bind(serverId, itemKey)
      .first<{ avg_price: number; recorded_at: string }>();

    if (latest) {
      const lastAvg = Number(latest.avg_price) || 0;
      const lastAt = Date.parse(str(latest.recorded_at));
      const unchanged = Math.abs(lastAvg - referenceAvg) < 0.01;
      const recent = Number.isFinite(lastAt) && Date.now() - lastAt < minGapMs;
      if (unchanged && recent) continue;
    }

    await db
      .prepare(
        `INSERT INTO rootmc_shop_price_history (server_id, item_key, avg_price, sample_count, recorded_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .bind(serverId, itemKey, referenceAvg, samples, syncedAt)
      .run();
    count++;
  }
  return count;
}

async function recomputeShopPriceForItem(
  db: D1Database,
  serverId: string,
  itemKey: string,
  syncedAt: string,
  source = "rootmc-shops",
): Promise<boolean> {
  const normalized = normalizeItemKey(itemKey);
  if (!normalized) return false;

  const { results } = await db
    .prepare(
      `SELECT price, listing_type, stock_quantity, item_key
       FROM rootstat_shop_listings
       WHERE server_id = ? AND item_key = ?`,
    )
    .bind(serverId, normalized)
    .all<Record<string, unknown>>();

  const priceRows = shopPricesFromInStockListings(results || [], source);
  if (priceRows.length > 0 && priceRows[0]!.prices.length > 0) {
    await upsertShopPrices(db, serverId, priceRows, syncedAt);
    return true;
  }
  await db
    .prepare(`DELETE FROM rootstat_shop_prices WHERE server_id = ? AND item_key = ?`)
    .bind(serverId, normalized)
    .run();
  return false;
}

async function upsertOneShopListing(
  db: D1Database,
  serverId: string,
  raw: Record<string, unknown>,
  syncedAt: string,
): Promise<boolean> {
  const shopId = str(raw.shop_id);
  const itemKey = normalizeItemKey(str(raw.item_key));
  const price = Number(raw.price);
  const worldName = str(raw.world || raw.world_name);
  const x = Number(raw.x);
  const y = Number(raw.y);
  const z = Number(raw.z);
  if (!shopId || !itemKey || !Number.isFinite(price) || price <= 0 || !worldName) return false;

  const ownerUuid = normalizeMinecraftUuid(str(raw.owner_uuid)) || null;
  const ownerUsername = str(raw.owner_username) || null;
  const listingType = str(raw.listing_type) || "sell";
  const stockQuantity = Math.max(0, Math.floor(Number(raw.stock_quantity) || 0));

  try {
    await db
      .prepare(
        `INSERT INTO rootstat_shop_listings
           (server_id, shop_id, owner_uuid, owner_username, world_name, x, y, z, item_key, price, listing_type, stock_quantity, synced_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(server_id, shop_id) DO UPDATE SET
           owner_uuid = excluded.owner_uuid,
           owner_username = excluded.owner_username,
           world_name = excluded.world_name,
           x = excluded.x,
           y = excluded.y,
           z = excluded.z,
           item_key = excluded.item_key,
           price = excluded.price,
           listing_type = excluded.listing_type,
           stock_quantity = excluded.stock_quantity,
           synced_at = excluded.synced_at`,
      )
      .bind(serverId, shopId, ownerUuid, ownerUsername, worldName, x, y, z, itemKey, price, listingType, stockQuantity, syncedAt)
      .run();
    return true;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (!msg.includes("stock_quantity")) throw e;
    await db
      .prepare(
        `INSERT INTO rootstat_shop_listings
           (server_id, shop_id, owner_uuid, owner_username, world_name, x, y, z, item_key, price, listing_type, synced_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(server_id, shop_id) DO UPDATE SET
           owner_uuid = excluded.owner_uuid,
           owner_username = excluded.owner_username,
           world_name = excluded.world_name,
           x = excluded.x,
           y = excluded.y,
           z = excluded.z,
           item_key = excluded.item_key,
           price = excluded.price,
           listing_type = excluded.listing_type,
           synced_at = excluded.synced_at`,
      )
      .bind(serverId, shopId, ownerUuid, ownerUsername, worldName, x, y, z, itemKey, price, listingType, syncedAt)
      .run();
    return true;
  }
}

const CANONICAL_ROOTMC_SERVER = "rootmc";

async function applyShopListingPatch(
  db: D1Database,
  serverId: string,
  action: "upsert" | "delete",
  listing: Record<string, unknown> | null,
  shopId: string,
  itemKey: string,
  previousItemKey: string,
  syncedAt: string,
): Promise<{ upserted: boolean; deleted: boolean; priceItems: number }> {
  let upserted = false;
  let deleted = false;
  const affected = new Set<string>();

  if (action === "delete") {
    const sid = str(listing?.shop_id) || shopId;
    if (!sid) return { upserted: false, deleted: false, priceItems: 0 };

    const existing = await db
      .prepare(`SELECT item_key FROM rootstat_shop_listings WHERE server_id = ? AND shop_id = ?`)
      .bind(serverId, sid)
      .first<{ item_key: string }>();

    if (existing?.item_key) affected.add(str(existing.item_key));
    if (itemKey) affected.add(normalizeItemKey(itemKey));
    if (previousItemKey) affected.add(normalizeItemKey(previousItemKey));

    await db.prepare(`DELETE FROM rootstat_shop_listings WHERE server_id = ? AND shop_id = ?`).bind(serverId, sid).run();
    deleted = true;
  } else if (listing) {
    upserted = await upsertOneShopListing(db, serverId, listing, syncedAt);
    const key = normalizeItemKey(str(listing.item_key));
    if (key) affected.add(key);
    if (previousItemKey) affected.add(normalizeItemKey(previousItemKey));
  }

  let priceItems = 0;
  for (const key of affected) {
    if (!key) continue;
    if (await recomputeShopPriceForItem(db, serverId, key, syncedAt)) priceItems++;
  }

  return { upserted, deleted, priceItems };
}

export async function handleShopListingSync(
  request: Request,
  env: RootStatEnv,
): Promise<Response> {
  const server = await validateServerAuth(env, request);
  if (server instanceof Response) return server;

  let body: Record<string, unknown> = {};
  try {
    body = record(JSON.parse(await request.text()));
  } catch {
    return json({ detail: "Invalid JSON body." }, 400);
  }

  const actionRaw = str(body.action).toLowerCase();
  const action = actionRaw === "delete" ? "delete" : "upsert";
  const syncedAt = str(body.synced_at) || nowIso();
  const listing = action === "upsert" && body.listing && typeof body.listing === "object" ? record(body.listing) : null;
  const shopId = str(body.shop_id);
  const itemKey = str(body.item_key);
  const previousItemKey = str(body.previous_item_key);

  if (action === "upsert" && !listing) {
    return json({ detail: "listing required for upsert." }, 400);
  }
  if (action === "delete" && !shopId && !str(listing?.shop_id)) {
    return json({ detail: "shop_id required for delete." }, 400);
  }

  try {
    const primary = await applyShopListingPatch(
      env.DB,
      server.serverId,
      action,
      listing,
      shopId,
      itemKey,
      previousItemKey,
      syncedAt,
    );

    if (server.serverId !== CANONICAL_ROOTMC_SERVER) {
      await applyShopListingPatch(
        env.DB,
        CANONICAL_ROOTMC_SERVER,
        action,
        listing,
        shopId,
        itemKey,
        previousItemKey,
        syncedAt,
      );
    }

    return json({
      ok: true,
      action,
      shop_id: shopId || str(listing?.shop_id) || null,
      upserted: primary.upserted,
      deleted: primary.deleted,
      price_items_updated: primary.priceItems,
      synced_at: syncedAt,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("shop_listing_sync_failed", server.serverId, msg.slice(0, 500));
    return json({ detail: `Shop listing sync failed: ${msg.slice(0, 240)}` }, 500);
  }
}

export async function handlePhysicalGoldSync(
  request: Request,
  env: RootStatEnv,
): Promise<Response> {
  const server = await validateServerAuth(env, request);
  if (server instanceof Response) return server;

  try {
    let body: Record<string, unknown> = {};
    try {
      body = record(JSON.parse(await request.text()));
    } catch {
      return json({ detail: "Invalid JSON body." }, 400);
    }
    const syncedAt = str(body.synced_at) || nowIso();
    const result = await upsertPhysicalGoldScan(env.DB, server.serverId, body, syncedAt);
    // Mint/treasury public pages read canonical slug "rootmc"; heartbeat auth uses the registered UUID.
    if (server.serverId !== CANONICAL_ROOTMC_SERVER) {
      await upsertPhysicalGoldScan(env.DB, CANONICAL_ROOTMC_SERVER, body, syncedAt);
    }
    return json({
      ok: true,
      server_id: server.serverId,
      synced_at: syncedAt,
      players_upserted: result.players,
      total_storage_g: result.totalStorageG,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("physical_gold_sync_failed", server.serverId, msg.slice(0, 500));
    return json({ detail: `Physical gold sync failed: ${msg.slice(0, 240)}` }, 500);
  }
}

export async function handleEconomySync(
  request: Request,
  env: RootStatEnv,
): Promise<Response> {
  const server = await validateServerAuth(env, request);
  if (server instanceof Response) return server;

  try {
    return await handleEconomySyncBody(request, env, server);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("economy_sync_failed", server.serverId, msg.slice(0, 500));
    return json({ detail: `Economy sync failed: ${msg.slice(0, 240)}` }, 500);
  }
}

async function handleEconomySyncBody(
  request: Request,
  env: RootStatEnv,
  server: { serverId: string },
): Promise<Response> {
  let body: Record<string, unknown> = {};
  try {
    body = record(JSON.parse(await request.text()));
  } catch {
    return json({ detail: "Invalid JSON body." }, 400);
  }

  const syncedAt = str(body.synced_at) || nowIso();
  let shopCount = 0;
  let listingCount = 0;
  let balanceCount = 0;
  let playerItemCount = 0;
  let serverItemCount = 0;

  const shopRaw = Array.isArray(body.shop_prices) ? body.shop_prices : [];
  const shopRows: Array<{ item_key: string; prices: number[]; source?: string }> = [];
  for (const raw of shopRaw) {
    const row = record(raw);
    const itemKey = str(row.item_key);
    const prices = parsePriceList(row.prices);
    if (!itemKey || prices.length === 0) continue;
    shopRows.push({ item_key: itemKey, prices, source: str(row.source) || "sign_scan" });
  }

  const listingRaw = Array.isArray(body.shop_listings) ? body.shop_listings : [];
  const listingRows = listingRaw.filter(
    (row): row is Record<string, unknown> => !!row && typeof row === "object",
  );
  const priceSource = shopRows[0]?.source || "rootmc-shops";
  const recomputed = shopPricesFromInStockListings(listingRows, priceSource);
  const effectiveShopRows = recomputed.length > 0 ? recomputed : shopRows;
  if (effectiveShopRows.length > 0) {
    shopCount = await upsertShopPrices(env.DB, server.serverId, effectiveShopRows, syncedAt);
  }
  if (listingRows.length > 0) {
    listingCount = await replaceShopListings(env.DB, server.serverId, listingRows, syncedAt);
  }

  const CANONICAL_ROOTMC = "rootmc";
  if (server.serverId !== CANONICAL_ROOTMC && (shopCount > 0 || listingCount > 0)) {
    if (effectiveShopRows.length > 0) {
      await upsertShopPrices(env.DB, CANONICAL_ROOTMC, effectiveShopRows, syncedAt);
    }
    if (listingRows.length > 0) {
      await replaceShopListings(env.DB, CANONICAL_ROOTMC, listingRows, syncedAt);
    }
  }

  const balances = Array.isArray(body.balances) ? body.balances : [];
  const pendingUuids = await pendingTransferUuidSet(env.DB, server.serverId);
  let balancesSkippedPending = 0;
  if (balances.length > 0) {
    await env.DB.prepare(`DELETE FROM rootstat_player_balances WHERE server_id = ?`)
      .bind(server.serverId)
      .run();
  }
  for (const raw of balances) {
    const row = record(raw);
    const uuid = normalizeMinecraftUuid(str(row.minecraft_uuid));
    if (!uuid) continue;
    if (pendingUuids.has(uuid)) {
      balancesSkippedPending++;
      continue;
    }
    const balance = Number(row.balance);
    if (!Number.isFinite(balance)) continue;
    await env.DB.prepare(
      `INSERT INTO rootstat_player_balances
         (server_id, minecraft_uuid, minecraft_username, balance, currency, synced_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(server_id, minecraft_uuid) DO UPDATE SET
         minecraft_username = excluded.minecraft_username,
         balance = excluded.balance,
         currency = excluded.currency,
         synced_at = excluded.synced_at,
         updated_at = excluded.updated_at`,
    )
      .bind(
        server.serverId,
        uuid,
        str(row.minecraft_username) || null,
        balance,
        str(row.currency) || "default",
        syncedAt,
        syncedAt,
      )
      .run();
    balanceCount++;
  }

  const systemBalancesRaw = Array.isArray(body.system_balances) ? body.system_balances : [];
  const systemBalanceCount = await upsertSystemAccountBalances(
    env.DB,
    server.serverId,
    systemBalancesRaw.filter((row): row is Record<string, unknown> => !!row && typeof row === "object"),
    syncedAt,
  );
  if (server.serverId !== CANONICAL_ROOTMC && systemBalanceCount > 0) {
    await upsertSystemAccountBalances(
      env.DB,
      CANONICAL_ROOTMC,
      systemBalancesRaw.filter((row): row is Record<string, unknown> => !!row && typeof row === "object"),
      syncedAt,
    );
  }

  const playerItems = Array.isArray(body.player_items) ? body.player_items : [];
  // Inventory scan is online-only; drop stale rows so offline players are not over-counted.
  await env.DB.prepare(`DELETE FROM rootstat_player_item_totals WHERE server_id = ?`)
    .bind(server.serverId)
    .run();
  for (const raw of playerItems) {
    const row = record(raw);
    const uuid = normalizeMinecraftUuid(str(row.minecraft_uuid));
    if (!uuid) continue;
    const items = parseItemMap(row.items);
    for (const [itemKey, qty] of Object.entries(items)) {
      await env.DB.prepare(
        `INSERT INTO rootstat_player_item_totals
           (server_id, minecraft_uuid, item_key, quantity, source, synced_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
        .bind(server.serverId, uuid, itemKey, qty, str(row.source) || "inventory", syncedAt)
        .run();
      playerItemCount++;
    }
  }

  const serverItems = parseItemMap(body.server_items);
  let serverItemWrites = 0;
  for (const [itemKey, qty] of Object.entries(serverItems)) {
    if (serverItemWrites >= 400) break;
    await env.DB.prepare(
      `INSERT INTO rootstat_server_item_totals
         (server_id, item_key, total_quantity, synced_at, updated_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(server_id, item_key) DO UPDATE SET
         total_quantity = excluded.total_quantity,
         synced_at = excluded.synced_at,
         updated_at = excluded.updated_at`,
    )
      .bind(server.serverId, itemKey, qty, syncedAt, syncedAt)
      .run();
    serverItemCount++;
    serverItemWrites++;
  }

  const netWorthCount = await recomputeNetWorth(env.DB, server.serverId, syncedAt);
  if (server.serverId !== CANONICAL_ROOTMC && (shopCount > 0 || listingCount > 0 || balanceCount > 0)) {
    await mirrorNetWorthSources(env.DB, server.serverId, CANONICAL_ROOTMC, syncedAt);
    await recomputeNetWorth(env.DB, CANONICAL_ROOTMC, syncedAt);
  }
  const priceHistoryPruned = await pruneShopPriceHistory(env.DB, server.serverId, 14);
  const historyServerId =
    server.serverId !== CANONICAL_ROOTMC && (shopCount > 0 || listingCount > 0)
      ? CANONICAL_ROOTMC
      : server.serverId;
  const priceHistoryCount = await recordShopPriceHistory(env.DB, historyServerId, syncedAt);
  if (server.serverId !== CANONICAL_ROOTMC) {
    await pruneShopPriceHistory(env.DB, CANONICAL_ROOTMC, 14);
  }

  const treasuryLedgerRaw = Array.isArray(body.treasury_ledger) ? body.treasury_ledger : [];
  const treasuryLedgerRows = treasuryLedgerRaw.filter(
    (row): row is Record<string, unknown> => !!row && typeof row === "object",
  );
  const ledgerResult = await upsertTreasuryLedgerRows(env.DB, CANONICAL_ROOTMC, treasuryLedgerRows, syncedAt);

  // Vault balance is updated only via MySQL pull (pullTreasuryBalance). The live jar can read 0
  // while Shockbyte/MySQL still holds the reconciled reserve  -  writing it here caused false zeros on the site.

  const playtimeMonthlyRaw = Array.isArray(body.playtime_monthly) ? body.playtime_monthly : [];
  const playtimeMonthlyRows = playtimeMonthlyRaw.filter(
    (row): row is Record<string, unknown> => !!row && typeof row === "object",
  );
  const playtimeMonthlyCount = await upsertPlaytimeMonthlyRows(
    env.DB,
    server.serverId,
    playtimeMonthlyRows,
    syncedAt,
  );

  const townTaxRaw = Array.isArray(body.town_tax_rates) ? body.town_tax_rates : [];
  const townTaxRows = townTaxRaw.filter(
    (row): row is Record<string, unknown> => !!row && typeof row === "object",
  );
  let townTaxCount = 0;
  if (townTaxRows.length > 0) {
    townTaxCount = await replaceTownTaxRates(env.DB, server.serverId, townTaxRows, syncedAt);
  }

  const goldFoundRaw = Array.isArray(body.gold_found) ? body.gold_found : [];
  const goldFoundRows = goldFoundRaw.filter(
    (row): row is Record<string, unknown> => !!row && typeof row === "object",
  );
  const goldFoundCount = await upsertGoldFoundRows(env.DB, server.serverId, goldFoundRows, syncedAt);
  if (server.serverId !== CANONICAL_ROOTMC && goldFoundCount > 0) {
    await upsertGoldFoundRows(env.DB, CANONICAL_ROOTMC, goldFoundRows, syncedAt);
  }

  const goldItemEventsRaw = Array.isArray(body.gold_item_events) ? body.gold_item_events : [];
  const goldItemEventRows = goldItemEventsRaw.filter(
    (row): row is Record<string, unknown> => !!row && typeof row === "object",
  );
  const goldItemEventsCount = await upsertGoldItemEventRows(
    env.DB,
    server.serverId,
    goldItemEventRows,
    syncedAt,
  );
  if (server.serverId !== CANONICAL_ROOTMC && goldItemEventsCount > 0) {
    await upsertGoldItemEventRows(env.DB, CANONICAL_ROOTMC, goldItemEventRows, syncedAt);
  }

  return json({
    ok: true,
    server_id: server.serverId,
    synced_at: syncedAt,
    shop_prices_upserted: shopCount,
    shop_listings_upserted: listingCount,
    balances_upserted: balanceCount,
    balances_skipped_pending: balancesSkippedPending,
    player_item_rows: playerItemCount,
    server_item_rows: serverItemCount,
    net_worth_recomputed: netWorthCount,
    price_history_recorded: priceHistoryCount,
    price_history_pruned: priceHistoryPruned,
    treasury_ledger_upserted: ledgerResult.upserted,
    playtime_monthly_upserted: playtimeMonthlyCount,
    town_tax_rates_upserted: townTaxCount,
    gold_found_upserted: goldFoundCount,
    gold_item_events_upserted: goldItemEventsCount,
    treasury_balance: Number.isFinite(Number(body.treasury_balance)) ? Number(body.treasury_balance) : null,
  });
}

export async function handleRootMcEconomyServer(
  request: Request,
  env: RootStatEnv,
  subpath: string,
  method: string,
): Promise<Response | null> {
  if (!subpath.startsWith("/rootmc/server")) return null;
  const rest = subpath.slice("/rootmc/server".length) || "/";

  const shopsPricesMatch = rest.match(/^\/([^/]+)\/shops\/prices$/);
  if (method === "GET" && shopsPricesMatch) {
    const serverId = await resolvePublicServerId(env.DB, decodeURIComponent(shopsPricesMatch[1]));
    const url = new URL(request.url);
    const limit = Number(url.searchParams.get("limit")) || 100;
    const prices = await shopPriceCatalog(env.DB, serverId, limit);
    return json({
      server_id: serverId,
      share_url: shopsShareUrl(env.SITE_URL, serverId),
      prices,
      synced_at: nowIso(),
    });
  }

  const shopsPlayerMatch = rest.match(/^\/([^/]+)\/shops\/player\/([^/]+)$/);
  if (method === "GET" && shopsPlayerMatch) {
    const serverId = await resolvePublicServerId(env.DB, decodeURIComponent(shopsPlayerMatch[1]));
    const playerUuid = normalizeMinecraftUuid(decodeURIComponent(shopsPlayerMatch[2]));
    if (!playerUuid) return json({ detail: "Invalid player UUID." }, 400);
    const url = new URL(request.url);
    const limit = Number(url.searchParams.get("limit")) || 100;
    const listings = await shopListingsForPlayer(env.DB, serverId, playerUuid, limit);
    return json({
      server_id: serverId,
      player_uuid: playerUuid,
      share_url: shopsShareUrl(env.SITE_URL, serverId, playerUuid),
      listings,
      synced_at: nowIso(),
    });
  }

  const shopsMatch = rest.match(/^\/([^/]+)\/shops$/);
  if (method === "GET" && shopsMatch) {
    const serverId = await resolvePublicServerId(env.DB, decodeURIComponent(shopsMatch[1]));
    const url = new URL(request.url);
    const limit = Number(url.searchParams.get("limit")) || 100;
    const listings = await shopListingsForServer(env.DB, serverId, limit);
    const prices = await shopPriceCatalog(env.DB, serverId, Math.min(limit, 100));
    const leaderboard = await netWorthLeaderboard(env.DB, serverId, 10);
    return json({
      server_id: serverId,
      share_url: shopsShareUrl(env.SITE_URL, serverId),
      listings,
      prices,
      net_worth_leaderboard: leaderboard,
      synced_at: nowIso(),
    });
  }

  const leaderboardMatch = rest.match(/^\/([^/]+)\/economy\/net-worth$/);
  if (method === "GET" && leaderboardMatch) {
    const serverId = await resolveEconomyServerId(env.DB, decodeURIComponent(leaderboardMatch[1]));
    const url = new URL(request.url);
    const limit = Number(url.searchParams.get("limit")) || 25;
    const leaderboard = await netWorthLeaderboard(env.DB, serverId, limit);
    return json({
      server_id: serverId,
      share_url: shopsShareUrl(env.SITE_URL, serverId),
      leaderboard,
      synced_at: nowIso(),
    });
  }

  const goldSupplyMatch = rest.match(/^\/([^/]+)\/economy\/gold-supply$/);
  if (method === "GET" && goldSupplyMatch) {
    const serverId = await resolveEconomyServerId(env.DB, decodeURIComponent(goldSupplyMatch[1]));
    const url = new URL(request.url);
    const limit = Number(url.searchParams.get("limit")) || 200;
    const report = await goldSupplyReport(env.DB, serverId, { playerLimit: limit });
    return json(report);
  }

  const circulatingMatch = rest.match(/^\/([^/]+)\/economy\/circulating-balances$/);
  if (method === "GET" && circulatingMatch) {
    const serverId = await resolveEconomyServerId(env.DB, decodeURIComponent(circulatingMatch[1]));
    const url = new URL(request.url);
    const limit = Number(url.searchParams.get("limit")) || 500;
    const report = await circulatingBalancesReport(env.DB, serverId, { limit });
    return json(report);
  }

  const totalsMatch = rest.match(/^\/([^/]+)\/economy\/totals$/);
  if (method === "GET" && totalsMatch) {
    const serverId = decodeURIComponent(totalsMatch[1]);
    const url = new URL(request.url);
    const limit = Number(url.searchParams.get("limit")) || 50;
    const items = await serverItemTotals(env.DB, serverId, limit);
    const sumRow = await env.DB.prepare(
      `SELECT COALESCE(SUM(total_quantity), 0) AS total_items
       FROM rootstat_server_item_totals WHERE server_id = ?`,
    )
      .bind(serverId)
      .first<{ total_items: number }>();
    return json({
      server_id: serverId,
      share_url: shopsShareUrl(env.SITE_URL, serverId),
      total_item_stacks: Number(sumRow?.total_items) || 0,
      items,
      synced_at: nowIso(),
    });
  }

  const meMatch = rest.match(/^\/([^/]+)\/economy\/me$/);
  if (method === "GET" && meMatch) {
    const auth = await requireSignedInAccount(request, env);
    if (auth instanceof Response) return auth;

    const serverId = decodeURIComponent(meMatch[1]);
    const link = await env.DB.prepare(
      `SELECT minecraft_uuid, minecraft_username FROM rootstat_minecraft_links WHERE account_id = ? LIMIT 1`,
    )
      .bind(auth.accountId)
      .first<Record<string, unknown>>();

    const uuid = str(link?.minecraft_uuid);
    if (!uuid) {
      return json({
        server_id: serverId,
        minecraft_linked: false,
        rootstat_linked: false,
        net_worth: null,
      });
    }

    const netWorth = await netWorthForPlayer(env.DB, serverId, uuid);
    const rankRow = netWorth
      ? await env.DB.prepare(
          `SELECT COUNT(*) + 1 AS rank
           FROM rootstat_player_net_worth
           WHERE server_id = ? AND total_value > ?
           ${economySystemAccountSqlFilter}`,
        )
          .bind(serverId, Number(netWorth.total_value) || 0)
          .first<{ rank: number }>()
      : null;

    const treasury = await treasurySummaryForPlayer(env.DB, serverId, uuid);

    return json({
      server_id: serverId,
      minecraft_linked: true,
      rootstat_linked: true,
      minecraft_uuid: uuid,
      minecraft_username: link?.minecraft_username || null,
      net_worth: netWorth,
      rank: rankRow?.rank ?? null,
      treasury,
    });
  }

  return null;
}
