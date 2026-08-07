/**
 * Shared Ava process liveness — parent (index) writes, HTTP status reads.
 */
import fs from "node:fs";
import path from "node:path";
import { storePaths } from "./store.mjs";

const startedAt = Date.now();

function livenessPath() {
  return path.join(storePaths().dir, "liveness.json");
}

export function readLiveness() {
  try {
    if (!fs.existsSync(livenessPath())) return null;
    return JSON.parse(fs.readFileSync(livenessPath(), "utf8"));
  } catch {
    return null;
  }
}

export function writeLiveness(patch = {}) {
  const prev = readLiveness() || {};
  const next = {
    ...prev,
    ...patch,
    updatedAt: Date.now(),
    parentPid: process.pid,
    parentStartedAt: prev.parentStartedAt || startedAt,
    parentUptimeMs: Date.now() - startedAt,
  };
  try {
    fs.mkdirSync(path.dirname(livenessPath()), { recursive: true });
    fs.writeFileSync(livenessPath(), JSON.stringify(next, null, 2), "utf8");
  } catch {
    /* ignore */
  }
  return next;
}

/** Stale thresholds: hot 90s, break/hush 3m. */
export function livenessDegraded(heartbeat, liveness) {
  const age =
    heartbeat?.updatedAt != null ? Date.now() - Number(heartbeat.updatedAt) : null;
  const onBreak = Boolean(heartbeat?.onBreak || heartbeat?.hushed);
  const maxAge = onBreak ? 180_000 : 90_000;
  const staleHb = age == null || age > maxAge;
  const childRestarts = Number(liveness?.childRestartsTotal || 0);
  const crashLoop = Boolean(liveness?.crashLoop);
  return {
    degraded: staleHb || crashLoop,
    staleHeartbeat: staleHb,
    heartbeatAgeMs: age,
    childRestarts,
    crashLoop,
    maxAgeMs: maxAge,
  };
}
