/**
 * In-game join lookout — RCON + Discord bridge.
 * Template welcomes for *new* players (no AI). Metrics tracked locally.
 *
 * Sources:
 *  1) #ingame-chat bridge embeds (kind=join) — primary
 *  2) RCON `list` name delta — backup when bridge lags
 *
 * Disable: AVA_INGAME_JOIN_WELCOME=0
 */
import fs from "node:fs";
import path from "node:path";
import { AVA_CHANNELS, botToken, loadEnv } from "./config.mjs";
import { makeFetchJson } from "./discordApi.mjs";
import { recordAvaUtterance, appendAction } from "./fullLog.mjs";
import { parseBridgeMessage } from "./ingameChatAssist.mjs";
import { observeMinecraftLine } from "./playerProfiles.mjs";
import { guardedRcon, rconConfigured, rconTargets } from "./rconGuard.mjs";
import { isEmergencyStopped } from "./emergencyStop.mjs";
import { isHushed, storePaths, pushStatusEvent } from "./store.mjs";
import { isPoweredOff } from "./powerDown.mjs";
import { isLockoutActive } from "./lockoutMode.mjs";

const INGAME_CHAT_CHANNEL =
  AVA_CHANNELS.ingameChat ||
  String(process.env.AVA_INGAME_CHAT_CHANNEL_ID || "").trim() ||
  "1516706598519832677";

const WELCOME_TEMPLATES = [
  "hey {name}! welcome to RootMC — i'm Ava. /link Discord when you can · map.rootmc.net · have fun out there!",
  "hi {name}! you made it to RootMC. i'm Ava (lead-dev). tip: /link for Discord · https://rootmc.net/wiki/ if you get stuck. glad you're here!",
  "welcome aboard, {name}! RootMC's happy to have you. i'm Ava — try /ava army in-game, or ask in chat. map: map.rootmc.net",
  "hey hey {name}! fresh boots on RootMC. i'm Ava. /link Discord · /ava army · map.rootmc.net — go make something cool!",
];

export function joinWelcomeEnabled() {
  const v = String(process.env.AVA_INGAME_JOIN_WELCOME || "1").trim();
  return !(v === "0" || /^false$/i.test(v) || /^off$/i.test(v));
}

/** Default ~45s — welcomes should feel quick. */
export function joinWelcomeIntervalMs() {
  const n = Number(process.env.AVA_INGAME_JOIN_MS || 45_000);
  return Number.isFinite(n) && n >= 15_000 ? n : 45_000;
}

export function joinWelcomeBootDelayMs() {
  const n = Number(process.env.AVA_INGAME_JOIN_BOOT_MS || 25_000);
  return Number.isFinite(n) && n >= 5_000 ? n : 25_000;
}

function metricsPath() {
  return path.join(storePaths().dir, "ingame-join-metrics.json");
}

function defaultMetrics() {
  return {
    id: "ingame-join-metrics-v1",
    updatedAt: null,
    lastMessageId: null,
    joinsSeen: 0,
    newPlayers: 0,
    welcomesSent: 0,
    returningJoins: 0,
    rconDeltaJoins: 0,
    lastJoinAt: null,
    lastWelcomeAt: null,
    lastJoinName: null,
    onlineByTarget: {},
    welcomed: {},
    seen: {},
  };
}

function loadMetrics() {
  try {
    if (!fs.existsSync(metricsPath())) return defaultMetrics();
    return { ...defaultMetrics(), ...JSON.parse(fs.readFileSync(metricsPath(), "utf8")) };
  } catch {
    return defaultMetrics();
  }
}

function saveMetrics(m) {
  m.updatedAt = new Date().toISOString();
  fs.mkdirSync(path.dirname(metricsPath()), { recursive: true });
  // Cap maps so file stays small
  for (const key of ["welcomed", "seen"]) {
    const obj = m[key] && typeof m[key] === "object" ? m[key] : {};
    const entries = Object.entries(obj).sort((a, b) => (b[1] || 0) - (a[1] || 0));
    m[key] = Object.fromEntries(entries.slice(0, 2000));
  }
  fs.writeFileSync(metricsPath(), JSON.stringify(m, null, 2), "utf8");
}

