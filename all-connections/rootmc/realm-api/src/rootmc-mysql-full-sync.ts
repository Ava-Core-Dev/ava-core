/**
 * Full Hyperdrive → LIVE_DB sync.
 * Discovers root_/towny_/mcmmo_/root_skills_ tables on each host MySQL and mirrors into rootmc-live.
 * Does not read or write the legacy D1 `rootmc`.
 */
import type { Connection, RowDataPacket } from "mysql2/promise";
import {
  openRootMcMysqlBinding,
  type RootMcHyperdriveEnv,
  type RootMcMysqlBindingName,
} from "./rootmc-hyperdrive";

const DEFAULT_PREFIXES = ["root_", "towny_", "mcmmo_", "root_skills_"];
const ROW_BATCH = 100;
const MAX_ROWS_PER_TABLE = 10_000;
const SAMPLE_MIN_INTERVAL_MS = 60_000;
const SAMPLE_RETENTION_MS = 400 * 24 * 60 * 60 * 1000;
const D1_STMT_BATCH = 25;
/** Soft wall-clock budget per host so cron/waitUntil stays under Worker limits. */
const SERVER_BUDGET_MS = 45_000;
const PRIORITY_TABLE_SUBSTR = ["times_status", "economy_balances", "playtime", "host_metrics", "shop_listing"];

type ConnectionRow = {
  server_id: string;
  display_name: string;
  role: string;
  game_address: string;
  webstat_url: string;
  mysql_binding: string;
  mysql_database: string;
  table_prefixes: string;
};

type LiveEnv = RootMcHyperdriveEnv & {
  LIVE_DB?: D1Database;
  DB?: D1Database;
};

function nowIso(): string {
  return new Date().toISOString();
}

function sanitizeIdent(name: string): string {
  const s = String(name || "")
    .trim()
    .replace(/[^a-zA-Z0-9_]/g, "_")
    .slice(0, 60);
  return s || "unknown";
}

function mirrorTableName(mysqlTable: string): string {
  return `m_${sanitizeIdent(mysqlTable).toLowerCase()}`;
}

function parsePrefixes(raw: string | null | undefined): string[] {
  const parts = String(raw || "")
    .split(/[,;\s]+/)
    .map((p) => p.trim())
    .filter(Boolean);
  const out = parts.length ? parts : DEFAULT_PREFIXES;
  for (const p of out) {
    if (!/^[a-zA-Z0-9_]+$/.test(p)) {
      throw new Error(`Invalid table prefix: ${p}`);
    }
  }
  return out;
}

function cellToText(value: unknown): string {
  if (value == null) return "";
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "object") {
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }
  if (typeof value === "boolean") return value ? "1" : "0";
  return String(value);
}

function rowKey(pkCols: string[], row: Record<string, unknown>, colNames: string[]): string {
  if (pkCols.length) {
    return pkCols.map((c) => cellToText(row[c])).join("\u001f");
  }
  return colNames.map((c) => cellToText(row[c])).join("\u001f").slice(0, 500);
}

async function listMysqlTables(conn: Connection, prefixes: string[]): Promise<string[]> {
  const found = new Set<string>();
  for (const prefix of prefixes) {
    const like = `${prefix}%`;
    const [rows] = await conn.query<RowDataPacket[]>("SHOW TABLES LIKE ?", [like]);
    for (const row of rows) {
      const name = String(Object.values(row)[0] ?? "").trim();
      if (name) found.add(name);
    }
  }
  return [...found].sort((a, b) => a.localeCompare(b));
}

async function describeTable(
  conn: Connection,
  table: string,
): Promise<{ columns: string[]; pk: string[] }> {
  const safe = sanitizeIdent(table);
  const [rows] = await conn.query<RowDataPacket[]>(`DESCRIBE \`${safe}\``);
  const columns: string[] = [];
  const pk: string[] = [];
  for (const r of rows) {
    const field = String(r.Field ?? "").trim();
    if (!field) continue;
    columns.push(field);
    if (String(r.Key || "").toUpperCase() === "PRI") pk.push(field);
  }
  return { columns, pk };
}

async function ensureMirrorSchema(
  db: D1Database,
  mysqlTable: string,
  columns: string[],
): Promise<string> {
  const mirror = mirrorTableName(mysqlTable);
  const colDefs = columns
    .map((c) => `\`${sanitizeIdent(c)}\` TEXT NOT NULL DEFAULT ''`)
    .join(",\n         ");
  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS \`${mirror}\` (
         _server_id TEXT NOT NULL,
         _row_key TEXT NOT NULL,
         ${colDefs},
         PRIMARY KEY (_server_id, _row_key)
       )`,
    )
    .run();
  return mirror;
}

