/**
 * Remembered ops mood — survives power-down / process kill.
 * If she powers down in lockout, boot restores lockout (1:1 with Alex).
 * Ava-core focus: humanization / companion. Server process owns telemetry/APIs.
 */
import fs from "node:fs";
import path from "node:path";
import { storePaths, pushStatusEvent } from "./store.mjs";

function moodPath() {
  return path.join(storePaths().dir, "mood.json");
}

export function loadRememberedMood() {
  try {
    if (!fs.existsSync(moodPath())) return null;
    return JSON.parse(fs.readFileSync(moodPath(), "utf8").replace(/^\uFEFF/, ""));
  } catch {
    return null;
  }
}

/**
 * @param {object} patch
 */
export function rememberMood(patch = {}) {
  const prev = loadRememberedMood() || {};
  const payload = {
    ...prev,
    ...patch,
    updatedAt: Date.now(),
  };
  if (payload.mood) payload.mood = String(payload.mood).slice(0, 40);
  if (payload.reason) payload.reason = String(payload.reason).slice(0, 300);
  fs.mkdirSync(path.dirname(moodPath()), { recursive: true });
  fs.writeFileSync(moodPath(), JSON.stringify(payload, null, 2), "utf8");
  return payload;
}

/** Snapshot used at power-down so boot can restore the same companion posture. */
export function snapshotMoodForPowerDown({
  mood = "live",
  lockout = false,
  hush = false,
  asleep = false,
  reason = "power down",
  by = "operator",
} = {}) {
  return rememberMood({
    mood: lockout ? "lockout" : mood,
    lockout: Boolean(lockout),
    hush: Boolean(hush) || Boolean(lockout),
    asleep: Boolean(asleep),
    poweredOff: true,
    reason: String(reason).slice(0, 300),
    by: String(by).slice(0, 80),
    poweredOffAt: Date.now(),
  });
}

/**
 * On human power-on: restore lockout/hush from remembered mood + lockout.json.
 * Does not re-apply powered-off (that flag is cleared separately).
 * @returns {{ restored: boolean, mood: string, lockout: boolean }}
 */
export function restoreMoodOnBoot({
  isLockoutActive,
  setLockout,
  setHushed,
} = {}) {
  const remembered = loadRememberedMood() || {};
  const wantLockout =
    Boolean(remembered.lockout) ||
    String(remembered.mood || "").toLowerCase() === "lockout" ||
    (typeof isLockoutActive === "function" && isLockoutActive());

  if (wantLockout && typeof setLockout === "function" && !isLockoutActive?.()) {
    setLockout({
      on: true,
      reason: remembered.reason || "restored lockout after power-down",
      by: remembered.by || "mood-restore",
    });
  }

  if (wantLockout && typeof setHushed === "function") {
    setHushed(true, "lockout companion — channels silent; Alex verified DMs only");
  }

  const mood = wantLockout ? "lockout" : String(remembered.mood || "live");
  rememberMood({
    mood,
    lockout: wantLockout,
    hush: wantLockout || Boolean(remembered.hush),
    asleep: false,
    poweredOff: false,
    reason: wantLockout
      ? "boot · restored lockout companion"
      : "boot · powered on",
    by: "boot",
  });

  if (wantLockout) {
    pushStatusEvent("mood restore · lockout · Alex verified DMs only · no chat boot automation");
  }

  return { restored: wantLockout, mood, lockout: wantLockout };
}

/** Chat-facing boot posts / catch-ups / online pings — off in lockout. */
export function shouldRunChatBootAutomation() {
  try {
    const m = loadRememberedMood();
    if (m?.lockout || String(m?.mood || "").toLowerCase() === "lockout") {
      return false;
    }
  } catch {
    /* fall through */
  }
  // Dynamic import avoided — callers also check isLockoutActive()
  return true;
}
