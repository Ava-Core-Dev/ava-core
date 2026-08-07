/**
 * Cloudflare Tunnel for https://ava.rootmc.net → local Ava status (:8787).
 * Starts with Ava when AVA_PUBLIC_TUNNEL is not "0" (default on).
 *
 * Auth order:
 * 1. AVA_TUNNEL_TOKEN / CLOUDFLARE_TUNNEL_TOKEN / TUNNEL_TOKEN → `cloudflared tunnel run --token`
 * 2. Else config.yml (rewrites Windows credentials-file paths on Linux)
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { AVA_PORT } from "./config.mjs";
import { pushStatusEvent } from "./store.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WORKSPACE = path.resolve(__dirname, "../../..");
const DEFAULT_CFG = path.join(
  WORKSPACE,
  "scripts",
  "local-edge",
  "cloudflared",
  "config.yml",
);

let child = null;

export function publicAvaUrl() {
  return String(process.env.AVA_PUBLIC_URL || "https://ava.rootmc.net").replace(
    /\/$/,
    "",
  );
}

function tunnelEnabled() {
  const v = String(process.env.AVA_PUBLIC_TUNNEL || "1").trim().toLowerCase();
  return v !== "0" && v !== "false" && v !== "off";
}

function findCloudflared() {
  const fromEnv = String(process.env.CLOUDFLARED_PATH || "").trim();
  if (fromEnv && fs.existsSync(fromEnv)) return fromEnv;
  const candidates =
    process.platform === "win32"
      ? [
          "C:\\Program Files (x86)\\cloudflared\\cloudflared.exe",
          "C:\\Program Files\\cloudflared\\cloudflared.exe",
          path.join(process.env.LOCALAPPDATA || "", "cloudflared", "cloudflared.exe"),
        ]
      : ["/usr/local/bin/cloudflared", "/usr/bin/cloudflared"];
  for (const p of candidates) {
    if (p && fs.existsSync(p)) return p;
  }
  return "cloudflared";
}

function configPath() {
  return String(process.env.AVA_TUNNEL_CONFIG || DEFAULT_CFG).trim();
}

function tunnelToken() {
  for (const key of [
    "AVA_TUNNEL_TOKEN",
    "CLOUDFLARE_TUNNEL_TOKEN",
    "TUNNEL_TOKEN",
  ]) {
    const v = String(process.env[key] || "").trim();
    if (v) return v;
  }
  // Optional token file (chmod 600) — avoids putting token in unit Environment=
  const tokenFile = String(process.env.AVA_TUNNEL_TOKEN_FILE || "").trim();
  if (tokenFile && fs.existsSync(tokenFile)) {
    try {
      return fs.readFileSync(tokenFile, "utf8").trim();
    } catch {
      return "";
    }
  }
  const homeTok = path.join(os.homedir(), ".cloudflared", "tunnel.token");
  if (fs.existsSync(homeTok)) {
    try {
      return fs.readFileSync(homeTok, "utf8").trim();
    } catch {
      return "";
    }
  }
  return "";
}

/** On Linux, rewrite Windows credentials-file paths into ~/.cloudflared/<uuid>.json */
function resolveConfigForHost(cfg) {
  if (process.platform === "win32") return cfg;
  let raw = "";
  try {
    raw = fs.readFileSync(cfg, "utf8");
  } catch {
    return cfg;
  }
  // Strip UTF-8 BOM
  if (raw.charCodeAt(0) === 0xfeff) raw = raw.slice(1);
  const m = raw.match(/credentials-file:\s*(.+)\s*$/m);
  if (!m) return cfg;
  const cred = m[1].trim().replace(/^["']|["']$/g, "");
  const looksWindows = /^[A-Za-z]:\\/.test(cred) || cred.includes("\\");
  if (!looksWindows) return cfg;

  const base = path.basename(cred.replace(/\\/g, "/"));
  const linuxCred = path.join(os.homedir(), ".cloudflared", base);
  if (!fs.existsSync(linuxCred)) {
    console.warn(
      "Ava tunnel credentials missing on Linux:",
      linuxCred,
      "(config still points at Windows path)",
    );
    pushStatusEvent("tunnel credentials missing on Linux");
    return cfg;
  }
  const rewritten = raw.replace(
    /credentials-file:\s*.+$/m,
    `credentials-file: ${linuxCred}`,
  );
  const out = path.join(os.tmpdir(), "ava-cloudflared-config.yml");
  fs.writeFileSync(out, rewritten, "utf8");
  return out;
}

function attachChildLogs(proc) {
  proc.stdout?.on("data", (buf) => {
    const line = String(buf).trim();
    if (line) console.log("[tunnel]", line.slice(0, 240));
  });
  proc.stderr?.on("data", (buf) => {
    const line = String(buf).trim();
    if (line) console.warn("[tunnel]", line.slice(0, 240));
  });
  proc.on("exit", (code) => {
    console.warn(`cloudflared exited code=${code}`);
    pushStatusEvent(`tunnel exited · ${code}`);
    child = null;
  });
}

export function startAvaPublicTunnel() {
  if (!tunnelEnabled()) {
    console.log("Ava public tunnel disabled (AVA_PUBLIC_TUNNEL=0)");
    return null;
  }
  if (child && !child.killed) return child;

  const bin = findCloudflared();
  const token = tunnelToken();

  try {
    if (token) {
      child = spawn(bin, ["tunnel", "run", "--token", token], {
        cwd: os.homedir(),
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
        detached: false,
        env: { ...process.env },
      });
      attachChildLogs(child);
      console.log(
        `Ava public tunnel → ${publicAvaUrl()} (local :${AVA_PORT}) via tunnel token`,
      );
      pushStatusEvent(`tunnel up · ${publicAvaUrl()} · token`);
      return child;
    }

    const cfgRaw = configPath();
    if (!fs.existsSync(cfgRaw)) {
      console.warn("Ava tunnel config missing:", cfgRaw);
      pushStatusEvent("tunnel config missing");
      return null;
    }
    const cfg = resolveConfigForHost(cfgRaw);
    child = spawn(bin, ["tunnel", "--config", cfg, "run"], {
      cwd: path.dirname(cfgRaw),
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
      detached: false,
    });
  } catch (err) {
    console.warn("cloudflared spawn failed:", err.message);
    pushStatusEvent(`tunnel spawn failed · ${err.message}`);
    return null;
  }

  attachChildLogs(child);
  console.log(
    `Ava public tunnel → ${publicAvaUrl()} (local :${AVA_PORT}) via ${configPath()}`,
  );
  pushStatusEvent(`tunnel up · ${publicAvaUrl()}`);
  return child;
}

export function stopAvaPublicTunnel() {
  if (!child) return;
  try {
    child.kill();
  } catch {
    /* ignore */
  }
  child = null;
}
