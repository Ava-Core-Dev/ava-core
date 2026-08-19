/**
 * Ava session lifecycle — start/stop Python core + voice with the desktop GUI.
 * Processes run as children of Electron (same user), so no sudo is required.
 * On quit we also reap any leftover uvicorn / director PIDs from prior runs.
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
  "/run/media/ava-core/6B6C97406BF24558/ava-core-v2";
const RUN_DIR = path.join(AVA_ROOT, "data", "run");
const LOG_DIR = path.join(AVA_ROOT, "data", "logs");
const VENV_PY = path.join(AVA_ROOT, ".venv", "bin", "python");
const VENV_UVICORN = path.join(AVA_ROOT, ".venv", "bin", "uvicorn");
const PORT = String(process.env.AVA_PORT || "8787").replace(/\s*#.*$/, "").trim() || "8787";

/** @type {import('node:child_process').ChildProcess[]} */
const children = [];
let startedByUs = false;

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
  // Prefer session logs we always own (systemd often leaves root-owned *.log files)
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
    detached: false,
  });
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
  });
  return child;
}

async function waitHealth(timeoutMs = 45000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/health`, {
        signal: AbortSignal.timeout(1500),
      });
      if (r.ok) return true;
    } catch {
      /* retry */
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  return false;
}

/**
 * Start Ava Core + Voice Director for this GUI session.
 */
export async function startAvaSession() {
  ensureDirs();
  appendLog(path.join(LOG_DIR, "ava-desktop.log"), "lifecycle: starting Ava session");

  // If core is already healthy (manual start / prior session), adopt it — don't kill.
  try {
    const r = await fetch(`http://127.0.0.1:${PORT}/health`, {
      signal: AbortSignal.timeout(1500),
    });
    if (r.ok) {
      startedByUs = false; // we didn't spawn; on close still stop via reap
      appendLog(path.join(LOG_DIR, "ava-desktop.log"), "lifecycle: adopting existing Ava Core");
      // Still ensure voice director is up
      await ensureVoiceDirector();
      return true;
    }
  } catch {
    /* not up yet */
  }

  // Clear any prior dead runtime so close→open is deterministic
  reapStaleAvaProcesses();
  await new Promise((r) => setTimeout(r, 800));

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

  spawnTracked(pyBin, ["-m", "apps.voice.director"], "ava-voice.log", "ava-voice");

  startedByUs = true;
  const ok = await waitHealth();
  appendLog(
    path.join(LOG_DIR, "ava-desktop.log"),
    ok ? "lifecycle: Ava Core healthy" : "lifecycle: Ava Core health wait timed out",
  );
  return ok;
}

async function ensureVoiceDirector() {
  // If director already logging / process exists, skip
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
 * Stop everything this session started + any leftover Ava runtime PIDs.
 */
export function stopAvaSession() {
  appendLog(path.join(LOG_DIR, "ava-desktop.log"), "lifecycle: stopping Ava session (GUI closed)");

  for (const child of children.splice(0)) {
    try {
      if (child.pid && !child.killed) {
        child.kill("SIGTERM");
      }
    } catch {
      /* ignore */
    }
  }

  // Hard reap after a brief grace
  setTimeout(() => {
    for (const child of children) {
      try {
        if (child.pid && !child.killed) child.kill("SIGKILL");
      } catch {
        /* ignore */
      }
    }
    reapStaleAvaProcesses();
  }, 1500);

  reapStaleAvaProcesses();
  startedByUs = false;

  // Clear pid files
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
