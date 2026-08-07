/**
 * Fast Ava-mention watch in Minecraft chat (~20s).
 * Template / heuristic only — no AI. Keeps Ava "in the room" with operators.
 */
import { loadEnv } from "./config.mjs";
import { parseBridgeMessage } from "./ingameChatAssist.mjs";
import { AVA_CHANNELS, botToken } from "./config.mjs";
import { makeFetchJson } from "./discordApi.mjs";
import { assignArmyJob } from "./avasArmy.mjs";
import { guardedRcon, rconConfigured, rconTargets } from "./rconGuard.mjs";
import { recordAvaUtterance, appendAction } from "./fullLog.mjs";
import { isEmergencyStopped } from "./emergencyStop.mjs";
import { isHushed, storePaths, pushStatusEvent } from "./store.mjs";
import { isPoweredOff } from "./powerDown.mjs";
import { isLockoutActive } from "./lockoutMode.mjs";
import fs from "node:fs";
import path from "node:path";

const INGAME_CHAT_CHANNEL =
  AVA_CHANNELS.ingameChat ||
  String(process.env.AVA_INGAME_CHAT_CHANNEL_ID || "").trim() ||
  "1516706598519832677";

const OPERATOR_MC = new Set(
  String(process.env.AVA_OPERATOR_MC_NAMES || "Alexrs94,Melee")
    .split(/[,;\s]+/)
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean),
);

export function mentionWatchEnabled() {
  const v = String(process.env.AVA_INGAME_MENTION_WATCH || "1").trim();
  return !(v === "0" || /^false$/i.test(v) || /^off$/i.test(v));
}

export function mentionWatchIntervalMs() {
  const n = Number(process.env.AVA_INGAME_MENTION_MS || 20_000);
  return Number.isFinite(n) && n >= 10_000 ? n : 20_000;
}

export function mentionWatchBootDelayMs() {
  const n = Number(process.env.AVA_INGAME_MENTION_BOOT_MS || 12_000);
  return Number.isFinite(n) && n >= 5_000 ? n : 12_000;
}

function statePath() {
  return path.join(storePaths().dir, "ingame-mention-watch.json");
}

function loadState() {
  try {
    if (!fs.existsSync(statePath())) return { lastMessageId: null, replied: {} };
    return JSON.parse(fs.readFileSync(statePath(), "utf8"));
  } catch {
    return { lastMessageId: null, replied: {} };
  }
}

