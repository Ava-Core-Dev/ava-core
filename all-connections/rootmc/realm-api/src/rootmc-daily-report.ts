/**
 * RootMC daily server status report  -  runs at midnight HST via the hourly cron.
 * Posts economy, Towny, mcMMO, leaderboards, and Discord activity to a configured channel.
 */

import {
  excludedDiscordChannelsForGrok,
  type DiscordOperationalHighlight,
} from "./rootmc-daily-discord-ops";
import type { TreasuryReportBrief } from "./rootmc-treasury";
import type { D1Database } from "@cloudflare/workers-types";

import { resolveEconomyServerId } from "./realm-lib";
import { FEATURED_SERVER_DEFAULTS } from "./rootmc-server";
import { economySystemAccountSqlFilter, isEconomySystemAccount } from "./rootmc-economy-accounts";
import {
  openRootMcMysqlBinding,
  rootMcMysqlTablePrefix,
  type RootMcHyperdriveEnv,
  type RootMcMysqlBindingName,
} from "./rootmc-hyperdrive";
import {
  netWorthLeaderboard,
  refreshServerNetWorth,
  serverItemTotals,
  shopListingsForServer,
  shopPriceCatalog,
} from "./rootmc-economy";
import {
  discordBotFetch,
  fetchGuildSummary,
  listGuildTextChannels,
} from "./discord-rootmc-api";
import type { RootMcTownyDiscordEnv } from "./discord-rootmc-towny";
import { treasuryBriefForReports, readGoldMintedBreakdown } from "./rootmc-treasury";
import { formatGoldDailyReport } from "./gold-format";
import { playtimeLeaderboardForServer } from "./rootstat-minecraft";
import type { RootMcAiEnv } from "./rootmc-world-ai";

export type RootMcDailyReportEnv = RootMcTownyDiscordEnv &
  RootMcAiEnv &
  RootMcHyperdriveEnv & {
    LIVE_DB?: D1Database;
    DISCORD_ROOTMC_DAILY_REPORT_CHANNEL_ID?: string;
    DISCORD_ROOTMC_ECONOMY_ANNOUNCE_CHANNEL_ID?: string;
    DISCORD_ROOTMC_GENERAL_CHAT_CHANNEL_ID?: string;
    DISCORD_ROOTMC_OPERATIONS_FORUM_CHANNEL_ID?: string;
    DISCORD_ROOTMC_APPEALS_FORUM_CHANNEL_ID?: string;
    SLACK_SERVER_REPORTS_WEBHOOK_URL?: string;
    SLACK_SERVER_REPORTS_CHANNEL_ID?: string;
  };

type DailyMetrics = {
  serverId: string;
  serverName: string;
  dayKey: string;
  rootmcOk: boolean;
  rootstatOk: boolean;
  gameVersion: string;
  /** Discord-linked Minecraft accounts (realm-wide; shared by Towny + Claims). */
  linked: number;
  towny: Awaited<ReturnType<typeof townySnapshot>>;
  economy: Awaited<ReturnType<typeof economyTotals>>;
  playtime: Awaited<ReturnType<typeof playtimeLeaderboardForServer>>;
  /** Realm-merged playtime pool (shared Towny+Claims) — not per-host. */
  playersWithPlaytime: number;
  netWorth: Awaited<ReturnType<typeof netWorthLeaderboard>>;
  /** LIVE wallet leaderboard for Towny (balance only). */
  wallets: Awaited<ReturnType<typeof netWorthLeaderboard>>;
  mcmmo: Awaited<ReturnType<typeof mcmmoLeaderboard>>;
  discord: Awaited<ReturnType<typeof discordActivityForDay>>;
  discordOps: DiscordOperationalHighlight[];
  items: Awaited<ReturnType<typeof serverItemTotals>>;
  shops: Awaited<ReturnType<typeof shopListingsForServer>>;
  prices: Awaited<ReturnType<typeof shopPriceCatalog>>;
  treasury: TreasuryReportBrief;
  /** Claims host economy (playtime/votes are realm-merged — not duplicated here). */
  claims: {
    serverId: string;
    displayName: string;
    joinAddress: string;
    onlinePlayers: number | null;
    gameVersion: string | null;
    /** Same realm-wide linked count as `linked` (kept for callers; not host-specific). */
    linked: number;
    economy: Awaited<ReturnType<typeof economyTotals>>;
    /** Real inventory net worth when tracked; empty when host has no NW pipeline. */
    netWorth: Awaited<ReturnType<typeof netWorthLeaderboard>>;
    /** LIVE wallet leaderboard (balance only). */
    wallets: Awaited<ReturnType<typeof netWorthLeaderboard>>;
  };
};

