/**
 * Personal Telegram = master ops channel with Alex.
 * Periodic urgent alerts only when the urgent set changes (or is newly non-empty).
 * Quiet when nothing needs doing; no re-spam of the same list.
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { loadEnv, telegramBotToken } from "./config.mjs";
import { storePaths, loadHeartbeat, pushStatusEvent } from "./store.mjs";
import { listJobs } from "./jobQueue.mjs";
import { isPoweredOff } from "./powerDown.mjs";
import { safeModeSnapshot } from "./overloadSafeMode.mjs";
import { appendAction } from "./fullLog.mjs";

const URGENT_JOB_STATUSES = new Set([
  "waiting_restart",
  "staged",
  "blocked",
  "pending",
  "implementing",
  "failed",
]);

/** Default 30 minutes. */
export function urgentTelegramIntervalMs() {
  const n = Number(process.env.AVA_URGENT_TELEGRAM_MS || "");
  if (Number.isFinite(n) && n >= 5 * 60_000) return n;
  return 30 * 60_000;
}

export function urgentTelegramBootDelayMs() {
  const n = Number(process.env.AVA_URGENT_TELEGRAM_BOOT_MS || "");
  if (Number.isFinite(n) && n >= 0) return n;
  return 90_000; // 90s after boot
}

function operatorChatId(env = {}) {
  return String(
    env.AVA_TELEGRAM_OPERATOR_IDS || process.env.AVA_TELEGRAM_OPERATOR_IDS || "",
  )
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)[0];
}

function presencePath() {
  return path.join(storePaths().dir, "telegram-presence.json");
}

function statePath() {
  return path.join(storePaths().dir, "urgent-telegram.json");
}

function loadPresence() {
  try {
    return JSON.parse(
      fs.readFileSync(presencePath(), "utf8").replace(/^\uFEFF/, ""),
    );
  } catch {
    return { lastOnlineAt: 0, lastOnlinePid: null, lastReason: "" };
  }
}

function savePresence(s) {
  fs.mkdirSync(path.dirname(presencePath()), { recursive: true });
  fs.writeFileSync(presencePath(), JSON.stringify(s, null, 2), "utf8");
}

/**
 * Ping personal Telegram when Ava comes online (boot / wake).
 * Once per process pid per reason family — no spam on heartbeat.
 */
export async function notifyOnlineTelegram(opts = {}) {
  try {
    const { isLockoutActive } = await import("./lockoutMode.mjs");
    if (isLockoutActive() && !opts.force) {
      return { sent: false, reason: "lockout_quiet" };
    }
  } catch {
    /* ignore */
  }
  const env = opts.env || (await loadEnv());
  const token = telegramBotToken(env);
  const chatId = operatorChatId(env);
  if (!token || !chatId) {
    return { sent: false, reason: "telegram_not_configured" };
  }

  const reason = String(opts.reason || "boot").slice(0, 80);
  const presence = loadPresence();
  // Same live process already announced this boot
  if (
    !opts.force &&
    presence.lastOnlinePid === process.pid &&
    (reason === "boot" || presence.lastReason === reason)
  ) {
    return { sent: false, reason: "already_announced" };
  }
  // Deduplicate rapid double-calls (boot + gateway ready)
  if (
    !opts.force &&
    presence.lastOnlinePid === process.pid &&
    Date.now() - Number(presence.lastOnlineAt || 0) < 60_000
  ) {
    return { sent: false, reason: "recent" };
  }

  const hb = loadHeartbeat() || {};
  const lines = [
    "Ava — online",
    "",
    reason === "wake" || reason === "auto-wake"
      ? "i'm awake again."
      : "i'm live.",
    `reason: ${reason}`,
    `mode: ${hb.mode || "hot"} · pid ${process.pid}`,
    "",
    "personal Telegram stays master comms — urgents only when something changes.",
    "— Ava",
  ];

  await telegramSend(token, chatId, lines.join("\n"));
  savePresence({
    lastOnlineAt: Date.now(),
    lastOnlinePid: process.pid,
    lastReason: reason,
  });
  appendAction("telegram.online", { reason, pid: process.pid });
  pushStatusEvent(`telegram online · ${reason}`);
  return { sent: true, reason };
}

function registryPath() {
  return path.join(storePaths().dir, "urgent-registry.json");
}

function loadState() {
  try {
    return JSON.parse(fs.readFileSync(statePath(), "utf8").replace(/^\uFEFF/, ""));
  } catch {
    return {
      lastFingerprint: "",
      lastSentAt: 0,
      lastItemKeys: [],
      lastText: "",
    };
  }
}

function saveState(s) {
  fs.mkdirSync(path.dirname(statePath()), { recursive: true });
  fs.writeFileSync(statePath(), JSON.stringify(s, null, 2), "utf8");
}

