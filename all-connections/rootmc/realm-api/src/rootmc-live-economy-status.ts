/**
 * Posts combined Towny + Claims live realm snapshots once per hour.
 */

import type { D1Database } from "@cloudflare/workers-types";

import { discordBotFetch } from "./discord-rootmc-api";
import { formatGold, roundGold } from "./discord-rootmc-economy";
import { economySystemAccountSqlFilter } from "./rootmc-economy-accounts";
import { resolveServerId } from "./rootmc-daily-report";
import { FEATURED_SERVER_ADDRESS, publicServerAddress } from "./rootmc-server";
import { goldFoundLeaderboardForServer } from "./rootmc-gold-found";
import { reserveGoldMinedUrl } from "./rootmc-site";
import {
  allHostsConnected,
  readHostPresenceStatus,
} from "./rootmc-dev-workstation";
import { formatServerSpecsLine, readHostMetricsLastHourAvg } from "./rootmc-host-metrics";
import {
  formatDurationShort,
  formatHostStatusWithUptime,
  readDevPresenceUptimeSummary,
} from "./rootmc-host-presence";
import { treasuryBriefForReports, readPostResetNoteSupplySnapshot } from "./rootmc-treasury";
import { resolveHourlySnapshotChannelId } from "./rootmc-report-channels";
import { CLAIMS_SERVER_ID } from "./rootmc-claims-vote-credit";
import { ROOTMC_CHANNEL_FALLBACKS } from "./rootmc-discord-channels";
import { buildHostSiteHourlySection } from "./rootmc-host-site";

export type RootMcLiveEconomyStatusEnv = {
  DB: D1Database;
  DISCORD_ROOTMC_BOT_TOKEN?: string;
  DISCORD_ROOTMC_GENERAL_CHAT_CHANNEL_ID?: string;
  DISCORD_ROOTMC_HOURLY_SNAPSHOT_CHANNEL_ID?: string;
  DISCORD_ROOTMC_PROPOSALS_CHANNEL_ID?: string;
  DISCORD_ROOTMC_GUILD_ID?: string;
  SITE_URL?: string;
};

const DEFAULT_GUILD_ID = "1516108585740800042";
const GOVERNANCE_PROP_CAP = 5;

const CLAIMS_JOIN_ADDRESS = "51.81.176.61:24945";

function str(v: unknown): string {
  return String(v ?? "").trim();
}

function nowIso(): string {
  return new Date().toISOString();
}

const LIVE_STATS_MAX_AGE_MS = 12 * 60 * 1000;
const MCSTATUS_API_BASE = "https://api.mcstatus.io/v2/status/java";

