/**
 * Gen 2 hourly realm snapshot — returns Discord section text for Gen 1 to
 * combine into one Gen1+Gen2 post. Does not post to Discord itself.
 */

import type { D1Database } from "@cloudflare/workers-types";

import { formatGold, roundGold } from "../discord-rootmc-economy";
import { resolveG2FeaturedRealmId, str } from "./g2-db";
import { queryJavaServerStatus } from "../rootmc-live-economy-status";

const SERVER_ONLINE_MAX_AGE_MS = 15 * 60 * 1000;

export type G2LiveEconomyStatusEnv = {
  DB: D1Database;
  DISCORD_ROOTMC_BOT_TOKEN?: string;
  DISCORD_ROOTMC_GENERAL_CHAT_CHANNEL_ID?: string;
  DISCORD_ROOTMC_GEN2_CHANNEL_ID?: string;
  SITE_URL?: string;
};

export type G2HourlySnapshotResult = {
  ok: boolean;
  online: boolean;
  /** Discord markdown section for Gen 2 (no outer title). */
  content: string;
  detail: string;
};

function num(v: unknown, fallback = 0): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

async function readRealm(db: D1Database, realmId: string) {
  return db
    .prepare(
      `SELECT realm_id, realm_name, server_address, last_heartbeat_ms, last_economy_snapshot_ms
       FROM g2_realm WHERE realm_id = ? LIMIT 1`,
    )
    .bind(realmId)
    .first<{
      realm_id: string;
      realm_name: string | null;
      server_address: string | null;
      last_heartbeat_ms: number | null;
      last_economy_snapshot_ms: number | null;
    }>();
}

async function readOnlineSnap(db: D1Database, realmId: string) {
  return db
    .prepare(
      `SELECT player_count, updated_at_ms FROM g2_snap_online WHERE realm_id = ? LIMIT 1`,
    )
    .bind(realmId)
    .first<{ player_count: number; updated_at_ms: number }>();
}

function isServerOnline(input: {
  lastHeartbeatMs: number;
  lastEconomySnapshotMs: number;
  onlineSnapMs: number;
  nowMs: number;
}): boolean {
  const ages = [input.lastHeartbeatMs, input.lastEconomySnapshotMs, input.onlineSnapMs]
    .filter((ms) => ms > 0)
    .map((ms) => input.nowMs - ms);
  if (ages.length === 0) return false;
  return Math.min(...ages) <= SERVER_ONLINE_MAX_AGE_MS;
}

async function readTopPlayer(db: D1Database, realmId: string) {
  const row = await db
    .prepare(
      `SELECT username, gold_g
       FROM g2_snap_balance
       WHERE realm_id = ? AND gold_g > 0.0001
       ORDER BY gold_g DESC
       LIMIT 1`,
    )
    .bind(realmId)
    .first<{ username: string | null; gold_g: number }>();
  if (!row) return null;
  return {
    username: str(row.username) || "Unknown",
    balance: Math.max(0, num(row.gold_g)),
  };
}

async function readWalletGold(db: D1Database, realmId: string): Promise<number> {
  const row = await db
    .prepare(
      `SELECT COALESCE(SUM(gold_g), 0) AS total_g
       FROM g2_snap_balance
       WHERE realm_id = ? AND gold_g > 0.0001`,
    )
    .bind(realmId)
    .first<{ total_g: number }>();
  return roundGold(num(row?.total_g));
}

async function readTreasury(db: D1Database, realmId: string) {
  return db
    .prepare(`SELECT reserve_g FROM g2_snap_treasury WHERE realm_id = ? LIMIT 1`)
    .bind(realmId)
    .first<{ reserve_g: number }>();
}

