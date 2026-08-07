/**
 * Overload / peak-activity safe mode ("sweater on").
 * Auto-triggers when queues + demand spike. Ava still saves everything,
 * but only digs / talks deeply with people she truly trusts until cool-down.
 */
import fs from "node:fs";
import path from "node:path";
import { storePaths } from "./store.mjs";
import { AVA_HANDOFF, AVA_CHANNELS, botToken } from "./config.mjs";
import { brainQueueDepth, cursorSlots } from "./cursorBrain.mjs";
import { personByAuthorId } from "./people.mjs";
import { loadPlayerProfile } from "./playerProfiles.mjs";
import { isQuietOperator } from "./recommend.mjs";
import { postMessageWithFiles } from "./postWithFiles.mjs";
import { appEmoji } from "./appEmojis.mjs";
import { appendAction } from "./fullLog.mjs";
import { pushStatusEvent } from "./store.mjs";

const WINDOW_MS = 5 * 60_000;
const COOL_MS = 2 * 60_000;
const CHILL_COOLDOWN_MS = 3 * 60_000;

/** Recent addressed askers: { id, at, isNew } */
const recentAskers = [];
/** channelId → last chill reply at */
const chillSaidAt = new Map();

function statePath() {
  return path.join(storePaths().dir, "overload-safe-mode.json");
}

function loadState() {
  try {
    if (!fs.existsSync(statePath())) {
      return { active: false, enteredAt: 0, reason: "", announcedAt: 0, cooledSince: 0 };
    }
    return JSON.parse(fs.readFileSync(statePath(), "utf8"));
  } catch {
    return { active: false, enteredAt: 0, reason: "", announcedAt: 0, cooledSince: 0 };
  }
}

function saveState(s) {
  fs.mkdirSync(path.dirname(statePath()), { recursive: true });
  fs.writeFileSync(statePath(), JSON.stringify(s, null, 2), "utf8");
}

function numEnv(key, fallback) {
  const n = Number(process.env[key]);
  return Number.isFinite(n) ? n : fallback;
}

function peakVideoPath() {
  const fromEnv = String(process.env.AVA_PEAK_ACTIVITY_VIDEO || "").trim();
  if (fromEnv && fs.existsSync(fromEnv)) return fromEnv;
  const handoff = path.join(AVA_HANDOFF, "appearance", "peakactivity.mp4");
  if (fs.existsSync(handoff)) return handoff;
  const home = process.env.HOME || process.env.USERPROFILE || "";
  if (home) {
    const downloads = path.join(home, "Downloads", "peakactivity.mp4");
    if (fs.existsSync(downloads)) return downloads;
  }
  return "";
}

function pruneAskers(now = Date.now()) {
  while (recentAskers.length && now - recentAskers[0].at > WINDOW_MS) {
    recentAskers.shift();
  }
}

/** Call whenever someone addresses Ava (Discord or Slack). */
export function noteSafeModeDemand({
  authorId,
  username,
  channelId,
  busyChannelCount = 0,
} = {}) {
  const id = String(authorId || "");
  if (!id) return evaluateSafeMode({ busyChannelCount });
  const now = Date.now();
  pruneAskers(now);
  const profile = loadPlayerProfile(id);
  const isNew =
    !profile ||
    (profile.seenCount || 0) <= 2 ||
    (profile.firstSeenAt && now - profile.firstSeenAt < WINDOW_MS);
  recentAskers.push({
    id,
    at: now,
    isNew: Boolean(isNew),
    username: username || "",
    channelId: channelId || "",
  });
  return evaluateSafeMode({ busyChannelCount });
}

export function isTrulyTrusted(authorId) {
  const id = String(authorId || "");
  if (!id) return false;
  if (isQuietOperator(id)) return true; // Alex + Melee + Slack/Telegram ops
  const known = personByAuthorId(id);
  if (known?.id === "zuppafredda") return false; // staff, but not full trust yet
  if (
    known &&
    (known.roles || []).some((r) =>
      ["owner", "operator", "trusted", "emergency-stop"].includes(r),
    )
  ) {
    return true;
  }
  const profile = loadPlayerProfile(id);
  if (!profile) return false;
  const trust = Number(profile.trust) || 50;
  const rudeness = Number(profile.rudeness) || 0;
  return trust >= 85 && rudeness < 15 && (profile.seenCount || 0) >= 8;
}

export function isSafeModeActive() {
  return Boolean(loadState().active);
}

export function safeModeSnapshot() {
  const s = loadState();
  pruneAskers();
  const unique = new Set(recentAskers.map((a) => a.id));
  const newOnes = new Set(recentAskers.filter((a) => a.isNew).map((a) => a.id));
  const slots = cursorSlots();
  return {
    active: Boolean(s.active),
    reason: s.reason || "",
    enteredAt: s.enteredAt || 0,
    asksOpen: brainQueueDepth(),
    waiting: slots.waiting,
    uniqueAskers5m: unique.size,
    newAskers5m: newOnes.size,
  };
}

