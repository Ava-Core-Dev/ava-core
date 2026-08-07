/**
 * Push Ava ops/status snapshot to api.rootmc.net → D1.
 */
import { buildPublicOpsPayload } from "./opsStatus.mjs";
import { loadHeartbeat, isHushed } from "./store.mjs";
import { isLockoutActive } from "./lockoutMode.mjs";

let lastPushAt = 0;
const MIN_INTERVAL_MS = Number(process.env.AVA_STATUS_PUSH_MS || 60_000) || 60_000;

export async function pushAvaStatusSnapshot(env = {}, opts = {}) {
  const force = Boolean(opts.force);
  const now = Date.now();
  if (!force && lastPushAt && now - lastPushAt < MIN_INTERVAL_MS) {
    return { ok: true, skipped: true, reason: "too_soon" };
  }
  const key = String(
    env.ROOTMC_DEV_WORKSTATION_KEY ||
      process.env.ROOTMC_DEV_WORKSTATION_KEY ||
      process.env.ROOTMC_INTERNAL_API_KEY ||
      "",
  ).trim();
  if (!key) return { ok: false, detail: "no_workstation_key" };

  const ops = buildPublicOpsPayload();
  const hb = loadHeartbeat() || {};
  const body = {
    at: now,
    sampledAt: now,
    mood: ops.mood,
    moodLabel: ops.moodLabel,
    lockout: Boolean(ops.lockout || isLockoutActive()),
    hushed: Boolean(ops.hushed || isHushed()),
    brainMode: ops.brain?.mode || "normal",
    ops,
    heartbeat: {
      mode: hb.mode,
      live: hb.live,
      updatedAt: hb.updatedAt,
      queueDepth: hb.queueDepth,
      cursorAgents: hb.cursorAgents,
      pollMs: hb.pollMs,
    },
  };

  const base = String(
    process.env.AVA_API_BASE || process.env.ROOTMC_API_BASE || "https://api.rootmc.net",
  ).replace(/\/$/, "");

  try {
    const res = await fetch(`${base}/api/rootmc/ava/status`, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "User-Agent": "AvaIvyRootMC/0.5",
        "X-RootMC-Dev-Key": key,
      },
      body: JSON.stringify(body),
    });
    const text = await res.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = { raw: text.slice(0, 200) };
    }
    if (!res.ok) {
      return { ok: false, status: res.status, detail: data?.detail || text.slice(0, 160) };
    }
    lastPushAt = now;
    return { ok: true, data };
  } catch (err) {
    return { ok: false, detail: err.message };
  }
}
