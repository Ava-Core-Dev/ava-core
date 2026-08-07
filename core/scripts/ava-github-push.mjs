/**
 * Ava GitHub auto-commit + push — end of dig phases only.
 * Stages Ava-owned workspace paths; never secrets; never force-push main/master.
 *
 * Usage:
 *   node scripts/ava-github-push.mjs ["optional commit message"]
 *   AVA_GIT_ROOT=D:\  node scripts/ava-github-push.mjs
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { appendAction } from "../src/fullLog.mjs";
import { storePaths } from "../src/store.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOTMC = path.resolve(__dirname, "../../.."); // D:\.1 Work Stations\RootMC

const SECRET_BASENAMES = new Set([
  ".env",
  "google-services.json",
  "cloud.yml",
  "database.yml",
]);

const SECRET_EXT = [".pem", ".p12", ".jks", ".keystore"];

/** Relative to git toplevel, with forward slashes. */
const OWNED_GLOBS = [
  "Web Files/rootmc-ava/src/**",
  "Web Files/rootmc-ava/scripts/**",
  "Web Files/rootmc-ava/docs/**",
  "Web Files/rootmc-ava/package.json",
  "Web Files/rootmc-ava/README.md",
  "Web Files/rootmc-realm-api/src/**",
  "Web Files/rootmc-realm-api/scripts/**",
  "Web Files/rootmc-api/deploy.ps1",
  "Web Files/rootmc-api/src/**",
  "Web Files/rootmc-web/public/wiki/constitution/**",
  "Web Files/rootmc-web/deploy.ps1",
  "Plugin Building/Minecraft/plugins/root-ava-core/**",
  "Server Handoffs/Ava Ivy/notes/**",
  "Server Handoffs/Ava Ivy/docs/**",
  ".cursor/rules/ava-*.mdc",
];

const SKIP_SUBSTR = [
  "/node_modules/",
  "/build/",
  "/dist/",
  "/data/",
  "/.gradle/",
  "/uploads/",
];

function git(cwd, args, opts = {}) {
  const r = spawnSync("git", args, {
    cwd,
    encoding: "utf8",
    maxBuffer: 20 * 1024 * 1024,
    ...opts,
  });
  return {
    ok: r.status === 0,
    status: r.status,
    stdout: (r.stdout || "").trim(),
    stderr: (r.stderr || "").trim(),
  };
}

function findGitRoot(start) {
  const envRoot = String(process.env.AVA_GIT_ROOT || "").trim();
  if (envRoot && fs.existsSync(path.join(envRoot, ".git"))) {
    return path.resolve(envRoot);
  }
  let cur = path.resolve(start);
  for (let i = 0; i < 12; i++) {
    if (fs.existsSync(path.join(cur, ".git"))) return cur;
    const parent = path.dirname(cur);
    if (parent === cur) break;
    cur = parent;
  }
  return null;
}

function toPosix(p) {
  return String(p).replace(/\\/g, "/");
}

/** Prefix from git root to RootMC workspace (e.g. ".1 Work Stations/RootMC/"). */
function workspacePrefix(gitRoot) {
  const envRootmc = String(process.env.AVA_ROOTMC || "").trim();
  if (envRootmc) {
    const relEnv = path.relative(gitRoot, path.resolve(envRootmc));
    if (relEnv && !relEnv.startsWith("..")) {
      return toPosix(relEnv).replace(/\/?$/, "/");
    }
  }
  // SSD layout: MonoRepo at /mnt/e with RootMC under ".1 Work Stations/RootMC"
  const candidates = [
    path.join(gitRoot, ".1 Work Stations", "RootMC"),
    path.join(gitRoot, "RootMC"),
    ROOTMC,
  ];
  for (const cand of candidates) {
    const rel = path.relative(gitRoot, cand);
    if (rel && !rel.startsWith("..") && fs.existsSync(path.join(cand, "Web Files"))) {
      return toPosix(rel).replace(/\/?$/, "/");
    }
  }
  const rel = path.relative(gitRoot, ROOTMC);
  if (!rel || rel.startsWith("..")) {
    return "";
  }
  return toPosix(rel).replace(/\/?$/, "/");
}

function isSecretPath(relPosix) {
  const base = path.posix.basename(relPosix);
  if (SECRET_BASENAMES.has(base)) return true;
  if (SECRET_EXT.some((e) => base.toLowerCase().endsWith(e))) return true;
  if (/\.env(\.|$)/i.test(base)) return true;
  if (/Server Handoffs\/\d\./i.test(relPosix) && /cloud\.yml$/i.test(relPosix)) {
    return true;
  }
  const norm = `/${relPosix}/`;
  if (SKIP_SUBSTR.some((s) => norm.includes(s))) return true;
  return false;
}

function ownedPathspecs(prefix) {
  return OWNED_GLOBS.map((g) => `${prefix}${g}`);
}

function listDirtyOwned(gitRoot, prefix) {
  const specs = ownedPathspecs(prefix);
  const st = git(gitRoot, ["status", "--porcelain", "-uall", "--", ...specs]);
  if (!st.ok && !st.stdout) {
    return { ok: false, files: [], error: st.stderr || "status failed" };
  }
  const files = [];
  for (const line of st.stdout.split("\n")) {
    if (!line.trim()) continue;
    // XY PATH or XY ORIG -> PATH
    let file = line.slice(3).trim();
    if (file.includes(" -> ")) file = file.split(" -> ").pop().trim();
    file = file.replace(/^"|"$/g, "");
    if (!file || isSecretPath(file)) continue;
    files.push(file);
  }
  return { ok: true, files };
}