/** Strip URL scheme/trailing slash; keep host or host:port for mcstatus.io. */
export function parseJavaServerEndpoint(address: string): string {
  const trimmed = str(address) || FEATURED_SERVER_ADDRESS;
  return trimmed.replace(/^https?:\/\//i, "").replace(/\/+$/, "");
}

/** Live player count via Minecraft server list ping (mcstatus.io). */
export async function queryJavaServerOnlinePlayers(serverAddress: string): Promise<number | null> {
  const status = await queryJavaServerStatus(serverAddress);
  if (!status) return null;
  return status.online ? status.players : 0;
}

/** Full list-ping result — distinguishes unreachable vs online-with-zero. */
export async function queryJavaServerStatus(
  serverAddress: string,
): Promise<{ online: boolean; players: number } | null> {
  const endpoint = parseJavaServerEndpoint(serverAddress);
  if (!endpoint) return null;

  const url = `${MCSTATUS_API_BASE}/${encodeURIComponent(endpoint)}?timeout=4`;
  try {
    const res = await fetch(url, { headers: { Accept: "application/json" } });
    if (!res.ok) {
      console.warn("rootmc_server_ping_http", endpoint, res.status);
      return null;
    }
    const body = (await res.json()) as { online?: boolean; players?: { online?: number } };
    const online = Boolean(body.online);
    return {
      online,
      players: online ? Math.max(0, Math.floor(Number(body.players?.online) || 0)) : 0,
    };
  } catch (e) {
    console.warn(
      "rootmc_server_ping_failed",
      endpoint,
      e instanceof Error ? e.message : String(e),
    );
    return null;
  }
}

/** Cached online count from heartbeat / last status ping (null if missing or stale). */
export async function readHeartbeatOnlinePlayerCount(
  db: D1Database,
  serverId: string,
  maxAgeMs = LIVE_STATS_MAX_AGE_MS,
): Promise<number | null> {
  try {
    const live = await db
      .prepare(
        `SELECT online_players, updated_at FROM rootmc_server_live_stats WHERE server_id = ? LIMIT 1`,
      )
      .bind(serverId)
      .first<{ online_players: number; updated_at: string }>();
    const updatedAt = Date.parse(str(live?.updated_at));
    if (
      live &&
      Number.isFinite(updatedAt) &&
      Date.now() - updatedAt <= maxAgeMs
    ) {
      return Math.max(0, Math.floor(Number(live.online_players) || 0));
    }
  } catch {
    // Table may not exist until migration 0118 is applied.
  }
  return null;
}

async function readOnlinePlayerCount(
  db: D1Database,
  serverId: string,
  serverAddress: string,
): Promise<number> {
  const pinged = await queryJavaServerOnlinePlayers(serverAddress);
  if (pinged !== null) {
    await upsertServerLiveStats(db, serverId, pinged);
    return pinged;
  }

  const heartbeat = await readHeartbeatOnlinePlayerCount(db, serverId);
  return heartbeat ?? 0;
}

async function readServerAddress(db: D1Database, serverId: string): Promise<string> {
  const row = await db
    .prepare(`SELECT server_address FROM rootstat_servers WHERE server_id = ? LIMIT 1`)
    .bind(serverId)
    .first<{ server_address: string | null }>();
  return publicServerAddress(row?.server_address);
}

async function readTopPlayer(
  db: D1Database,
  serverId: string,
): Promise<{ username: string; balance: number } | null> {
  const fromNetWorth = await db
    .prepare(
      `SELECT minecraft_username, balance_value
       FROM rootstat_player_net_worth
       WHERE server_id = ?
       ${economySystemAccountSqlFilter}
       ORDER BY balance_value DESC
       LIMIT 1`,
    )
    .bind(serverId)
    .first<{ minecraft_username: string | null; balance_value: number }>();
  if (fromNetWorth && Number(fromNetWorth.balance_value) > 0) {
    return {
      username: str(fromNetWorth.minecraft_username) || "Unknown",
      balance: Math.max(0, Number(fromNetWorth.balance_value) || 0),
    };
  }
  const fromBalances = await db
    .prepare(
      `SELECT minecraft_username, balance
       FROM rootstat_player_balances
       WHERE server_id = ?
       ${economySystemAccountSqlFilter}
       ORDER BY balance DESC
       LIMIT 1`,
    )
    .bind(serverId)
    .first<{ minecraft_username: string | null; balance: number }>();
  if (!fromBalances) {
    return null;
  }
  return {
    username: str(fromBalances.minecraft_username) || "Unknown",
    balance: Math.max(0, Number(fromBalances.balance) || 0),
  };
}

async function readTopGoldMiner(
  db: D1Database,
  serverId: string,
): Promise<{ username: string; minedSinceJuly: number } | null> {
  const rows = await goldFoundLeaderboardForServer(db, serverId, 1, "since_july");
  const top = rows[0];
  if (!top) {
    return null;
  }
  const physical = roundGold(top.mined_ore_since_july_g + top.mined_block_since_july_g);
  if (physical <= 0) {
    return null;
  }
  return {
    username: str(top.minecraft_username) || "Unknown",
    minedSinceJuly: physical,
  };
}

export function buildLiveEconomyStatusMessage(input: {
  serverAddress: string;
  onlinePlayers: number;
  walletGold: number;
  goldInCirculation: number;
  reserveVaultNotes: number;
  reserveGold: number;
  totalGoldMined: number;
  topPlayer: { username: string; balance: number } | null;
  topGoldMiner?: { username: string; minedSinceJuly: number } | null;
  goldMinedUrl?: string;
  backingPct?: number | null;
  dynamicTaxPct?: number | null;
  economyUrl?: string;
  devWorkstationLines?: string[];
}): string {
  const topPlayerLine = input.topPlayer
    ? `**${input.topPlayer.username}** \u2014 **${formatGold(input.topPlayer.balance)}**`
    : "_No player wallets tracked yet._";
  const address = str(input.serverAddress) || FEATURED_SERVER_ADDRESS;
  const goldMinedUrl = str(input.goldMinedUrl) || reserveGoldMinedUrl();
  const topMinerLine =
    input.topGoldMiner && input.topGoldMiner.minedSinceJuly > 0
      ? `\u2022 **Top miner (since July 1):** **${input.topGoldMiner.username}** \u2014 **${formatGold(input.topGoldMiner.minedSinceJuly)}**\n`
      : "";
  const economyUrl = str(input.economyUrl) || "https://rootmc.net/economy/";
  const backingPct = Number(input.backingPct);
  const dynamicTaxPct = Number(input.dynamicTaxPct);
  const backingSuffix = Number.isFinite(backingPct)
    ? ` (${backingPct.toFixed(1)}% wallet Notes backed by /mint)`
    : "";
  const taxLine = Number.isFinite(dynamicTaxPct)
    ? dynamicTaxPct <= 0.0001
      ? `\u2022 **Transaction tax:** **0%** (reserve ledger \u2265 1,000 G) \u00B7 [economy](${economyUrl})\n`
      : `\u2022 **Transaction tax:** **${dynamicTaxPct.toFixed(3)}%** (reserve ledger tier) \u00B7 [economy](${economyUrl})\n`
    : `\u2022 **Transaction tax:** live rate on [economy](${economyUrl}) \u00B7 \`/tax\` in-game\n`;
  const circulationLine = `\u2022 **Gold in circulation (wallets):** ${formatGold(input.walletGold)}\n`;
  const devWorkstationBlock =
    input.devWorkstationLines && input.devWorkstationLines.length > 0
      ? `${input.devWorkstationLines.join("\n")}\n`
      : "";

  return (
    `\u2022 **Server:** \`${address}\`\n` +
    `\u2022 **Players online:** ${input.onlinePlayers}\n` +
    `\u2022 **Top player:** ${topPlayerLine} \u00B7 same as \`/baltop players\`\n` +
    `\u2022 **Wallet gold (all players):** ${formatGold(input.walletGold)}\n` +
    `\u2022 **TOTAL GOLD MINED ALL TIME:** **${formatGold(input.totalGoldMined)}** \u00B7 [audited ledger](${goldMinedUrl})\n` +
    topMinerLine +
    taxLine +
    `\u2022 **Server Reserve (gap bucket):** ${formatGold(input.reserveGold)} \u00B7 offsets unclaimed/lost/tax differences\n` +
    circulationLine +
    devWorkstationBlock.trimEnd()
  );
}

/** Hourly #general post when server + dev workstation + laptop are all online. */
export function buildCondensedHourlyHostMessage(input: {
  laptopOnline: boolean;
  workstationOnline: boolean;
  serverOnline: boolean;
  serverAddress: string;
  onlinePlayers: number;
  serverSpecs: {
    cpu_avg_pct: number;
    ram_avg_pct: number;
    disk_used_pct: number;
    tps_avg: number | null;
  } | null;
  uptime: {
    laptopTodayMs: number;
    laptopSessionMs: number | null;
    workstationTodayMs: number;
    workstationSessionMs: number | null;
    serverTodayMs: number;
    serverSessionMs: number | null;
    mergedDevTodayMs: number;
  };
}): string {
  return (
    `${formatHostStatusWithUptime("Dev Laptop", input.laptopOnline, input.uptime.laptopTodayMs, input.uptime.laptopSessionMs)}\n` +
    `${formatHostStatusWithUptime("Dev Workstation", input.workstationOnline, input.uptime.workstationTodayMs, input.uptime.workstationSessionMs)}\n` +
    `${formatHostStatusWithUptime("Game server", input.serverOnline, input.uptime.serverTodayMs, input.uptime.serverSessionMs)} \u00B7 \`${input.serverAddress}\` \u00B7 ${input.onlinePlayers} players\n` +
    `\u2022 **Dev active (merged):** today ${formatDurationShort(input.uptime.mergedDevTodayMs)}\n` +
    formatServerSpecsLine(input.serverSpecs)
  );
}

export async function upsertServerLiveStats(
  db: D1Database,
  serverId: string,
  onlinePlayers: number,
  updatedAt = nowIso(),
): Promise<void> {
  try {
    await db
      .prepare(
        `INSERT INTO rootmc_server_live_stats (server_id, online_players, updated_at)
         VALUES (?, ?, ?)
         ON CONFLICT(server_id) DO UPDATE SET
           online_players = excluded.online_players,
           updated_at = excluded.updated_at`,
      )
      .bind(serverId, Math.max(0, Math.floor(onlinePlayers)), updatedAt)
      .run();
  } catch (e) {
    console.warn(
      "rootmc_live_stats_upsert",
      e instanceof Error ? e.message : String(e),
    );
  }
}

export async function runLiveEconomyStatusPost(
  env: RootMcLiveEconomyStatusEnv,
): Promise<{ ok: boolean; detail: string }> {
  const token = str(env.DISCORD_ROOTMC_BOT_TOKEN);
  const channelId = resolveHourlySnapshotChannelId(env);
  if (!token || !channelId) {
    return { ok: false, detail: "missing bot token or hourly snapshot channel id" };
  }

  const serverId = await resolveServerId(env.DB);
  const serverAddress = await readServerAddress(env.DB, serverId);
  try {
    const { refreshTreasuryVaultFromMysql } = await import("./rootmc-mysql-economy-pull");
    await refreshTreasuryVaultFromMysql(env);
  } catch {
    // Hyperdrive unavailable
  }
  const [onlinePlayers, treasury, topPlayer, topGoldMiner, noteSupply, presence, serverSpecs, uptimeSummary] =
    await Promise.all([
      readOnlinePlayerCount(env.DB, serverId, serverAddress),
      treasuryBriefForReports(env.DB, serverId),
      readTopPlayer(env.DB, serverId),
      readTopGoldMiner(env.DB, serverId),
      readPostResetNoteSupplySnapshot(env.DB, serverId),
      readHostPresenceStatus(env.DB, serverId),
      readHostMetricsLastHourAvg(env.DB, serverId),
      readDevPresenceUptimeSummary(env.DB, serverId),
    ]);

  // Channel 1528956490831102093 — no empty-hour noise when the Towny server is empty.
  if (onlinePlayers <= 0) {
    return { ok: true, detail: "skipped — 0 players online" };
  }

  const siteUrl = str(env.SITE_URL) || "https://rootmc.net";
  let gen1Body: string;
  if (allHostsConnected(presence)) {
    gen1Body = buildCondensedHourlyHostMessage({
      laptopOnline: presence.laptopOnline,
      workstationOnline: presence.workstationOnline,
      serverOnline: presence.serverOnline,
      serverAddress,
      onlinePlayers,
      serverSpecs,
      uptime: {
        laptopTodayMs: uptimeSummary.laptop.todayMs,
        laptopSessionMs: uptimeSummary.laptop.sessionMs,
        workstationTodayMs: uptimeSummary.workstation.todayMs,
        workstationSessionMs: uptimeSummary.workstation.sessionMs,
        serverTodayMs: uptimeSummary.server.todayMs,
        serverSessionMs: uptimeSummary.server.sessionMs,
        mergedDevTodayMs: uptimeSummary.mergedDevTodayMs,
      },
    });
  } else {
    const devWorkstationLines = [
      formatHostStatusWithUptime(
        "Dev Laptop",
        presence.laptopOnline,
        uptimeSummary.laptop.todayMs,
        uptimeSummary.laptop.sessionMs,
      ),
      formatHostStatusWithUptime(
        "Dev Workstation",
        presence.workstationOnline,
        uptimeSummary.workstation.todayMs,
        uptimeSummary.workstation.sessionMs,
      ),
      `\u2022 **Dev active (merged):** today ${formatDurationShort(uptimeSummary.mergedDevTodayMs)}`,
    ];
    const reserveGold = roundGold(Number(treasury.reserve_balance) || 0);
    const walletGold = roundGold(Number(noteSupply.player_notes_g) || 0);
    gen1Body = buildLiveEconomyStatusMessage({
      serverAddress,
      onlinePlayers,
      walletGold,
      goldInCirculation: roundGold(Number(noteSupply.total_notes_g) || 0),
      reserveVaultNotes: roundGold(Number(noteSupply.reserve_notes_g) || 0),
      reserveGold,
      totalGoldMined: roundGold(Number(noteSupply.gold_mined_g) || 0),
      topPlayer,
      topGoldMiner,
      goldMinedUrl: reserveGoldMinedUrl(env),
      backingPct: noteSupply.backing_pct,
      dynamicTaxPct: noteSupply.dynamic_tax_pct,
      economyUrl: `${siteUrl.replace(/\/$/, "")}/economy/`,
      devWorkstationLines,
    });
  }

  const claims = await buildClaimsHourlySection(env);
  const governance = await buildGovernanceHourlySection(env, token);
  const hostSite = await buildHostSiteHourlySection(env);
  const parts = [
    `**Hourly realm snapshot**`,
    ``,
    `**Towny**`,
    gen1Body.trim(),
    ``,
    `**Claims**`,
    claims.content.trim(),
  ];
  if (governance.content) {
    parts.push(``, `**Governance**`, governance.content.trim());
  }
  if (hostSite.content) {
    parts.push(``, hostSite.content.trim());
  }
  // Multipost-friendly: Discord limit 2000 — prefer host site over truncation of core
  let content = parts.join("\n");
  if (content.length > 1950) {
    content = content.slice(0, 1947) + "...";
  }

  const postRes = await discordBotFetch(token, `/channels/${encodeURIComponent(channelId)}/messages`, {
    method: "POST",
    body: JSON.stringify({ content }),
  });
  if (!postRes.ok) {
    const errText = await postRes.text().catch(() => "");
    return { ok: false, detail: `discord post failed ${postRes.status}: ${errText.slice(0, 200)}` };
  }

  return {
    ok: true,
    detail: allHostsConnected(presence)
      ? `posted combined hourly hosts towny_online=${onlinePlayers} claims=${claims.detail} gov=${governance.detail} host=${hostSite.detail}`
      : `posted combined hourly snapshot towny_online=${onlinePlayers} circulation=${formatGold(noteSupply.total_notes_g)} claims=${claims.detail} gov=${governance.detail} host=${hostSite.detail}`,
  };
}

/**
 * Open proposal-forum threads (top N titles + links). Empty when none / fetch fails.
 */
async function buildGovernanceHourlySection(
  env: RootMcLiveEconomyStatusEnv,
  token: string,
): Promise<{ content: string; detail: string }> {
  const guildId = str(env.DISCORD_ROOTMC_GUILD_ID) || DEFAULT_GUILD_ID;
  const proposalsId =
    str(env.DISCORD_ROOTMC_PROPOSALS_CHANNEL_ID) || ROOTMC_CHANNEL_FALLBACKS.proposals;
  if (!token || !guildId || !proposalsId) {
    return { content: "", detail: "gov skipped" };
  }

  try {
    const res = await discordBotFetch(
      token,
      `/guilds/${encodeURIComponent(guildId)}/threads/active`,
    );
    if (!res.ok) {
      return { content: "", detail: `gov fetch ${res.status}` };
    }
    const data = (await res.json()) as {
      threads?: Array<{
        id?: string;
        name?: string;
        parent_id?: string;
        thread_metadata?: { archived?: boolean; locked?: boolean };
      }>;
    };
    const allOpen = (data.threads || [])
      .filter((t) => str(t.parent_id) === proposalsId)
      .filter((t) => !t.thread_metadata?.archived && !t.thread_metadata?.locked)
      .map((t) => ({
        id: str(t.id),
        name: str(t.name) || "proposal",
      }))
      .filter((t) => t.id);

    const open = allOpen.slice(0, GOVERNANCE_PROP_CAP);

    if (!open.length) {
      return { content: "• _No open proposal threads_", detail: "gov=0" };
    }

    const lines = open.map(
      (t) =>
        `• [${t.name.slice(0, 80)}](https://discord.com/channels/${guildId}/${t.id})`,
    );
    if (allOpen.length > open.length) {
      lines.push(`• _+ more in_ \`#proposals\``);
    }
    return { content: lines.join("\n"), detail: `gov=${open.length}` };
  } catch (e) {
    console.warn(
      "rootmc_hourly_governance",
      e instanceof Error ? e.message : String(e),
    );
    return { content: "", detail: "gov error" };
  }
}

async function buildClaimsHourlySection(
  env: RootMcLiveEconomyStatusEnv,
): Promise<{ content: string; detail: string }> {
  const siteUrl = str(env.SITE_URL) || "https://rootmc.net";
  const economyUrl = `${siteUrl.replace(/\/$/, "")}/economy/claims/`;
  const ping = await queryJavaServerStatus(CLAIMS_JOIN_ADDRESS);
  const heartbeat = await readHeartbeatOnlinePlayerCount(env.DB, CLAIMS_SERVER_ID);
  const onlinePlayers = ping?.online
    ? ping.players
    : heartbeat != null
      ? heartbeat
      : 0;
  const onlineLabel = ping?.online || heartbeat != null ? "online" : "unknown";
  return {
    content:
      `\u2022 **Server:** \`${CLAIMS_JOIN_ADDRESS}\`\n` +
      `\u2022 **Players online:** ${onlinePlayers}\n` +
      `\u2022 **Economy:** [Claims](${economyUrl})`,
    detail: `claims ${onlineLabel} players=${onlinePlayers}`,
  };
}
