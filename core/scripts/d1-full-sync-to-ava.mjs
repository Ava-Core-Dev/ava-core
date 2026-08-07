#!/usr/bin/env node
/**
 * Full D1 → local SQLite (paginated, no truncation) → MariaDB import.
 * Usage: AVA_HANDOFF=/home/ava-core/ava node scripts/d1-full-sync-to-ava.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const require = createRequire(import.meta.url);
const Database = require("better-sqlite3");
const mysql = require("mysql2/promise");

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const AVA_HANDOFF = process.env.AVA_HANDOFF || path.resolve(__dirname, "../..");
const OUT = path.join(AVA_HANDOFF, "local-api", "data");
const PAGE = Math.max(200, Number(process.env.D1_PAGE_SIZE || 1000));

function loadEnv() {
  const out = { ...process.env };
  const p = path.join(AVA_HANDOFF, ".env");
  if (!fs.existsSync(p)) return out;
  for (const line of fs.readFileSync(p, "utf8").split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#") || !t.includes("=")) continue;
    const i = t.indexOf("=");
    const k = t.slice(0, i).trim();
    let v = t.slice(i + 1).trim();
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    )
      v = v.slice(1, -1);
    if (out[k] == null || out[k] === "") out[k] = v;
  }
  return out;
}

const env = loadEnv();

const DB_SPECS = [
  {
    name: "rootmc",
    id: "6cf71128-67e3-47b2-a802-d6c23d6489e0",
    account: env.ROOTMC_CLOUDFLARE_ACCOUNT_ID || env.CLOUDFLARE_ACCOUNT_ID,
    auth: "token",
    maria: "rootmc_api",
  },
  {
    name: "rootmc-webstat",
    id: "e999ab90-08d5-485f-a813-a22aa6aead52",
    account: env.ROOTMC_CLOUDFLARE_ACCOUNT_ID || env.CLOUDFLARE_ACCOUNT_ID,
    auth: "token",
    maria: "rootmc_api",
    tablePrefix: "webstat_",
  },
  {
    name: "rootmc-live",
    id: "0fae3fc8-f48d-4d6a-b31e-ddff12131d84",
    account: env.ROOTMC_CLOUDFLARE_ACCOUNT_ID || env.CLOUDFLARE_ACCOUNT_ID,
    auth: "token",
    maria: "rootmc_api",
    tablePrefix: "live_",
  },
  {
    name: "root-record",
    id: "0b49c598-1f91-4a09-84a8-6ba8241c6df3",
    account: null, // resolve outlook
    auth: "global",
    maria: "root_record",
  },
];

function headersFor(spec) {
  if (spec.auth === "token") {
    return {
      Authorization: `Bearer ${env.CLOUDFLARE_API_TOKEN}`,
      "content-type": "application/json",
    };
  }
  return {
    "X-Auth-Email": env.CLOUDFLARE_EMAIL,
    "X-Auth-Key": env.CLOUDFLARE_GLOBAL_API_KEY,
    "content-type": "application/json",
  };
}

async function listAccountsGlobal() {
  const res = await fetch("https://api.cloudflare.com/client/v4/accounts?per_page=50", {
    headers: headersFor({ auth: "global" }),
  });
  const json = await res.json();
  if (!json.success) throw new Error(JSON.stringify(json.errors));
  return json.result || [];
}

async function d1Query(spec, sql, params = []) {
  const url = `https://api.cloudflare.com/client/v4/accounts/${spec.account}/d1/database/${spec.id}/query`;
  const res = await fetch(url, {
    method: "POST",
    headers: headersFor(spec),
    body: JSON.stringify({ sql, params }),
  });
  const json = await res.json();
  if (!json.success) {
    const err = json.errors || json;
    throw new Error(typeof err === "string" ? err : JSON.stringify(err));
  }
  return json.result?.[0]?.results || json.result?.results || [];
}

async function exportDb(spec) {
  console.log(`\n=== EXPORT ${spec.name} → ${spec.name}.sqlite ===`);
  const tables = (
    await d1Query(
      spec,
      "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' ORDER BY name",
    )
  )
    .map((r) => r.name)
    .filter(Boolean);

  const sqlitePath = path.join(OUT, `${spec.name}.sqlite`);
  if (fs.existsSync(sqlitePath)) fs.unlinkSync(sqlitePath);
  const db = new Database(sqlitePath);
  db.pragma("journal_mode = WAL");
  db.pragma("synchronous = NORMAL");
  db.pragma("foreign_keys = OFF");

  const meta = { database: spec.name, id: spec.id, tables: [], at: new Date().toISOString() };

  for (const table of tables) {
    process.stdout.write(`  ${table}… `);
    try {
      const schemaRows = await d1Query(
        spec,
        "SELECT sql FROM sqlite_master WHERE type='table' AND name = ?",
        [table],
      );
      const createSql = schemaRows[0]?.sql;
      if (!createSql) {
        console.log("no schema");
        meta.tables.push({ table, error: "no_schema" });
        continue;
      }
      db.exec(`DROP TABLE IF EXISTS "${table}"`);
      db.exec(createSql);

      const countRows = await d1Query(spec, `SELECT COUNT(*) AS c FROM "${table}"`);
      const count = Number(countRows[0]?.c || 0);
      let offset = 0;
      let exported = 0;
      let cols = null;
      let stmt = null;
      const insertTx = db.transaction((rows) => {
        for (const row of rows) stmt.run(...cols.map((c) => row[c]));
      });

      while (offset < count) {
        let rows;
        try {
          rows = await d1Query(
            spec,
            `SELECT * FROM "${table}" LIMIT ${PAGE} OFFSET ${offset}`,
          );
        } catch (e) {
          // fallback without offset for weird tables — try keyset not available; reduce page
          if (PAGE > 100) {
            const small = Math.max(50, Math.floor(PAGE / 2));
            rows = await d1Query(
              spec,
              `SELECT * FROM "${table}" LIMIT ${small} OFFSET ${offset}`,
            );
          } else {
            throw e;
          }
        }
        if (!rows.length) break;
        if (!cols) {
          cols = Object.keys(rows[0]);
          const ph = cols.map(() => "?").join(",");
          stmt = db.prepare(
            `INSERT OR REPLACE INTO "${table}" (${cols.map((c) => `"${c}"`).join(",")}) VALUES (${ph})`,
          );
        }
        insertTx(rows);
        exported += rows.length;
        offset += rows.length;
        if (rows.length < PAGE) break;
      }
      console.log(`${exported}/${count}`);
      meta.tables.push({
        table,
        count,
        exported,
        truncated: exported < count,
      });
    } catch (e) {
      console.log("FAIL", e.message.slice(0, 120));
      meta.tables.push({ table, error: e.message.slice(0, 300) });
    }
  }

  db.close();
  fs.mkdirSync(path.join(OUT, "dumps", spec.name), { recursive: true });
  fs.writeFileSync(
    path.join(OUT, "dumps", spec.name, "_full_meta.json"),
    JSON.stringify(meta, null, 2),
  );
  return meta;
}

function sqliteTypeToMysql(decl) {
  const d = String(decl || "TEXT").toUpperCase();
  if (d.includes("INT")) return "BIGINT";
  if (d.includes("BOOL")) return "TINYINT(1)";
  if (d.includes("REAL") || d.includes("FLOA") || d.includes("DOUB")) return "DOUBLE";
  if (d.includes("BLOB")) return "LONGBLOB";
  if (d.includes("CHAR") || d.includes("CLOB") || d.includes("TEXT")) return "LONGTEXT";
  if (d.includes("NUMERI") || d.includes("DECI") || d.includes("MONEY")) return "DECIMAL(24,8)";
  return "LONGTEXT";
}

function convertCreateSql(sqliteCreate, mariaTable) {
  // Very pragmatic converter — strip sqlite-isms
  let s = sqliteCreate;
  s = s.replace(/^CREATE TABLE IF NOT EXISTS/i, "CREATE TABLE IF NOT EXISTS");
  s = s.replace(/^CREATE TABLE\s+("?)(\w+)\1/i, `CREATE TABLE IF NOT EXISTS \`${mariaTable}\``);
  s = s.replace(/"/g, "`");
  // remove sqlite table options
  s = s.replace(/\s*WITHOUT\s+ROWID\s*/gi, " ");
  // map types roughly by rewriting common patterns
  s = s.replace(/\bINTEGER\b/gi, "BIGINT");
  s = s.replace(/\bINT\b/gi, "BIGINT");
  s = s.replace(/\bREAL\b/gi, "DOUBLE");
  s = s.replace(/\bBLOB\b/gi, "LONGBLOB");
  s = s.replace(/\bNUMERIC\b/gi, "DECIMAL(24,8)");
  s = s.replace(/\bBOOLEAN\b/gi, "TINYINT(1)");
  s = s.replace(/\bTEXT\b/gi, "LONGTEXT");
  // AUTOINCREMENT
  s = s.replace(/\bAUTOINCREMENT\b/gi, "AUTO_INCREMENT");
  // DEFAULT CURRENT_TIMESTAMP stays
  if (!/ENGINE=/i.test(s)) {
    s = s.replace(/\s*;\s*$/, "") + " ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;";
  }
  return s;
}

