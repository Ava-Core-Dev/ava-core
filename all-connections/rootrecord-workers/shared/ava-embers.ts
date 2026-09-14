/**
 * Ava Embers ($EMBER) — Pump.fun sub-shard. Not a vote.
 * Ava forges Embers into Ava Shards from live USDC value (100 shards per $1).
 */
export const EMBER_NAME = "Ava Embers";
export const EMBER_TICKER = "EMBER";
export const EMBER_LORE =
  "Embers are street heat from Pump.fun — unbound Root fire, not a vote. Swap them with Ava and she forges Ava Shards from what the Embers are worth in USDC, not from how many tokens you hold.";

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

async function jupiterUsd(mint: string): Promise<number> {
  const urls = [
    `https://lite-api.jup.ag/price/v2?ids=${encodeURIComponent(mint)}`,
    `https://api.jup.ag/price/v2?ids=${encodeURIComponent(mint)}`,
  ];
  for (const url of urls) {
    try {
      const res = await fetch(url, { headers: { accept: "application/json" } });
      if (!res.ok) continue;
      const data = (await res.json()) as { data?: Record<string, { price?: string | number }> };
      const p = num(data.data?.[mint]?.price);
      if (p > 0) return p;
    } catch {
      /* next */
    }
  }
  return 0;
}

async function dexscreenerUsd(mint: string): Promise<number> {
  try {
    const res = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${encodeURIComponent(mint)}`, {
      headers: { accept: "application/json" },
    });
    if (!res.ok) return 0;
    const data = (await res.json()) as { pairs?: { priceUsd?: string; liquidity?: { usd?: number } }[] };
    const pairs = Array.isArray(data.pairs) ? data.pairs : [];
    const ranked = [...pairs].sort((a, b) => num(b.liquidity?.usd) - num(a.liquidity?.usd));
    for (const p of ranked) {
      const px = num(p.priceUsd);
      if (px > 0) return px;
    }
  } catch {
    /* ignore */
  }
  return 0;
}

async function pumpFunUsd(mint: string): Promise<number> {
  try {
    const res = await fetch(`https://frontend-api-v3.pump.fun/coins/${encodeURIComponent(mint)}`, {
      headers: { accept: "application/json" },
    });
    if (!res.ok) return 0;
    const data = (await res.json()) as Record<string, unknown>;
    const mcap = num(data.usd_market_cap);
    const supply = num(data.total_supply) || num(data.virtual_token_reserves);
    if (mcap > 0 && supply > 0) {
      const decimals = num(data.token_decimals) || 6;
      const whole = supply / 10 ** decimals;
      if (whole > 0) return mcap / whole;
    }
    const px = num(data.price_usd) || num(data.usd_price);
    if (px > 0) return px;
  } catch {
    /* ignore */
  }
  return 0;
}

export async function emberUsdPrice(mint: string): Promise<{ usd: number; source: string } | null> {
  const m = String(mint || "").trim();
  if (!m) return null;
  const jup = await jupiterUsd(m);
  if (jup > 0) return { usd: jup, source: "jupiter" };
  const dex = await dexscreenerUsd(m);
  if (dex > 0) return { usd: dex, source: "dexscreener" };
  const pump = await pumpFunUsd(m);
  if (pump > 0) return { usd: pump, source: "pump.fun" };
  return null;
}

export function shardsFromEmberUsd(usd: number): number {
  if (!Number.isFinite(usd) || usd <= 0) return 0;
  return Math.max(0, Math.floor(usd * 100));
}

export function pumpFunCoinUrl(mint: string): string {
  return `https://pump.fun/coin/${encodeURIComponent(mint)}`;
}
