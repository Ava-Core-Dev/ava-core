/**
 * SQLite index over hot JSONL — answer "what happened last night?" without grep.
 * DB: data/logs/index.sqlite
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { storePaths } from "./store.mjs";
import { appendAction } from "./fullLog.mjs";

const require = createRequire(import.meta.url);
const Database = require("better-sqlite3");

function dbPath() {
  const dir = path.join(storePaths().dir, "logs");
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, "index.sqlite");
}

function statePath() {
  return path.join(storePaths().dir, "logs", "index-state.json");
}

function loadState() {
  try {
    return JSON.parse(fs.readFileSync(statePath(), "utf8"));
  } catch {
    return { offsets: {} };
  }
}

function saveState(s) {
  fs.writeFileSync(statePath(), JSON.stringify(s, null, 2), "utf8");
}

function openDb() {
  const db = new Database(dbPath());
  db.exec(`
    CREATE TABLE IF NOT EXISTS events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      at INTEGER,
      source TEXT,
      type TEXT,
      level TEXT,
      job_id TEXT,
      ok INTEGER,
      status INTEGER,
      error TEXT,
      summary TEXT,
      raw TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_events_at ON events(at);
    CREATE INDEX IF NOT EXISTS idx_events_level ON events(level);
    CREATE INDEX IF NOT EXISTS idx_events_type ON events(type);
  `);
  return db;
}

function sources() {
  const logs = path.join(storePaths().dir, "logs");
  const flight = path.join(storePaths().dir, "flight");
  return [
    { name: "actions", file: path.join(logs, "actions.jsonl") },
    { name: "ops", file: path.join(logs, "ops.jsonl") },
    { name: "inbound", file: path.join(logs, "inbound.jsonl") },
    { name: "outbound", file: path.join(logs, "outbound.jsonl") },
    { name: "brain-events", file: path.join(flight, "brain-events.jsonl") },
  ];
}

function ingestFile(db, source, file, fromOffset) {
  if (!fs.existsSync(file)) return { ingested: 0, offset: 0 };
  const buf = fs.readFileSync(file);
  const slice = buf.subarray(Math.min(fromOffset, buf.length));
  const text = slice.toString("utf8");
  const lines = text.split(/\r?\n/);
  // incomplete last line: keep offset before it
  let consumed = 0;
  let ingested = 0;
  const insert = db.prepare(`
    INSERT INTO events (at, source, type, level, job_id, ok, status, error, summary, raw)
    VALUES (@at, @source, @type, @level, @job_id, @ok, @status, @error, @summary, @raw)
  `);
  const tx = db.transaction((rows) => {
    for (const r of rows) insert.run(r);
  });
  const batch = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const isLast = i === lines.length - 1;
    if (isLast && text && !text.endsWith("\n") && !text.endsWith("\r\n")) {
      break; // wait for complete line
    }
    consumed += Buffer.byteLength(line, "utf8") + (text.includes("\r\n") ? 2 : 1);
    if (!line.trim()) continue;
    try {
      const row = JSON.parse(line);
      const type = String(row.type || row.kind || source);
      const level = String(row.level || (row.ok === false ? "error" : "info"));
      batch.push({
        at: Number(row.at || 0) || Date.now(),
        source,
        type,
        level,
        job_id: row.jobId || row.job_id || null,
        ok: row.ok == null ? null : row.ok ? 1 : 0,
        status: row.status == null ? null : Number(row.status),
        error: row.error ? String(row.error).slice(0, 1000) : null,
        summary: String(row.content || row.message || row.error || type).slice(0, 240),
        raw: line.slice(0, 4000),
      });
      ingested++;
    } catch {
      /* skip bad line */
    }
  }
  if (batch.length) tx(batch);
  return { ingested, offset: fromOffset + Math.min(consumed, slice.length) };
}

/** Incremental ingest of hot JSONL into SQLite. */
export function syncLogIndex() {
  const db = openDb();
  const state = loadState();
  let total = 0;
  try {
    for (const s of sources()) {
      const prev = Number(state.offsets?.[s.name] || 0);
      // if file shrank (rotation), reset offset
      let offset = prev;
      try {
        const size = fs.existsSync(s.file) ? fs.statSync(s.file).size : 0;
        if (size < prev) offset = 0;
      } catch {
        offset = 0;
      }
      const r = ingestFile(db, s.name, s.file, offset);
      state.offsets = state.offsets || {};
      state.offsets[s.name] = r.offset;
      total += r.ingested;
    }
    state.updatedAt = Date.now();
    saveState(state);
    if (total > 0) {
      appendAction("log.index", { level: "debug", ingested: total });
    }
    return { ok: true, ingested: total, db: dbPath() };
  } finally {
    db.close();
  }
}

/** Query recent errors/warns since timestamp. */
export function queryLogIndex({
  sinceMs = Date.now() - 24 * 60 * 60 * 1000,
  levels = ["error", "warn"],
  limit = 40,
} = {}) {
  const db = openDb();
  try {
    const placeholders = levels.map(() => "?").join(",");
    const rows = db
      .prepare(
        `SELECT at, source, type, level, job_id, ok, status, error, summary
         FROM events
         WHERE at >= ? AND level IN (${placeholders})
         ORDER BY at DESC
         LIMIT ?`,
      )
      .all(sinceMs, ...levels, limit);
    return rows;
  } finally {
    db.close();
  }
}

export function logIndexPaths() {
  return { db: dbPath(), state: statePath() };
}
