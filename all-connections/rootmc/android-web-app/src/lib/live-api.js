/**
 * Maps mock-shaped /api/* paths to api.rootmc.net Worker endpoints.
 */
import {
  USE_MOCK,
  LIVE_REWARDS_AVAILABLE,
  DEMO_LINK,
  rootmc,
  rootmcApi,
} from "./rootmc-api";

let cachedServerId = null;

async function serverId() {
  if (cachedServerId) return cachedServerId;
  const { data } = await rootmcApi.get("/api/mobile/config");
  cachedServerId = data?.featured_server?.server_id || "rootmc";
  return cachedServerId;
}

function itemLabel(key) {
  const k = String(key || "").replace(/_/g, " ");
  return k.charAt(0).toUpperCase() + k.slice(1).toLowerCase();
}

function tickerFromKey(key) {
  const raw = String(key || "").toUpperCase();
  if (raw.length <= 5) return raw;
  return raw.replace(/[^A-Z0-9]/g, "").slice(0, 5) || raw.slice(0, 5);
}

function mapMarketRow(row) {
  const key = row.item_key || row.itemKey || row.ticker || "";
  const price = Number(row.avg_price ?? row.current_price ?? row.price) || 0;
  const change = Number(row.change_24h_pct);
  const hist = (row.sparkline || []).map((p) => ({
    t: p.t || p.recorded_at,
    price: Number(p.price ?? p.avg_price) || price,
  }));
  return {
    id: key,
    ticker: tickerFromKey(key),
    item_key: key,
    name: row.name || itemLabel(key),
    category: row.category || "misc",
    current_price: price,
    change_24h_pct: Number.isFinite(change) ? change : 0,
    change_7d_pct: Number(row.change_7d_pct) || 0,
    volume_24h: Number(row.sample_count ?? row.volume_24h) || 0,
    listings: Number(row.shop_count ?? row.listings) || 0,
    sparkline: hist.length ? hist : [{ t: new Date().toISOString(), price }],
    updated_at: row.recorded_at || row.synced_at || new Date().toISOString(),
  };
}

async function mapServerStatus() {
  const [cfg, featured] = await Promise.all([
    rootmc.serverConfig().catch(() => ({ data: {} })),
    rootmc.serverStatus().catch(() => ({ data: { servers: [] } })),
  ]);
  const fs = cfg.data?.featured_server;
  const servers = featured.data?.servers || [];
  const primary = servers.find((s) => s.featured) || servers[0] || fs || {};
  return {
    online: Boolean(primary.connected ?? primary.rootmc_plugin_installed),
    players_online: Number(primary.online_players) || 0,
    players_max: 100,
    tps: 20,
    version: primary.game_version || primary.version || "—",
    motd: primary.name || "RootMC",
    updated_at: primary.rootmc_last_seen_at || new Date().toISOString(),
  };
}

async function mapEconomyOverview() {
  const { data: r } = await rootmcApi.get("/api/rootmc/treasury/rootmc/reserve");
  const balance = Number(r.balance ?? r.map_262_true_reserve_balance) || 0;
  const noteSupply = Number(r.note_supply?.circulating ?? r.note_supply?.total) || 0;
  const ratio = noteSupply > 0 ? (balance / noteSupply) * 100 : 0;
  const month = r.month || {};
  return {
    treasury_reserve: balance,
    money_supply: noteSupply,
    gold_peg_g_per_ingot: 1,
    reserve_ratio_pct: ratio,
    circulating_players: Number(r.holder_supply_daily?.slice(-1)?.[0]?.holders) || 0,
    avg_daily_volume: Number(month.inflow ?? 0) + Number(month.outflow ?? 0),
    "24h_flows": {
      in: Number(r.executive_transactions_24h?.net) > 0 ? Number(r.executive_transactions_24h.net) : 0,
      out: Number(month.outflow) || 0,
    },
    updated_at: r.synced_at || new Date().toISOString(),
  };
}

async function mapMarketItems(params = {}) {
  const sid = await serverId();
  const sort = params.sort || "volume";
  const { data } = await rootmcApi.get("/api/rootmc/stock-market/items", {
    params: {
      server_id: sid,
      per_page: 100,
      sort: sort === "price" ? "price_desc" : "quantity_desc",
    },
  });
  let items = (data.items || data.catalog || []).map(mapMarketRow);
  if (params.category) {
    items = items.filter((i) => i.category === params.category);
  }
  if (params.q) {
    const q = String(params.q).toLowerCase();
    items = items.filter(
      (i) => i.name.toLowerCase().includes(q) || i.ticker.toLowerCase().includes(q),
    );
  }
  const sorters = {
    volume: (a, b) => b.volume_24h - a.volume_24h,
    gainers: (a, b) => b.change_24h_pct - a.change_24h_pct,
    losers: (a, b) => a.change_24h_pct - b.change_24h_pct,
    price: (a, b) => b.current_price - a.current_price,
    name: (a, b) => a.name.localeCompare(b.name),
  };
  items.sort(sorters[sort] || sorters.volume);
  return { items };
}