const EMBED_GOLD = 0xc9a227;
const HST_OFFSET_MS = 10 * 60 * 60 * 1000;
const TEXT_CHANNEL_SCAN_LIMIT = 60;
const MESSAGE_PAGE_LIMIT = 5;

function str(v: unknown): string {
  return String(v ?? "").trim();
}

function nowIso(): string {
  return new Date().toISOString();
}

/** True at HST calendar midnight (hourly cron at 10:00 UTC). */
export function isHstMidnightHour(at = new Date()): boolean {
  const hstMs = at.getTime() - HST_OFFSET_MS;
  const hst = new Date(hstMs);
  return hst.getUTCHours() === 0 && hst.getUTCMinutes() < 10;
}

/** Previous completed HST calendar day (midnight → midnight). */
export function previousHstDayKey(at = new Date()): string {
  const hstMs = at.getTime() - HST_OFFSET_MS;
  const hst = new Date(hstMs);
  const start = new Date(
    Date.UTC(hst.getUTCFullYear(), hst.getUTCMonth(), hst.getUTCDate()) - 24 * 60 * 60 * 1000,
  );
  const y = start.getUTCFullYear();
  const m = start.getUTCMonth();
  const day = start.getUTCDate();
  return `${y}-${String(m + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function hstDayBoundsMs(dayKey: string): { startMs: number; endMs: number } {
  const startMs = Date.parse(`${dayKey}T00:00:00-10:00`);
  const endMs = startMs + 24 * 60 * 60 * 1000 - 1;
  return { startMs, endMs };
}

function formatGold(value: number): string {
  return formatGoldDailyReport(value);
}

function snowflakeFromMs(ms: number): string {
  return String((BigInt(Math.floor(ms)) - 1420070400000n) << 22n);
}

function formatPlaytime(seconds: number): string {
  const s = Math.max(0, Math.floor(Number(seconds) || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h >= 24) {
    const d = Math.floor(h / 24);
    const rh = h % 24;
    return `${d}d ${rh}h`;
  }
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function playerLine(rank: number, name: string | null, detail: string): string {
  const label = name ? `**${name}**` : "_unknown_";
  return `\`${rank}.\` ${label} - ${detail}`;
}

export async function resolveServerId(db: D1Database): Promise<string> {
  const row = await db
    .prepare(
      `SELECT server_id FROM rootstat_servers
       WHERE featured = 1
       ORDER BY updated_at DESC
       LIMIT 1`,
    )
    .first<{ server_id: string }>();
  const id = str(row?.server_id);
  if (id && id !== "4963895e-0964-48b8-81b7-1f40a966e8be" && id !== "15bbc057-4f8b-4761-abdb-7b7e4d9c7512") {
    return id;
  }
  return FEATURED_SERVER_DEFAULTS.server_id;
}

async function serverStatusRow(db: D1Database, serverId: string) {
  return db
    .prepare(
      `SELECT server_name, game_version, rootmc_plugin_version,
              rootmc_last_seen_at, rootstat_last_seen_at
       FROM rootstat_servers
       WHERE server_id = ?
       LIMIT 1`,
    )
    .bind(serverId)
    .first<Record<string, unknown>>();
}

async function mcmmoLeaderboard(db: D1Database, serverId: string, limit = 5) {
  const { results } = await db
    .prepare(
      `SELECT minecraft_username, power_level
       FROM rootstat_mcmmo_stats
       WHERE server_id = ?
       ORDER BY power_level DESC
       LIMIT ?`,
    )
    .bind(serverId, limit)
    .all<{ minecraft_username: string | null; power_level: number }>();
  return results || [];
}

