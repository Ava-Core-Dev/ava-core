/**
 * Rotate append-only JSONL before they grow unbounded.
 * Hot file stays; prior chunk → data/logs/archive/<name>.<stamp>.jsonl.gz
 */
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { storePaths } from "./store.mjs";
import { appendAction } from "./fullLog.mjs";

const DEFAULT_MAX_BYTES = Number(process.env.AVA_LOG_ROTATE_BYTES || 8 * 1024 * 1024) || 8 * 1024 * 1024;
const DEFAULT_MAX_AGE_MS =
  Number(process.env.AVA_LOG_ROTATE_AGE_MS || 7 * 24 * 60 * 60 * 1000) || 7 * 24 * 60 * 60 * 1000;

function archiveDir() {
  const dir = path.join(storePaths().dir, "logs", "archive");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function stamp() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

/** Rotate one file if over size or age. Returns { rotated, reason } */
export function rotateJsonlFile(filePath, {
  maxBytes = DEFAULT_MAX_BYTES,
  maxAgeMs = DEFAULT_MAX_AGE_MS,
} = {}) {
  try {
    if (!fs.existsSync(filePath)) return { rotated: false, reason: "missing" };
    const st = fs.statSync(filePath);
    if (st.size <= 0) return { rotated: false, reason: "empty" };
    const overSize = st.size >= maxBytes;
    const overAge = Date.now() - st.mtimeMs >= maxAgeMs && st.size > 64 * 1024;
    if (!overSize && !overAge) return { rotated: false, reason: "ok" };

    const base = path.basename(filePath);
    const dest = path.join(archiveDir(), `${base}.${stamp()}.gz`);
    const raw = fs.readFileSync(filePath);
    fs.writeFileSync(dest, zlib.gzipSync(raw));
    fs.writeFileSync(filePath, "");
    return {
      rotated: true,
      reason: overSize ? "size" : "age",
      bytes: st.size,
      archive: dest,
    };
  } catch (err) {
    return { rotated: false, reason: err.message };
  }
}

export function rotateHotLogs() {
  const logs = path.join(storePaths().dir, "logs");
  const training = path.join(storePaths().dir, "training");
  const flight = path.join(storePaths().dir, "flight");
  const targets = [
    path.join(logs, "actions.jsonl"),
    path.join(logs, "inbound.jsonl"),
    path.join(logs, "outbound.jsonl"),
    path.join(logs, "host-audit.jsonl"),
    path.join(logs, "ops.jsonl"),
    path.join(training, "rcon-pairs.jsonl"),
    path.join(training, "digs.jsonl"),
    path.join(training, "free-cloud-calls.jsonl"),
    path.join(training, "local-lessons.jsonl"),
    path.join(flight, "brain-events.jsonl"),
  ];
  const results = [];
  for (const f of targets) {
    const r = rotateJsonlFile(f);
    if (r.rotated) results.push({ file: path.basename(f), ...r });
  }
  if (results.length) {
    appendAction("log.rotate", { level: "info", count: results.length, results });
  }
  return { ok: true, rotated: results };
}