function defaultRegistry() {
  return {
    updatedAt: Date.now(),
    items: [
      {
        id: "ops-ava-tunnel",
        priority: "high",
        title: "ava.rootmc.net Cloudflare Tunnel + Access → :8787",
        detail: "Status page remote access — needs operator DNS/tunnel.",
        status: "open",
      },
      {
        id: "ops-ava-core-plugin",
        priority: "high",
        title: "Root-Ava-Core plugin — yes/no greenlight",
        detail: "Asked in Slack #--general-chat--; no decision yet.",
        status: "open",
      },
      {
        id: "ops-optiplex-ubuntu",
        priority: "med",
        title: "OptiPlex robocopy → Ubuntu cutover",
        detail: "Confirm progress / next step.",
        status: "open",
      },
      {
        id: "ops-legacy-bot",
        priority: "med",
        title: "Legacy RootMC bot — don't kick until Ava parity",
        detail: "Ava asked to retire it but later said not at full parity yet.",
        status: "open",
      },
      {
        id: "ops-bond-reserve",
        priority: "med",
        title: "Watch bond/Server Reserve ledger",
        detail: "Reports showed Reserve 0 Gold; payouts paused when ledger < 0.",
        status: "open",
      },
    ],
  };
}

function loadRegistry() {
  try {
    const p = registryPath();
    if (!fs.existsSync(p)) {
      const reg = defaultRegistry();
      fs.mkdirSync(path.dirname(p), { recursive: true });
      fs.writeFileSync(p, JSON.stringify(reg, null, 2), "utf8");
      return reg;
    }
    const raw = fs.readFileSync(p);
    // Truncated/nulled files from crash — rewrite defaults.
    if (!raw.length || raw.every((b) => b === 0)) {
      const reg = defaultRegistry();
      fs.writeFileSync(p, JSON.stringify(reg, null, 2), "utf8");
      return reg;
    }
    return JSON.parse(raw.toString("utf8").replace(/^\uFEFF/, ""));
  } catch {
    try {
      const reg = defaultRegistry();
      fs.writeFileSync(registryPath(), JSON.stringify(reg, null, 2), "utf8");
      return reg;
    } catch {
      return defaultRegistry();
    }
  }
}

function priorityRank(p) {
  const k = String(p || "med").toLowerCase();
  if (k === "critical" || k === "crit") return 0;
  if (k === "high") return 1;
  if (k === "med" || k === "medium") return 2;
  return 3;
}

/**
 * @returns {{ key: string, priority: string, title: string, detail: string, source: string }[]}
 */
export function collectUrgentItems() {
  const items = [];

  // Runtime
  if (isPoweredOff()) {
    items.push({
      key: "runtime:powered_off",
      priority: "critical",
      title: "Ava is powered off",
      detail: "power-off latch set — runtime not responding until cleared + restart.",
      source: "runtime",
    });
  }

  try {
    const hb = loadHeartbeat() || {};
    const age = Date.now() - Number(hb.updatedAt || 0);
    if (hb.live === false && age < 24 * 60 * 60 * 1000) {
      items.push({
        key: "runtime:not_live",
        priority: "critical",
        title: "Ava heartbeat not live",
        detail: `mode=${hb.mode || "?"} poweredOff=${Boolean(hb.poweredOff)} ageMs=${age}`,
        source: "runtime",
      });
    }
    const sm = hb.safeMode || safeModeSnapshot() || {};
    if (sm.active) {
      items.push({
        key: "runtime:sweater",
        priority: "high",
        title: "Sweater / safe mode ACTIVE",
        detail: `reason=${sm.reason || "?"} — trusted-only digs until cleared.`,
        source: "runtime",
      });
    }
  } catch {
    /* ignore */
  }

  // Jobs needing human / stuck
  for (const j of listJobs(50)) {
    if (!URGENT_JOB_STATUSES.has(j.status)) continue;
    // Skip pure chat fluff jobs that aren't ops — keep blocked/waiting_restart/staged always
    const pri =
      j.status === "waiting_restart" || j.status === "failed"
        ? "high"
        : j.status === "blocked"
          ? "med"
          : "med";
    items.push({
      key: `job:${j.id}:${j.status}`,
      priority: pri,
      title: `[${j.status}] ${j.title || j.id}`,
      detail: String(j.brief || j.history?.slice(-1)?.[0]?.note || "").slice(0, 220),
      source: "job",
    });
  }

  // Operator registry (manual / standing ops)
  const reg = loadRegistry();
  for (const it of reg.items || []) {
    if (String(it.status || "open").toLowerCase() !== "open") continue;
    items.push({
      key: `reg:${it.id}`,
      priority: it.priority || "med",
      title: it.title || it.id,
      detail: String(it.detail || "").slice(0, 220),
      source: "registry",
    });
  }

  items.sort(
    (a, b) =>
      priorityRank(a.priority) - priorityRank(b.priority) ||
      String(a.key).localeCompare(String(b.key)),
  );
  return items;
}

