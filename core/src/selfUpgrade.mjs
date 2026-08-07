import { markNextBootSafemode } from "./bootSequence.mjs";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { AVA_HANDOFF } from "./config.mjs";
import { markShutdown, loadWatermark, pushStatusEvent, storePaths } from "./store.mjs";
import { recordPatch } from "./flightRecorder.mjs";
import { logOps } from "./logOps.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const AVA_ROOT = path.resolve(__dirname, "..");

let scheduled = false;

function restartStatePath() {
  return path.join(storePaths().dir, "restart-request.json");
}

export function loadRestartRequest() {
  try {
    const p = restartStatePath();
    if (!fs.existsSync(p)) return null;
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch {
    return null;
  }
}

export function clearRestartRequest() {
  try {
    const p = restartStatePath();
    if (fs.existsSync(p)) fs.unlinkSync(p);
  } catch {
    /* ignore */
  }
}

function spawnWindowsRestart(waitSec, handoff) {
  const rootEsc = AVA_ROOT.replace(/'/g, "''");
  const handoffEsc = String(handoff || "").replace(/'/g, "''");
  const ps = `
$ErrorActionPreference = 'SilentlyContinue'
Start-Sleep -Seconds ${waitSec}
Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object {
  $_.CommandLine -match 'rootmc-ava' -or $_.CommandLine -match 'ava\\\\src\\\\(index|server|poller)'
} | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
Start-Sleep -Seconds 1
$env:AVA_NO_STATUS_WINDOW = '1'
$env:AVA_HEADLESS = '1'
if ('${handoffEsc}') { $env:AVA_HANDOFF = '${handoffEsc}' }
Set-Location '${rootEsc}'
Start-Process -FilePath 'npm.cmd' -ArgumentList 'start' -WorkingDirectory '${rootEsc}' -WindowStyle Hidden
`;
  return spawn(
    "powershell.exe",
    ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", ps],
    {
      cwd: AVA_ROOT,
      detached: true,
      stdio: "ignore",
      windowsHide: true,
      env: { ...process.env, AVA_NO_STATUS_WINDOW: "1", AVA_HEADLESS: "1" },
    },
  );
}

function spawnUnixRestart(waitSec, handoff) {
  const rootQ = AVA_ROOT.replace(/'/g, `'\\''`);
  const handoffQ = String(handoff || "").replace(/'/g, `'\\''`);
  const sh = `
sleep ${waitSec}
pkill -f 'rootmc-ava/src/(index|server|poller)\\.mjs' 2>/dev/null || true
pkill -f 'Web Files/rootmc-ava/src/(index|server|poller)\\.mjs' 2>/dev/null || true
pkill -f 'ava/core/src/(index|server|poller)\\.mjs' 2>/dev/null || true
pkill -f '/home/ava-core/ava/core/src/(index|server|poller)\\.mjs' 2>/dev/null || true
sleep 1
export AVA_NO_STATUS_WINDOW=1
export AVA_HEADLESS=1
${handoffQ ? `export AVA_HANDOFF='${handoffQ}'` : ""}
cd '${rootQ}'
nohup npm start >/dev/null 2>&1 &
`;
  return spawn("bash", ["-lc", sh], {
    cwd: AVA_ROOT,
    detached: true,
    stdio: "ignore",
    env: { ...process.env, AVA_NO_STATUS_WINDOW: "1", AVA_HEADLESS: "1" },
  });
}

/**
 * Schedule a silent self-restart (manual upgrade push).
 * Spawns a detached supervisor that waits, kills this Ava tree, then `npm start`.
 * Windows: PowerShell. Linux/SSH: bash + pkill + nohup.
 */
function noteRestartPatch(reason = "restart") {
  try {
    recordPatch({
      brain: "host",
      paths: ["selfUpgrade.mjs"],
      summary: `self-restart: ${String(reason || "restart").slice(0, 500)}`,
      meta: { source: "selfUpgrade" },
    });
    logOps({ type: "self.restart", level: "info", ok: true, meta: { reason } });
  } catch (err) {
    console.warn("selfUpgrade patch log:", err.message);
  }
}

export function scheduleSelfRestart({
  reason = "manual upgrade",
  delayMs = 1500,
  requestedBy = "local",
  silent = true,
} = {}) {
  noteRestartPatch(reason);
  if (scheduled) {
    return { ok: false, reason: "already_scheduled" };
  }
  scheduled = true;
  try { markNextBootSafemode("operator restart"); } catch {}


  const payload = {
    at: Date.now(),
    reason: String(reason).slice(0, 200),
    requestedBy: String(requestedBy).slice(0, 80),
    silent: Boolean(silent),
    delayMs,
    pid: process.pid,
  };
  try {
    fs.writeFileSync(restartStatePath(), JSON.stringify(payload, null, 2), "utf8");
  } catch {
    /* still try restart */
  }

  try {
    markShutdown(loadWatermark().channels || {});
  } catch {
    /* ignore */
  }

  pushStatusEvent(
    silent
      ? `silent restart scheduled · ${payload.reason}`
      : `restart scheduled · ${payload.reason}`,
  );

  const waitSec = Math.max(1, Math.ceil(Number(delayMs) / 1000));
  const handoff = AVA_HANDOFF;

  try {
    const child =
      process.platform === "win32"
        ? spawnWindowsRestart(waitSec, handoff)
        : spawnUnixRestart(waitSec, handoff);
    child.unref();
  } catch (err) {
    scheduled = false;
    pushStatusEvent(`restart spawn failed · ${err.message}`);
    return { ok: false, reason: err.message };
  }

  return { ok: true, ...payload };
}

export function isRestartCommand(content) {
  const q = String(content || "")
    .toLowerCase()
    .replace(/<@!?\d+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!q) return false;
  // Host reboot / Minecraft rootrestart — not Ava process
  if (/\b\/?reboot\b/.test(q) && !/\bava\b/.test(q)) return false;
  if (/\brootrestart\b/.test(q)) return false;
  if (/\b(restart|reboot|respawn)\s+(ava|yourself|the\s+bot)\b/.test(q)) return true;
  if (/\bava[,:]?\s+(restart|reboot)\b/.test(q)) return true;
  if (/^(restart|reboot)\s+ava\b/.test(q)) return true;
  // Alex shorthand: "restart" / "restart the server" → Ava process (not host)
  if (
    /^(hey\s+|hi\s+|ok\s+|okay\s+|please\s+|pls\s+)*(ava[,:]?\s+)?restart(\s+the\s+server)?\s*[!.]?$/.test(
      q,
    )
  ) {
    return true;
  }
  return false;
}
