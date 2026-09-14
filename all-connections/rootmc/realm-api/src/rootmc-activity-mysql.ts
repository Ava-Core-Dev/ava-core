/**
 * Root-Activity MySQL: Discord timezone persist + public timezone peak aggregates.
 */

import type { Connection, RowDataPacket } from "mysql2/promise";
import mysql from "mysql2/promise";

import { resolveLinkedPlayerByDiscord } from "./discord-rootmc-economy";
import type { RootStatEnv } from "./rootstat-minecraft";
import {
  emptyHourBuckets,
  formatPeakHours,
  HST_OFFSET_MINUTES,
  PEAK_HOUR_COUNT,
  shiftBucketsToOffset,
  TIMEZONE_DEFS,
} from "./rootmc-timezone-defs";

type ActivityMysqlEnv = RootStatEnv & {
  ROOTMC_MYSQL?: {
    host: string;
    port: number;
    user: string;
    password: string;
    database: string;
  };
  ROOTMC_MYSQL_TABLE_PREFIX?: string;
};

export type ActivityTimezonePublicRow = {
  key: string;
  label: string;
  offsetMinutes: number;
  players: number;
  peakLocal: string;
  peakHst: string;
  playSeconds: number;
  hourBuckets: number[];
};

function tablePrefix(env: ActivityMysqlEnv): string {
  const raw = env.ROOTMC_MYSQL_TABLE_PREFIX;
  return raw == null || String(raw).trim() === "" ? "root_" : String(raw).trim();
}

async function openMysql(env: ActivityMysqlEnv): Promise<Connection | null> {
  const hd = env.ROOTMC_MYSQL;
  if (!hd?.host || !hd.user || !hd.database) {
    return null;
  }
  return mysql.createConnection({
    host: hd.host,
    port: hd.port || 3306,
    user: hd.user,
    password: hd.password,
    database: hd.database,
    disableEval: true,
  });
}

export async function persistDiscordTimezone(
  env: ActivityMysqlEnv,
  discordUserId: string,
  timezoneKey: string,
): Promise<void> {
  const key = String(timezoneKey || "").trim();
  if (!key) return;

  const linked = await resolveLinkedPlayerByDiscord(env.DB, discordUserId);
  if (!linked?.minecraftUuid) return;

  const conn = await openMysql(env);
  if (!conn) return;

  const table = `${tablePrefix(env)}activity_timezone`;
  try {
    await conn.execute(
      `INSERT INTO ${table} (minecraft_uuid, timezone_key, source, last_ip, updated_at)
       VALUES (?, ?, 'discord', NULL, UTC_TIMESTAMP())
       ON DUPLICATE KEY UPDATE
         timezone_key = VALUES(timezone_key),
         source = 'discord',
         updated_at = UTC_TIMESTAMP()`,
      [linked.minecraftUuid.toLowerCase(), key],
    );
  } finally {
    await conn.end();
  }
}

export async function fetchActivityTimezonePublic(
  env: ActivityMysqlEnv,
): Promise<{ ok: boolean; mysql: boolean; timezones: ActivityTimezonePublicRow[]; totalPlayers: number }> {
  const counts = new Map<string, number>();
  const buckets = new Map<string, number[]>();

  const conn = await openMysql(env);
  if (!conn) {
    return {
      ok: true,
      mysql: false,
      totalPlayers: 0,
      timezones: TIMEZONE_DEFS.map((d) => ({
        key: d.key,
        label: d.label,
        offsetMinutes: d.offsetMinutes,
        players: 0,
        peakLocal: "",
        peakHst: "",
        playSeconds: 0,
        hourBuckets: emptyHourBuckets(),
      })),
    };
  }

  const prefix = tablePrefix(env);
  const tzTable = `${prefix}activity_timezone`;
  const hourlyTable = `${prefix}activity_hourly`;

  try {
    const [countRows] = await conn.query<RowDataPacket[]>(
      `SELECT timezone_key, COUNT(*) AS n FROM ${tzTable} GROUP BY timezone_key`,
    );
    for (const row of countRows || []) {
      const key = String(row.timezone_key || "").trim();
      if (!key) continue;
      counts.set(key, Math.max(0, Math.floor(Number(row.n) || 0)));
    }

    const [hourRows] = await conn.query<RowDataPacket[]>(
      `SELECT t.timezone_key, h.local_hour, SUM(h.play_seconds) AS secs
       FROM ${hourlyTable} h
       INNER JOIN ${tzTable} t ON t.minecraft_uuid = h.minecraft_uuid
       GROUP BY t.timezone_key, h.local_hour`,
    );
    for (const row of hourRows || []) {
      const key = String(row.timezone_key || "").trim();
      const hour = Math.floor(Number(row.local_hour));
      const secs = Math.max(0, Math.floor(Number(row.secs) || 0));
      if (!key || hour < 0 || hour > 23) continue;
      const arr = buckets.get(key) || emptyHourBuckets();
      arr[hour] = Math.min(Number.MAX_SAFE_INTEGER, secs);
      buckets.set(key, arr);
    }
  } finally {
    await conn.end();
  }

  const known = new Set(TIMEZONE_DEFS.map((d) => d.key));
  const extraKeys = [...new Set([...counts.keys(), ...buckets.keys()])].filter((k) => !known.has(k));
  const defs = [
    ...TIMEZONE_DEFS,
    ...extraKeys.map((key) => ({
      key,
      label: key,
      offsetMinutes: 0,
      roleName: key,
    })),
  ];

  let totalPlayers = 0;
  const timezones: ActivityTimezonePublicRow[] = defs.map((d) => {
    const players = counts.get(d.key) || 0;
    totalPlayers += players;
    const hourBuckets = buckets.get(d.key) || emptyHourBuckets();
    const playSeconds = hourBuckets.reduce((a, b) => a + (b || 0), 0);
    const peakLocal = formatPeakHours(hourBuckets, PEAK_HOUR_COUNT);
    const peakHst = formatPeakHours(
      shiftBucketsToOffset(hourBuckets, d.offsetMinutes, HST_OFFSET_MINUTES),
      PEAK_HOUR_COUNT,
    );
    return {
      key: d.key,
      label: d.label,
      offsetMinutes: d.offsetMinutes,
      players,
      peakLocal,
      peakHst,
      playSeconds,
      hourBuckets,
    };
  });

  return { ok: true, mysql: true, timezones, totalPlayers };
}