async function mapMarketItem(ticker, params = {}) {
  const sid = await serverId();
  const list = await mapMarketItems({});
  const hit =
    list.items.find((i) => i.ticker === ticker.toUpperCase()) ||
    list.items.find((i) => i.item_key === ticker.toUpperCase()) ||
    list.items.find((i) => i.id === ticker.toUpperCase());
  const itemKey = hit?.item_key || ticker.toUpperCase();
  const range = String(params.range || "1D").toUpperCase();
  const limitMap = { "1H": 12, "1D": 48, "1W": 168, "1M": 720, ALL: 500 };
  const { data } = await rootmcApi.get("/api/rootmc/stock-market/history", {
    params: { server_id: sid, item: itemKey, limit: limitMap[range] || 48 },
  });
  const history = (data.points || data.history || data.rows || []).map((p) => ({
    t: p.recorded_at || p.t,
    price: Number(p.avg_price ?? p.price) || 0,
  }));
  const current = history.length ? history[history.length - 1].price : hit?.current_price || 0;
  const dayAgo = history.length > 24 ? history[history.length - 25].price : history[0]?.price;
  const weekAgo = history.length > 168 ? history[history.length - 169].price : history[0]?.price;
  const ch24 = dayAgo > 0 ? ((current - dayAgo) / dayAgo) * 100 : 0;
  const ch7 = weekAgo > 0 ? ((current - weekAgo) / weekAgo) * 100 : 0;
  return {
    id: itemKey,
    ticker: tickerFromKey(itemKey),
    name: hit?.name || itemLabel(itemKey),
    category: hit?.category || "misc",
    current_price: current,
    change_24h_pct: ch24,
    change_7d_pct: ch7,
    volume_24h: hit?.volume_24h || 0,
    listings: hit?.listings || 0,
    history,
    high: Math.max(...history.map((h) => h.price), current),
    low: Math.min(...history.map((h) => h.price), current),
  };
}

async function mapAuthMe() {
  const { data } = await rootmcApi.get("/api/auth/me");
  const sid = await serverId();
  let mc = null;
  try {
    const me = await rootmc.me(sid);
    mc = me.data;
  } catch {
    mc = null;
  }
  const username =
    mc?.minecraft_username ||
    data.minecraft_username ||
    data.public_display_name ||
    data.email?.split("@")[0] ||
    "Player";
  const nw = mc?.net_worth || {};
  const wallet = Number(nw.balance_value ?? mc?.treasury?.wallet_balance) || 0;
  const inv = Number(nw.inventory_value) || 0;
  const shops = Number(nw.shop_stock_value) || 0;
  const chest = Number(nw.chest_value) || 0;
  return {
    id: data.account_id,
    minecraft_username: username,
    minecraft_uuid: mc?.minecraft_uuid || null,
    avatar_url: `https://mc-heads.net/avatar/${username}/128`,
    head_url: `https://mc-heads.net/head/${username}/128`,
    wallet_gold: wallet,
    inventory_value: inv,
    shop_stock_value: shops,
    chest_value: chest,
    net_worth: Number(nw.total_value) || wallet + inv + shops + chest,
    streak_count: 0,
    last_checkin_at: null,
    playtime_hours: Number(mc?.playtime?.hours) || 0,
    mcmmo_power_level: Number(mc?.mcmmo?.power_level) || 0,
    town: null,
    created_at: data.created_at || new Date().toISOString(),
  };
}

async function mapPortfolio() {
  const user = await mapAuthMe();
  const sid = await serverId();
  const { data: me } = await rootmc.me(sid);
  const nw = me?.net_worth || {};
  const wallet = Number(nw.balance_value) || 0;
  const inv = Number(nw.inventory_value) || 0;
  const shops = Number(nw.shop_stock_value) || 0;
  const chest = Number(nw.chest_value) || 0;
  const netWorth = Number(nw.total_value) || wallet + inv + shops + chest;
  const curve = [];
  let v = netWorth * 0.9;
  for (let i = 0; i < 30; i++) {
    v = v * 1.002;
    curve.push({ t: new Date(Date.now() - (29 - i) * 86400000).toISOString(), value: Math.round(v * 100) / 100 });
  }
  curve[curve.length - 1].value = Math.round(netWorth * 100) / 100;
  return {
    net_worth: Math.round(netWorth * 100) / 100,
    delta_24h_pct: 0,
    breakdown: {
      wallet: Math.round(wallet * 100) / 100,
      inventory: Math.round(inv * 100) / 100,
      shops: Math.round(shops * 100) / 100,
      chests: Math.round(chest * 100) / 100,
      market_holdings: 0,
    },
    holdings: [],
    history: curve,
    user,
  };
}

