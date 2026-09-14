/**
 * Ava session lifecycle — start Python core + voice with the desktop GUI.
 * Origin stays up if the window closes. A watchdog restarts core if /health dies.
 * stopAvaSession() is only for an explicit power-off.
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const AVA_ROOT =
  process.env.AVA_HANDOFF ||
  process.env.AVA_HOME ||
  "/home/ava-core/ava/ava-core-v2";
const RUN_DIR = path.join(AVA_ROOT, "data", "run");
const LOG_DIR = path.join(AVA_ROOT, "data", "logs");
const VENV_PY = path.join(AVA_ROOT, ".venv", "bin", "python");
const VENV_UVICORN = path.join(AVA_ROOT, ".venv", "bin", "uvicorn");
const PORT = String(process.env.AVA_PORT || "8787").replace(/\s*#.*$/, "").trim() || "8787";

/** @type {import('node:child_process').ChildProcess[]} */
const children = [];
let startedByUs = false;
let stopping = false;
let restarting = false;
let watchTimer = null;

function ensureDirs() {
  fs.mkdirSync(RUN_DIR, { recursive: true });
  fs.mkdirSync(LOG_DIR, { recursive: true });
}

function appendLog(file, line) {
  try {
    fs.appendFileSync(file, `${new Date().toISOString()} ${line}\n`);
  } catch {
    /* ignore */
  }
}

function childEnv() {
  const uid = process.getuid?.() ?? 1000;
  return {
    ...process.env,
    AVA_HOME: AVA_ROOT,
    AVA_HANDOFF: AVA_ROOT,
    PYTHONUNBUFFERED: "1",
    PULSE_SERVER: process.env.PULSE_SERVER || `unix:/run/user/${uid}/pulse/native`,
    XDG_RUNTIME_DIR: process.env.XDG_RUNTIME_DIR || `/run/user/${uid}`,
    DISPLAY: process.env.DISPLAY || ":0",
  };
}