async function economyTotals(db: D1Database, serverId: string) {
  const net = await db
    .prepare(
      `SELECT COUNT(*) AS players,
              COALESCE(SUM(total_value), 0) AS total_net_worth,
              COALESCE(SUM(balance_value), 0) AS total_balance,
              MAX(synced_at) AS latest_synced_at
       FROM rootstat_player_net_worth
       WHERE server_id = ?
       ${economySystemAccountSqlFilter}`,
    )
    .bind(serverId)
    .first<{
      players: number;
      total_net_worth: number;
      total_balance: number;
      latest_synced_at: string | null;
    }>();

  const shops = await db
    .prepare(
      `SELECT COUNT(*) AS c, MAX(synced_at) AS latest_synced_at
       FROM rootstat_shop_listings WHERE server_id = ?`,
    )
    .bind(serverId)
    .first<{ c: number; latest_synced_at: string | null }>();

  const prices = await db
    .prepare(`SELECT COUNT(*) AS c FROM rootstat_shop_prices WHERE server_id = ? AND avg_price > 0`)
    .bind(serverId)
    .first<{ c: number }>();

  const goldSupply = await readGoldMintedBreakdown(db, serverId);

  const syncedCandidates = [str(net?.latest_synced_at), str(shops?.latest_synced_at)].filter(Boolean);
  const syncedAt = syncedCandidates.sort().pop() || null;
  const shopSyncedAt = str(shops?.latest_synced_at) || null;
  const shopAgeMs = shopSyncedAt ? Date.now() - Date.parse(shopSyncedAt) : Number.POSITIVE_INFINITY;
  const shopFresh = Number.isFinite(shopAgeMs) && shopAgeMs >= 0 && shopAgeMs < 24 * 60 * 60 * 1000;

  return {
    trackedPlayers: Number(net?.players) || 0,
    totalNetWorth: Number(net?.total_net_worth) || 0,
    totalBalance: Number(net?.total_balance) || 0,
    totalGoldMinted: goldSupply.total_gold_mined,
    totalGoldMined: goldSupply.total_gold_mined,
    // Never publish week-old D1 shop rows as live dual-host facts.
    shopListings: shopFresh ? Number(shops?.c) || 0 : null,
    pricedItems: Number(prices?.c) || 0,
    syncedAt,
  };
}

/** Live chest-shop listing count from host MySQL (Hyperdrive). null = not available. */
async function liveMysqlShopListingCount(
  env: RootMcHyperdriveEnv,
  bindingName: RootMcMysqlBindingName,
): Promise<number | null> {
  const conn = await openRootMcMysqlBinding(env, bindingName);
  if (!conn) return null;
  try {
    const prefix = rootMcMysqlTablePrefix(env);
    const candidates = [`${prefix}rootstat_shop_listings`, `${prefix}shop_listings`];
    for (const table of candidates) {
      try {
        const [rows] = await conn.query(`SELECT COUNT(*) AS c FROM \`${table}\``);
        const first = Array.isArray(rows) ? (rows[0] as { c?: number }) : null;
        const c = Number(first?.c);
        if (Number.isFinite(c)) return Math.max(0, Math.floor(c));
      } catch {
        // try next table name
      }
    }
    return null;
  } catch (e) {
    console.warn(
      "rootmc_live_mysql_shop_count_failed",
      bindingName,
      e instanceof Error ? e.message : String(e),
    );
    return null;
  } finally {
    await conn.end().catch(() => undefined);
  }
}

