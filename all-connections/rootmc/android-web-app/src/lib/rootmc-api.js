/**
 * RootMC production API client.
 * Talks directly to the Cloudflare Worker at api.rootmc.net.
 *
 * Enabled when REACT_APP_USE_MOCK !== "true".
 * The frontend still keeps `api.js` (mock backend) for the preview build; switching
 * REACT_APP_USE_MOCK=false in an environment flips every screen to the live worker.
 */
import axios from "axios";

export const ROOTMC_API_BASE =
  process.env.REACT_APP_ROOTMC_API || "https://api.rootmc.info";

export const USE_MOCK = process.env.REACT_APP_USE_MOCK !== "false";
export const DEMO_LINK = process.env.REACT_APP_DEMO_LINK !== "false";

export const rootmcApi = axios.create({
  baseURL: ROOTMC_API_BASE,
  timeout: 20000,
});

rootmcApi.interceptors.request.use((config) => {
  const token = localStorage.getItem("rootmc_token");
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

/* ---------- production endpoints (wired to api.rootmc.net) ---------- */
export const rootmc = {
  // server + status
  serverStatus: () => rootmcApi.get("/api/rootmc/server/featured"),
  serverConfig: () => rootmcApi.get("/api/rootmc/config"),

  // economy
  treasury: () => rootmcApi.get("/api/rootmc/treasury/rootmc"),
  economyOverview: () => rootmcApi.get("/api/rootmc/economy/overview"),

  // market
  marketItems: (serverId) =>
    rootmcApi.get(`/api/rootmc/stock-market`, {
      params: serverId ? { server_id: serverId } : {},
    }),
  marketItemHistory: (serverId, itemKey, range) =>
    rootmcApi.get(`/api/rootmc/stock-market/${itemKey}/history`, {
      params: { server_id: serverId, range },
    }),

  // player
  me: (serverId) => rootmcApi.get(`/api/rootmc/server/${serverId}/economy/me`),
  netWorthLeaderboard: (serverId, limit = 20) =>
    rootmcApi.get(`/api/rootmc/server/${serverId}/economy/net-worth`, {
      params: { limit },
    }),

  // daily report
  dailyReport: () => rootmcApi.get("/api/rootmc/daily-report"),

  // auth (in-game /link)
  linkComplete: (code) =>
    rootmcApi.post("/api/rootmc/realm/minecraft/link/app/complete", { code }),

  // rewards (P0 — planned worker routes; may not exist yet)
  checkinStatus: () => rootmcApi.get("/api/rootmc/app/checkin/status"),
  checkinClaim: () => rootmcApi.post("/api/rootmc/app/checkin/claim"),
  voteSites: () => rootmcApi.get("/api/rootmc/app/vote/sites"),
  voteClaim: (siteId) =>
    rootmcApi.post("/api/rootmc/app/vote/claim", { site_id: siteId }),
};

/**
 * Feature flag: is the treasury-backed reward flow available on the Worker yet?
 * When REACT_APP_USE_MOCK=false we assume the routes are not deployed
 * unless explicitly enabled with REACT_APP_LIVE_REWARDS=true.
 */
export const LIVE_REWARDS_AVAILABLE =
  process.env.REACT_APP_LIVE_REWARDS === "true";