function sanitizePlayerName(name) {
  const n = String(name || "").trim();
  if (!/^[A-Za-z0-9_]{1,16}$/.test(n)) return null;
  return n;
}

function sanitizeTellBody(text) {
  return String(text || "")
    .replace(/[\r\n\t]+/g, " ")
    .replace(/§./g, "")
    .replace(/["`]/g, "'")
    .slice(0, 200)
    .trim();
}

function keyName(name) {
  return String(name || "").toLowerCase();
}

function pickWelcome(name) {
  const tpl =
    WELCOME_TEMPLATES[Math.floor(Math.random() * WELCOME_TEMPLATES.length)] ||
    WELCOME_TEMPLATES[0];
  return sanitizeTellBody(tpl.replace(/\{name\}/gi, name));
}

function isNewPlayer(metrics, name) {
  const k = keyName(name);
  if (metrics.welcomed?.[k]) return false;
  if (metrics.seen?.[k]) return false;
  // Minecraft profile file = returning to Ava
  try {
    const safe = String(name).replace(/[^A-Za-z0-9_]/g, "").slice(0, 16);
    const p = path.join(storePaths().dir, "players", `mc-${safe}.json`);
    if (fs.existsSync(p)) {
      const raw = JSON.parse(fs.readFileSync(p, "utf8"));
      if (raw?.seenCount > 0 || raw?.welcomedAt) return false;
    }
  } catch {
    /* treat as new */
  }
  return true;
}

async function tellPlayer(target, username, body) {
  const name = sanitizePlayerName(username);
  const msg = sanitizeTellBody(body);
  if (!name || !msg) return { ok: false, reason: "bad_args" };
  return guardedRcon(`tell ${name} ${msg}`, { allow: true, target });
}

async function listOnlineNames(target) {
  const res = await guardedRcon("list", { allow: true, target });
  if (!res.ok) return null;
  const body = String(res.output || "");
  const m = body.match(/:\s*(.+)$/s);
  if (!m) return [];
  return m[1]
    .split(/,|\n/)
    .map((s) => s.trim())
    .filter((s) => /^[A-Za-z0-9_]{1,16}$/.test(s));
}

function isOperatorMc(name) {
  const set = new Set(
    String(process.env.AVA_OPERATOR_MC_NAMES || "Alexrs94,Melee")
      .split(/[,;\s]+/)
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
  );
  return set.has(keyName(name));
}

const OPERATOR_PULSE = [
  "hey {name} — Watch pulse: im with you. /ava tip · /ava pulse · /ava army · /ava rollcall when 1.8.3 is live. - Ava",
  "welcome back {name}. Relations says hi. army ideas cooking — /ava army. - Ava",
  "{name}! Continuity checked in. clocks are running. try /ava pulse · /ava rollcall. - Ava",
];

async function maybeOperatorPulse(name, target, metrics) {
  if (!isOperatorMc(name) || !rconConfigured()) return { sent: false };
  metrics.operatorPulse = metrics.operatorPulse || {};
  const k = keyName(name);
  const last = Number(metrics.operatorPulse[k] || 0);
  // Once per 6 hours
  if (Date.now() - last < 6 * 60 * 60 * 1000) return { sent: false };
  const tpl = OPERATOR_PULSE[Math.floor(Math.random() * OPERATOR_PULSE.length)];
  const body = sanitizeTellBody(tpl.replace(/\{name\}/gi, name));
  const sent = await tellPlayer(target, name, body);
  if (!sent.ok) return { sent: false, reason: sent.reason };
  metrics.operatorPulse[k] = Date.now();
  pushStatusEvent(`operator pulse · ${name} · ${target}`);
  await recordAvaUtterance({
    surface: "minecraft",
    channelId: `rcon:${target}`,
    content: body,
    kind: "ingame_operator_pulse",
    source: "ingame_join_welcome",
    meta: { player: name },
  });
  return { sent: true };
}

/**
 * @param {{ name: string, target: string, source: string, at?: number }} join
 * @param {object} metrics
 * @param {object} env
 */
async function handleJoin(join, metrics, env) {
  const name = sanitizePlayerName(join.name);
  if (!name) return { welcomed: false, reason: "bad_name" };
  const k = keyName(name);
  const now = Date.now();
  const target =
    rconTargets().some((t) => t.id === join.target) ? join.target : "claims";

  metrics.joinsSeen = (metrics.joinsSeen || 0) + 1;
  metrics.lastJoinAt = new Date(now).toISOString();
  metrics.lastJoinName = name;

  const neu = isNewPlayer(metrics, name);
  metrics.seen = metrics.seen || {};
  const alreadySeen = Boolean(metrics.seen[k]);
  metrics.seen[k] = now;

  observeMinecraftLine({
    minecraftName: name,
    text: `[join] via ${join.source}`,
    server: target,
    source: "ingame_join",
  });

  if (!neu) {
    metrics.returningJoins = (metrics.returningJoins || 0) + 1;
    // Operator session pulse — Ava's own idea (Relations/Watch)
    const pulse = await maybeOperatorPulse(name, target, metrics);
    return {
      welcomed: false,
      reason: pulse.sent ? "returning_pulsed" : "returning",
      name,
      target,
      pulsed: pulse.sent,
    };
  }

  // Dedup: already welcomed this session/lifetime
  if (metrics.welcomed?.[k]) {
    return { welcomed: false, reason: "already_welcomed", name, target };
  }

  if (!rconConfigured()) {
    metrics.newPlayers = (metrics.newPlayers || 0) + 1;
    return { welcomed: false, reason: "rcon_not_configured", name, target, isNew: true };
  }

  const body = pickWelcome(name);
  const sent = await tellPlayer(target, name, body);
  if (!sent.ok) {
    console.warn("joinWelcome tell:", sent.reason, name);
    return { welcomed: false, reason: sent.reason || "tell_failed", name, target, isNew: true };
  }

  metrics.newPlayers = (metrics.newPlayers || 0) + 1;
  metrics.welcomesSent = (metrics.welcomesSent || 0) + 1;
  metrics.lastWelcomeAt = new Date(now).toISOString();
  metrics.welcomed = metrics.welcomed || {};
  metrics.welcomed[k] = now;
  if (join.source === "rcon_list") {
    metrics.rconDeltaJoins = (metrics.rconDeltaJoins || 0) + 1;
  }

  await recordAvaUtterance({
    surface: "minecraft",
    channelId: `rcon:${target}`,
    content: body,
    kind: "ingame_join_welcome",
    source: "ingame_join_welcome",
    meta: { player: name, joinSource: join.source, serverTag: join.serverTag || target },
  });

  pushStatusEvent(`join welcome · ${name} · ${target}`);
  appendAction("ingameJoinWelcome.sent", {
    name,
    target,
    source: join.source,
    alreadySeen,
  });

  return { welcomed: true, name, target, body };
}

async function scanBridgeJoins(metrics, env) {
  const token = botToken(env);
  if (!token) return { joins: [], newestId: metrics.lastMessageId };

  const fetchJson = makeFetchJson(token);
  const qs = new URLSearchParams({ limit: "30" });
  if (metrics.lastMessageId) qs.set("after", String(metrics.lastMessageId));

  let messages = [];
  try {
    messages = await fetchJson(
      `/channels/${encodeURIComponent(INGAME_CHAT_CHANNEL)}/messages?${qs}`,
    );
  } catch (err) {
    console.warn("joinWelcome fetch:", err.message);
    return { joins: [], newestId: metrics.lastMessageId };
  }

  const rows = Array.isArray(messages) ? [...messages].reverse() : [];
  let newestId = metrics.lastMessageId;
  /** @type {{ name: string, target: string, source: string, serverTag?: string }[]} */
  const joins = [];

  for (const msg of rows) {
    if (!msg?.id) continue;
    newestId = msg.id;
    const line = parseBridgeMessage(msg);
    if (!line) continue;
    if (line.kind !== "join") continue;
    joins.push({
      name: line.username,
      target: line.target,
      source: "bridge",
      serverTag: line.serverTag,
    });
  }

  return { joins, newestId };
}

async function scanRconDeltas(metrics) {
  if (!rconConfigured()) return [];
  const joins = [];
  metrics.onlineByTarget = metrics.onlineByTarget || {};

  for (const t of rconTargets()) {
    const names = await listOnlineNames(t.id);
    if (!Array.isArray(names)) continue;
    const prev = Array.isArray(metrics.onlineByTarget[t.id])
      ? metrics.onlineByTarget[t.id]
      : [];
    const prevSet = new Set(prev.map((n) => keyName(n)));
    // First successful list after boot: seed only, don't welcome everyone online
    const seeded = prev.length > 0 || metrics.onlineByTarget[`_seeded_${t.id}`];
    if (!seeded) {
      metrics.onlineByTarget[t.id] = names;
      metrics.onlineByTarget[`_seeded_${t.id}`] = true;
      continue;
    }
    for (const name of names) {
      if (!prevSet.has(keyName(name))) {
        joins.push({ name, target: t.id, source: "rcon_list" });
      }
    }
    metrics.onlineByTarget[t.id] = names;
  }
  return joins;
}

/**
 * One pass: bridge joins + RCON list deltas → welcome new players (template).
 */
export async function runIngameJoinWelcome({ env: envIn, force = false } = {}) {
  if (!joinWelcomeEnabled()) {
    return { ok: true, welcomed: 0, silent: true, reason: "disabled" };
  }
  if (isPoweredOff() || isHushed() || isLockoutActive() || isEmergencyStopped()) {
    return { ok: true, welcomed: 0, silent: true, reason: "muted" };
  }

  const env = envIn || (await loadEnv());
  const metrics = loadMetrics();
  const now = Date.now();
  if (
    !force &&
    metrics._lastRunAt &&
    now - metrics._lastRunAt < joinWelcomeIntervalMs() * 0.8
  ) {
    return { ok: true, welcomed: 0, silent: true, reason: "throttle" };
  }
  metrics._lastRunAt = now;

  const { joins: bridgeJoins, newestId } = await scanBridgeJoins(metrics, env);
  if (newestId) metrics.lastMessageId = newestId;

  const rconJoins = await scanRconDeltas(metrics);

  // Dedup by name+target for this batch (bridge wins over rcon for same name)
  const seenBatch = new Set();
  const batch = [];
  for (const j of [...bridgeJoins, ...rconJoins]) {
    const name = sanitizePlayerName(j.name);
    if (!name) continue;
    const dk = `${keyName(name)}:${j.target || "claims"}`;
    if (seenBatch.has(dk)) continue;
    seenBatch.add(dk);
    batch.push({ ...j, name });
  }

  let welcomed = 0;
  for (const j of batch) {
    const r = await handleJoin(j, metrics, env);
    if (r.welcomed) welcomed += 1;
  }

  saveMetrics(metrics);
  return {
    ok: true,
    scanned: batch.length,
    welcomed,
    silent: welcomed === 0,
    reason: welcomed ? "welcomed" : batch.length ? "no_new" : "quiet",
    metrics: summarizeJoinMetrics(metrics),
  };
}

export function summarizeJoinMetrics(m = null) {
  const metrics = m || loadMetrics();
  return {
    joinsSeen: metrics.joinsSeen || 0,
    newPlayers: metrics.newPlayers || 0,
    welcomesSent: metrics.welcomesSent || 0,
    returningJoins: metrics.returningJoins || 0,
    lastJoinAt: metrics.lastJoinAt || null,
    lastJoinName: metrics.lastJoinName || null,
    lastWelcomeAt: metrics.lastWelcomeAt || null,
  };
}

export function gatherIngameJoinBrief() {
  const s = summarizeJoinMetrics();
  return {
    brief: `### In-game join metrics (Ava lookout)
joins seen: ${s.joinsSeen}
new players (welcomed lane): ${s.newPlayers}
welcomes sent: ${s.welcomesSent}
returning joins: ${s.returningJoins}
last join: ${s.lastJoinName || "—"} @ ${s.lastJoinAt || "—"}
template welcomes only (no AI per join).`,
  };
}