async function townySnapshot(db: D1Database, serverId: string) {
  const totals = await db
    .prepare(
      `SELECT
         COALESCE(SUM(plot_count), 0) AS total_plots,
         COALESCE(SUM(town_balance_gold), 0) AS total_town_banks,
         MAX(synced_at) AS latest_synced_at
       FROM rootmc_towny_towns
       WHERE server_id = ? AND is_active = 1`,
    )
    .bind(serverId)
    .first<{ total_plots: number; total_town_banks: number; latest_synced_at: string | null }>();

  const towns = await db
    .prepare(
      `SELECT town_name, mayor_name, resident_count, nation_name, is_capital, plot_count, town_balance_gold
       FROM rootmc_towny_towns
       WHERE server_id = ? AND is_active = 1
       ORDER BY plot_count DESC, resident_count DESC, town_name COLLATE NOCASE ASC
       LIMIT 40`,
    )
    .bind(serverId)
    .all<Record<string, unknown>>();

  const nations = await db
    .prepare(
      `SELECT nation_name, leader_name, town_count
       FROM rootmc_towny_nations
       WHERE server_id = ? AND is_active = 1
       ORDER BY town_count DESC, nation_name COLLATE NOCASE ASC
       LIMIT 12`,
    )
    .bind(serverId)
    .all<Record<string, unknown>>();

  const townCount = await db
    .prepare(`SELECT COUNT(*) AS c FROM rootmc_towny_towns WHERE server_id = ? AND is_active = 1`)
    .bind(serverId)
    .first<{ c: number }>();

  const nationCount = await db
    .prepare(`SELECT COUNT(*) AS c FROM rootmc_towny_nations WHERE server_id = ? AND is_active = 1`)
    .bind(serverId)
    .first<{ c: number }>();

  const totalPlots = Math.max(0, Math.floor(Number(totals?.total_plots) || 0));
  const townRows = towns.results || [];

  return {
    townCount: Number(townCount?.c) || 0,
    nationCount: Number(nationCount?.c) || 0,
    totalPlots,
    totalTownBanks: Math.max(0, Number(totals?.total_town_banks) || 0),
    syncedAt: str(totals?.latest_synced_at) || null,
    plotCountsAvailable: totalPlots > 0,
    towns: townRows,
    nations: nations.results || [],
  };
}

/** Discord-linked Minecraft accounts (realm-wide — shared across Towny and Claims). */
async function linkedPlayerCount(db: D1Database): Promise<number> {
  const row = await db
    .prepare(
      `SELECT COUNT(DISTINCT l.minecraft_uuid) AS c
       FROM rootstat_minecraft_links l
       INNER JOIN discord_account_links d ON d.account_id = l.account_id`,
    )
    .first<{ c: number }>();
  return Number(row?.c) || 0;
}

/** Realm-merged playtime headcount (shared Towny+Claims — never count per host). */
async function realmPlaytimePlayerCount(db: D1Database, primaryServerId: string): Promise<number> {
  const row = await db
    .prepare(
      `SELECT COUNT(*) AS c
       FROM rootstat_player_playtime
       WHERE server_id = ?
         AND COALESCE(total_playtime_seconds, 0) > 0`,
    )
    .bind(primaryServerId)
    .first<{ c: number }>();
  return Math.max(0, Number(row?.c) || 0);
}

async function upsertDiscoveredChannels(
  db: D1Database,
  guildId: string,
  channels: { id: string; name: string; type: number; position?: number; parent_id?: string | null }[],
): Promise<void> {
  const ts = nowIso();
  for (const ch of channels.slice(0, 80)) {
    await db
      .prepare(
        `INSERT INTO discord_discovered_channels
           (channel_id, guild_id, name, type, position, parent_id, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(channel_id) DO UPDATE SET
           guild_id = excluded.guild_id,
           name = excluded.name,
           type = excluded.type,
           position = excluded.position,
           parent_id = excluded.parent_id,
           updated_at = excluded.updated_at`,
      )
      .bind(
        ch.id,
        guildId,
        ch.name,
        ch.type,
        Number(ch.position) || 0,
        ch.parent_id || null,
        ts,
      )
      .run();
  }
}