function shouldEnter({ busyChannelCount = 0 } = {}) {
  pruneAskers();
  const slots = cursorSlots();
  const asks = brainQueueDepth();
  const unique = new Set(recentAskers.map((a) => a.id)).size;
  const newOnes = new Set(recentAskers.filter((a) => a.isNew).map((a) => a.id)).size;
  const minAsks = numEnv("AVA_SAFE_MODE_ASKS", 2);
  const minWait = numEnv("AVA_SAFE_MODE_WAITING", 2);
  const minUnique = numEnv("AVA_SAFE_MODE_UNIQUE", 5);
  const minNew = numEnv("AVA_SAFE_MODE_NEW", 3);
  const minBusy = numEnv("AVA_SAFE_MODE_BUSY", 3);

  if (asks >= minAsks + 1) {
    return `asksOpen=${asks}`;
  }
  if (slots.waiting >= minWait && asks >= 1) {
    return `waiting=${slots.waiting} asks=${asks}`;
  }
  if (unique >= minUnique) {
    return `uniqueAskers5m=${unique}`;
  }
  if (newOnes >= minNew && unique >= minNew) {
    return `newAskers5m=${newOnes}`;
  }
  if (busyChannelCount >= minBusy && unique >= 3) {
    return `busyChannels=${busyChannelCount} unique=${unique}`;
  }
  return "";
}

function isCooled({ busyChannelCount = 0 } = {}) {
  pruneAskers();
  const slots = cursorSlots();
  const unique = new Set(recentAskers.map((a) => a.id)).size;
  return (
    brainQueueDepth() === 0 &&
    slots.waiting === 0 &&
    unique < 3 &&
    busyChannelCount <= 1
  );
}

/**
 * Evaluate enter/exit. Does not announce — caller may call maybeAnnounceSafeMode.
 */
export function evaluateSafeMode({ busyChannelCount = 0 } = {}) {
  const state = loadState();
  const now = Date.now();
  const enterReason = shouldEnter({ busyChannelCount });

  if (!state.active && enterReason) {
    const next = {
      ...state,
      active: true,
      enteredAt: now,
      reason: enterReason,
      cooledSince: 0,
    };
    saveState(next);
    appendAction("safeMode.enter", { reason: enterReason });
    pushStatusEvent(`safe-mode ON · ${enterReason}`);
    return { ...next, justEntered: true, justExited: false };
  }

  if (state.active) {
    if (isCooled({ busyChannelCount })) {
      if (!state.cooledSince) {
        const next = { ...state, cooledSince: now };
        saveState(next);
        return { ...next, justEntered: false, justExited: false };
      }
      if (now - state.cooledSince >= COOL_MS) {
        const next = {
          active: false,
          enteredAt: 0,
          reason: "",
          announcedAt: state.announcedAt || 0,
          cooledSince: 0,
          exitedAt: now,
        };
        saveState(next);
        appendAction("safeMode.exit", {});
        pushStatusEvent("safe-mode OFF · cooled");
        return { ...next, justEntered: false, justExited: true };
      }
    } else if (state.cooledSince) {
      const next = { ...state, cooledSince: 0 };
      saveState(next);
      return { ...next, justEntered: false, justExited: false };
    }
  }

  return { ...state, justEntered: false, justExited: false };
}

export function chillReplyText() {
  const hush = appEmoji("ava_hush");
  const wave = appEmoji("ava_wave");
  return [
    `${hush || ""} hey — i'm overloaded rn.`,
    "",
    "sweater on, headphones in, tuning in. still **saving everything** you send — nothing's ignored — but i can only dig with people i **truly trust** until the queue cools.",
    "",
    "chill for a bit. give me time to think. i'll come up for air when i can keep up again.",
    "",
    `${wave || ""} — Ava`,
  ].join("\n");
}

export function shouldSendChillReply(channelId) {
  const ch = String(channelId || "");
  if (!ch) return false;
  const last = chillSaidAt.get(ch) || 0;
  return Date.now() - last >= CHILL_COOLDOWN_MS;
}

export function markChillReplySent(channelId) {
  chillSaidAt.set(String(channelId || ""), Date.now());
}

/**
 * Announce sweater/headphones lore with peakactivity.mp4 (once per enter).
 */
export async function maybeAnnounceSafeMode(env, { force = false } = {}) {
  const state = loadState();
  if (!state.active) return { ok: false, reason: "inactive" };
  if (!force && state.announcedAt && state.announcedAt >= state.enteredAt) {
    return { ok: false, reason: "already_announced" };
  }
  const token = botToken(env || {});
  if (!token) return { ok: false, reason: "no_token" };

  const video = peakVideoPath();
  const content = [
    `${appEmoji("ava_hush") || ""} **peak activity — sweater mode**`,
    "",
    "too many asks piling up. i'm putting my **sweater** on, **headphones** in, and tuning in for a bit.",
    "",
    "still saving **everything** — every ping, every file. but until this cools, i only dig with people i **truly trust**.",
    "",
    "everyone else: chill. give me space to think. i'll be back when i can keep up.",
    "",
    "— Ava",
  ].join("\n");

  const channels = [
    AVA_CHANNELS.general || "1516108586307158088",
    AVA_CHANNELS.updates || "1520665313631408251",
  ];
  const posted = [];
  for (const channel of channels) {
    try {
      const msg = await postMessageWithFiles(
        token,
        channel,
        content,
        video ? [video] : [],
      );
      posted.push({ channel, id: msg?.id });
    } catch (err) {
      console.warn("safe-mode announce:", channel, err.message);
    }
  }
  const next = { ...state, announcedAt: Date.now() };
  saveState(next);
  appendAction("safeMode.announce", { posted, hasVideo: Boolean(video) });
  return { ok: true, posted, video: Boolean(video) };
}

/** Operator force clear (optional). */
export function clearSafeMode(reason = "operator") {
  const next = {
    active: false,
    enteredAt: 0,
    reason: "",
    announcedAt: loadState().announcedAt || 0,
    cooledSince: 0,
    exitedAt: Date.now(),
    clearReason: reason,
  };
  saveState(next);
  appendAction("safeMode.clear", { reason });
  pushStatusEvent(`safe-mode cleared · ${reason}`);
  return next;
}
