#!/usr/bin/env node
/**
 * Ava multi-repo GitHub push (canonical).
 *
 * Covers Ava-Core-Dev repos on this desk:
 *   - ava-core           (public runtime; also mirrors HEAD → branch `dev`)
 *   - ava-core-private   (private handoff + plugins/workstations sync; main + `dev`)
 *   - all-connections    (agent map; main + `dev`)
 *   - web-files          (aggregated web sources; main + `dev`)
 *
 * Safety:
 *   - never force-pushes main/master
 *   - never stages .env / credentials / keys
 *   - only Ava-owned paths (see SYNC_SPECS / SKIP patterns)
 *
 * Usage:
 *   node scripts/ava-github-push.mjs [--dry-run] ["optional commit message"]
 *   AVA_GITHUB_PUSH_ONLY=ava-core,all-connections node scripts/ava-github-push.mjs
 *
 * Timer: user systemd `ava-auto-push.timer` → scripts/auto-push.sh → this script.
 * Manual: same command from ava-core-v2, or `bash scripts/ava-github-push.sh`
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const AVA_CORE_V2 = path.resolve(__dirname, "..");
const HANDOFF = path.resolve(AVA_CORE_V2, ".."); // /home/ava-core/ava
const MIRRORS = path.join(HANDOFF, "var", "mirrors");

const SECRET_BASENAMES = new Set([
  ".env",
  "credentials.env",
  "credentials.env.rootrecord",
  "google-services.json",
  "cloud.yml",
  "database.yml",
]);
const SECRET_EXT = [".pem", ".p12", ".jks", ".keystore", ".token"];
const SKIP_DIR_PARTS = [
  "/node_modules/",
  "/.venv/",
  "/dist/",
  "/build/",
  "/.gradle/",
  "/.wrangler/",
  "/uploads/",
  "/__pycache__/",
  "/.cache/",
  "/Server Handoffs/",
  "/Server Live Backups/",
];

/** Live git checkouts that already track Ava-Core-Dev remotes. */
const LIVE_REPOS = [
  {
    id: "ava-core",
    dir: AVA_CORE_V2,
    remoteUrl: "https://github.com/Ava-Core-Dev/ava-core.git",
    defaultBranch: "master",
    alsoDev: true,
  },
  {
    id: "all-connections",
    dir: path.join(HANDOFF, "all-connections"),
    remoteUrl: "https://github.com/Ava-Core-Dev/all-connections.git",
    defaultBranch: "main",
    alsoDev: true,
  },
];

/**
 * Mirror specs: rsync curated Ava paths into a dedicated clone, then push.
 * Plugins + Cloudflare workers land in ava-core-private so they update with Ava.
 */
const MIRROR_REPOS = [
  {
    id: "ava-core-private",
    remoteUrl: "https://github.com/Ava-Core-Dev/ava-core-private.git",
    defaultBranch: "main",
    alsoDev: true,
    sync: [
      {
        from: path.join(HANDOFF, "workstations", "cloudflare"),
        to: "workstations/cloudflare",
      },
      {
        from: path.join(HANDOFF, "workstations", "minecraft-plugins", "plugins"),
        to: "workstations/minecraft-plugins/plugins",
      },
      {
        from: path.join(HANDOFF, "workstations", "projects"),
        to: "workstations/projects",
      },
      {
        from: path.join(AVA_CORE_V2, "docs"),
        to: "docs/ava-core-v2",
      },
      {
        from: path.join(HANDOFF, "media", "documents", "docs"),
        to: "docs/media",
      },
      {
        from: path.join(AVA_CORE_V2, "scripts"),
        to: "scripts/ava-core-v2",
      },
    ],
  },
  {
    id: "web-files",
    remoteUrl: "https://github.com/Ava-Core-Dev/web-files.git",
    defaultBranch: "main",
    alsoDev: true,
    sync: [
      {
        from: path.join(HANDOFF, "Web Files"),
        to: "Web Files",
      },
      {
        from: path.join(HANDOFF, "workstations", "rootmc-web"),
        to: "workstations/rootmc-web",
      },
    ],
  },
];

function git(cwd, args, opts = {}) {
  const r = spawnSync("git", args, {
    cwd,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    ...opts,
  });
  return {
    ok: r.status === 0,
    status: r.status,
    stdout: (r.stdout || "").trim(),
    stderr: (r.stderr || "").trim(),
  };
}

