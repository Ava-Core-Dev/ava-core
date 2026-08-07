/**
 * Persistent cron watermarks — MariaDB `ava_cron` with JSON file fallback.
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { AVA_HANDOFF } from "./config.mjs";

const require = createRequire(import.meta.url);

function loadEnvFile() {
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
    ) {
      v = v.slice(1, -1);
    }
    if (out[k] == null || out[k] === "") out[k] = v;
  }
  return out;
}

function fileStorePath() {
  const dir = path.join(AVA_HANDOFF, "core", "data", "cron");
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, "watermarks.json");
}

function readFileStore() {
  const p = fileStorePath();
  try {
    if (!fs.existsSync(p)) return { jobs: {} };
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch {
    return { jobs: {} };
  }
}

function writeFileStore(data) {
  fs.writeFileSync(fileStorePath(), JSON.stringify(data, null, 2));
}

let pool = null;
let poolFailed = false;

function getPool(env) {
  if (poolFailed) return null;
  if (pool) return pool;
  try {
    const mysql = require("mysql2/promise");
    pool = mysql.createPool({
      host: env.AVA_MYSQL_HOST || "127.0.0.1",
      port: Number(env.AVA_MYSQL_PORT || 3306),
      user: env.AVA_MYSQL_USER || "ava",
      password: env.AVA_MYSQL_PASSWORD || env.MYSQL_PASSWORD || "",
      database: "ava_cron",
      connectionLimit: 4,
    });
    return pool;
  } catch (err) {
    poolFailed = true;
    console.warn("cronWatermarks: mysql2 unavailable, file store only:", err.message);
    return null;
  }
}

export async function getWatermark(jobId) {
  const env = loadEnvFile();
  const p = getPool(env);
  if (p) {
    try {
      const [rows] = await p.query("SELECT * FROM cron_watermarks WHERE job_id = ? LIMIT 1", [
        jobId,
      ]);
      if (rows[0]) return rows[0];
    } catch (err) {
      console.warn("cronWatermarks get:", err.message);
    }
  }
  return readFileStore().jobs[jobId] || null;
}

export async function recordRunStart(jobId) {
  const env = loadEnvFile();
  const started = Date.now();
  const p = getPool(env);
  if (p) {
    try {
      const [res] = await p.query(
        "INSERT INTO cron_runs (job_id, started_at, ok) VALUES (?, ?, 0)",
        [jobId, started],
      );
      await p.query(
        `INSERT INTO cron_watermarks (job_id, last_started_at, last_ok, run_count, updated_at)
         VALUES (?, ?, 0, 1, ?)
         ON DUPLICATE KEY UPDATE last_started_at = VALUES(last_started_at), updated_at = VALUES(updated_at), run_count = run_count + 1`,
        [jobId, started, started],
      );
      return { runId: res.insertId, startedAt: started };
    } catch (err) {
      console.warn("cronWatermarks start:", err.message);
    }
  }
  const store = readFileStore();
  const runId = `file-${started}`;
  store.jobs[jobId] = {
    ...(store.jobs[jobId] || {}),
    last_started_at: started,
    last_ok: 0,
    run_count: Number(store.jobs[jobId]?.run_count || 0) + 1,
    updated_at: started,
  };
  writeFileStore(store);
  return { runId, startedAt: started };
}

export async function recordRunFinish(jobId, runId, { ok, detail, error } = {}) {
  const env = loadEnvFile();
  const finished = Date.now();
  const p = getPool(env);
  if (p && typeof runId === "number") {
    try {
      await p.query(
        "UPDATE cron_runs SET finished_at = ?, ok = ?, detail = ?, error = ? WHERE id = ?",
        [finished, ok ? 1 : 0, detail || null, error || null, runId],
      );
      await p.query(
        `UPDATE cron_watermarks SET last_finished_at = ?, last_ok = ?, last_detail = ?, last_error = ?, updated_at = ?
         WHERE job_id = ?`,
        [finished, ok ? 1 : 0, detail || null, error || null, finished, jobId],
      );
      return;
    } catch (err) {
      console.warn("cronWatermarks finish:", err.message);
    }
  }
  const store = readFileStore();
  store.jobs[jobId] = {
    ...(store.jobs[jobId] || {}),
    last_finished_at: finished,
    last_ok: ok ? 1 : 0,
    last_detail: detail || null,
    last_error: error || null,
    updated_at: finished,
  };
  writeFileStore(store);
}

export async function listWatermarks() {
  const env = loadEnvFile();
  const p = getPool(env);
  if (p) {
    try {
      const [rows] = await p.query("SELECT * FROM cron_watermarks ORDER BY job_id");
      return rows;
    } catch (err) {
      console.warn("cronWatermarks list:", err.message);
    }
  }
  const jobs = readFileStore().jobs || {};
  return Object.entries(jobs).map(([job_id, v]) => ({ job_id, ...v }));
}

export async function recordCatchupReport(report) {
  const env = loadEnvFile();
  const started = Number(report.startedAt || Date.now());
  const finished = Number(report.finishedAt || Date.now());
  const ok = report.ok ? 1 : 0;
  const p = getPool(env);
  if (p) {
    try {
      await p.query(
        "INSERT INTO catchup_runs (started_at, finished_at, ok, report_json) VALUES (?, ?, ?, ?)",
        [started, finished, ok, JSON.stringify(report)],
      );
    } catch (err) {
      console.warn("catchup_runs insert:", err.message);
    }
  }
  const dir = path.join(AVA_HANDOFF, "core", "data", "cron");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, `catchup-${started}.json`),
    JSON.stringify(report, null, 2),
  );
}
