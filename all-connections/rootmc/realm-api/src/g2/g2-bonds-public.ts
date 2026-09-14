import { json } from "../cors";
import { msToIso, type G2Env } from "./g2-db";

type JsonObj = Record<string, unknown>;

function num(v: unknown, fallback = 0): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function str(v: unknown): string {
  return typeof v === "string" ? v : v == null ? "" : String(v);
}

function asArray(v: unknown): JsonObj[] {
  return Array.isArray(v) ? (v as JsonObj[]) : [];
}

function avgYieldFromDaily(daily: JsonObj[], lookback = 48): {
  avg_daily_yield_pct: number;
  avg_daily_yield_g_per_g: number;
  avg_daily_yield_sample_days: number;
} {
  let sum = 0;
  let n = 0;
  for (const row of daily) {
    if (n >= lookback) break;
    const principal = num(row.total_principal_g);
    if (principal < 0.001) continue;
    sum += (num(row.bond_pool_g) / principal) * 100;
    n += 1;
  }
  if (n <= 0) {
    return {
      avg_daily_yield_pct: 0,
      avg_daily_yield_g_per_g: 0,
      avg_daily_yield_sample_days: 0,
    };
  }
  const pct = Math.round((sum / n) * 10000) / 10000;
  return {
    avg_daily_yield_pct: pct,
    avg_daily_yield_g_per_g: Math.round((pct / 100) * 1e8) / 1e8,
    avg_daily_yield_sample_days: n,
  };
}

function buildSummary(payload: JsonObj) {
  const summary = (payload.summary && typeof payload.summary === "object"
    ? (payload.summary as JsonObj)
    : {}) as JsonObj;
  const daily = asArray(payload.daily_settlements);
  const players = asArray(payload.players);
  const governments = asArray(payload.governments);
  const yieldStats =
    num(summary.avg_daily_yield_sample_days) > 0
      ? {
          avg_daily_yield_pct: num(summary.avg_daily_yield_pct),
          avg_daily_yield_g_per_g: num(summary.avg_daily_yield_g_per_g),
          avg_daily_yield_sample_days: Math.floor(num(summary.avg_daily_yield_sample_days)),
        }
      : avgYieldFromDaily(daily);

  const last = daily[0] || null;
  const pending =
    summary.pending_day && typeof summary.pending_day === "object"
      ? (summary.pending_day as JsonObj)
      : {
          mc_day_id: num(payload.pending_mc_day_id),
          gross_inflow_g: num(payload.pending_gross_inflow_g),
          estimated_pool_g: num(payload.pending_gross_inflow_g) * num(payload.income_share, 0.25),
        };

  let uncollected = 0;
  let lifetime = 0;
  for (const p of players) {
    uncollected += num(p.uncollected_g);
    lifetime += num(p.lifetime_earned_g);
  }
  for (const g of governments) {
    lifetime += num(g.lifetime_earned_g);
  }

  const incomeShare = num(summary.income_share, num(payload.income_share, 0.25));
  return {
    active_bonds: Math.floor(num(summary.active_bonds, players.length)),
    holder_count: Math.floor(num(summary.holder_count, players.length)),
    total_principal_g: num(summary.total_principal_g),
    player_principal_g: num(summary.player_principal_g),
    government_principal_g: num(summary.government_principal_g),
    uncollected_g: Math.round(uncollected * 1000) / 1000,
    lifetime_earned_g: Math.round(lifetime * 1000) / 1000,
    income_share: incomeShare,
    income_share_pct: Math.round(incomeShare * 1000) / 10,
    settlement_days: daily.length,
    pool_7d_g: daily.slice(0, 14).reduce((a, d) => a + num(d.bond_pool_g), 0),
    pool_24h_g: daily.slice(0, 48).reduce((a, d) => a + num(d.bond_pool_g), 0),
    avg_pool_per_mc_day_7d: 0,
    ...yieldStats,
    last_settlement: last
      ? {
          mc_day_id: Math.floor(num(last.mc_day_id)),
          gross_inflow_g: num(last.gross_inflow_g),
          bond_pool_g: num(last.bond_pool_g),
          total_principal_g: num(last.total_principal_g),
          active_bonds: Math.floor(num(last.active_bonds)),
          settled_at: str(last.settled_at),
        }
      : null,
    pending_day: {
      mc_day_id: Math.floor(num(pending.mc_day_id)),
      gross_inflow_g: num(pending.gross_inflow_g),
      estimated_pool_g: num(pending.estimated_pool_g),
      synced_at: str(payload.synced_at),
    },
  };
}