function buildG2HourlySection(input: {
  serverAddress: string;
  onlinePlayers: number;
  walletGold: number;
  reserveGold: number;
  topPlayer: { username: string; balance: number } | null;
  ageSec: number;
  economyUrl: string;
}): string {
  const topPlayerLine = input.topPlayer
    ? `**${input.topPlayer.username}** — **${formatGold(input.topPlayer.balance)}**`
    : "_No player wallets tracked yet._";
  return (
    `• **Server:** \`${input.serverAddress}\`\n` +
    `• **Players online:** ${input.onlinePlayers}\n` +
    `• **Top player:** ${topPlayerLine} · same as \`/baltop players\`\n` +
    `• **Wallet gold (all players):** ${formatGold(input.walletGold)}\n` +
    `• **Server Reserve:** ${formatGold(input.reserveGold)}\n` +
    `• **Status:** online (heartbeat ${input.ageSec}s ago) · [g2](${input.economyUrl})`
  );
}

/** Collect Gen 2 hourly section for Gen 1's combined Discord post. */
export async function collectG2HourlySnapshot(
  env: G2LiveEconomyStatusEnv,
): Promise<G2HourlySnapshotResult> {
  const realmId = (await resolveG2FeaturedRealmId(env.DB)) || "";
  if (!realmId) {
    return {
      ok: false,
      online: false,
      content: "• _No Gen 2 realm registered._",
      detail: "no g2 realm registered",
    };
  }

  const nowMs = Date.now();
  const [realm, onlineSnap] = await Promise.all([
    readRealm(env.DB, realmId),
    readOnlineSnap(env.DB, realmId),
  ]);
  if (!realm) {
    return {
      ok: false,
      online: false,
      content: "• _Gen 2 realm missing._",
      detail: `realm not found: ${realmId}`,
    };
  }

  const lastHeartbeatMs = num(realm.last_heartbeat_ms);
  const lastEconomySnapshotMs = num(realm.last_economy_snapshot_ms);
  const onlineSnapMs = num(onlineSnap?.updated_at_ms);
  const serverAddress = str(realm.server_address) || "g2.rootmc.net:24945";
  const heartbeatFresh = isServerOnline({
    lastHeartbeatMs,
    lastEconomySnapshotMs,
    onlineSnapMs,
    nowMs,
  });

  // If cloud heartbeats are stale (common when jars still hit Gen1 paths), fall
  // back to a live Minecraft list ping before declaring Gen2 offline.
  const ping = await queryJavaServerStatus(serverAddress);
  if (!heartbeatFresh && (!ping || !ping.online)) {
    return {
      ok: true,
      online: false,
      content: "• _Offline_ (stale heartbeat / snapshot).",
      detail: "skipped — gen2 server offline (stale heartbeat/snapshot)",
    };
  }

  const freshestMs = Math.max(
    lastHeartbeatMs,
    lastEconomySnapshotMs,
    onlineSnapMs,
    heartbeatFresh ? 0 : nowMs,
  );
  const onlinePlayers = ping?.online
    ? ping.players
    : Math.max(0, Math.floor(num(onlineSnap?.player_count)));

  const [topPlayer, walletGold, treasury] = await Promise.all([
    readTopPlayer(env.DB, realmId),
    readWalletGold(env.DB, realmId),
    readTreasury(env.DB, realmId),
  ]);

  const siteUrl = str(env.SITE_URL) || "https://rootmc.net";
  const content = buildG2HourlySection({
    serverAddress,
    onlinePlayers,
    walletGold,
    reserveGold: roundGold(num(treasury?.reserve_g)),
    topPlayer,
    ageSec: Math.max(0, Math.round((nowMs - freshestMs) / 1000)),
    economyUrl: `${siteUrl.replace(/\/$/, "")}/g2/`,
  });

  return {
    ok: true,
    online: true,
    content,
    detail: `gen2 hourly online=${onlinePlayers} wallets=${formatGold(walletGold)}`,
  };
}

/**
 * @deprecated Prefer {@link collectG2HourlySnapshot} — Gen 1 posts the combined message.
 * Kept for the api2 cron trigger (returns JSON only; no Discord post).
 */
export async function runG2LiveEconomyStatusPost(
  env: G2LiveEconomyStatusEnv,
): Promise<{ ok: boolean; detail: string; online?: boolean; content?: string }> {
  const result = await collectG2HourlySnapshot(env);
  return {
    ok: result.ok,
    detail: result.detail,
    online: result.online,
    content: result.content,
  };
}