async function syncOneTable(
  conn: Connection,
  db: D1Database,
  serverId: string,
  table: string,
): Promise<{ rows: number; error: string }> {
  try {
    const { columns, pk } = await describeTable(conn, table);
    if (!columns.length) {
      return { rows: 0, error: "no columns" };
    }
    const mirror = await ensureMirrorSchema(db, table, columns);
    const safeTable = sanitizeIdent(table);
    const [rawRows] = await conn.query<RowDataPacket[]>(
      `SELECT * FROM \`${safeTable}\` LIMIT ${MAX_ROWS_PER_TABLE}`,
    );

    await db.prepare(`DELETE FROM \`${mirror}\` WHERE _server_id = ?`).bind(serverId).run();

    const colSql = columns.map((c) => `\`${sanitizeIdent(c)}\``).join(", ");
    const placeholders = ["?", "?", ...columns.map(() => "?")].join(", ");
    const insertSql = `INSERT INTO \`${mirror}\` (_server_id, _row_key, ${colSql}) VALUES (${placeholders})`;

    let written = 0;
    for (let i = 0; i < rawRows.length; i += ROW_BATCH) {
      const chunk = rawRows.slice(i, i + ROW_BATCH);
      const stmts: D1PreparedStatement[] = [];
      for (const raw of chunk) {
        const row = raw as Record<string, unknown>;
        const key = rowKey(pk, row, columns);
        const values = columns.map((c) => cellToText(row[c]));
        stmts.push(db.prepare(insertSql).bind(serverId, key, ...values));
        if (stmts.length >= D1_STMT_BATCH) {
          await db.batch(stmts.splice(0, stmts.length));
        }
      }
      if (stmts.length) await db.batch(stmts);
      written += chunk.length;
    }

    await db
      .prepare(
        `INSERT INTO sync_table_state (server_id, table_name, last_ok_at, row_count, error)
         VALUES (?, ?, ?, ?, '')
         ON CONFLICT(server_id, table_name) DO UPDATE SET
           last_ok_at = excluded.last_ok_at,
           row_count = excluded.row_count,
           error = ''`,
      )
      .bind(serverId, table, nowIso(), written)
      .run();

    if (table.toLowerCase() === "root_times_status" || table.toLowerCase().endsWith("times_status")) {
      await projectTimesStatus(db, serverId, rawRows);
    }

    return { rows: written, error: "" };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    try {
      await db
        .prepare(
          `INSERT INTO sync_table_state (server_id, table_name, last_ok_at, row_count, error)
           VALUES (?, ?, ?, 0, ?)
           ON CONFLICT(server_id, table_name) DO UPDATE SET
             error = excluded.error`,
        )
        .bind(serverId, table, nowIso(), msg.slice(0, 500))
        .run();
    } catch {
      // ignore meta write failure
    }
    return { rows: 0, error: msg.slice(0, 300) };
  }
}

function pickField(row: Record<string, unknown>, ...names: string[]): unknown {
  const lower = new Map(Object.keys(row).map((k) => [k.toLowerCase(), k]));
  for (const n of names) {
    const key = lower.get(n.toLowerCase());
    if (key != null) return row[key];
  }
  return undefined;
}

