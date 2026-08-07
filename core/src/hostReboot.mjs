/**
 * Host reboot — literally reboots the Pacific Ubuntu device (not Ava npm, not Minecraft).
 * Alex-only. Mood/lockout are remembered so she boots back in the same companion state.
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import {
  pushStatusEvent,
  storePaths,
  writeHeartbeat,
  isHushed,
} from "./store.mjs";
import { appendAction } from "./fullLog.mjs";
import { isLockoutActive } from "./lockoutMode.mjs";
import { snapshotMoodForPowerDown } from "./moodState.mjs";
import { markNextBootSafemode } from "./bootSequence.mjs";

let scheduled = false;

function rebootFlagPath() {
  return path.join(storePaths().dir, "host-reboot.json");
}

/**
 * `/reboot` · `ava reboot the host` · `reboot the device` / server / box / machine
 * Does NOT match: reboot ava, restart ava, /rootrestart, Minecraft restarts.
 */
export function isHostRebootCommand(content) {
  const q = String(content || "")
    .toLowerCase()
    .replace(/<@!?\d+>/g, " ")
    .replace(/[“”"']/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!q) return false;
  if (/\b(don'?t|do not|never|stop)\b.*\breboot\b/.test(q)) return false;
  // Ava process restart — different command
  if (
    /\b(restart|reboot|respawn)\s+(ava|yourself|the\s+bot)\b/.test(q) ||
    /\bava[,:]?\s+(restart|reboot)\b/.test(q) ||
    /^(restart|reboot)\s+ava\b/.test(q)
  ) {
    return false;
  }
  // Minecraft
  if (/\brootrestart\b/.test(q)) return false;

  if (/^\/reboot\b/.test(q)) return true;
  if (/^reboot(\s+now)?[.!?]*$/.test(q)) return true;
  if (
    /\breboot\b/.test(q) &&
    /\b(host|device|machine|box|server|computer|pc|ubuntu|pacific)\b/.test(q)
  ) {
    return true;
  }
  if (
    /^(hey\s+|hi\s+|ok\s+|okay\s+|yes\s+|yeah\s+|pls\s+|please\s+)*ava[,:]?\s+reboot(\s+(the\s+)?(host|device|machine|box|server|now))?[.!?]*$/.test(
      q,
    )
  ) {
    return true;
  }
  return false;
}

/**
 * Schedule full OS reboot via sudo. Reply first from pipeline before calling this.
 */
export function scheduleHostReboot({
  reason = "operator /reboot",
  delayMs = 5000,
  requestedBy = "operator",
} = {}) {
  if (scheduled) {
    return { ok: false, reason: "already_scheduled" };
  }
  scheduled = true;

  const payload = {
    at: Date.now(),
    reason: String(reason).slice(0, 200),
    requestedBy: String(requestedBy).slice(0, 80),
    delayMs: Math.max(2000, Number(delayMs) || 5000),
    pid: process.pid,
  };

  try {
    fs.mkdirSync(storePaths().dir, { recursive: true });
    fs.writeFileSync(rebootFlagPath(), JSON.stringify(payload, null, 2), "utf8");
  } catch {
    /* still try */
  }

  try {
    const lockout = isLockoutActive();
    try { markNextBootSafemode("host /reboot"); } catch {}
    snapshotMoodForPowerDown({
      mood: lockout ? "lockout" : "reboot",
      lockout,
      hush: isHushed() || lockout,
      asleep: false,
      reason: `host reboot · ${payload.reason}`,
      by: requestedBy,
    });
  } catch {
    /* continue */
  }

  writeHeartbeat({
    live: false,
    mode: isLockoutActive() ? "lockout" : "reboot",
    poweredOff: false,
    lockout: isLockoutActive(),
    hostReboot: true,
  });
  pushStatusEvent(`HOST REBOOT in ${Math.ceil(payload.delayMs / 1000)}s · ${payload.reason}`);
  appendAction("host.reboot", {
    reason: payload.reason,
    by: payload.requestedBy,
  });

  const waitSec = Math.max(2, Math.ceil(payload.delayMs / 1000));
  // Detached: sleep then reboot. Prefer systemctl; fall back to /sbin/reboot.
  const sh = `
sleep ${waitSec}
if command -v systemctl >/dev/null 2>&1; then
  sudo -n /bin/systemctl reboot || sudo -n /usr/bin/systemctl reboot || sudo -n systemctl reboot
fi
sudo -n /sbin/reboot || sudo -n /usr/sbin/reboot || sudo -n reboot
`;
  try {
    const child = spawn("bash", ["-lc", sh], {
      detached: true,
      stdio: "ignore",
      env: process.env,
    });
    child.unref();
  } catch (err) {
    scheduled = false;
    pushStatusEvent(`host reboot spawn failed · ${err.message}`);
    return { ok: false, reason: err.message };
  }

  return { ok: true, ...payload };
}
