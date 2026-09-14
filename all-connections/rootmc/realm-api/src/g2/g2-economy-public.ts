import { json } from "../cors";
import { handleG2BondsPublicRoutes } from "./g2-bonds-public";
import { msToIso, resolveG2FeaturedRealmId, str, type G2Env } from "./g2-db";

type Row = Record<string, unknown>;

function num(v: unknown, fallback = 0): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function roundGold(v: number): number {
  return Math.round(v * 1000) / 1000;
}

function nowIso(): string {
  return new Date().toISOString();
}

const GEN1_API_BASE = "https://api.rootmc.info";

/** Playtime + McMMO are shared across generations — always serve Gen1 boards. */
async function proxyGen1SharedLeaderboard(
  url: URL,
  kind: "playtime" | "mcmmo",
): Promise<Response> {
  try {
    const cfgRes = await fetch(`${GEN1_API_BASE}/api/rootmc/server/config`, { cache: "no-store" });
    const cfg = (await cfgRes.json().catch(() => ({}))) as {
      featured_server?: { server_id?: string };
    };
    const sid = str(cfg?.featured_server?.server_id) || "rootmc";
    const limit = Math.min(100, Math.max(1, num(url.searchParams.get("limit"), 50)));
    const target =
      `${GEN1_API_BASE}/api/rootmc/server/${encodeURIComponent(sid)}/${kind}/leaderboard?limit=${limit}`;
    const upstream = await fetch(target, { cache: "no-store" });
    const body = await upstream.arrayBuffer();
    return new Response(body, {
      status: upstream.status,
      headers: {
        "Content-Type": upstream.headers.get("Content-Type") || "application/json; charset=utf-8",
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return json({ ok: false, error: "gen1_shared_proxy_failed", detail: msg, kind }, 502);
  }
}

async function resolveRealmId(env: G2Env, requested?: string): Promise<string> {
  const id = str(requested);
  if (id) return id;
  return (await resolveG2FeaturedRealmId(env.DB)) || "g2";
}

async function realmRow(env: G2Env, realmId: string): Promise<Row | null> {
  return env.DB.prepare(
    `SELECT realm_id, realm_name, server_address, last_heartbeat_ms, last_economy_snapshot_ms, updated_at_ms
     FROM g2_realm WHERE realm_id = ? LIMIT 1`,
  )
    .bind(realmId)
    .first<Row>();
}

async function latestSnapshotIso(env: G2Env, realmId: string): Promise<string | null> {
  const row = await env.DB.prepare(
    `SELECT MAX(updated_at_ms) AS updated_at_ms FROM (
       SELECT updated_at_ms FROM g2_snap_balance WHERE realm_id = ?
       UNION ALL SELECT updated_at_ms FROM g2_snap_treasury WHERE realm_id = ?
       UNION ALL SELECT updated_at_ms FROM g2_snap_shop WHERE realm_id = ?
       UNION ALL SELECT updated_at_ms FROM g2_snap_net_worth WHERE realm_id = ?
       UNION ALL SELECT updated_at_ms FROM g2_snap_playtime WHERE realm_id = ?
     )`,
  )
    .bind(realmId, realmId, realmId, realmId, realmId)
    .first<{ updated_at_ms: number | null }>();
  const ms = num(row?.updated_at_ms);
  return ms > 0 ? msToIso(ms) : null;
}

async function treasuryRow(env: G2Env, realmId: string): Promise<{ reserve_g: number; supply_json: string | null; updated_at_ms: number } | null> {
  return env.DB.prepare(
    `SELECT reserve_g, supply_json, updated_at_ms FROM g2_snap_treasury WHERE realm_id = ? LIMIT 1`,
  )
    .bind(realmId)
    .first<{ reserve_g: number; supply_json: string | null; updated_at_ms: number }>();
}

function parseSupply(raw: string | null | undefined): Row {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Row : {};
  } catch {
    return {};
  }
}

async function balanceTotals(env: G2Env, realmId: string) {
  const row = await env.DB.prepare(
    `SELECT COALESCE(SUM(gold_g), 0) AS total_g, COUNT(*) AS count
     FROM g2_snap_balance
     WHERE realm_id = ? AND gold_g > 0.0001`,
  )
    .bind(realmId)
    .first<{ total_g: number; count: number }>();
  return { total: roundGold(num(row?.total_g)), count: Math.max(0, Math.floor(num(row?.count))) };
}

async function handleConfig(env: G2Env, url?: URL) {
  const realmId = await resolveRealmId(env, url?.searchParams.get("server_id") || undefined);
  const row = await realmRow(env, realmId);
  const name = str(row?.realm_name) || "RootMC Gen2";
  const online = await env.DB.prepare(
    `SELECT player_count FROM g2_snap_online WHERE realm_id = ? LIMIT 1`,
  )
    .bind(realmId)
    .first<{ player_count: number }>();
  return json({
    featured_server: {
      server_id: realmId,
      name,
      address: str(row?.server_address) || "g2.rootmc.net",
      default_world_name: "Gen2",
      game_version: "27",
      map_url: null,
      verify_url: "https://rootmc.net/verify/",
      realm_url: "https://rootmc.net/g2/",
      rootmc_plugin_installed: true,
      rootmc_plugin_version: null,
      rootmc_last_seen_at: num(row?.last_heartbeat_ms) > 0 ? msToIso(num(row?.last_heartbeat_ms)) : null,
      online_players: online?.player_count != null ? Number(online.player_count) : null,
    },
    generation: "gen2",
  });
}

async function handlePlayerBalance(env: G2Env, uuidRaw: string) {
  const uuid = str(uuidRaw).toLowerCase();
  if (!uuid || !/^[0-9a-f-]{36}$/.test(uuid)) {
    return json({ ok: false, detail: "Valid minecraft uuid required." }, 400);
  }
  const realmId = await resolveRealmId(env);
  const row = await env.DB.prepare(
    `SELECT player_uuid, username, gold_g, updated_at_ms
     FROM g2_snap_balance
     WHERE realm_id = ? AND LOWER(player_uuid) = ?
     LIMIT 1`,
  )
    .bind(realmId, uuid)
    .first<{ player_uuid: string; username: string | null; gold_g: number; updated_at_ms: number }>();

  let balanceG = roundGold(num(row?.gold_g));
  let username = str(row?.username) || null;
  let hasRow = Boolean(row);
  let updatedAt = num(row?.updated_at_ms) > 0 ? msToIso(num(row?.updated_at_ms)) : null;
  let source = hasRow ? "snapshot" : "none";

  // Snapshot often empty until Gen2 economy sync is wired — fall back to live MySQL.
  if (!hasRow || balanceG <= 0) {
    try {
      const { openRootMcMysql, rootMcMysqlTablePrefix } = await import("../rootmc-hyperdrive");
      const conn = await openRootMcMysql(env);
      if (conn) {
        try {
          const prefix = rootMcMysqlTablePrefix(env);
          const table = `${prefix}economy_balances`;
          const [rows] = await conn.query(
            `SELECT minecraft_username, balance FROM \`${table}\` WHERE LOWER(minecraft_uuid) = ? LIMIT 1`,
            [uuid],
          );
          const live = Array.isArray(rows) ? (rows[0] as { minecraft_username?: string; balance?: number } | undefined) : undefined;
          if (live && live.balance != null && Number.isFinite(Number(live.balance))) {
            balanceG = roundGold(Number(live.balance));
            username = str(live.minecraft_username) || username;
            hasRow = true;
            updatedAt = nowIso();
            source = "mysql";
          }
        } finally {
          await conn.end().catch(() => undefined);
        }
      }
    } catch (e) {
      console.warn("g2_player_balance_mysql", e instanceof Error ? e.message : String(e));
    }
  }

  const realm = await realmRow(env, realmId);
  return json({
    ok: true,
    generation: "gen2",
    realm_id: realmId,
    server_address: str(realm?.server_address) || "51.81.176.61:24945",
    minecraft_uuid: uuid,
    minecraft_username: username,
    balance_g: balanceG,
    has_row: hasRow,
    source,
    updated_at: updatedAt,
  });
}

async function handleBalances(env: G2Env, realmId: string, limit: number) {
  const { results } = await env.DB.prepare(
    `SELECT player_uuid, username, gold_g, updated_at_ms
     FROM g2_snap_balance
     WHERE realm_id = ? AND gold_g > 0.0001
     ORDER BY gold_g DESC
     LIMIT ?`,
  )
    .bind(realmId, Math.min(1000, Math.max(1, limit)))
    .all<{ player_uuid: string; username: string | null; gold_g: number; updated_at_ms: number }>();

  let total = 0;
  const players = (results || []).map((row, idx) => {
    const gold = roundGold(num(row.gold_g));
    total += gold;
    const username = str(row.username) || str(row.player_uuid).slice(0, 8);
    return {
      rank: idx + 1,
      minecraft_uuid: row.player_uuid,
      minecraft_username: username,
      display_name: username,
      notes_g: gold,
    };
  });

  return json({
    server_id: realmId,
    synced_at: await latestSnapshotIso(env, realmId),
    totals: {
      player_notes_g: roundGold(total),
      town_notes_g: 0,
      nation_notes_g: 0,
      circulating_notes_g: roundGold(total),
      player_count: players.length,
      town_count: 0,
      nation_count: 0,
    },
    players,
    towns: [],
    nations: [],
  });
}

async function handleNetWorth(env: G2Env, realmId: string, limit: number) {
  const { results } = await env.DB.prepare(
    `SELECT n.player_uuid, b.username, n.net_worth_g, n.wallet_g, n.items_g, n.updated_at_ms
     FROM g2_snap_net_worth n
     LEFT JOIN g2_snap_balance b ON b.realm_id = n.realm_id AND b.player_uuid = n.player_uuid
     WHERE n.realm_id = ?
     ORDER BY n.net_worth_g DESC
     LIMIT ?`,
  )
    .bind(realmId, Math.min(100, Math.max(1, limit)))
    .all<Row>();
  return json({
    server_id: realmId,
    leaderboard: (results || []).map((row, idx) => ({
      rank: idx + 1,
      minecraft_uuid: row.player_uuid,
      minecraft_username: str(row.username) || str(row.player_uuid).slice(0, 8),
      balance_value: roundGold(num(row.wallet_g)),
      inventory_value: roundGold(num(row.items_g)),
      chest_value: 0,
      shop_stock_value: 0,
      total_value: roundGold(num(row.net_worth_g)),
    })),
    synced_at: await latestSnapshotIso(env, realmId),
  });
}

async function handlePlaytime(env: G2Env, realmId: string, limit: number) {
  const { results } = await env.DB.prepare(
    `SELECT p.player_uuid, b.username, p.total_sec, p.month_key, p.month_sec, p.updated_at_ms
     FROM g2_snap_playtime p
     LEFT JOIN g2_snap_balance b ON b.realm_id = p.realm_id AND b.player_uuid = p.player_uuid
     WHERE p.realm_id = ?
     ORDER BY p.total_sec DESC
     LIMIT ?`,
  )
    .bind(realmId, Math.min(100, Math.max(1, limit)))
    .all<Row>();
  return json({
    server_id: realmId,
    leaderboard: (results || []).map((row, idx) => ({
      rank: idx + 1,
      minecraft_uuid: row.player_uuid,
      minecraft_username: str(row.username) || str(row.player_uuid).slice(0, 8),
      total_playtime_seconds: Math.max(0, Math.floor(num(row.total_sec))),
      month_key: row.month_key || null,
      month_playtime_seconds: Math.max(0, Math.floor(num(row.month_sec))),
    })),
    synced_at: await latestSnapshotIso(env, realmId),
  });
}

async function marketRows(env: G2Env, realmId: string): Promise<Row[]> {
  const { results } = await env.DB.prepare(
    `SELECT item_key,
            SUM(CASE WHEN LOWER(COALESCE(listing_type, 'sell')) = 'sell' THEN stock ELSE 0 END) AS total_quantity,
            COUNT(CASE WHEN LOWER(COALESCE(listing_type, 'sell')) = 'sell' THEN 1 END) AS shop_count,
            MIN(CASE WHEN LOWER(COALESCE(listing_type, 'sell')) = 'sell' AND price_g > 0 THEN price_g END) AS min_price,
            MAX(CASE WHEN LOWER(COALESCE(listing_type, 'sell')) = 'sell' AND price_g > 0 THEN price_g END) AS max_price,
            AVG(CASE WHEN LOWER(COALESCE(listing_type, 'sell')) = 'sell' AND price_g > 0 THEN price_g END) AS avg_listing_price,
            SUM(CASE WHEN LOWER(COALESCE(listing_type, 'sell')) = 'buy' THEN stock ELSE 0 END) AS buy_capacity,
            COUNT(CASE WHEN LOWER(COALESCE(listing_type, 'sell')) = 'buy' THEN 1 END) AS buy_shop_count,
            MAX(CASE WHEN LOWER(COALESCE(listing_type, 'sell')) = 'buy' AND price_g > 0 THEN price_g END) AS max_buy_price,
            MAX(updated_at_ms) AS updated_at_ms
     FROM g2_snap_shop
     WHERE realm_id = ?
     GROUP BY item_key`,
  )
    .bind(realmId)
    .all<Row>();

  const market = await env.DB.prepare(
    `SELECT item_key, median_g, sample_n, updated_at_ms
     FROM g2_snap_item_market
     WHERE realm_id = ?`,
  )
    .bind(realmId)
    .all<Row>();
  const byItem = new Map((market.results || []).map((r) => [str(r.item_key), r]));
  return (results || []).map((row) => {
    const key = str(row.item_key);
    const m = byItem.get(key);
    const avgListing = num(row.avg_listing_price);
    const marketAvg = num(m?.median_g, avgListing || num(row.min_price));
    return {
      item_key: key,
      display_name: key.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
      total_quantity: Math.max(0, Math.floor(num(row.total_quantity))),
      shop_count: Math.max(0, Math.floor(num(row.shop_count))),
      min_price: roundGold(num(row.min_price)),
      max_price: roundGold(num(row.max_price)),
      avg_listing_price: roundGold(avgListing),
      buy_capacity: Math.max(0, Math.floor(num(row.buy_capacity))),
      buy_shop_count: Math.max(0, Math.floor(num(row.buy_shop_count))),
      max_buy_price: roundGold(num(row.max_buy_price)),
      market_avg: roundGold(marketAvg),
      sample_count: Math.max(0, Math.floor(num(m?.sample_n, num(row.shop_count)))),
      change_24h_pct: null,
      synced_at: num(row.updated_at_ms) > 0 ? msToIso(num(row.updated_at_ms)) : null,
    };
  });
}

function applyMarketFilters(rows: Row[], url: URL): Row[] {
  const q = str(url.searchParams.get("q")).toLowerCase();
  const inStock = url.searchParams.get("in_stock") === "1";
  const minPrice = url.searchParams.has("min_price") ? num(url.searchParams.get("min_price")) : null;
  const maxPrice = url.searchParams.has("max_price") ? num(url.searchParams.get("max_price")) : null;
  const minQty = url.searchParams.has("min_qty") ? num(url.searchParams.get("min_qty")) : null;
  const maxQty = url.searchParams.has("max_qty") ? num(url.searchParams.get("max_qty")) : null;
  const minShops = url.searchParams.has("min_shops") ? num(url.searchParams.get("min_shops")) : null;
  return rows.filter((row) => {
    if (q && !str(row.item_key).toLowerCase().includes(q) && !str(row.display_name).toLowerCase().includes(q)) return false;
    if (inStock && num(row.total_quantity) <= 0) return false;
    if (minPrice != null && num(row.min_price) < minPrice) return false;
    if (maxPrice != null && num(row.min_price) > maxPrice) return false;
    if (minQty != null && num(row.total_quantity) < minQty) return false;
    if (maxQty != null && num(row.total_quantity) > maxQty) return false;
    if (minShops != null && num(row.shop_count) < minShops) return false;
    return true;
  });
}

function sortMarket(rows: Row[], sort: string): Row[] {
  const out = rows.slice();
  const byNum = (field: string, dir: 1 | -1) => out.sort((a, b) => (num(a[field]) - num(b[field])) * dir);
  switch (sort) {
    case "quantity_asc": return byNum("total_quantity", 1);
    case "shops_desc": return byNum("shop_count", -1);
    case "shops_asc": return byNum("shop_count", 1);
    case "price_asc": return byNum("min_price", 1);
    case "price_desc": return byNum("max_price", -1);
    case "buy_price_desc": return byNum("max_buy_price", -1);
    case "buy_capacity_desc": return byNum("buy_capacity", -1);
    case "market_avg_desc": return byNum("market_avg", -1);
    case "market_avg_asc": return byNum("market_avg", 1);
    case "name_asc": return out.sort((a, b) => str(a.item_key).localeCompare(str(b.item_key)));
    case "name_desc": return out.sort((a, b) => str(b.item_key).localeCompare(str(a.item_key)));
    case "quantity_desc":
    default: return byNum("total_quantity", -1);
  }
}

async function handleMarketItems(env: G2Env, url: URL) {
  const realmId = await resolveRealmId(env, url.searchParams.get("server_id") || undefined);
  const page = Math.max(1, Math.floor(num(url.searchParams.get("page"), 1)));
  const perPage = Math.min(100, Math.max(1, Math.floor(num(url.searchParams.get("per_page"), 25))));
  const rows = sortMarket(applyMarketFilters(await marketRows(env, realmId), url), str(url.searchParams.get("sort")) || "quantity_desc");
  const total = rows.length;
  const start = (page - 1) * perPage;
  return json({
    server_id: realmId,
    items: rows.slice(start, start + perPage),
    total,
    page,
    per_page: perPage,
    total_pages: Math.max(1, Math.ceil(total / perPage)),
    price_kind: "g2_snapshot",
    synced_at: await latestSnapshotIso(env, realmId),
  });
}

async function handleMarketSummary(env: G2Env, url: URL) {
  const realmId = await resolveRealmId(env, url.searchParams.get("server_id") || undefined);
  const rows = sortMarket(await marketRows(env, realmId), "shops_desc").slice(0, Math.min(100, Math.max(1, num(url.searchParams.get("limit"), 50))));
  return json({
    server_id: realmId,
    catalog: rows.map((row) => ({
      item_key: row.item_key,
      avg_price: row.market_avg,
      sample_count: row.sample_count,
      recorded_at: row.synced_at,
    })),
    recent_history: rows.map((row) => ({
      item_key: row.item_key,
      current_price: row.market_avg,
      prior_price: null,
      sample_count: row.sample_count,
      recorded_at: row.synced_at,
    })),
    total_server_items: rows.reduce((sum, row) => sum + Math.max(0, Math.floor(num(row.total_quantity))), 0),
    synced_at: await latestSnapshotIso(env, realmId),
  });
}

async function handleMarketHistory(env: G2Env, url: URL) {
  const realmId = await resolveRealmId(env, url.searchParams.get("server_id") || undefined);
  const item = str(url.searchParams.get("item")).toUpperCase();
  const row = await env.DB.prepare(
    `SELECT median_g, sample_n, updated_at_ms
     FROM g2_snap_item_market
     WHERE realm_id = ? AND item_key = ?
     LIMIT 1`,
  )
    .bind(realmId, item)
    .first<Row>();
  const point = row
    ? [{ avg_price: roundGold(num(row.median_g)), sample_count: Math.floor(num(row.sample_n)), recorded_at: msToIso(num(row.updated_at_ms)) }]
    : [];
  return json({
    server_id: realmId,
    item_key: item,
    price_kind: "g2_snapshot",
    current_avg: point[0]?.avg_price || 0,
    sample_count: point[0]?.sample_count || 0,
    synced_at: point[0]?.recorded_at || null,
    points: point,
  });
}

async function handleReserve(env: G2Env, realmId: string) {
  const [treasury, balances] = await Promise.all([treasuryRow(env, realmId), balanceTotals(env, realmId)]);
  const reserve = roundGold(num(treasury?.reserve_g));
  const supply = parseSupply(treasury?.supply_json);
  const minted = roundGold(num(supply.minted_g, num(supply.total_minted_g, balances.total + reserve)));
  const circulating = roundGold(balances.total + reserve);
  const overIssue = roundGold(Math.max(0, circulating - minted));
  const synced = treasury?.updated_at_ms ? msToIso(num(treasury.updated_at_ms)) : await latestSnapshotIso(env, realmId);
  return json({
    server_id: realmId,
    generation: "gen2",
    synced_at: synced,
    balance: reserve,
    vault_balance: reserve,
    ledger_implied_balance: reserve,
    true_reserve_balance: reserve,
    balance_matches_ledger: true,
    balance_gap: 0,
    current_hst_month: nowIso().slice(0, 7),
    view_hst_month: nowIso().slice(0, 7),
    available_months: [nowIso().slice(0, 7)],
    month: { inflow: 0, outflow: 0, net: 0, by_type: {} },
    prior_month: { inflow: 0, outflow: 0, net: 0, by_type: {} },
    all_time: { inflow: reserve, outflow: 0, net: reserve, by_type: { OPENING: reserve } },
    map_262_gross_reserve_balance: reserve,
    payable_supply: {
      private_claims_g: balances.total,
      reserve_managed_g: reserve,
      reserve_vault_g: reserve,
      total_payable_claims_g: circulating,
      missing_g: 0,
    },
    note_supply: {
      gold_mined_g: minted,
      player_notes_g: balances.total,
      reserve_notes_g: reserve,
      total_notes_g: circulating,
      over_issue_g: overIssue,
      surplus_mint_headroom_g: roundGold(Math.max(0, minted - circulating)),
      backing_ratio: circulating > 0 ? minted / circulating : null,
      backing_pct: circulating > 0 ? Math.round((minted / circulating) * 100) : null,
      dynamic_tax_pct: null,
      status: overIssue > 0 ? "over_issued" : "fully_backed",
      summary: "Gen2 economy snapshot from g2 tables.",
    },
    gold_minted: { total_gross_minted_g: minted, total_gross_in_g: minted, total_redeemed_g: 0, net_minted_g: minted },
    gold_found: { mined_since_july_g: 0, physical_mined_since_july_g: 0 },
    integrity: { ok: true, detail: "Gen2 snapshot adapter." },
    towny: { month: {}, all_time: {} },
    daily: [],
    weekly: [],
    monthly: [],
    yearly: [],
    executive_24h: [],
    glossary: [
      { type: "OPENING", label: "Snapshot balance", direction: "other", description: "Current Gen2 reserve snapshot." },
    ],
  });
}

async function handleLedger(realmId: string, url: URL) {
  const limit = Math.min(100, Math.max(1, num(url.searchParams.get("limit"), 25)));
  return json({ server_id: realmId, rows: [], ledger: [], entries: [], total: 0, limit, offset: num(url.searchParams.get("offset")), synced_at: nowIso() });
}

async function handleMintLeaderboard(realmId: string) {
  return json({
    server_id: realmId,
    leaderboard: [],
    total_gross_in_g: 0,
    total_redeemed_g: 0,
    net_minted_g: 0,
    total_gross_minted_g: 0,
    synced_at: nowIso(),
  });
}

async function handleMintDepartment(env: G2Env, realmId: string) {
  const reserveData = await (await handleReserve(env, realmId)).json() as Row;
  const noteSupply = (reserveData.note_supply || {}) as Row;
  return json({
    server_id: realmId,
    department: "mint",
    generation: "gen2",
    era_start_date_hst: "2026-07-15",
    synced_at: reserveData.synced_at || nowIso(),
    totals: {
      total_player_balances_g: num(noteSupply.player_notes_g),
      total_minted_g: num(noteSupply.gold_mined_g),
      unminted_gold_items_g: 0,
      mint_gross_g: 0,
      mint_redeem_g: 0,
      mint_net_g: 0,
      mint_events: 0,
      redeem_events: 0,
      mint_ledger_rows: 0,
      backing_pct: noteSupply.backing_pct ?? null,
    },
    note_supply: noteSupply,
    transparency: {
      summary: "Gen2 mint detail ledger has not been snapshotted yet; headline backing uses the Gen2 treasury supply snapshot.",
      ledger_gross_in_g: 0,
      ledger_redeemed_out_g: 0,
      ledger_net_backing_g: 0,
      player_wallet_notes_g: num(noteSupply.player_notes_g),
      reserve_notes_g: num(noteSupply.reserve_notes_g),
      total_circulation_g: num(noteSupply.total_notes_g),
      wallet_backing_pct: noteSupply.backing_pct ?? null,
      circulation_backing_pct: noteSupply.backing_pct ?? null,
      wallet_over_issue_g: num(noteSupply.over_issue_g),
      era_surplus_headroom_g: num(noteSupply.surplus_mint_headroom_g),
      physical_items_unminted_g: 0,
      gold_found_physical_since_era_g: 0,
      gold_found_loot_since_era_g: 0,
      gold_found_since_era_g: 0,
    },
    leaderboard: [],
    physical_gold: { total_gold_g: 0, player_count: 0, scanned_at: null },
    gold_found: { leaderboard: [], summary: {} },
    provenance: { physical_scan_available: false, item_events_available: false, item_events_count: 0 },
  });
}

async function handleGoldSupply(env: G2Env, realmId: string, limit: number) {
  const net = await (await handleNetWorth(env, realmId, limit)).json() as { leaderboard?: Row[]; synced_at?: string };
  const totals = await balanceTotals(env, realmId);
  return json({
    server_id: realmId,
    synced_at: net.synced_at || await latestSnapshotIso(env, realmId),
    summary: {
      player_notes_g: totals.total,
      physical_scan_g: (net.leaderboard || []).reduce((sum, row) => sum + num(row.inventory_value), 0),
      total_g: (net.leaderboard || []).reduce((sum, row) => sum + num(row.total_value), 0),
    },
    system_accounts: [],
    players: net.leaderboard || [],
    scan: { available: true, scanned_at: net.synced_at || null },
    footnote: "Gen2 gold supply uses snapshot wallet/items data.",
  });
}

async function handleGoldFound(realmId: string) {
  return json({
    server_id: realmId,
    leaderboard: [],
    summary: {
      mined_since_july_g: 0,
      physical_mined_since_july_g: 0,
      player_count: 0,
    },
    synced_at: nowIso(),
  });
}

async function handleGoldItemEvents(realmId: string) {
  return json({ server_id: realmId, events: [], total: 0, has_more: false, synced_at: nowIso() });
}

async function handleVault(request: Request, realmId: string) {
  if (request.method === "GET") {
    return json({
      server_id: realmId,
      pending: [],
      claim_hint: "Gen2 vault order snapshots are not enabled yet.",
      generation: "gen2",
    });
  }
  if (request.method === "POST") {
    return json({ ok: false, detail: "Gen2 vault claims are not enabled yet." }, 501);
  }
  return null;
}

/** Public Gen2 economy facade for copied /g2 web pages. */
export async function handleG2EconomyPublicRoutes(
  request: Request,
  env: G2Env,
  subpath: string,
  method: string,
): Promise<Response | null> {
  if (!subpath.startsWith("/g2/rootmc")) return null;
  const rest = subpath.slice("/g2/rootmc".length) || "/";
  const url = new URL(request.url);

  if (method === "GET" && rest === "/server/config") return handleConfig(env, url);

  const playerBal = rest.match(/^\/player\/([^/]+)\/balance$/i);
  if (method === "GET" && playerBal) {
    return handlePlayerBalance(env, decodeURIComponent(playerBal[1]!));
  }

  if (method === "GET" && rest === "/stock-market/items") return handleMarketItems(env, url);
  if (method === "GET" && rest === "/stock-market/history") return handleMarketHistory(env, url);
  if (method === "GET" && rest === "/stock-market") return handleMarketSummary(env, url);

  if (rest === "/vault" || rest === "/vault/claim") {
    return handleVault(request, await resolveRealmId(env, url.searchParams.get("server_id") || undefined));
  }

  const serverMatch = rest.match(/^\/server\/([^/]+)(\/.*)$/);
  if (serverMatch) {
    const realmId = decodeURIComponent(serverMatch[1]!);
    const path = serverMatch[2]!;
    if (method === "GET" && path === "/economy/circulating-balances") {
      return handleBalances(env, realmId, num(url.searchParams.get("limit"), 500));
    }
    if (method === "GET" && path === "/economy/net-worth") {
      return handleNetWorth(env, realmId, num(url.searchParams.get("limit"), 50));
    }
    if (method === "GET" && path === "/economy/gold-supply") {
      return handleGoldSupply(env, realmId, num(url.searchParams.get("limit"), 200));
    }
    if (method === "GET" && path === "/playtime/leaderboard") {
      return proxyGen1SharedLeaderboard(url, "playtime");
    }
    if (method === "GET" && path === "/mcmmo/leaderboard") {
      return proxyGen1SharedLeaderboard(url, "mcmmo");
    }
    if (method === "GET" && path === "/gold-found/leaderboard") return handleGoldFound(realmId);
    if (method === "GET" && path === "/gold-items/events") return handleGoldItemEvents(realmId);
    if (method === "GET" && (path === "/bonds" || path.startsWith("/bonds/"))) {
      return handleG2BondsPublicRoutes(request, env, "/rootmc/server/" + encodeURIComponent(realmId) + path, method);
    }
  }

  const treasuryMatch = rest.match(/^\/treasury\/([^/]+)(\/.*)$/);
  if (treasuryMatch) {
    const realmId = decodeURIComponent(treasuryMatch[1]!);
    const path = treasuryMatch[2]!;
    if (method === "GET" && path === "/reserve") return handleReserve(env, realmId);
    if (method === "GET" && path === "/ledger") return handleLedger(realmId, url);
    if (method === "GET" && path === "/mint/leaderboard") return handleMintLeaderboard(realmId);
    if (method === "GET" && path === "/mint/department") return handleMintDepartment(env, realmId);
    if (method === "GET" && path === "/mint/ledger") return handleLedger(realmId, url);
  }

  return null;
}