async function projectTimesStatus(
  db: D1Database,
  serverId: string,
  rawRows: RowDataPacket[],
): Promise<void> {
  if (!rawRows.length) return;
  const row = rawRows[0] as Record<string, unknown>;
  const dayId = Number(pickField(row, "day_id", "dayId") ?? 0) || 0;
  const todTicks = Number(pickField(row, "tod_ticks", "todTicks") ?? 0) || 0;
  const fullTime = Number(pickField(row, "full_time", "fullTime") ?? 0) || 0;
  const phase = String(pickField(row, "phase") ?? "—").slice(0, 32) || "—";
  const lengthMinutes = Number(pickField(row, "length_minutes", "lengthMinutes") ?? 30) || 30;
  const online = Number(pickField(row, "online") ?? 0) || 0;
  const afk = Number(pickField(row, "afk") ?? 0) || 0;
  const playersJson = String(pickField(row, "players_json", "playersJson") ?? "[]") || "[]";
  const pluginsJson = String(pickField(row, "plugins_json", "pluginsJson") ?? "[]") || "[]";
  const timezone = String(pickField(row, "timezone") ?? "UTC").slice(0, 64) || "UTC";
  const updatedRaw = pickField(row, "updated_at", "updatedAt");
  let updatedAt = nowIso();
  if (updatedRaw instanceof Date) updatedAt = updatedRaw.toISOString();
  else if (updatedRaw != null && String(updatedRaw).trim()) {
    const parsed = Date.parse(String(updatedRaw));
    updatedAt = Number.isFinite(parsed) ? new Date(parsed).toISOString() : String(updatedRaw);
  }

  await db
    .prepare(
      `INSERT INTO rootmc_server_times_status (
        server_id, day_id, tod_ticks, full_time, phase, length_minutes,
        online, afk, players_json, plugins_json, timezone, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(server_id) DO UPDATE SET
        day_id = excluded.day_id,
        tod_ticks = excluded.tod_ticks,
        full_time = excluded.full_time,
        phase = excluded.phase,
        length_minutes = excluded.length_minutes,
        online = excluded.online,
        afk = excluded.afk,
        players_json = excluded.players_json,
        plugins_json = excluded.plugins_json,
        timezone = excluded.timezone,
        updated_at = excluded.updated_at`,
    )
    .bind(
      serverId,
      dayId,
      todTicks,
      fullTime,
      phase,
      lengthMinutes,
      online,
      afk,
      playersJson,
      pluginsJson,
      timezone,
      updatedAt,
    )
    .run();

  const lastSample = await db
    .prepare(`SELECT ts FROM rootmc_server_times_samples WHERE server_id = ? ORDER BY ts DESC LIMIT 1`)
    .bind(serverId)
    .first<{ ts: string }>();
  const lastMs = lastSample?.ts ? Date.parse(lastSample.ts) : NaN;
  const shouldSample = !Number.isFinite(lastMs) || Date.now() - lastMs >= SAMPLE_MIN_INTERVAL_MS;
  if (shouldSample) {
    await db
      .prepare(
        `INSERT INTO rootmc_server_times_samples (server_id, ts, online, afk, tod_ticks, phase)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .bind(serverId, updatedAt, online, afk, todTicks, phase)
      .run();
  }
  const cutoff = new Date(Date.now() - SAMPLE_RETENTION_MS).toISOString();
  await db
    .prepare(`DELETE FROM rootmc_server_times_samples WHERE server_id = ? AND ts < ?`)
    .bind(serverId, cutoff)
    .run();
}

async function syncServer(env: LiveEnv, connRow: ConnectionRow): Promise<{
  server_id: string;
  ok: boolean;
  tables: number;
  rows: number;
  detail: string;
}> {
  const db = env.LIVE_DB;
  if (!db) {
    return { server_id: connRow.server_id, ok: false, tables: 0, rows: 0, detail: "LIVE_DB missing" };
  }

  const binding = (connRow.mysql_binding || "ROOTMC_MYSQL").trim() as RootMcMysqlBindingName;
  const conn = await openRootMcMysqlBinding(env, binding);
  if (!conn) {
    return {
      server_id: connRow.server_id,
      ok: false,
      tables: 0,
      rows: 0,
      detail: `Hyperdrive ${binding} unavailable`,
    };
  }

  let totalRows = 0;
  let tableCount = 0;
  const errors: string[] = [];
  try {
    const prefixes = parsePrefixes(connRow.table_prefixes);
    const tables = await listMysqlTables(conn, prefixes);
    tables.sort((a, b) => {
      const score = (t: string) => {
        const lower = t.toLowerCase();
        const idx = PRIORITY_TABLE_SUBSTR.findIndex((p) => lower.includes(p));
        return idx >= 0 ? idx : 100;
      };
      return score(a) - score(b) || a.localeCompare(b);
    });

    const started = Date.now();
    let skippedBudget = 0;
    for (const table of tables) {
      if (Date.now() - started > SERVER_BUDGET_MS) {
        skippedBudget = tables.length - tableCount;
        break;
      }
      const result = await syncOneTable(conn, db, connRow.server_id, table);
      tableCount += 1;
      totalRows += result.rows;
      if (result.error) errors.push(`${table}: ${result.error}`);
      // Progress heartbeat so partial runs are visible if the isolate is cut off.
      if (tableCount === 1 || tableCount % 5 === 0) {
        await db
          .prepare(
            `INSERT INTO servers (server_id, display_name, role, last_sync_at, last_sync_ok, table_count, row_count, updated_at)
             VALUES (?, ?, ?, ?, 0, ?, ?, ?)
             ON CONFLICT(server_id) DO UPDATE SET
               last_sync_at = excluded.last_sync_at,
               table_count = excluded.table_count,
               row_count = excluded.row_count,
               updated_at = excluded.updated_at`,
          )
          .bind(
            connRow.server_id,
            connRow.display_name || connRow.role || connRow.server_id,
            connRow.role || "",
            nowIso(),
            tableCount,
            totalRows,
            nowIso(),
          )
          .run();
      }
    }

    const ok = errors.length === 0 && skippedBudget === 0;
    const at = nowIso();
    await db
      .prepare(
        `INSERT INTO servers (server_id, display_name, role, last_sync_at, last_sync_ok, table_count, row_count, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(server_id) DO UPDATE SET
           display_name = excluded.display_name,
           role = excluded.role,
           last_sync_at = excluded.last_sync_at,
           last_sync_ok = excluded.last_sync_ok,
           table_count = excluded.table_count,
           row_count = excluded.row_count,
           updated_at = excluded.updated_at`,
      )
      .bind(
        connRow.server_id,
        connRow.display_name || connRow.role || connRow.server_id,
        connRow.role || "",
        at,
        ok ? 1 : 0,
        tableCount,
        totalRows,
        at,
      )
      .run();

    const detailParts: string[] = [];
    if (errors.length) detailParts.push(errors.slice(0, 5).join("; "));
    if (skippedBudget > 0) detailParts.push(`budget_skip=${skippedBudget}`);
    return {
      server_id: connRow.server_id,
      ok: errors.length === 0,
      tables: tableCount,
      rows: totalRows,
      detail: detailParts.length ? detailParts.join(" | ") : "ok",
    };
  } finally {
    try {
      await conn.end();
    } catch {
      // ignore
    }
  }
}

async function loadConnections(db: D1Database): Promise<ConnectionRow[]> {
  const res = await db
    .prepare(
      `SELECT server_id, display_name, role, game_address, webstat_url,
              mysql_binding, mysql_database, table_prefixes
       FROM server_connections
       ORDER BY role ASC, server_id ASC`,
    )
    .all<ConnectionRow>();
  return res.results || [];
}

/** Cron: full MySQL → LIVE_DB sync for all registered connections. */
export async function runMysqlFullSyncCron(env: LiveEnv): Promise<{
  ok: boolean;
  servers: number;
  tables: number;
  rows: number;
  details: Array<{ server_id: string; ok: boolean; tables: number; rows: number; detail: string }>;
}> {
  const db = env.LIVE_DB;
  if (!db) {
    return { ok: false, servers: 0, tables: 0, rows: 0, details: [] };
  }

  let connections: ConnectionRow[] = [];
  try {
    connections = await loadConnections(db);
  } catch (e) {
    console.warn("rootmc_live_sync_load_connections", e instanceof Error ? e.message : String(e));
    return { ok: false, servers: 0, tables: 0, rows: 0, details: [] };
  }

  const details: Array<{
    server_id: string;
    ok: boolean;
    tables: number;
    rows: number;
    detail: string;
  }> = [];
  let tables = 0;
  let rows = 0;

  // One host per invocation so each gets the full Worker budget (Claims + Towny alternate).
  const ordered = [...connections].sort((a, b) => {
    // Prefer never-synced / oldest last_sync_at from servers table when present.
    return a.server_id.localeCompare(b.server_id);
  });
  let pick = ordered[0]!;
  try {
    const stale = await db
      .prepare(
        `SELECT c.server_id
         FROM server_connections c
         LEFT JOIN servers s ON s.server_id = c.server_id
         ORDER BY CASE WHEN IFNULL(s.last_sync_at,'') = '' THEN 0 ELSE 1 END ASC,
                  IFNULL(s.last_sync_at, '') ASC,
                  c.role ASC
         LIMIT 1`,
      )
      .first<{ server_id: string }>();
    if (stale?.server_id) {
      const found = connections.find((c) => c.server_id === stale.server_id);
      if (found) pick = found;
    }
  } catch {
    // keep first
  }

  const r = await syncServer(env, pick);
  details.push(r);
  tables += r.tables;
  rows += r.rows;

  const ok = details.length > 0 && details.every((d) => d.ok);
  console.log(
    JSON.stringify({
      msg: "rootmc_mysql_full_sync",
      ok,
      servers: details.length,
      tables,
      rows,
      details,
    }),
  );
  return { ok, servers: details.length, tables, rows, details };
}
