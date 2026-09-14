import type { D1Database } from "@cloudflare/workers-types";

import { normalizeItemKey } from "./rootmc-economy";

/** Rolling window for historical average in the blended reference price. */
export const MARKET_REFERENCE_HISTORY_DAYS = 28;

/** Weight on current in-stock shop average (what buyers pay today). */
export const MARKET_REFERENCE_CURRENT_WEIGHT = 0.6;

/** Weight on recent historical reference samples. */
export const MARKET_REFERENCE_HISTORY_WEIGHT = 0.4;

function str(v: unknown): string {
  return String(v ?? "").trim();
}

export function roundMarketGold(value: number): number {
  return Math.round(Math.max(0, Number(value) || 0) * 100) / 100;
}

/**
 * Blended market reference: median in-stock sell average (buy-side) + recent history.
 * Used for net worth, /value charts, and stock-market display  -  not per-shop listing prices.
 */
export function blendMarketReferencePrice(availableAvg: number, historicalAvg: number): number {
  const available = Math.max(0, Number(availableAvg) || 0);
  const historical = Math.max(0, Number(historicalAvg) || 0);
  if (available > 0 && historical > 0) {
    return roundMarketGold(
      available * MARKET_REFERENCE_CURRENT_WEIGHT + historical * MARKET_REFERENCE_HISTORY_WEIGHT,
    );
  }
  return roundMarketGold(available || historical);
}

/** Median of in-stock sell listing prices  -  average price available to buyers. */
export async function availablePriceMapForServer(
  db: D1Database,
  serverId: string,
): Promise<Map<string, number>> {
  const { results } = await db
    .prepare(
      `SELECT item_key, avg_price FROM rootstat_shop_prices WHERE server_id = ? AND avg_price > 0`,
    )
    .bind(serverId)
    .all<{ item_key: string; avg_price: number }>();
  const map = new Map<string, number>();
  for (const row of results || []) {
    map.set(str(row.item_key), Number(row.avg_price) || 0);
  }
  return map;
}

export async function historicalAveragePrices(
  db: D1Database,
  serverId: string,
  days = MARKET_REFERENCE_HISTORY_DAYS,
): Promise<Map<string, number>> {
  const since = new Date(Date.now() - days * 86_400_000).toISOString();
  const { results } = await db
    .prepare(
      `SELECT item_key, AVG(avg_price) AS hist_avg
       FROM rootmc_shop_price_history
       WHERE server_id = ? AND recorded_at >= ? AND avg_price > 0
       GROUP BY item_key`,
    )
    .bind(serverId, since)
    .all<{ item_key: string; hist_avg: number }>();
  const map = new Map<string, number>();
  for (const row of results || []) {
    const key = normalizeItemKey(str(row.item_key));
    const avg = Number(row.hist_avg) || 0;
    if (key && avg > 0) map.set(key, avg);
  }
  return map;
}

/** Blended reference price per item  -  net worth, charts, and market pages. */
export async function referencePriceMapForServer(
  db: D1Database,
  serverId: string,
): Promise<Map<string, number>> {
  const available = await availablePriceMapForServer(db, serverId);
  const historical = await historicalAveragePrices(db, serverId);
  const keys = new Set([...available.keys(), ...historical.keys()]);
  const map = new Map<string, number>();
  for (const key of keys) {
    const ref = blendMarketReferencePrice(available.get(key) ?? 0, historical.get(key) ?? 0);
    if (ref > 0) map.set(key, ref);
  }
  return map;
}

export async function referencePriceForItem(
  db: D1Database,
  serverId: string,
  itemKey: string,
): Promise<number> {
  const normalized = normalizeItemKey(itemKey);
  if (!normalized) return 0;

  const availableRow = await db
    .prepare(
      `SELECT avg_price FROM rootstat_shop_prices
       WHERE server_id = ? AND item_key = ? AND avg_price > 0 LIMIT 1`,
    )
    .bind(serverId, normalized)
    .first<{ avg_price: number }>();
  const available = Number(availableRow?.avg_price) || 0;

  const since = new Date(Date.now() - MARKET_REFERENCE_HISTORY_DAYS * 86_400_000).toISOString();
  const histRow = await db
    .prepare(
      `SELECT AVG(avg_price) AS hist_avg
       FROM rootmc_shop_price_history
       WHERE server_id = ? AND item_key = ? AND recorded_at >= ? AND avg_price > 0`,
    )
    .bind(serverId, normalized, since)
    .first<{ hist_avg: number }>();
  const historical = Number(histRow?.hist_avg) || 0;

  return blendMarketReferencePrice(available, historical);
}