async function countChannelMessagesInWindow(
  token: string,
  channelId: string,
  startMs: number,
  endMs: number,
): Promise<number> {
  const after = snowflakeFromMs(startMs);
  let before: string | undefined;
  let total = 0;

  for (let page = 0; page < MESSAGE_PAGE_LIMIT; page++) {
    const params = new URLSearchParams({ limit: "100", after });
    if (before) params.set("before", before);
    const res = await discordBotFetch(
      token,
      `/channels/${encodeURIComponent(channelId)}/messages?${params}`,
    );
    if (!res.ok) break;
    const msgs = (await res.json()) as { id: string; timestamp?: string }[];
    if (!msgs.length) break;

    for (const msg of msgs) {
      const ts = Date.parse(msg.timestamp || "");
      if (Number.isNaN(ts)) continue;
      if (ts < startMs) continue;
      if (ts > endMs) continue;
      total += 1;
    }

    if (msgs.length < 100) break;
    before = msgs[msgs.length - 1]?.id;
    if (!before) break;
  }

  return total;
}

async function discordActivityForDay(
  env: RootMcDailyReportEnv,
  dayKey: string,
): Promise<{ totalMessages: number; topChannels: { name: string; count: number }[]; memberCount: number }> {
  const token = str(env.DISCORD_ROOTMC_BOT_TOKEN);
  const guildId = str(env.DISCORD_ROOTMC_GUILD_ID);
  if (!token || !guildId) {
    return { totalMessages: 0, topChannels: [], memberCount: 0 };
  }

  const { startMs, endMs } = hstDayBoundsMs(dayKey);
  const guild = await fetchGuildSummary(token, guildId);
  const channels = await listGuildTextChannels(token, guildId);
  await upsertDiscoveredChannels(env.DB, guildId, channels);
  const excluded = excludedDiscordChannelsForGrok(env);

  const counts: { name: string; count: number }[] = [];
  let totalMessages = 0;

  const scannable = channels.filter((ch) => ch.id && !excluded.has(ch.id));
  for (const ch of scannable.slice(0, TEXT_CHANNEL_SCAN_LIMIT)) {
    const count = await countChannelMessagesInWindow(token, ch.id, startMs, endMs);
    if (count > 0) counts.push({ name: ch.name, count });
    totalMessages += count;
  }

  counts.sort((a, b) => b.count - a.count);

  const d1Rows = await env.DB.prepare(
    `SELECT d.channel_id, d.message_count, c.name
     FROM discord_activity_daily_by_channel d
     LEFT JOIN discord_discovered_channels c ON c.channel_id = d.channel_id
     WHERE d.day = ? AND c.guild_id = ?
     ORDER BY d.message_count DESC
     LIMIT 40`,
  )
    .bind(dayKey, guildId)
    .all<{ channel_id: string; message_count: number; name: string | null }>();

  const d1Eligible = (d1Rows.results || []).filter(
    (r) => r.channel_id && !excluded.has(r.channel_id) && Number(r.message_count) > 0,
  );
  const d1Total = d1Eligible.reduce((s, r) => s + (Number(r.message_count) || 0), 0);
  if (d1Total > totalMessages) {
    totalMessages = d1Total;
    const fromD1 = d1Eligible
      .slice(0, 5)
      .map((r) => ({ name: str(r.name) || r.channel_id.slice(-6), count: Number(r.message_count) || 0 }));
    if (fromD1.length) {
      counts.length = 0;
      counts.push(...fromD1);
    }
  }

  return {
    totalMessages,
    topChannels: counts.slice(0, 5),
    memberCount: guild?.memberCount || 0,
  };
}

function pluginOnline(lastSeen: string | null | undefined, windowMs: number): boolean {
  if (!lastSeen) return false;
  const ms = Date.parse(lastSeen);
  return !Number.isNaN(ms) && Date.now() - ms < windowMs;
}

