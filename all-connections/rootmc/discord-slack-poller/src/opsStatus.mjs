/**
 * Public ops status for status/solar pages — Lockout, hush, brain mode, heartbeat mode.
 * Mood on the solar board = her ops mode (not battery SOC).
 * Mood is remembered in mood.json so power-down → boot restores lockout companion.
 */
import { isLockoutActive } from "./lockoutMode.mjs";
import { isHushed, loadHeartbeat } from "./store.mjs";
import { isAsleep } from "./sleepMode.mjs";
import { isPoweredOff } from "./powerDown.mjs";
import { getModeStatus, modeLabel } from "./brainModeSession.mjs";
import { shouldUseLlamaCore } from "./digHealth.mjs";
import { loadRememberedMood, rememberMood } from "./moodState.mjs";

const ALEX_DISCORD = "1497037418979786823";
const ALEX_TELEGRAM = "6644482344";

/** Prefer Alex's active /mode; fall back to llama-core survival. */
export function resolvePublicBrainMode() {
  const tg = getModeStatus(ALEX_TELEGRAM);
  const disc = getModeStatus(ALEX_DISCORD);
  const pick =
    (tg.mode !== "normal" && tg) ||
    (disc.mode !== "normal" && disc) ||
    tg ||
    disc;
  const llamaCore = shouldUseLlamaCore() || pick.mode === "llama";
  return {
    mode: pick.mode || "normal",
    label: pick.label || modeLabel(pick.mode || "normal"),
    idleSec: pick.idleSec,
    llamaCore: Boolean(llamaCore),
    modeNum:
      pick.mode === "llama"
        ? 1
        : pick.mode === "cursor"
          ? 2
          : pick.mode === "grok"
            ? 3
            : pick.mode === "combined"
              ? 4
              : 5,
  };
}

/**
 * Single "Mood" / ops line for public boards.
 * Priority: lockout → powered-off → hush → sleep → break → dig → live.
 * Lockout wins over stale powered-off while process is up.
 */
export function resolveOpsMood(heartbeat = null) {
  const hb = heartbeat || loadHeartbeat() || {};
  const remembered = loadRememberedMood() || {};
  const lockout =
    isLockoutActive() ||
    Boolean(remembered.lockout) ||
    String(remembered.mood || "").toLowerCase() === "lockout";
  const hushed =
    isHushed() || Boolean(hb.hushed) || (lockout && Boolean(remembered.hush));
  const asleep = isAsleep() || Boolean(hb.asleep);
  const poweredOff = isPoweredOff(); // file flag only — heartbeat can be stale
  const onBreak = Boolean(hb.onBreak);
  const dig =
    Number(hb.queueDepth || 0) > 0 || Number(hb.cursorAgents || 0) > 0;
  const brain = resolvePublicBrainMode();
  const hbMode = String(hb.mode || "").toLowerCase();

  let mood = "live";
  let moodLabel = "Live";
  let tone = "live";

  if (lockout || hbMode === "lockout") {
    mood = "lockout";
    moodLabel = "Lockout";
    tone = "lockout";
  } else if (poweredOff) {
    mood = "powered_off";
    moodLabel = "Powered off";
    tone = "down";
  } else if (hushed || hbMode === "hush") {
    mood = "hushed";
    moodLabel = "Hushed";
    tone = "hush";
  } else if (asleep || hbMode === "sleep") {
    mood = "sleep";
    moodLabel = "Sleep";
    tone = "hush";
  } else if (hbMode === "time-off" || hb.timeOff) {
    mood = "time_off";
    moodLabel = "Time off";
    tone = "break";
  } else if (onBreak || hbMode === "break") {
    mood = "break";
    moodLabel = "On break";
    tone = "break";
  } else if (dig || hb.digging) {
    mood = "digging";
    moodLabel = "Digging";
    tone = "live";
  } else if (hb.live) {
    mood = "live";
    moodLabel = "Live";
    tone = "live";
  } else {
    mood = "starting";
    moodLabel = "Starting";
    tone = "break";
  }

  try {
    if (remembered.mood !== mood || Boolean(remembered.lockout) !== Boolean(lockout)) {
      rememberMood({
        mood,
        lockout: Boolean(lockout),
        hush: Boolean(hushed),
        asleep: Boolean(asleep),
        poweredOff: Boolean(poweredOff),
      });
    }
  } catch {
    /* ignore */
  }

  return {
    mood,
    moodLabel,
    tone,
    lockout: Boolean(lockout),
    hushed,
    asleep,
    poweredOff,
    onBreak,
    digging: Boolean(dig || hb.digging),
    heartbeatMode: hb.mode || mood,
    remembered: {
      mood: remembered.mood || mood,
      lockout: Boolean(remembered.lockout),
      at: remembered.updatedAt || null,
    },
    companion: lockout
      ? "Alex verified DMs only · Ava-core guide/companion · server owns APIs/telemetry"
      : null,
    brain,
    indicators: [
      { id: "lockout", label: "Lockout", on: Boolean(lockout) },
      { id: "hush", label: "Hush", on: Boolean(hushed) },
      { id: "sleep", label: "Sleep", on: Boolean(asleep) },
      {
        id: "brain",
        label:
          brain.llamaCore && brain.mode === "normal"
            ? "Mode 1 · Ava core"
            : "Mode " + brain.modeNum + " · " + brain.mode,
        on: true,
      },
      { id: "dig", label: "Digging", on: Boolean(dig || hb.digging) },
    ],
  };
}

export function buildPublicOpsPayload() {
  return resolveOpsMood(loadHeartbeat());
}