async function loadBondsPayload(env: G2Env, realmId: string): Promise<{ payload: JsonObj; updatedAtMs: number } | null> {
  const row = await env.DB.prepare(
    `SELECT payload_json, updated_at_ms FROM g2_snap_bonds WHERE realm_id = ? LIMIT 1`,
  )
    .bind(realmId)
    .first<{ payload_json: string; updated_at_ms: number }>();
  if (!row?.payload_json) return null;
  try {
    const payload = JSON.parse(row.payload_json) as JsonObj;
    return { payload, updatedAtMs: num(row.updated_at_ms) };
  } catch {
    return null;
  }
}

/** Public bonds API for Gen2 — served from compact g2_snap_bonds JSON (one row / realm). */
export async function handleG2BondsPublicRoutes(
  request: Request,
  env: G2Env,
  subpath: string,
  method: string,
): Promise<Response | null> {
  if (method !== "GET" || !subpath.startsWith("/rootmc/server")) return null;
  const rest = subpath.slice("/rootmc/server".length) || "/";

  const summaryMatch = rest.match(/^\/([^/]+)\/bonds$/);
  if (summaryMatch) {
    const realmId = decodeURIComponent(summaryMatch[1]);
    const loaded = await loadBondsPayload(env, realmId);
    if (!loaded) {
      return json({
        server_id: realmId,
        summary: buildSummary({}),
        daily_settlements: [],
        players: [],
        governments: [],
        synced_at: null,
        detail: "No Gen2 bonds snapshot yet.",
      });
    }
    const url = new URL(request.url);
    const dailyLimit = Math.min(120, Math.max(1, Number(url.searchParams.get("daily_limit")) || 30));
    const daily = asArray(loaded.payload.daily_settlements).slice(0, dailyLimit);
    const summary = buildSummary({ ...loaded.payload, daily_settlements: daily });
    return json({
      server_id: realmId,
      summary,
      daily_settlements: daily,
      players: asArray(loaded.payload.players),
      governments: asArray(loaded.payload.governments),
      synced_at: str(loaded.payload.synced_at) || msToIso(loaded.updatedAtMs),
    });
  }

  const playerMatch = rest.match(/^\/([^/]+)\/bonds\/player\/([^/]+)$/);
  if (playerMatch) {
    const realmId = decodeURIComponent(playerMatch[1]);
    const playerUuid = decodeURIComponent(playerMatch[2]).toLowerCase();
    const loaded = await loadBondsPayload(env, realmId);
    if (!loaded) {
      return json({ detail: "No Gen2 bonds snapshot yet." }, 404);
    }
    const players = asArray(loaded.payload.players);
    const stats = players.find((p) => str(p.owner_uuid).toLowerCase() === playerUuid) || null;
    const bonds = asArray(loaded.payload.bonds).filter(
      (b) => str(b.owner_uuid).toLowerCase() === playerUuid,
    );
    const payouts = asArray(loaded.payload.daily_payouts)
      .filter((p) => str(p.owner_uuid).toLowerCase() === playerUuid)
      .slice(0, 120);
    let earned24h = 0;
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    for (const p of payouts) {
      const t = Date.parse(str(p.settled_at));
      if (Number.isFinite(t) && t >= cutoff) earned24h += num(p.amount_g);
    }
    return json({
      server_id: realmId,
      player_uuid: playerUuid,
      stats,
      bonds,
      payouts,
      earned_24h_g: Math.round(earned24h * 1000) / 1000,
    });
  }

  return null;
}