/** Prefer LIVE_DB Hyperdrive mirrors for singular live-production wallets + gold mined. */
async function liveHostEconomySlice(
  liveDb: D1Database,
  serverId: string,
): Promise<{
  economy: Awaited<ReturnType<typeof economyTotals>>;
  /** Wallet rows only (balance_value). */
  wallets: Awaited<ReturnType<typeof netWorthLeaderboard>>;
} | null> {
  try {
    const bal = await liveDb
      .prepare(
        `SELECT minecraft_uuid, minecraft_username, balance, updated_at
         FROM m_root_economy_balances
         WHERE _server_id = ?`,
      )
      .bind(serverId)
      .all<{
        minecraft_uuid: string;
        minecraft_username: string;
        balance: string;
        updated_at: string;
      }>();

    const rows = (bal.results || [])
      .map((row) => {
        const uuid = str(row.minecraft_uuid).toLowerCase();
        const name = str(row.minecraft_username);
        const balance = Number(row.balance);
        if (!uuid || !Number.isFinite(balance) || balance <= 0) return null;
        if (isEconomySystemAccount(uuid, name)) return null;
        return {
          minecraft_uuid: uuid,
          minecraft_username: name || null,
          balance_value: balance,
          total_value: 0,
          synced_at: str(row.updated_at) || null,
        };
      })
      .filter((row): row is NonNullable<typeof row> => row !== null);

    if (rows.length === 0) return null;

    const totalBalance = rows.reduce((s, r) => s + r.balance_value, 0);
    const syncedAt = rows.map((r) => r.synced_at).filter(Boolean).sort().pop() || null;
    const wallets = [...rows]
      .sort((a, b) => b.balance_value - a.balance_value)
      .slice(0, 15)
      .map((r) => ({
        minecraft_username: r.minecraft_username,
        total_value: 0,
        balance_value: r.balance_value,
      }));

    const goldRow = await liveDb
      .prepare(
        `SELECT COALESCE(SUM(CAST(total_gold_g AS REAL)), 0) AS mined
         FROM m_root_gold_found
         WHERE _server_id = ?`,
      )
      .bind(serverId)
      .first<{ mined: number }>();
    const goldMined = Math.max(0, Number(goldRow?.mined) || 0);

    // Physical gold in inv/ender/chests/shops (LIVE mirror). Wallet + physical = host NW when D1 item NW absent.
    let physicalGold = 0;
    try {
      const physPlayers = await liveDb
        .prepare(
          `SELECT COALESCE(SUM(CAST(total_g AS REAL)), 0) AS t
           FROM m_root_player_physical_gold
           WHERE _server_id = ?`,
        )
        .bind(serverId)
        .first<{ t: number }>();
      physicalGold = Math.max(0, Number(physPlayers?.t) || 0);
      if (!(physicalGold > 0)) {
        const physSummary = await liveDb
          .prepare(
            `SELECT CAST(total_storage_g AS REAL) AS t
             FROM m_root_physical_gold_summary
             WHERE _server_id = ?
             LIMIT 1`,
          )
          .bind(serverId)
          .first<{ t: number }>();
        physicalGold = Math.max(0, Number(physSummary?.t) || 0);
      }
    } catch {
      physicalGold = 0;
    }

    return {
      economy: {
        trackedPlayers: rows.length,
        totalNetWorth: totalBalance + physicalGold,
        totalBalance,
        totalGoldMinted: goldMined,
        totalGoldMined: goldMined,
        shopListings: null,
        pricedItems: 0,
        syncedAt,
      },
      wallets,
    };
  } catch (e) {
    console.warn(
      "rootmc_live_host_economy_slice_failed",
      serverId,
      e instanceof Error ? e.message : String(e),
    );
    return null;
  }
}