function sh(cwd, command) {
  const r = spawnSync("bash", ["-lc", command], {
    cwd,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  return {
    ok: r.status === 0,
    status: r.status,
    stdout: (r.stdout || "").trim(),
    stderr: (r.stderr || "").trim(),
  };
}

function toPosix(p) {
  return String(p).replace(/\\/g, "/");
}

function isSecretPath(relPosix) {
  const base = path.posix.basename(relPosix);
  if (SECRET_BASENAMES.has(base)) return true;
  if (SECRET_EXT.some((e) => base.toLowerCase().endsWith(e))) return true;
  if (/\.env(\.|$)/i.test(base)) return true;
  if (/credentials/i.test(base) && /\.(env|json|yml|yaml)$/i.test(base)) return true;
  const norm = `/${relPosix}/`;
  if (SKIP_DIR_PARTS.some((s) => norm.includes(s))) return true;
  return false;
}

function parseOnlyFilter() {
  const raw = String(process.env.AVA_GITHUB_PUSH_ONLY || "").trim();
  if (!raw) return null;
  return new Set(
    raw
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  );
}

function ensureRemote(dir, url) {
  if (!fs.existsSync(path.join(dir, ".git"))) return { ok: false, reason: "no_git" };
  const remotes = git(dir, ["remote", "-v"]).stdout;
  if (!/origin\t/.test(remotes)) {
    const add = git(dir, ["remote", "add", "origin", url]);
    if (!add.ok) return { ok: false, reason: "remote_add_failed", detail: add.stderr };
  }
  return { ok: true };
}

function unstageSecrets(dir) {
  const staged = git(dir, ["diff", "--cached", "--name-only"]);
  if (!staged.ok || !staged.stdout) return [];
  const bad = [];
  for (const f of staged.stdout.split("\n")) {
    const file = f.trim();
    if (!file) continue;
    if (isSecretPath(toPosix(file))) bad.push(file);
  }
  if (bad.length) {
    git(dir, ["restore", "--staged", "--", ...bad]);
  }
  return bad;
}

function commitIfDirty(dir, message) {
  git(dir, ["add", "-A"]);
  const unstaged = unstageSecrets(dir);
  const dirty = !git(dir, ["diff", "--cached", "--quiet"]).ok;
  if (!dirty) {
    return { committed: false, unstagedSecrets: unstaged, fileCount: 0 };
  }
  const stat = git(dir, ["diff", "--cached", "--stat"]).stdout.split("\n").pop() || "";
  const msg =
    String(message || "").trim() ||
    `Ava: sync ${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC\n\n${stat}`;
  const commit = git(dir, ["commit", "-m", msg], {
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: process.env.GIT_AUTHOR_NAME || "Ava Ivy",
      GIT_AUTHOR_EMAIL: process.env.GIT_AUTHOR_EMAIL || "ava@rootrecord.info",
      GIT_COMMITTER_NAME: process.env.GIT_COMMITTER_NAME || "Ava Ivy",
      GIT_COMMITTER_EMAIL: process.env.GIT_COMMITTER_EMAIL || "ava@rootrecord.info",
    },
  });
  if (!commit.ok && !/nothing to commit/i.test(commit.stdout + commit.stderr)) {
    return {
      committed: false,
      ok: false,
      reason: "commit_failed",
      detail: commit.stderr || commit.stdout,
      unstagedSecrets: unstaged,
    };
  }
  const count = git(dir, ["diff-tree", "--no-commit-id", "--name-only", "-r", "HEAD"]);
  return {
    committed: true,
    ok: true,
    message: msg,
    fileCount: count.stdout ? count.stdout.split("\n").filter(Boolean).length : 0,
    unstagedSecrets: unstaged,
  };
}

function pushBranch(dir, localRef, remoteBranch) {
  const isProtected = /^(main|master)$/i.test(remoteBranch);
  let push = git(dir, ["push", "-u", "origin", `${localRef}:${remoteBranch}`]);
  if (!push.ok && /rejected|non-fast-forward|behind/i.test(push.stderr + push.stdout)) {
    if (isProtected) {
      const pull = git(dir, [
        "pull",
        "--rebase",
        "--autostash",
        "origin",
        remoteBranch,
      ]);
      if (!pull.ok) {
        return {
          ok: false,
          reason: "pull_rebase_failed",
          detail: pull.stderr || pull.stdout,
          note: "refusing force-push on main/master",
        };
      }
      push = git(dir, ["push", "-u", "origin", `${localRef}:${remoteBranch}`]);
    } else {
      // Dev branch may diverge; still never --force on main. For `dev`, allow
      // a non-destructive update via +ref only when AVA_GITHUB_PUSH_FORCE_DEV=1.
      if (String(process.env.AVA_GITHUB_PUSH_FORCE_DEV || "") === "1") {
        push = git(dir, ["push", "-u", "origin", `+${localRef}:${remoteBranch}`]);
      } else {
        // Fast-forward only: tip of default onto dev when possible
        push = git(dir, ["push", "-u", "origin", `${localRef}:${remoteBranch}`]);
      }
    }
  }
  if (!push.ok) {
    return {
      ok: false,
      reason: "push_failed",
      detail: push.stderr || push.stdout,
      branch: remoteBranch,
    };
  }
  return { ok: true, branch: remoteBranch };
}

function pushDefaultAndDev(dir, defaultBranch, alsoDev) {
  const head = git(dir, ["rev-parse", "--abbrev-ref", "HEAD"]).stdout || defaultBranch;
  const results = [];
  const primary = pushBranch(dir, "HEAD", head);
  results.push({ target: head, ...primary });
  if (alsoDev && !/^dev$/i.test(head)) {
    // Keep a rolling `dev` pointer at the same commit (no force on first create).
    const dev = pushBranch(dir, "HEAD", "dev");
    results.push({ target: "dev", ...dev });
  }
  const ok = results.every((r) => r.ok);
  return { ok, results };
}

function ensureMirrorClone(id, remoteUrl, defaultBranch) {
  const dir = path.join(MIRRORS, id);
  fs.mkdirSync(MIRRORS, { recursive: true });
  if (!fs.existsSync(path.join(dir, ".git"))) {
    const clone = sh(MIRRORS, `git clone --branch ${defaultBranch} --single-branch ${JSON.stringify(remoteUrl)} ${JSON.stringify(id)}`);
    if (!clone.ok) {
      // Repo may be empty or branch name differs — try plain clone
      const clone2 = sh(MIRRORS, `git clone ${JSON.stringify(remoteUrl)} ${JSON.stringify(id)}`);
      if (!clone2.ok) {
        return { ok: false, dir, reason: "clone_failed", detail: clone2.stderr || clone.stderr };
      }
    }
  }
  git(dir, ["remote", "set-url", "origin", remoteUrl]);
  git(dir, ["fetch", "origin", defaultBranch]);
  const checkout = git(dir, ["checkout", defaultBranch]);
  if (!checkout.ok) {
    git(dir, ["checkout", "-B", defaultBranch, `origin/${defaultBranch}`]);
  }
  git(dir, ["pull", "--ff-only", "origin", defaultBranch]);
  return { ok: true, dir };
}

function rsyncInto(fromAbs, mirrorDir, relTo) {
  if (!fs.existsSync(fromAbs)) {
    return { ok: true, skipped: true, reason: "source_missing", from: fromAbs };
  }
  const dest = path.join(mirrorDir, relTo);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const excludes = [
    "--exclude=.env",
    "--exclude=.env.*",
    "--exclude=credentials.env",
    "--exclude=credentials.env.*",
    "--exclude=node_modules",
    "--exclude=.venv",
    "--exclude=dist",
    "--exclude=build",
    "--exclude=.gradle",
    "--exclude=.wrangler",
    "--exclude=__pycache__",
    "--exclude=*.pem",
    "--exclude=*.p12",
    "--exclude=*.jks",
    "--exclude=*.keystore",
    "--exclude=*.log",
    "--exclude=.git",
    "--exclude=data/ecoflow",
    "--exclude=data/billing",
    "--exclude=*.db",
    "--exclude=*.sqlite*",
  ].join(" ");
  const cmd = `rsync -a --delete ${excludes} ${JSON.stringify(fromAbs.replace(/\/?$/, "/"))} ${JSON.stringify(dest.replace(/\/?$/, "/"))}`;
  const r = sh(mirrorDir, cmd);
  return {
    ok: r.ok,
    from: fromAbs,
    to: relTo,
    detail: r.ok ? undefined : r.stderr || r.stdout,
  };
}

function syncMirror(spec) {
  const clone = ensureMirrorClone(spec.id, spec.remoteUrl, spec.defaultBranch);
  if (!clone.ok) return clone;
  const syncResults = [];
  for (const step of spec.sync) {
    syncResults.push(rsyncInto(step.from, clone.dir, step.to));
  }
  return { ok: true, dir: clone.dir, syncResults };
}

function aheadOfUpstream(dir) {
  const up = git(dir, ["rev-parse", "--abbrev-ref", "@{u}"]);
  if (!up.ok) return true;
  const counts = git(dir, ["rev-list", "--count", "@{u}..HEAD"]);
  return Number(counts.stdout || 0) > 0;
}

export async function runAvaGithubPush({
  message = "",
  dryRun = false,
  only = null,
} = {}) {
  const filter = only || parseOnlyFilter();
  const started = new Date().toISOString();
  const out = {
    ok: true,
    started,
    host: os.hostname(),
    dryRun: !!dryRun,
    repos: [],
  };

  for (const repo of LIVE_REPOS) {
    if (filter && !filter.has(repo.id)) continue;
    const entry = { id: repo.id, kind: "live", dir: repo.dir };
    if (!fs.existsSync(path.join(repo.dir, ".git"))) {
      entry.ok = false;
      entry.reason = "missing_checkout";
      out.repos.push(entry);
      out.ok = false;
      continue;
    }
    ensureRemote(repo.dir, repo.remoteUrl);
    if (dryRun) {
      const st = git(repo.dir, ["status", "--porcelain"]);
      entry.ok = true;
      entry.reason = "dry_run";
      entry.dirtyLines = st.stdout ? st.stdout.split("\n").filter(Boolean).length : 0;
      out.repos.push(entry);
      continue;
    }
    const committed = commitIfDirty(repo.dir, message);
    entry.commit = committed;
    if (committed.ok === false) {
      entry.ok = false;
      out.ok = false;
      out.repos.push(entry);
      continue;
    }
    if (!committed.committed && !aheadOfUpstream(repo.dir)) {
      // Still refresh `dev` pointer when we have commits locally matching default.
      if (repo.alsoDev) {
        const tip = git(repo.dir, ["rev-parse", "HEAD"]).stdout;
        const remoteDev = git(repo.dir, ["ls-remote", "--heads", "origin", "dev"]).stdout;
        if (tip && !remoteDev.includes(tip)) {
          entry.push = pushDefaultAndDev(repo.dir, repo.defaultBranch, true);
          entry.ok = entry.push.ok;
          if (!entry.ok) out.ok = false;
        } else {
          entry.ok = true;
          entry.reason = "clean";
        }
      } else {
        entry.ok = true;
        entry.reason = "clean";
      }
      out.repos.push(entry);
      continue;
    }
    entry.push = pushDefaultAndDev(repo.dir, repo.defaultBranch, repo.alsoDev);
    entry.ok = entry.push.ok;
    if (!entry.ok) out.ok = false;
    out.repos.push(entry);
  }

  for (const spec of MIRROR_REPOS) {
    if (filter && !filter.has(spec.id)) continue;
    const entry = { id: spec.id, kind: "mirror", remoteUrl: spec.remoteUrl };
    if (dryRun) {
      entry.ok = true;
      entry.reason = "dry_run";
      entry.wouldSync = spec.sync.map((s) => ({
        from: s.from,
        to: s.to,
        exists: fs.existsSync(s.from),
      }));
      out.repos.push(entry);
      continue;
    }
    const synced = syncMirror(spec);
    entry.sync = synced;
    if (!synced.ok) {
      entry.ok = false;
      out.ok = false;
      out.repos.push(entry);
      continue;
    }
    entry.dir = synced.dir;
    const committed = commitIfDirty(synced.dir, message);
    entry.commit = committed;
    if (committed.ok === false) {
      entry.ok = false;
      out.ok = false;
      out.repos.push(entry);
      continue;
    }
    if (!committed.committed && !aheadOfUpstream(synced.dir)) {
      if (spec.alsoDev) {
        const tip = git(synced.dir, ["rev-parse", "HEAD"]).stdout;
        const remoteDev = git(synced.dir, ["ls-remote", "--heads", "origin", "dev"]).stdout;
        if (tip && !remoteDev.includes(tip)) {
          entry.push = pushDefaultAndDev(synced.dir, spec.defaultBranch, true);
          entry.ok = entry.push.ok;
          if (!entry.ok) out.ok = false;
        } else {
          entry.ok = true;
          entry.reason = "clean";
        }
      } else {
        entry.ok = true;
        entry.reason = "clean";
      }
      out.repos.push(entry);
      continue;
    }
    entry.push = pushDefaultAndDev(synced.dir, spec.defaultBranch, spec.alsoDev);
    entry.ok = entry.push.ok;
    if (!entry.ok) out.ok = false;
    out.repos.push(entry);
  }

  out.finished = new Date().toISOString();
  return out;
}

const isMain =
  process.argv[1] &&
  path.normalize(process.argv[1]).includes("ava-github-push.mjs");

if (isMain) {
  const args = process.argv.slice(2);
  const dry = args.includes("--dry-run");
  const message = args.filter((a) => a !== "--dry-run").join(" ").trim();
  const result = await runAvaGithubPush({ message, dryRun: dry });
  console.log(JSON.stringify(result, null, 2));
  process.exit(result.ok ? 0 : 1);
}