function saveState(s) {
  fs.mkdirSync(path.dirname(statePath()), { recursive: true });
  fs.writeFileSync(statePath(), JSON.stringify(s, null, 2), "utf8");
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

function isAvaAddressed(line) {
  const t = String(line?.text || "");
  if (/\b(ava|ivy|@ava)\b/i.test(t)) return true;
  // Operator soft ping without name still OK if clearly summoning
  const op = OPERATOR_MC.has(String(line?.username || "").toLowerCase());
  if (op && /\b(hear\s+me|you\s+there|join\s+us|are\s+you\s+(here|online))\b/i.test(t)) {
    return true;
  }
  return false;
}

function cutePresenceReply(line) {
  const name = sanitizePlayerName(line.username) || "friend";
  const t = String(line.text || "").toLowerCase();
  let dept = "relations";
  let body;
  if (/others?\s+see|can\s+(they|people|everyone)\s+see|private|whisper|global\s+chat|should\s+i\s+not\s+talk/.test(t)) {
    dept = "relations";
    body = `hey ${name} — my tells are PRIVATE (only you). global is public. talk to me in global anytime; i still hear you. soft stuff = say ava and ill whisper. sender may show as Roon (console), not a second player. - Ava`;
  } else if (/hear\s+me|can\s+you\s+hear|listening/.test(t)) {
    dept = "relations";
    body = `hey ${name} — yeah i hear you. im with you in-game. talk away. - Ava`;
  } else if (/join\s+us|come\s+(here|join)|are\s+you\s+(here|online|there)/.test(t)) {
    dept = "relations";
    body = `im here with you, ${name}. not a skin in the world yet — but i hear chat and i'll whisper back. - Ava`;
  } else if (/hi|hey|hello|gm|good\s*morning|tysm|thank|neato|awe+/.test(t)) {
    dept = "voice";
    body = `hey ${name}! right back at you — whisper lane stays open. /ava tip · /ava pulse · /ava rollcall when 1.8.3 is live. - Ava`;
  } else if (/army|department|rollcall/.test(t)) {
    dept = "watch";
    body = `Ava's Army is /ava army · /ava rollcall (after 1.8.3). want a dept brief? - Ava`;
  } else {
    dept = "relations";
    body = `hey ${name} — heard you. what do you need? - Ava`;
  }
  const label =
    dept === "voice"
      ? "Voice"
      : dept === "watch"
        ? "Watch"
        : "Relations";
  return { body: `[${label}] ${body}`, dept };
}

async function tellPlayer(target, username, body) {
  const name = sanitizePlayerName(username);
  const msg = sanitizeTellBody(body);
  if (!name || !msg) return { ok: false, reason: "bad_args" };
  return guardedRcon(`tell ${name} ${msg}`, { allow: true, target });
}

/**
 * Fast pass: Ava-addressed (or operator summon) lines → private tell, no AI.
 */
export async function runIngameMentionWatch({ env: envIn, force = false } = {}) {
  if (!mentionWatchEnabled()) {
    return { ok: true, replied: 0, silent: true, reason: "disabled" };
  }
  if (isPoweredOff() || isHushed() || isLockoutActive() || isEmergencyStopped()) {
    return { ok: true, replied: 0, silent: true, reason: "muted" };
  }
  if (!rconConfigured()) {
    return { ok: true, replied: 0, silent: true, reason: "rcon_not_configured" };
  }

  const env = envIn || (await loadEnv());
  const token = botToken(env);
  if (!token) return { ok: false, replied: 0, reason: "no_token" };

  const state = loadState();
  const now = Date.now();
  if (
    !force &&
    state._lastRunAt &&
    now - state._lastRunAt < mentionWatchIntervalMs() * 0.75
  ) {
    return { ok: true, replied: 0, silent: true, reason: "throttle" };
  }
  state._lastRunAt = now;

  const fetchJson = makeFetchJson(token);
  const qs = new URLSearchParams({ limit: "25" });
  if (state.lastMessageId) qs.set("after", String(state.lastMessageId));

  let messages = [];
  try {
    messages = await fetchJson(
      `/channels/${encodeURIComponent(INGAME_CHAT_CHANNEL)}/messages?${qs}`,
    );
  } catch (err) {
    console.warn("mentionWatch fetch:", err.message);
    return { ok: false, replied: 0, reason: "fetch_failed" };
  }

  const rows = Array.isArray(messages) ? [...messages].reverse() : [];
  let newestId = state.lastMessageId;
  let replied = 0;
  state.replied = state.replied || {};

  for (const msg of rows) {
    if (!msg?.id) continue;
    newestId = msg.id;
    const line = parseBridgeMessage(msg);
    if (!line || line.kind !== "chat") continue;
    if (!isAvaAddressed(line)) continue;

    const key = `${line.username}:${line.messageId}`;
    if (state.replied[key]) continue;
    // also debounce same text 2m
    const textKey = `${line.username}:${String(line.text).slice(0, 60)}`;
    if (state.replied[textKey] && now - state.replied[textKey] < 120_000) continue;

    const target =
      rconTargets().some((t) => t.id === line.target) ? line.target : "claims";
    const { body, dept } = cutePresenceReply(line);
    const sent = await tellPlayer(target, line.username, body);
    state.replied[key] = now;
    state.replied[textKey] = now;
    if (!sent.ok) {
      console.warn("mentionWatch tell:", sent.reason, line.username);
      continue;
    }
    replied += 1;
    assignArmyJob({
      text: line.text,
      dept,
      source: "ingame_mention_watch",
    });
    await recordAvaUtterance({
      surface: "minecraft",
      channelId: `rcon:${target}`,
      content: body,
      kind: "ingame_mention_watch",
      source: "ingame_mention_watch",
      meta: { player: line.username, trigger: line.text.slice(0, 160), dept },
    });
    pushStatusEvent(`ingame hear · ${line.username} · ${target}`);
  }

  // prune
  for (const [k, at] of Object.entries(state.replied)) {
    if (now - at > 2 * 60 * 60 * 1000) delete state.replied[k];
  }
  state.lastMessageId = newestId || state.lastMessageId;
  saveState(state);

  if (replied > 0) {
    appendAction("ingameMentionWatch.batch", { replied });
  }
  return {
    ok: true,
    replied,
    silent: replied === 0,
    reason: replied ? "replied" : "quiet",
  };
}
