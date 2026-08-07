/**
 * Preflight: install npm deps (and report missing Node).
 * Safe to re-run — only installs when package-lock / package.json newer than node_modules stamp.
 */
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const stampPath = path.join(root, "node_modules", ".ava-deps-stamp");
const pkgPath = path.join(root, "package.json");
const lockPath = path.join(root, "package-lock.json");

function mtime(p) {
  try {
    return fs.statSync(p).mtimeMs;
  } catch {
    return 0;
  }
}

function needsInstall() {
  const required = [
    path.join(root, "node_modules", "@slack", "bolt"),
    path.join(root, "node_modules", "ws"),
    path.join(root, "node_modules", "discord-rpc"),
  ];
  for (const p of required) {
    if (!fs.existsSync(p)) return true;
  }
  const stamp = mtime(stampPath);
  if (!stamp) return true;
  return mtime(pkgPath) > stamp || mtime(lockPath) > stamp;
}

function runNpm(args) {
  const npmCmd = process.platform === "win32" ? "npm.cmd" : "npm";
  const r = spawnSync(npmCmd, args, {
    cwd: root,
    stdio: "inherit",
    env: process.env,
    shell: process.platform === "win32",
  });
  if (r.status !== 0) {
    throw new Error(`npm ${args.join(" ")} failed (exit ${r.status})`);
  }
}

const major = Number(process.versions.node.split(".")[0]);
if (!Number.isFinite(major) || major < 20) {
  console.error(`Ava needs Node.js 20+ (found ${process.version}).`);
  process.exit(2);
}

if (needsInstall()) {
  console.log("Ava deps: installing npm packages…");
  if (fs.existsSync(lockPath)) {
    try {
      runNpm(["ci", "--omit=dev"]);
    } catch {
      console.warn("npm ci failed — falling back to npm install");
      runNpm(["install", "--omit=dev"]);
    }
  } else {
    runNpm(["install", "--omit=dev"]);
  }
  fs.mkdirSync(path.join(root, "node_modules"), { recursive: true });
  fs.writeFileSync(
    stampPath,
    JSON.stringify({ at: new Date().toISOString(), node: process.version }, null, 2),
    "utf8",
  );
  console.log("Ava deps: ready");
} else {
  console.log("Ava deps: up to date");
}
