/**
 * Re-import post-reset TOWNY_SINK rows from live MySQL into D1 (audit trail).
 * These are real closed-loop Towny payments â€” excluded from reserve net, not deleted.
 *
 *   node scripts/resync-towny-sink-from-mysql.mjs
 *   node scripts/resync-towny-sink-from-mysql.mjs --dry-run
 */
import mysql from "mysql2/promise";
import fs from "node:fs";
import { loadRootMcEnv } from "./lib/rootmc-env.mjs";
import { WORKSPACE_ROOT } from "./lib/rootmc-paths.mjs";

const POST_RESET_START = "2026-07-01 00:00:00";
const TREASURY_SERVER_ID = "rootmc";
const dryRun = process.argv.includes("--dry-run");

const env = loadRootMcEnv();
const token = process.env.CLOUDFLARE_API_TOKEN || env.CLOUDFLARE_API_TOKEN;
const account = process.env.CLOUDFLARE_ACCOUNT_ID || env.CLOUDFLARE_ACCOUNT_ID || "f3372b30093435bacc35b69972abeb2e";
const dbId = process.env.ROOTMC_D1_DATABASE_ID || env.ROOTMC_D1_DATABASE_ID || "6cf71128-67e3-47b2-a802-d6c23d6489e0";

function read(key) {
  return String(process.env[key] || env[key] || "").trim();
}

function readTownyDatabaseYaml() {
  const candidates = [
    process.env.ROOTMC_TOWNY_DATABASE_YML,
    `${WORKSPACE_ROOT}\\Server Handoffs\2. RootMC - Towny\\plugins\\Towny\\settings\\database.yml`,
  ].filter(Boolean);
  for (const p of candidates) {
    if (!fs.existsSync(p)) continue;
    const yaml = fs.readFileSync(p, "utf8");
    const pick = (key) => {
      const m = yaml.match(new RegExp(`^\\s*${key}:\\s*'?([^'\\r\\n]+)'?\\s*$`, "m"));
      return m ? m[1].trim() : "";
    };
    return {
      host: pick("hostname"),
      port: Number(pick("port") || 3306),
      user: pick("username"),
      password: pick("password"),
      database: pick("dbname"),
    };
  }
  return null;
}

const townyDb = readTownyDatabaseYaml();
const host = read("ROOTMC_MYSQL_HOST") || townyDb?.host || "";
const user = read("ROOTMC_MYSQL_USER") || townyDb?.user || "";
const password = read("ROOTMC_MYSQL_PASS") || read("ROOTMC_MYSQL_PASSWORD") || townyDb?.password || "";
const database = read("ROOTMC_MYSQL_DB") || townyDb?.database || "";
const port = Number(read("ROOTMC_MYSQL_PORT") || townyDb?.port || 3306);
const prefix = read("ROOTMC_MYSQL_TABLE_PREFIX") || "root_";

if (!token) {
  console.error("Missing CLOUDFLARE_API_TOKEN");
  process.exit(1);
}
if (!host || !user || !password || !database) {
  console.error("Missing MySQL connection â€” set ROOTMC_MYSQL_* or Towny database.yml in handoff.");
  process.exit(1);
}

async function d1Exec(sql, params = []) {
  const res = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${account}/d1/database/${dbId}/query`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ sql, params }),
    },
  );
  const data = await res.json();
  if (!data.success) throw new Error(JSON.stringify(data.errors));
  return data.result?.[0];
}

const conn = await mysql.createConnection({ host, port, user, password, database });
const table = `${prefix}treasury_ledger`;
const [rows] = await conn.execute(
  `SELECT id, entry_type, amount, from_uuid, to_uuid, details, created_at
   FROM ${table}
   WHERE entry_type = 'TOWNY_SINK' AND created_at >= ?
   ORDER BY id ASC`,
  [POST_RESET_START],
);
await conn.end();

console.log("MySQL TOWNY_SINK rows since opening:", rows.length);
if (dryRun) {
  console.log("sample:", rows.slice(0, 10));
  console.log("Dry run â€” no D1 writes.");
  process.exit(0);
}

let upserted = 0;
const syncedAt = new Date().toISOString();
for (const row of rows) {
  await d1Exec(
    `INSERT INTO rootmc_treasury_ledger
       (server_id, mysql_id, entry_type, amount, from_uuid, to_uuid, details, created_at, synced_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(server_id, mysql_id) DO UPDATE SET
       entry_type = excluded.entry_type,
       amount = excluded.amount,
       from_uuid = excluded.from_uuid,
       to_uuid = excluded.to_uuid,
       details = excluded.details,
       created_at = excluded.created_at,
       synced_at = excluded.synced_at`,
    [
      TREASURY_SERVER_ID,
      row.id,
      row.entry_type,
      row.amount,
      row.from_uuid,
      row.to_uuid,
      row.details,
      row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
      syncedAt,
    ],
  );
  upserted++;
}
console.log("Upserted", upserted, "TOWNY_SINK audit rows into D1 (reserve net still excludes these).");
