#!/usr/bin/env node
/**
 * Export Cloudflare D1 databases to local SQLite files + SQL dumps.
 * Usage: node scripts/d1-export-to-local.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const AVA_HANDOFF = process.env.AVA_HANDOFF || path.resolve(__dirname, "../..");
const OUT = path.join(AVA_HANDOFF, "local-api", "data");

function loadEnv() {
  const envPath = path.join(AVA_HANDOFF, ".env");
  const out = { ...process.env };
  if (!fs.existsSync(envPath)) return out;
  for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
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

const DATABASES = [
  {
    name: "rootmc",
    accountEnv: "ROOTMC_CLOUDFLARE_ACCOUNT_ID",
    fallbackAccount: null, // filled from API list
    id: "6cf71128-67e3-47b2-a802-d6c23d6489e0",
    accountMatch: /root@rootrecord|rootmc/i,
  },
  {
    name: "rootmc-webstat",
    id: "e999ab90-08d5-485f-a813-a22aa6aead52",
    accountMatch: /root@rootrecord|rootmc/i,
  },
  {
    name: "rootmc-live",
    id: "0fae3fc8-f48d-4d6a-b31e-ddff12131d84",
    accountMatch: /root@rootrecord|rootmc/i,
  },
  {
    name: "root-record",
    id: "0b49c598-1f91-4a09-84a8-6ba8241c6df3",
    accountMatch: /outlook|rootrecord/i,
  },
];

async function cf(env, url, { method = "GET", body, email, key, token } = {}) {
  const headers = { "content-type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  else {
    headers["X-Auth-Email"] = email;
    headers["X-Auth-Key"] = key;
  }
  const res = await fetch(url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json();
  return { ok: res.ok && json.success !== false, status: res.status, json };
}

async function listAccounts(env) {
  const email = env.CLOUDFLARE_EMAIL;
  const key = env.CLOUDFLARE_GLOBAL_API_KEY;
  const r = await cf(env, "https://api.cloudflare.com/client/v4/accounts?per_page=50", {
    email,
    key,
  });
  if (!r.ok) throw new Error(JSON.stringify(r.json?.errors || r.json));
  return r.json.result || [];
}

async function listTables(env, accountId, dbId) {
  const email = env.CLOUDFLARE_EMAIL;
  const key = env.CLOUDFLARE_GLOBAL_API_KEY;
  const r = await cf(
    env,
    `https://api.cloudflare.com/client/v4/accounts/${accountId}/d1/database/${dbId}/query`,
    {
      method: "POST",
      email,
      key,
      body: { sql: "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' ORDER BY name" },
    },
  );
  if (!r.ok) throw new Error(`listTables ${dbId}: ${JSON.stringify(r.json?.errors || r.json)}`);
  const rows = r.json.result?.[0]?.results || r.json.result?.results || [];
  return rows.map((x) => x.name).filter(Boolean);
}

async function dumpTable(env, accountId, dbId, table) {
  const email = env.CLOUDFLARE_EMAIL;
  const key = env.CLOUDFLARE_GLOBAL_API_KEY;
  // schema
  const schemaRes = await cf(
    env,
    `https://api.cloudflare.com/client/v4/accounts/${accountId}/d1/database/${dbId}/query`,
    {
      method: "POST",
      email,
      key,
      body: { sql: `SELECT sql FROM sqlite_master WHERE type='table' AND name = ?`, params: [table] },
    },
  );
  const createSql =
    schemaRes.json.result?.[0]?.results?.[0]?.sql ||
    schemaRes.json.result?.results?.[0]?.sql ||
    null;

  // count
  const countRes = await cf(
    env,
    `https://api.cloudflare.com/client/v4/accounts/${accountId}/d1/database/${dbId}/query`,
    {
      method: "POST",
      email,
      key,
      body: { sql: `SELECT COUNT(*) AS c FROM "${table}"` },
    },
  );
  const count =
    countRes.json.result?.[0]?.results?.[0]?.c ??
    countRes.json.result?.results?.[0]?.c ??
    0;

  // page rows (cap for huge tables)
  const limit = Math.min(Number(process.env.D1_EXPORT_MAX_ROWS || 5000), 20000);
  const dataRes = await cf(
    env,
    `https://api.cloudflare.com/client/v4/accounts/${accountId}/d1/database/${dbId}/query`,
    {
      method: "POST",
      email,
      key,
      body: { sql: `SELECT * FROM "${table}" LIMIT ${limit}` },
    },
  );
  const rows =
    dataRes.json.result?.[0]?.results || dataRes.json.result?.results || [];
  return { createSql, count, rows, truncated: count > rows.length };
}

async function main() {
  const env = loadEnv();
  fs.mkdirSync(OUT, { recursive: true });
  const accounts = await listAccounts(env);
  console.log(
    "accounts",
    accounts.map((a) => a.name),
  );

  let Database;
  try {
    Database = require("better-sqlite3");
  } catch {
    console.warn("better-sqlite3 not installed — writing JSON/SQL dumps only");
  }

  const summary = [];

  for (const db of DATABASES) {
    const acct = accounts.find((a) => db.accountMatch.test(a.name || "")) || accounts[0];
    if (!acct) throw new Error("no CF account");
    console.log(`\n=== ${db.name} @ ${acct.name} (${db.id}) ===`);
    let tables = [];
    try {
      tables = await listTables(env, acct.id, db.id);
    } catch (err) {
      console.error("list tables failed", err.message);
      summary.push({ db: db.name, error: err.message });
      continue;
    }
    console.log("tables", tables.length);

    const dumpDir = path.join(OUT, "dumps", db.name);
    fs.mkdirSync(dumpDir, { recursive: true });
    const meta = { database: db.name, id: db.id, account: acct.name, tables: [] };

    let sqlite = null;
    const sqlitePath = path.join(OUT, `${db.name}.sqlite`);
    if (Database) {
      if (fs.existsSync(sqlitePath)) fs.unlinkSync(sqlitePath);
      sqlite = new Database(sqlitePath);
      sqlite.pragma("journal_mode = WAL");
    }

    for (const table of tables) {
      process.stdout.write(`  ${table}… `);
      try {
        const { createSql, count, rows, truncated } = await dumpTable(
          env,
          acct.id,
          db.id,
          table,
        );
        console.log(`${count} rows (export ${rows.length}${truncated ? " truncated" : ""})`);
        meta.tables.push({ table, count, exported: rows.length, truncated });
        fs.writeFileSync(
          path.join(dumpDir, `${table}.json`),
          JSON.stringify({ createSql, count, rows }, null, 0),
        );
        if (sqlite && createSql) {
          try {
            sqlite.exec(createSql);
            if (rows.length) {
              const cols = Object.keys(rows[0]);
              const placeholders = cols.map(() => "?").join(",");
              const stmt = sqlite.prepare(
                `INSERT OR REPLACE INTO "${table}" (${cols.map((c) => `"${c}"`).join(",")}) VALUES (${placeholders})`,
              );
              const tx = sqlite.transaction((rs) => {
                for (const row of rs) stmt.run(...cols.map((c) => row[c]));
              });
              tx(rows);
            }
          } catch (err) {
            console.warn("    sqlite write:", err.message);
          }
        }
      } catch (err) {
        console.log("FAIL", err.message);
        meta.tables.push({ table, error: err.message });
      }
    }
    if (sqlite) sqlite.close();
    fs.writeFileSync(path.join(dumpDir, "_meta.json"), JSON.stringify(meta, null, 2));
    summary.push(meta);
  }

  fs.writeFileSync(path.join(OUT, "export-summary.json"), JSON.stringify(summary, null, 2));
  console.log("\nDone →", OUT);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