async function importSqliteToMaria(spec, pool) {
  const sqlitePath = path.join(OUT, `${spec.name}.sqlite`);
  if (!fs.existsSync(sqlitePath)) {
    console.log("skip import — missing", sqlitePath);
    return { ok: false, detail: "missing_sqlite" };
  }
  const db = new Database(sqlitePath, { readonly: true });
  const tables = db
    .prepare(
      "SELECT name, sql FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
    )
    .all();

  console.log(`\n=== IMPORT ${spec.name} → MariaDB ${spec.maria} (${tables.length} tables) ===`);
  await pool.query(`CREATE DATABASE IF NOT EXISTS \`${spec.maria}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
  await pool.query(`USE \`${spec.maria}\``);
  await pool.query('SET FOREIGN_KEY_CHECKS=0');

  const report = [];
  for (const { name: table, sql } of tables) {
    const mariaTable = `${spec.tablePrefix || ""}${table}`;
    process.stdout.write(`  ${mariaTable}… `);
    try {
      await pool.query(`DROP TABLE IF EXISTS \`${mariaTable}\``);
      let create = convertCreateSql(sql, mariaTable);
      try {
        await pool.query(create);
      } catch (e) {
        // fallback: introspect columns from first row / pragma
        const cols = db.prepare(`PRAGMA table_info("${table}")`).all();
        const defs = cols
          .map((c) => {
            let t = sqliteTypeToMysql(c.type);
            if (c.pk) return `\`${c.name}\` ${t}`;
            return `\`${c.name}\` ${t}`;
          })
          .join(", ");
        create = `CREATE TABLE IF NOT EXISTS \`${mariaTable}\` (${defs}) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`;
        await pool.query(create);
      }

      const rows = db.prepare(`SELECT * FROM "${table}"`).all();
      if (!rows.length) {
        console.log("0 rows");
        report.push({ table: mariaTable, rows: 0 });
        continue;
      }
      const cols = Object.keys(rows[0]);
      const ph = cols.map(() => "?").join(",");
      const insertSql = `INSERT INTO \`${mariaTable}\` (${cols.map((c) => `\`${c}\``).join(",")}) VALUES (${ph})`;
      const chunk = 200;
      let inserted = 0;
      for (let i = 0; i < rows.length; i += chunk) {
        const slice = rows.slice(i, i + chunk);
        const conn = await pool.getConnection();
        try {
          await conn.beginTransaction();
          for (const row of slice) {
            await conn.query(
              insertSql,
              cols.map((c) => {
                const v = row[c];
                if (v == null) return null;
                if (Buffer.isBuffer(v)) return v;
                if (typeof v === "object") return JSON.stringify(v);
                return v;
              }),
            );
          }
          await conn.commit();
          inserted += slice.length;
        } catch (e) {
          await conn.rollback();
          throw e;
        } finally {
          conn.release();
        }
      }
      console.log(`${inserted} rows`);
      report.push({ table: mariaTable, rows: inserted });
    } catch (e) {
      console.log("FAIL", e.message.slice(0, 120));
      report.push({ table: mariaTable, error: e.message.slice(0, 300) });
    }
  }
  db.close();
  return { ok: true, report };
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const accounts = await listAccountsGlobal();
  const rrAcct = accounts.find((a) => /outlook/i.test(a.name || ""));
  if (!rrAcct) throw new Error("Root Record CF account not found");

  for (const spec of DB_SPECS) {
    if (!spec.account) spec.account = rrAcct.id;
  }

  const exportMetas = [];
  for (const spec of DB_SPECS) {
    exportMetas.push(await exportDb(spec));
  }
  fs.writeFileSync(path.join(OUT, "full-export-meta.json"), JSON.stringify(exportMetas, null, 2));

  const pool = await mysql.createPool({
    host: env.AVA_MYSQL_HOST || "127.0.0.1",
    port: Number(env.AVA_MYSQL_PORT || 3306),
    user: env.AVA_MYSQL_USER || "ava",
    password: env.AVA_MYSQL_PASSWORD || env.MYSQL_PASSWORD || "",
    connectionLimit: 4,
    multipleStatements: false,
  });

  const importReports = [];
  for (const spec of DB_SPECS) {
    importReports.push({
      name: spec.name,
      maria: spec.maria,
      ...(await importSqliteToMaria(spec, pool)),
    });
  }
  await pool.end();

  fs.writeFileSync(
    path.join(OUT, "full-import-meta.json"),
    JSON.stringify({ at: new Date().toISOString(), exportMetas, importReports }, null, 2),
  );

  // summary
  let trunc = 0;
  let fails = 0;
  for (const m of exportMetas) {
    for (const t of m.tables || []) {
      if (t.truncated) trunc++;
      if (t.error) fails++;
    }
  }
  console.log("\n=== DONE ===");
  console.log(JSON.stringify({ trunc, fails, out: OUT }, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