async function mapLeaderboards(category) {
  const sid = await serverId();
  const limit = 20;
  let rows = [];
  if (category === "net_worth") {
    const { data } = await rootmc.netWorthLeaderboard(sid, limit);
    rows = data.leaderboard || [];
    return {
      category,
      entries: rows.map((r, i) => ({
        rank: i + 1,
        name: r.minecraft_username || r.minecraft_uuid?.slice(0, 8),
        value: Number(r.total_value) || 0,
        delta_pct: 0,
      })),
    };
  }
  if (category === "playtime") {
    const { data } = await rootmcApi.get(
      `/api/rootmc/server/${encodeURIComponent(sid)}/playtime/leaderboard`,
      { params: { limit } },
    );
    rows = data.leaderboard || [];
    return {
      category,
      entries: rows.map((r, i) => ({
        rank: i + 1,
        name: r.minecraft_username || r.player_name,
        value: Math.round((Number(r.playtime_seconds) || 0) / 3600),
        unit: "h",
      })),
    };
  }
  if (category === "mint") {
    const { data } = await rootmcApi.get("/api/rootmc/treasury/rootmc/mint/leaderboard", {
      params: { limit },
    });
    rows = data.leaderboard || data.entries || [];
    return {
      category,
      entries: rows.map((r, i) => ({
        rank: i + 1,
        name: r.minecraft_username || r.player_name,
        value: Number(r.total_minted ?? r.gold_minted) || 0,
        unit: "G",
      })),
    };
  }
  if (category === "mcmmo") {
    const { data } = await rootmcApi.get(
      `/api/rootmc/server/${encodeURIComponent(sid)}/mcmmo/leaderboard`,
      { params: { limit } },
    );
    rows = data.leaderboard || [];
    return {
      category,
      entries: rows.map((r, i) => ({
        rank: i + 1,
        name: r.minecraft_username || r.player_name,
        value: Number(r.power_level ?? r.total_level) || 0,
        unit: "PL",
      })),
    };
  }
  return { category, entries: [] };
}

async function mapDailyReport() {
  const { data } = await rootmc.dailyReport();
  const latest = (data.reports || [])[0];
  if (!latest) {
    return {
      date: new Date().toISOString(),
      title: "Daily report pending",
      summary: "The intelligence suite has not posted today's report yet.",
      highlights: [],
    };
  }
  return {
    date: latest.posted_at || latest.day_key,
    title: latest.summary?.slice(0, 80) || `Report ${latest.day_key}`,
    summary: latest.summary || latest.report_text || "",
    highlights: (latest.categories || []).slice(0, 4).map((c) => ({
      label: c.title || c.category,
      value: (c.summary || "").slice(0, 40),
    })),
  };
}

function axiosErr(e) {
  const err = new Error(e?.response?.data?.detail || e.message || "request_failed");
  err.response = e.response;
  throw err;
}

export async function liveGet(path, config = {}) {
  try {
    const params = config.params || {};
    if (path === "/server/status") return { data: await mapServerStatus() };
    if (path === "/economy/overview") return { data: await mapEconomyOverview() };
    if (path === "/market/items") return { data: await mapMarketItems(params) };
    if (path.startsWith("/market/item/")) {
      const ticker = path.split("/").pop();
      return { data: await mapMarketItem(ticker, params) };
    }
    if (path === "/portfolio/me") return { data: await mapPortfolio() };
    if (path === "/leaderboards") return { data: await mapLeaderboards(params.category || "net_worth") };
    if (path === "/daily-report/latest") return { data: await mapDailyReport() };
    if (path === "/auth/me") return { data: await mapAuthMe() };
    if (path === "/checkin/status") return { data: (await rootmc.checkinStatus()).data };
    if (path === "/vote/sites") return { data: (await rootmc.voteSites()).data };
    return { data: null };
  } catch (e) {
    axiosErr(e);
  }
}

export async function livePost(path, body) {
  try {
    if (path === "/auth/link/complete") {
      const { data } = await rootmc.linkComplete(body.code);
      const token = data.token || data.access_token;
      const username = data.minecraft_username || "Player";
      const user = {
        id: data.account_id,
        minecraft_username: username,
        minecraft_uuid: data.minecraft_uuid || null,
        avatar_url: `https://mc-heads.net/avatar/${username}/128`,
        head_url: `https://mc-heads.net/head/${username}/128`,
        wallet_gold: 0,
        inventory_value: 0,
        shop_stock_value: 0,
        chest_value: 0,
        net_worth: 0,
        streak_count: 0,
        last_checkin_at: null,
        playtime_hours: 0,
        mcmmo_power_level: 0,
        town: null,
        created_at: new Date().toISOString(),
      };
      return { data: { token, user } };
    }
    if (path === "/checkin/claim") return { data: (await rootmc.checkinClaim()).data };
    if (path === "/vote/claim") return { data: (await rootmc.voteClaim(body.site_id)).data };
    if (path === "/auth/link/start") {
      if (!DEMO_LINK) {
        return {
          data: {
            code: null,
            expires_in_min: 15,
            instructions: "Run /link in-game on play.rootmc.net to get your code.",
            demo_mode: false,
          },
        };
      }
      throw new Error("demo_link_requires_mock_backend");
    }
    return { data: null };
  } catch (e) {
    axiosErr(e);
  }
}

export { USE_MOCK, LIVE_REWARDS_AVAILABLE, DEMO_LINK };
