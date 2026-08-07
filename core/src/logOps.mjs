/**
 * Structured ops logging for cronRunner + local-api + platform events.
 * Writes: actions.jsonl (always) + ops.jsonl (ops bus) + brain-events on failures.
 */
import fs from "node:fs";
import path from "node:path";
import { appendAction } from "./fullLog.mjs";
import { storePaths } from "./store.mjs";

function opsPath() {
  const dir = path.join(storePaths().dir, "logs");
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, "ops.jsonl");
}

function brainEventsPath() {
  const dir = path.join(storePaths().dir, "flight");
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, "brain-events.jsonl");
}

function appendJsonl(file, row) {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.appendFileSync(file, `${JSON.stringify(row)}\n`, "utf8");
  } catch (err) {
    console.warn("logOps append:", err.message);
  }
}

/**
 * @param {object} opts
 * @param {string} opts.type - e.g. cron.run, localApi.request
 * @param {"debug"|"info"|"warn"|"error"} [opts.level]
 * @param {string} [opts.jobId]
 * @param {number} [opts.durationMs]
 * @param {number} [opts.status]
 * @param {boolean} [opts.ok]
 * @param {string} [opts.error]
 * @param {object} [opts.meta]
 */
export function logOps({
  type,
  level = "info",
  jobId = null,
  durationMs = null,
  status = null,
  ok = null,
  error = null,
  path: reqPath = null,
  method = null,
  meta = {},
} = {}) {
  const row = {
    at: Date.now(),
    type: String(type || "ops"),
    level: String(level || "info"),
    jobId,
    durationMs,
    status,
    ok,
    error: error ? String(error).slice(0, 1500) : null,
    path: reqPath,
    method,
    ...meta,
  };
  appendJsonl(opsPath(), row);
  appendAction(type || "ops", {
    level: row.level,
    jobId,
    durationMs,
    status,
    ok,
    error: row.error,
    path: reqPath,
    method,
    ...meta,
  });

  if (row.level === "error" || row.level === "warn" || ok === false) {
    appendJsonl(brainEventsPath(), {
      at: row.at,
      kind: "ops",
      type: row.type,
      level: row.level,
      jobId,
      status,
      error: row.error,
      path: reqPath,
    });
  }
  return row;
}

export function logOpsPaths() {
  return { ops: opsPath(), brainEvents: brainEventsPath() };
}