async function gatherDailyMetrics(
  env: RootMcDailyReportEnv,
  dayKey: string,
  serverId?: string,
): Promise<DailyMetrics> {
  const featuredId = str(serverId) || (await resolveServerId(env.DB));
  const economyServerId = await resolveEconomyServerId(env.DB, featuredId, FEATURED_SERVER_DEFAULTS.server_id);
  await refreshServerNetWorth(env.DB, economyServerId);

  const server = await serverStatusRow(env.DB, economyServerId);
  const serverName = str(server?.server_name) || FEATURED_SERVER_DEFAULTS.server_name;
  const rootmcOk = pluginOnline(str(server?.rootmc_last_seen_at), 15 * 60 * 1000);
  const rootstatOk = pluginOnline(str(server?.rootstat_last_seen_at), 24 * 60 * 60 * 1000);

  const livePrimary = env.LIVE_DB
    ? (await liveHostEconomySlice(env.LIVE_DB, economyServerId)) ||
      // Hyperdrive mirror may still be keyed under the retired Towny UUID (same Shockbyte MySQL).
      (await liveHostEconomySlice(env.LIVE_DB, "15bbc057-4f8b-4761-abdb-7b7e4d9c7512"))
    : null;
  const [
    towny,
    economyMain,
    playtimeMain,
    netWorthMain,
    mcmmo,
    linked,
    discord,
    items,
    shops,
    prices,
    treasury,
    playersWithPlaytime,
    liveShopCount,
  ] = await Promise.all([
    townySnapshot(env.DB, economyServerId),
    economyTotals(env.DB, economyServerId),
    playtimeLeaderboardForServer(env.DB, economyServerId, 25),
    netWorthLeaderboard(env.DB, economyServerId, 15),
    mcmmoLeaderboard(env.DB, economyServerId, 15),
    linkedPlayerCount(env.DB),
    discordActivityForDay(env, dayKey),
    serverItemTotals(env.DB, economyServerId, 30),
    shopListingsForServer(env.DB, economyServerId, 50),
    shopPriceCatalog(env.DB, economyServerId, 50),
    treasuryBriefForReports(env.DB, economyServerId),
    realmPlaytimePlayerCount(env.DB, economyServerId),
    liveMysqlShopListingCount(env, "ROOTMC_MYSQL"),
  ]);

  const shopListings = liveShopCount ?? economyMain.shopListings;

  const economy = livePrimary?.economy
    ? {
        ...livePrimary.economy,
        totalNetWorth: economyMain.totalNetWorth,
        shopListings,
        pricedItems: economyMain.pricedItems,
        totalGoldMinted: livePrimary.economy.totalGoldMinted || economyMain.totalGoldMinted,
        totalGoldMined: livePrimary.economy.totalGoldMined || economyMain.totalGoldMined,
      }
    : { ...economyMain, shopListings };
  const playtime = playtimeMain;
  const netWorth = netWorthMain;
  const wallets = livePrimary?.wallets?.length ? livePrimary.wallets : netWorthMain;

  return {
    serverId: economyServerId,
    serverName,
    dayKey,
    rootmcOk,
    rootstatOk,
    gameVersion: str(server?.game_version) || FEATURED_SERVER_DEFAULTS.game_version,
    linked,
    towny,
    economy,
    playtime,
    playersWithPlaytime,
    netWorth,
    wallets,
    mcmmo,
    discord,
    discordOps: [] as DiscordOperationalHighlight[],
    items,
    shops,
    prices,
    treasury,
    // Retired dual-host Claims slice — keep shape empty so callers do not mix old maps.
    claims: {
      serverId: economyServerId,
      displayName: serverName,
      joinAddress: FEATURED_SERVER_DEFAULTS.server_address,
      onlinePlayers: null,
      gameVersion: str(server?.game_version) || null,
      linked,
      economy,
      netWorth,
      wallets,
    },
  };
}

export { gatherDailyMetrics, type DailyMetrics, EMBED_GOLD, nowIso, formatGold, formatPlaytime, playerLine };

type WaitUntilCtx = { waitUntil: (promise: Promise<unknown>) => void };

const ROOTMC_SCHEDULED_CATEGORIES = ["economy_intel", "towns", "nations"] as const;

/** Run all daily reports (daily + category briefs in isolated Worker invocations). */
export function scheduleRootMcDailyReports(env: RootMcDailyReportEnv, ctx: WaitUntilCtx): void {
  ctx.waitUntil(
    (async () => {
      const { runFullDailyReportSuite } = await import("./rootmc-daily-report-runner");
      await runFullDailyReportSuite(env);
    })().catch((e) => console.error("rootmc_daily_reports_failed", e instanceof Error ? e.message : String(e))),
  );
}

export async function runRootMcDailyReportCron(env: RootMcDailyReportEnv): Promise<void> {
  const { runFullDailyReportSuite } = await import("./rootmc-daily-report-runner");
  await runFullDailyReportSuite(env);
}
