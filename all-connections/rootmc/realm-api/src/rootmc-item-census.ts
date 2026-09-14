/**
 * Root-ItemInfo world census sync + public read for /resources/.
 */

import type { D1Database, D1PreparedStatement } from "@cloudflare/workers-types";
import type { Connection, RowDataPacket } from "mysql2/promise";

import { json } from "./cors";
import { isG2Worker, resolveG2FeaturedRealmId } from "./g2/g2-db";
import type { RootStatEnv } from "./rootstat-minecraft";
import { validateServerAuth } from "./rootstat-minecraft";
import {
  openRootMcMysql,
  rootMcMysqlTablePrefix,
  type RootMcHyperdriveEnv,
  withShortPublicCache,
} from "./rootmc-hyperdrive";

const CANONICAL_ROOTMC_SERVER = "rootmc";

function str(v: unknown): string {
  return String(v ?? "").trim();
}

function nowIso(): string {
  return new Date().toISOString();
}

function hstDate(timestampMs: number): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Pacific/Honolulu",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(timestampMs));
  const value = (type: string) => parts.find((part) => part.type === type)?.value || "";
  return `${value("year")}-${value("month")}-${value("day")}`;
}

function record(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

type CensusRow = { id: string; count: number; avg: number | null; peg: number | null };

/** D1 allows up to 1000 stmts/batch; keep headroom for summary + stale delete. */
const D1_BATCH_LIMIT = 900;

/** Collapse duplicate item ids (sum counts) before write. */
function normalizeCensusItems(items: unknown[]): CensusRow[] {
  const byId = new Map<string, CensusRow>();
  for (const raw of items) {
    const row = record(raw);
    const id = str(row.id).toLowerCase();
    const count = Math.max(0, Math.floor(Number(row.count) || 0));
    if (!id || count <= 0) continue;
    const avg = row.avg_g == null || Number.isNaN(Number(row.avg_g)) ? null : Number(row.avg_g);
    const peg = row.mint_peg_g == null || Number.isNaN(Number(row.mint_peg_g)) ? null : Number(row.mint_peg_g);
    const prev = byId.get(id);
    if (prev) {
      prev.count += count;
      if (avg != null) prev.avg = avg;
      if (peg != null) prev.peg = peg;
    } else {
      byId.set(id, { id, count, avg, peg });
    }
  }
  return [...byId.values()];
}

export async function upsertItemCensus(
  db: D1Database,
  serverId: string,
  body: Record<string, unknown>,
): Promise<{ rows: number; distinct: number }> {
  const scannedAt = Math.max(0, Math.floor(Number(body.scanned_at) || 0));
  const scanNote = str(body.scan_note) || null;
  const goldPeg = Math.max(0, Number(body.gold_mint_peg_g) || 0);
  const items = normalizeCensusItems(Array.isArray(body.items) ? body.items : []);
  const updatedAt = nowIso();
  const effectiveScannedAt = scannedAt > 0 ? scannedAt : Date.now();
  const snapshotDate = hstDate(effectiveScannedAt);
  const rows = items.length;

  // Upsert first, then drop stale rows. Avoid DELETE-then-INSERT: concurrent syncs
  // race on the PK and D1 returns UNIQUE constraint errors even with ON CONFLICT.
  const statements: D1PreparedStatement[] = [];

  for (const item of items) {
    statements.push(
      db
        .prepare(
          `INSERT INTO rootmc_item_census_rows
             (server_id, item_id, item_count, avg_g, mint_peg_g, updated_at)
           VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT(server_id, item_id) DO UPDATE SET
             item_count = excluded.item_count,
             avg_g = excluded.avg_g,
             mint_peg_g = excluded.mint_peg_g,
             updated_at = excluded.updated_at`,
        )
        .bind(serverId, item.id, item.count, item.avg, item.peg, updatedAt),
    );
    statements.push(
      db
        .prepare(
          `INSERT INTO rootmc_item_census_daily_rows
             (server_id, snapshot_date, item_id, item_count, avg_g, mint_peg_g, scanned_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(server_id, snapshot_date, item_id) DO UPDATE SET
             item_count = excluded.item_count,
             avg_g = excluded.avg_g,
             mint_peg_g = excluded.mint_peg_g,
             scanned_at = excluded.scanned_at`,
        )
        .bind(serverId, snapshotDate, item.id, item.count, item.avg, item.peg, effectiveScannedAt),
    );
  }

  statements.push(
    db
      .prepare(
        `INSERT INTO rootmc_item_census_summary
           (server_id, scanned_at, scan_note, distinct_items, gold_mint_peg_g, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(server_id) DO UPDATE SET
           scanned_at = excluded.scanned_at,
           scan_note = excluded.scan_note,
           distinct_items = excluded.distinct_items,
           gold_mint_peg_g = excluded.gold_mint_peg_g,
           updated_at = excluded.updated_at`,
      )
      .bind(serverId, scannedAt, scanNote, rows, goldPeg, updatedAt),
  );

  statements.push(
    db
      .prepare(
        `INSERT INTO rootmc_item_census_daily_summary
           (server_id, snapshot_date, scanned_at, scan_note, distinct_items, gold_mint_peg_g, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(server_id, snapshot_date) DO UPDATE SET
           scanned_at = excluded.scanned_at,
           scan_note = excluded.scan_note,
           distinct_items = excluded.distinct_items,
           gold_mint_peg_g = excluded.gold_mint_peg_g,
           updated_at = excluded.updated_at`,
      )
      .bind(serverId, snapshotDate, effectiveScannedAt, scanNote, rows, goldPeg, updatedAt),
  );

  statements.push(
    db
      .prepare(
        `DELETE FROM rootmc_item_census_rows
         WHERE server_id = ? AND updated_at != ?`,
      )
      .bind(serverId, updatedAt),
  );

  statements.push(
    db
      .prepare(
        `DELETE FROM rootmc_item_census_daily_rows
         WHERE server_id = ? AND snapshot_date = ? AND scanned_at != ?`,
      )
      .bind(serverId, snapshotDate, effectiveScannedAt),
  );

  for (let i = 0; i < statements.length; i += D1_BATCH_LIMIT) {
    await db.batch(statements.slice(i, i + D1_BATCH_LIMIT));
  }

  return { rows, distinct: rows };
}

export async function handleItemCensusSync(request: Request, env: RootStatEnv): Promise<Response> {
  const server = await validateServerAuth(env, request);
  if (server instanceof Response) return server;

  try {
    let body: Record<string, unknown> = {};
    try {
      body = record(JSON.parse(await request.text()));
    } catch {
      return json({ detail: "Invalid JSON body." }, 400);
    }
    const result = await upsertItemCensus(env.DB, server.serverId, body);
    // Gen 1 mirrors heartbeat server_id → canonical rootmc for the public site.
    if (!isG2Worker(env) && server.serverId !== CANONICAL_ROOTMC_SERVER) {
      await upsertItemCensus(env.DB, CANONICAL_ROOTMC_SERVER, body);
    }
    return json({
      ok: true,
      server_id: server.serverId,
      rows: result.rows,
      distinct_items: result.distinct,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("item_census_sync_failed", msg.slice(0, 500));
    return json({ detail: `Item census sync failed: ${msg.slice(0, 240)}` }, 500);
  }
}

async function resolveMysqlServerId(
  connection: Connection,
  prefix: string,
  requested: string,
): Promise<string> {
  const [exact] = await connection.query<Array<RowDataPacket & { server_id: string }>>(
    `SELECT server_id FROM ${prefix}item_census_summary WHERE server_id = ? LIMIT 1`,
    [requested],
  );
  if (exact[0]?.server_id) return exact[0].server_id;
  const [latest] = await connection.query<Array<RowDataPacket & { server_id: string }>>(
    `SELECT server_id FROM ${prefix}item_census_summary ORDER BY updated_at DESC LIMIT 1`,
  );
  return latest[0]?.server_id || requested;
}

async function handleMysqlItemCensusPublic(
  connection: Connection,
  prefix: string,
  requestedServerId: string,
  options: {
    limit: number;
    q: string;
    snapshotDate: string;
    historyItem: string;
    historyDays: number;
  },
): Promise<Response> {
  const sid = await resolveMysqlServerId(connection, prefix, requestedServerId);
  if (options.historyItem) {
    const [rows] = await connection.query<
      Array<RowDataPacket & {
        snapshot_date: string;
        scanned_at: number;
        item_count: number;
        avg_g: number | null;
        mint_peg_g: number | null;
      }>
    >(
      `SELECT DATE_FORMAT(s.snapshot_date, '%Y-%m-%d') AS snapshot_date,
              s.scanned_at, COALESCE(r.item_count, 0) AS item_count,
              r.avg_g, r.mint_peg_g
       FROM ${prefix}item_census_daily_summary s
       LEFT JOIN ${prefix}item_census_daily_rows r
         ON r.server_id = s.server_id
        AND r.snapshot_date = s.snapshot_date
        AND r.item_id = ?
       WHERE s.server_id = ?
         AND s.snapshot_date >= DATE_SUB(CURDATE(), INTERVAL ? DAY)
       ORDER BY s.snapshot_date ASC`,
      [options.historyItem, sid, options.historyDays],
    );
    return json({ server_id: sid, item_id: options.historyItem, history: rows });
  }

  const summaryTable = options.snapshotDate
    ? `${prefix}item_census_daily_summary`
    : `${prefix}item_census_summary`;
  const summaryWhere = options.snapshotDate
    ? "server_id = ? AND snapshot_date = ?"
    : "server_id = ?";
  const summaryArgs = options.snapshotDate ? [sid, options.snapshotDate] : [sid];
  const [summaryRows] = await connection.query<Array<RowDataPacket & Record<string, unknown>>>(
    `SELECT * FROM ${summaryTable} WHERE ${summaryWhere} LIMIT 1`,
    summaryArgs,
  );

  const rowsTable = options.snapshotDate
    ? `${prefix}item_census_daily_rows`
    : `${prefix}item_census_rows`;
  let rowsSql = `SELECT item_id, item_count, avg_g, mint_peg_g
                 FROM ${rowsTable} WHERE server_id = ?`;
  const rowArgs: unknown[] = [sid];
  if (options.snapshotDate) {
    rowsSql += " AND snapshot_date = ?";
    rowArgs.push(options.snapshotDate);
  }
  if (options.q) {
    rowsSql += " AND item_id LIKE ?";
    rowArgs.push(`%${options.q}%`);
  }
  rowsSql += " ORDER BY item_count DESC LIMIT ?";
  rowArgs.push(options.limit);
  const [items] = await connection.query<
    Array<RowDataPacket & { item_id: string; item_count: number; avg_g: number | null; mint_peg_g: number | null }>
  >(rowsSql, rowArgs);
  const [dateRows] = await connection.query<Array<RowDataPacket & { snapshot_date: string }>>(
    `SELECT DATE_FORMAT(snapshot_date, '%Y-%m-%d') AS snapshot_date
     FROM ${prefix}item_census_daily_summary
     WHERE server_id = ?
     ORDER BY snapshot_date DESC
     LIMIT 730`,
    [sid],
  );
  return json({
    server_id: sid,
    snapshot_date: options.snapshotDate || null,
    snapshot_dates: dateRows.map((row) => row.snapshot_date),
    summary: summaryRows[0] || null,
    items: items.map((row) => ({
      id: row.item_id,
      count: Number(row.item_count),
      avg_g: row.avg_g == null ? null : Number(row.avg_g),
      mint_peg_g: row.mint_peg_g == null ? null : Number(row.mint_peg_g),
    })),
  });
}

export async function handleItemCensusPublic(
  request: Request,
  env: { DB: D1Database; WORKER_SHARD?: string } & RootMcHyperdriveEnv,
  serverId = CANONICAL_ROOTMC_SERVER,
): Promise<Response> {
  const url = new URL(request.url);
  const limit = Math.min(500, Math.max(1, Math.floor(Number(url.searchParams.get("limit")) || 100)));
  const q = str(url.searchParams.get("q")).toLowerCase();
  const snapshotDate = str(url.searchParams.get("snapshot_date"));
  const historyItem = str(url.searchParams.get("history_item")).toLowerCase();
  const historyDays = Math.min(730, Math.max(7, Math.floor(Number(url.searchParams.get("history_days")) || 365)));
  let sid = str(url.searchParams.get("server_id")) || serverId;
  if (isG2Worker(env) && (!sid || sid === CANONICAL_ROOTMC_SERVER)) {
    sid = (await resolveG2FeaturedRealmId(env.DB)) || sid;
  }

  try {
    if (snapshotDate && !/^\d{4}-\d{2}-\d{2}$/.test(snapshotDate)) {
      return json({ detail: "snapshot_date must be YYYY-MM-DD." }, 400);
    }

    const mysql = await openRootMcMysql(env);
    if (mysql) {
      try {
        return withShortPublicCache(
          await handleMysqlItemCensusPublic(
            mysql,
            rootMcMysqlTablePrefix(env),
            sid,
            { limit, q, snapshotDate, historyItem, historyDays },
          ),
        );
      } catch (error) {
        console.warn("item_census_hyperdrive_fallback", String(error).slice(0, 300));
      } finally {
        await mysql.end();
      }
    }

    if (historyItem) {
      const cutoff = hstDate(Date.now() - historyDays * 86400000);
      const { results } = await env.DB.prepare(
        `SELECT s.snapshot_date, s.scanned_at,
                COALESCE(r.item_count, 0) AS item_count,
                r.avg_g, r.mint_peg_g
         FROM rootmc_item_census_daily_summary s
         LEFT JOIN rootmc_item_census_daily_rows r
           ON r.server_id = s.server_id
          AND r.snapshot_date = s.snapshot_date
          AND r.item_id = ?
         WHERE s.server_id = ? AND s.snapshot_date >= ?
         ORDER BY s.snapshot_date ASC`,
      )
        .bind(historyItem, sid, cutoff)
        .all<{
          snapshot_date: string;
          scanned_at: number;
          item_count: number;
          avg_g: number | null;
          mint_peg_g: number | null;
        }>();
      return json({
        server_id: sid,
        item_id: historyItem,
        history: results || [],
      });
    }

    const summary = snapshotDate
      ? await env.DB.prepare(
          `SELECT server_id, snapshot_date, scanned_at, scan_note,
                  distinct_items, gold_mint_peg_g, updated_at
           FROM rootmc_item_census_daily_summary
           WHERE server_id = ? AND snapshot_date = ? LIMIT 1`,
        )
          .bind(sid, snapshotDate)
          .first<{
            server_id: string;
            snapshot_date: string;
            scanned_at: number;
            scan_note: string | null;
            distinct_items: number;
            gold_mint_peg_g: number;
            updated_at: string;
          }>()
      : await env.DB.prepare(
          `SELECT server_id, scanned_at, scan_note, distinct_items, gold_mint_peg_g, updated_at
           FROM rootmc_item_census_summary WHERE server_id = ? LIMIT 1`,
        )
          .bind(sid)
          .first<{
        server_id: string;
        scanned_at: number;
        scan_note: string | null;
        distinct_items: number;
        gold_mint_peg_g: number;
        updated_at: string;
          }>();

    let sql = snapshotDate
      ? `SELECT item_id, item_count, avg_g, mint_peg_g
         FROM rootmc_item_census_daily_rows
         WHERE server_id = ? AND snapshot_date = ?`
      : `SELECT item_id, item_count, avg_g, mint_peg_g
         FROM rootmc_item_census_rows
         WHERE server_id = ?`;
    const binds: unknown[] = snapshotDate ? [sid, snapshotDate] : [sid];
    if (q) {
      sql += ` AND item_id LIKE ?`;
      binds.push(`%${q}%`);
    }
    sql += ` ORDER BY item_count DESC LIMIT ?`;
    binds.push(limit);

    const { results } = await env.DB.prepare(sql).bind(...binds).all<{
      item_id: string;
      item_count: number;
      avg_g: number | null;
      mint_peg_g: number | null;
    }>();

    const { results: dateRows } = await env.DB.prepare(
      `SELECT snapshot_date
       FROM rootmc_item_census_daily_summary
       WHERE server_id = ?
       ORDER BY snapshot_date DESC
       LIMIT 730`,
    )
      .bind(sid)
      .all<{ snapshot_date: string }>();

    return json({
      server_id: sid,
      snapshot_date: snapshotDate || null,
      snapshot_dates: (dateRows || []).map((row) => row.snapshot_date),
      summary: summary || null,
      items: (results || []).map((r) => ({
        id: r.item_id,
        count: r.item_count,
        avg_g: r.avg_g,
        mint_peg_g: r.mint_peg_g,
      })),
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn("item_census_public_failed", msg.slice(0, 300));
    return json({
      server_id: sid,
      summary: null,
      items: [],
      detail: "Item census unavailable (tables missing or not synced yet).",
    });
  }
}