export async function runAvaGithubPush({
  message = "",
  dryRun = false,
} = {}) {
  const gitRoot = findGitRoot(ROOTMC);
  if (!gitRoot) {
    const out = { ok: false, reason: "no_git_root" };
    appendAction("avaGithubPush", out);
    return out;
  }

  const prefix = workspacePrefix(gitRoot);
  const branch = git(gitRoot, ["rev-parse", "--abbrev-ref", "HEAD"]).stdout || "main";
  const remote = git(gitRoot, ["remote"]).stdout.split("\n").filter(Boolean)[0] || "origin";

  const dirty = listDirtyOwned(gitRoot, prefix);
  if (!dirty.ok) {
    const out = { ok: false, reason: "status_failed", detail: dirty.error, gitRoot };
    appendAction("avaGithubPush", out);
    return out;
  }
  if (!dirty.files.length) {
    const out = { ok: true, reason: "clean", gitRoot, branch, pushed: false };
    appendAction("avaGithubPush", out);
    return out;
  }

  if (dryRun) {
    return {
      ok: true,
      reason: "dry_run",
      gitRoot,
      branch,
      files: dirty.files,
      fileCount: dirty.files.length,
      pushed: false,
    };
  }

  // Batch add — Windows argv length limits kill a single giant add list
  for (let i = 0; i < dirty.files.length; i += 40) {
    const chunk = dirty.files.slice(i, i + 40);
    const add = git(gitRoot, ["add", "--", ...chunk]);
    if (!add.ok) {
      const out = {
        ok: false,
        reason: "add_failed",
        detail: add.stderr || add.stdout,
        gitRoot,
        chunkStart: i,
      };
      appendAction("avaGithubPush", out);
      return out;
    }
  }

  const msg =
    String(message || "").trim() ||
    `Ava: dig ship ${new Date().toISOString().slice(0, 10)} (${dirty.files.length} files)`;

  // HEREDOC-style via -m; avoid interactive
  const commit = git(gitRoot, ["commit", "-m", msg], {
    env: { ...process.env, GIT_AUTHOR_NAME: process.env.GIT_AUTHOR_NAME || "Ava Ivy", GIT_AUTHOR_EMAIL: process.env.GIT_AUTHOR_EMAIL || "ava@rootmc.net", GIT_COMMITTER_NAME: process.env.GIT_COMMITTER_NAME || "Ava Ivy", GIT_COMMITTER_EMAIL: process.env.GIT_COMMITTER_EMAIL || "ava@rootmc.net" },
  });
  if (!commit.ok && !/nothing to commit/i.test(commit.stdout + commit.stderr)) {
    const out = {
      ok: false,
      reason: "commit_failed",
      detail: commit.stderr || commit.stdout,
      gitRoot,
    };
    appendAction("avaGithubPush", out);
    return out;
  }

  // Never force on main/master
  const isMain = /^(main|master)$/i.test(branch);
  let push = git(gitRoot, ["push", "-u", remote, `HEAD:${branch}`]);
  if (!push.ok && /rejected|non-fast-forward|behind/i.test(push.stderr + push.stdout)) {
    const pull = git(gitRoot, ["pull", "--rebase", "--autostash", remote, branch]);
    if (!pull.ok) {
      const out = {
        ok: false,
        reason: "pull_rebase_failed",
        detail: pull.stderr || pull.stdout,
        gitRoot,
        branch,
        note: isMain ? "refusing force-push on main" : "rebase failed",
      };
      appendAction("avaGithubPush", out);
      return out;
    }
    push = git(gitRoot, ["push", "-u", remote, `HEAD:${branch}`]);
  }

  if (!push.ok) {
    const detail = push.stderr || push.stdout;
    const authHint = /not found|Authentication failed|could not read Username/i.test(
      detail,
    )
      ? "Operator: gh auth login/switch as Rootmcnet (RootRecord token cannot see Rootmcnet repos). See notes/GITHUB-PUSH-AUTH-GATE-2026-08-02.md"
      : null;
    const out = {
      ok: false,
      reason: "push_failed",
      detail,
      authHint,
      gitRoot,
      branch,
      committed: true,
      fileCount: dirty.files.length,
    };
    appendAction("avaGithubPush", out);
    return out;
  }

  const out = {
    ok: true,
    reason: "pushed",
    gitRoot,
    remote,
    branch,
    message: msg,
    fileCount: dirty.files.length,
    pushed: true,
    logDir: storePaths().dir,
  };
  appendAction("avaGithubPush", out);
  console.log(
    `ava-github-push · ${dirty.files.length} file(s) → ${remote}/${branch}`,
  );
  return out;
}

const isMain =
  process.argv[1] &&
  path.normalize(process.argv[1]).includes("ava-github-push.mjs");

if (isMain) {
  const msg = process.argv.slice(2).join(" ").trim();
  const dry = msg === "--dry-run";
  const result = await runAvaGithubPush({
    message: dry ? "" : msg,
    dryRun: dry,
  });
  console.log(JSON.stringify(result, null, 2));
  process.exit(result.ok ? 0 : 1);
}