function openLog(name) {
  const preferred = [
    path.join(LOG_DIR, name.replace(/\.log$/, "-session.log")),
    path.join(LOG_DIR, name),
    path.join(os.tmpdir(), `ava-${name}`),
  ];
  let lastErr;
  for (const p of preferred) {
    try {
      return fs.openSync(p, "a");
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr || new Error(`cannot open log ${name}`);
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Kill leftover Ava runtime processes (same user) so we own a clean session.
 * Does not touch tunnel, mariadb, ollama, minecraft, or phpmyadmin.
 */
export function reapStaleAvaProcesses() {
  const patterns = [
    "uvicorn apps.core.main:app",
    "apps.voice.director",
    "apps.core.main:app",
  ];
  for (const pat of patterns) {
    try {
      spawn("pkill", ["-u", String(process.getuid?.() ?? 1000), "-f", pat], {
        stdio: "ignore",
        detached: true,
      }).unref();
    } catch {
      /* ignore */
    }
  }
}

function spawnTracked(cmd, args, logName, label) {
  const out = openLog(logName);
  const err = out;
  const child = spawn(cmd, args, {
    cwd: AVA_ROOT,
    env: childEnv(),
    stdio: ["ignore", out, err],
    detached: true,
  });
  child.unref();
  children.push(child);
  const pidFile = path.join(RUN_DIR, `${label}.pid`);
  try {
    fs.writeFileSync(pidFile, String(child.pid));
  } catch {
    /* ignore */
  }
  child.on("exit", (code, signal) => {
    appendLog(path.join(LOG_DIR, "ava-desktop.log"), `${label} exited code=${code} signal=${signal}`);
    try {
      fs.unlinkSync(pidFile);
    } catch {
      /* ignore */
    }
    if (label === "ava-core" && !stopping) {
      void ensureCoreUp("child-exit");
    }
  });
  return child;
}

async function waitHealth(timeoutMs = 45000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await healthOk()) return true;
    await sleep(400);
  }
  return false;
}

async function healthOk() {
  try {
    const r = await fetch(`http://127.0.0.1:${PORT}/health`, {
      signal: AbortSignal.timeout(2000),
    });
    return r.ok;
  } catch {
    return false;
  }
}

function spawnCore() {
  const uvicornBin = fs.existsSync(VENV_UVICORN) ? VENV_UVICORN : null;
  const pyBin = fs.existsSync(VENV_PY) ? VENV_PY : "python3";
  if (uvicornBin) {
    spawnTracked(
      uvicornBin,
      [
        "apps.core.main:app",
        "--host",
        "127.0.0.1",
        "--port",
        PORT,
        "--log-level",
        "info",
        "--no-access-log",
      ],
      "ava-core.log",
      "ava-core",
    );
  } else {
    spawnTracked(
      pyBin,
      ["-m", "uvicorn", "apps.core.main:app", "--host", "127.0.0.1", "--port", PORT],
      "ava-core.log",
      "ava-core",
    );
  }
}

async function ensureCoreUp(reason) {
  if (stopping || restarting) return;
  if (await healthOk()) return;
  restarting = true;
  try {
    appendLog(path.join(LOG_DIR, "ava-desktop.log"), `watchdog: Ava Core down (${reason}) — restarting`);
    reapStaleAvaProcesses();
    await sleep(800);
    spawnCore();
    await ensureVoiceDirector();
    const ok = await waitHealth(30000);
    appendLog(
      path.join(LOG_DIR, "ava-desktop.log"),
      ok ? "watchdog: Ava Core back" : "watchdog: restart failed",
    );
  } finally {
    restarting = false;
  }
}

function startWatchdog() {
  if (watchTimer) return;
  watchTimer = setInterval(() => {
    void ensureCoreUp("health-poll");
  }, 8000);
}

function stopWatchdog() {
  if (watchTimer) {
    clearInterval(watchTimer);
    watchTimer = null;
  }
}

/**
 * Start Ava Core + Voice Director. Origin is kept alive after the GUI exits.
 */
export async function startAvaSession() {
  stopping = false;
  ensureDirs();
  appendLog(path.join(LOG_DIR, "ava-desktop.log"), "lifecycle: starting Ava session");

  try {
    const r = await fetch(`http://127.0.0.1:${PORT}/health`, {
      signal: AbortSignal.timeout(1500),
    });
    if (r.ok) {
      startedByUs = false;
      appendLog(path.join(LOG_DIR, "ava-desktop.log"), "lifecycle: adopting existing Ava Core");
      await ensureVoiceDirector();
      startWatchdog();
      return true;
    }
  } catch {
    /* not up yet */
  }

  reapStaleAvaProcesses();
  await sleep(800);
  spawnCore();
  const pyBin = fs.existsSync(VENV_PY) ? VENV_PY : "python3";
  spawnTracked(pyBin, ["-m", "apps.voice.director"], "ava-voice.log", "ava-voice");

  startedByUs = true;
  const ok = await waitHealth();
  appendLog(
    path.join(LOG_DIR, "ava-desktop.log"),
    ok ? "lifecycle: Ava Core healthy" : "lifecycle: Ava Core health wait timed out",
  );
  startWatchdog();
  return ok;
}

async function ensureVoiceDirector() {
  try {
    const { execSync } = await import("node:child_process");
    const out = execSync("pgrep -f 'apps.voice.director' || true", { encoding: "utf8" });
    if (out.trim()) return;
  } catch {
    /* spawn anyway */
  }
  const pyBin = fs.existsSync(VENV_PY) ? VENV_PY : "python3";
  spawnTracked(pyBin, ["-m", "apps.voice.director"], "ava-voice.log", "ava-voice");
}

/**
 * Explicit power-off only. Closing the GUI must not call this.
 */
export function stopAvaSession() {
  stopping = true;
  stopWatchdog();
  appendLog(path.join(LOG_DIR, "ava-desktop.log"), "lifecycle: stopping Ava session (explicit)");

  for (const child of children.splice(0)) {
    try {
      if (child.pid && !child.killed) {
        child.kill("SIGTERM");
      }
    } catch {
      /* ignore */
    }
  }

  setTimeout(() => {
    reapStaleAvaProcesses();
  }, 1500);

  reapStaleAvaProcesses();
  startedByUs = false;

  for (const name of ["ava-core.pid", "ava-voice.pid"]) {
    try {
      fs.unlinkSync(path.join(RUN_DIR, name));
    } catch {
      /* ignore */
    }
  }
}

export function sessionStartedByDesktop() {
  return startedByUs;
}
