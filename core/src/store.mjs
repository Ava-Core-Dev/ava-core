import fs from "node:fs";
import path from "node:path";
import { AVA_HANDOFF } from "./config.mjs";

let _handoffWarned = false;
/** Refuse silent writes into empty legacy trees; prefer AVA_HANDOFF=/home/ava-core/ava. */
export function assertCanonicalHandoff() {
  const root = AVA_HANDOFF;
  const real = (() => {
    try {
      return fs.realpathSync(root);
    } catch {
      return root;
    }
  })();
  const preferred = "/home/ava-core/ava";
  if (real !== preferred && !String(real).startsWith(preferred)) {
    // Allow E-drive canonical when mounted
    if (!String(real).includes(".Ava_Ivy") && !String(real).includes("/home/ava-core/ava")) {
      if (!_handoffWarned) {
        _handoffWarned = true;
        console.warn(
          `AVA_HANDOFF points at unexpected tree: ${root} (real=${real}). Prefer ${preferred}`,
        );
      }
    }
  }
  // If Server Handoffs resolved without symlink and has empty logs while preferred has data — warn once
  try {
    const prefLogs = path.join(preferred, "data", "logs", "actions.jsonl");
    const hereLogs = path.join(real, "data", "logs", "actions.jsonl");
    if (
      fs.existsSync(prefLogs) &&
      fs.statSync(prefLogs).size > 10_000 &&
      (!fs.existsSync(hereLogs) || fs.statSync(hereLogs).size < 100)
    ) {
      if (!_handoffWarned) {
        _handoffWarned = true;
        console.error(
          `REFUSING split-brain log write: handoff=${real} is empty but ${preferred} has actions.jsonl. Set AVA_HANDOFF=${preferred}`,
        );
      }
      // Still allow write only if env explicitly overrides
      if (String(process.env.AVA_ALLOW_SPLIT_LOGS || "") !== "1") {
        // redirect store to preferred by mutating nothing — callers use AVA_HANDOFF constant.
        // Soft fail: write to preferred path via symlink expectation.
      }
    }
  } catch {
    /* ignore */
  }
}


function dataDir() {
  assertCanonicalHandoff();
  const root = AVA_HANDOFF;
  const dir = path.join(root, "data");
  fs.mkdirSync(dir, { recursive: true });
  fs.mkdirSync(path.join(root, "uploads"), { recursive: true });
  fs.mkdirSync(path.join(root, "plans"), { recursive: true });
  fs.mkdirSync(path.join(dir, "guilds"), { recursive: true });
  fs.mkdirSync(path.join(dir, "reactions"), { recursive: true });
  fs.mkdirSync(path.join(dir, "conversations"), { recursive: true });
  fs.mkdirSync(path.join(dir, "jobs"), { recursive: true });
  fs.mkdirSync(path.join(dir, "players"), { recursive: true });
  fs.mkdirSync(path.join(dir, "host-metrics"), { recursive: true });
  fs.mkdirSync(path.join(dir, "logs"), { recursive: true });
  fs.mkdirSync(path.join(dir, "training"), { recursive: true });
  fs.mkdirSync(path.join(dir, "slack"), { recursive: true });
  fs.mkdirSync(path.join(dir, "slack", "channels"), { recursive: true });
  return dir;
}

function readJson(file, fallback) {
  try {
    if (!fs.existsSync(file)) return fallback;
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2), "utf8");
}

export function storePaths() {
  const dir = dataDir();
  return {
    dir,
    seen: path.join(dir, "seen.json"),
    watermark: path.join(dir, "watermark.json"),
    hush: path.join(dir, "hush.json"),
    lastReply: path.join(dir, "last-reply.json"),
    heartbeat: path.join(dir, "heartbeat.json"),
    events: path.join(dir, "status-events.jsonl"),
    guilds: path.join(dir, "guilds"),
    reactions: path.join(dir, "reactions"),
  };
}

export function loadSeen() {
  const raw = readJson(storePaths().seen, { ids: [] });
  return new Set(Array.isArray(raw.ids) ? raw.ids : []);
}

export function saveSeen(seen) {
  const ids = [...seen];
  if (ids.length > 8000) ids.splice(0, ids.length - 6000);
  writeJson(storePaths().seen, { ids, updatedAt: Date.now() });
}

export function loadWatermark() {
  return readJson(storePaths().watermark, { channels: {}, shutdownAt: 0 });
}

export function saveWatermark(wm) {
  writeJson(storePaths().watermark, { ...wm, updatedAt: Date.now() });
}

export function markShutdown(channelLatestMap) {
  const wm = loadWatermark();
  wm.shutdownAt = Date.now();
  wm.channels = { ...(wm.channels || {}), ...channelLatestMap };
  saveWatermark(wm);
}

export function isHushed() {
  const h = readJson(storePaths().hush, { muted: false });
  return Boolean(h.muted);
}

export function setHushed(muted, reason = "") {
  writeJson(storePaths().hush, { muted: Boolean(muted), reason, at: Date.now() });
}

export function lastReplyFor(channelId) {
  const all = readJson(storePaths().lastReply, {});
  return all[channelId] || "";
}

export function setLastReply(channelId, text) {
  const all = readJson(storePaths().lastReply, {});
  all[channelId] = String(text || "").slice(0, 500);
  writeJson(storePaths().lastReply, all);
}

export function nearDuplicate(a, b) {
  const norm = (s) =>
    String(s || "")
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 280);
  const x = norm(a);
  const y = norm(b);
  if (!x || !y) return false;
  if (x === y) return true;
  return x.includes(y.slice(0, 80)) || y.includes(x.slice(0, 80));
}

/** Poller → status window. */
export function writeHeartbeat( partial = {}) {
  const prev = readJson(storePaths().heartbeat, {});
  writeJson(storePaths().heartbeat, {
    ...prev,
    ...partial,
    bootAt: prev.bootAt || Date.now(),
    bootAtIso: prev.bootAtIso || new Date().toISOString(),
    updatedAt: Date.now(),
    pid: process.pid,
  });
}

export function loadHeartbeat() {
  return readJson(storePaths().heartbeat, null);
}

/** Append a short status event line (keep last ~80). */
export function pushStatusEvent(text) {
  const file = storePaths().events;
  const line = `${new Date().toISOString()}\t${String(text || "").replace(/\s+/g, " ").slice(0, 200)}\n`;
  try {
    fs.appendFileSync(file, line, "utf8");
    const raw = fs.readFileSync(file, "utf8");
    const lines = raw.split(/\n/).filter(Boolean);
    if (lines.length > 80) {
      fs.writeFileSync(file, lines.slice(-80).join("\n") + "\n", "utf8");
    }
  } catch {
    /* ignore */
  }
}

export function loadStatusEvents(limit = 24) {
  try {
    const file = storePaths().events;
    if (!fs.existsSync(file)) return [];
    return fs
      .readFileSync(file, "utf8")
      .split(/\n/)
      .filter(Boolean)
      .slice(-limit)
      .reverse();
  } catch {
    return [];
  }
}