export function fingerprintUrgent(items) {
  const payload = items.map((i) => `${i.key}|${i.priority}|${i.title}|${i.detail}`);
  return crypto.createHash("sha256").update(payload.join("\n")).digest("hex");
}

export function buildUrgentTelegramMessage(items) {
  const lines = [
    "Ava — URGENT / needs you",
    `(personal Telegram · ${new Date().toISOString()})`,
    "",
  ];
  let n = 0;
  for (const it of items) {
    n += 1;
    lines.push(`${n}. [${String(it.priority).toUpperCase()}] ${it.title}`);
    if (it.detail) lines.push(`   ${it.detail}`);
  }
  lines.push("");
  lines.push("I won't re-ping this same list until something changes.");
  lines.push("— Ava");
  return lines.join("\n");
}

async function telegramSend(token, chatId, text) {
  const chunks = [];
  let rest = String(text || "");
  while (rest.length) {
    if (rest.length <= 4000) {
      chunks.push(rest);
      break;
    }
    let cut = rest.lastIndexOf("\n\n", 3800);
    if (cut < 1500) cut = rest.lastIndexOf("\n", 3800);
    if (cut < 1500) cut = 3800;
    chunks.push(rest.slice(0, cut));
    rest = rest.slice(cut).trimStart();
  }
  let first = null;
  for (const c of chunks) {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text: c,
        disable_web_page_preview: true,
      }),
    });
    const data = await res.json();
    if (!data.ok) throw new Error(data.description || "telegram_send_failed");
    if (!first) first = data.result;
    await new Promise((r) => setTimeout(r, 300));
  }
  return first;
}

/**
 * @param {{ force?: boolean, env?: object }} opts
 * @returns {Promise<{ sent: boolean, reason: string, count: number, fingerprint?: string }>}
 */
export async function runUrgentTelegramAlert(opts = {}) {
  try {
    const { isLockoutActive } = await import("./lockoutMode.mjs");
    if (isLockoutActive() && !opts.force) {
      return { sent: false, reason: "lockout_quiet", count: 0 };
    }
  } catch {
    /* ignore */
  }
  const env = opts.env || (await loadEnv());
  const token = telegramBotToken(env);
  const chatId = operatorChatId(env);

  if (!token || !chatId) {
    return { sent: false, reason: "telegram_not_configured", count: 0 };
  }

  const items = collectUrgentItems();
  const fp = fingerprintUrgent(items);
  const state = loadState();

  if (!items.length) {
    // Clear fingerprint so a future new item alerts again cleanly
    if (state.lastFingerprint) {
      saveState({
        ...state,
        lastFingerprint: "",
        lastItemKeys: [],
        lastText: "",
        clearedAt: Date.now(),
      });
    }
    appendAction("urgentTelegram.quiet", { count: 0 });
    return { sent: false, reason: "nothing_urgent", count: 0 };
  }

  if (!opts.force && fp === state.lastFingerprint) {
    appendAction("urgentTelegram.unchanged", { count: items.length, fp });
    return {
      sent: false,
      reason: "unchanged",
      count: items.length,
      fingerprint: fp,
    };
  }

  const text = buildUrgentTelegramMessage(items);
  await telegramSend(token, chatId, text);

  saveState({
    lastFingerprint: fp,
    lastSentAt: Date.now(),
    lastItemKeys: items.map((i) => i.key),
    lastText: text.slice(0, 2000),
    lastCount: items.length,
  });

  appendAction("urgentTelegram.sent", {
    count: items.length,
    fp,
    keys: items.map((i) => i.key),
  });
  pushStatusEvent(`urgent telegram · ${items.length} item(s)`);

  return { sent: true, reason: "sent", count: items.length, fingerprint: fp };
}

/** Mark a registry item done (id without reg: prefix). */
export function resolveUrgentRegistryItem(id, note = "") {
  const reg = loadRegistry();
  const item = (reg.items || []).find((x) => x.id === id);
  if (!item) return false;
  item.status = "done";
  item.resolvedAt = Date.now();
  if (note) item.resolveNote = String(note).slice(0, 300);
  reg.updatedAt = Date.now();
  fs.writeFileSync(registryPath(), JSON.stringify(reg, null, 2), "utf8");
  // Force next digest to recompute as changed
  const state = loadState();
  saveState({ ...state, lastFingerprint: "" });
  return true;
}
