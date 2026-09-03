"""Sync holding HTML and deploy the live visitor worker (rootrecord-cloud).

Canonical HTML: apps/core/static/maintenance.html
Mirror: Sites/Holding/index.html
Worker embed: packages/workers/src/shared/maintenancePage.ts
Live host: https://rootrecord.cloud/  (not Pages, not rootmc-api, not /ops)

Reuses windows/sync_maintenance_html.py then wrangler deploy
-c wrangler.rootrecord-cloud.toml. Skips deploy when sources are unchanged.
"""
from __future__ import annotations

import hashlib
import os
import subprocess
import sys
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

CREATE_NO_WINDOW = 0x08000000
REPO = Path(__file__).resolve().parents[1]
LOG_DIR = Path(os.environ.get("AVA_AUTO_PUSH_LOG_DIR", str(REPO / "data" / "logs")))
LOG = LOG_DIR / "site-update.log"
STAMP = LOG_DIR / "site-update.stamp"
HTML = REPO / "apps" / "core" / "static" / "maintenance.html"
HOLDING = REPO / "Sites" / "Holding" / "index.html"
SYNC_PY = REPO / "windows" / "sync_maintenance_html.py"
WORKER_DIR = REPO / "packages" / "workers"
TOML = WORKER_DIR / "wrangler.rootrecord-cloud.toml"
WATCHED = (
    HTML,
    REPO / "packages" / "workers" / "holding-worker.ts",
    REPO / "packages" / "workers" / "src" / "shared" / "maintenancePage.ts",
    REPO / "packages" / "workers" / "wrangler.rootrecord-cloud.toml",
)
XDG = Path.home() / "AppData" / "Roaming" / "xdg.config"
NODE_DIR = Path(r"C:\Program Files\nodejs")


def log(msg: str) -> None:
    LOG_DIR.mkdir(parents=True, exist_ok=True)
    LOG.open("a", encoding="utf-8").write(f"{datetime.now(timezone.utc).isoformat()} {msg}\n")


def _sources_hash() -> str:
    h = hashlib.sha256()
    for p in WATCHED:
        h.update(p.as_posix().encode())
        h.update(b"\0")
        if p.is_file():
            h.update(p.read_bytes())
        h.update(b"\0")
    return h.hexdigest()


def _node_env() -> dict:
    env = os.environ.copy()
    if NODE_DIR.is_dir():
        env["PATH"] = str(NODE_DIR) + os.pathsep + env.get("PATH", "")
    if XDG.is_dir():
        env["XDG_CONFIG_HOME"] = str(XDG)
    env.pop("CLOUDFLARE_API_TOKEN", None)
    env.pop("CLOUDFLARE_API_KEY", None)
    return env


def _wrangler_cmd() -> list[str]:
    local = WORKER_DIR / "node_modules" / ".bin" / "wrangler.cmd"
    npx = NODE_DIR / "npx.cmd"
    if local.is_file():
        return [str(local)]
    if npx.is_file():
        return [str(npx), "--yes", "wrangler"]
    return ["npx", "--yes", "wrangler"]


def _run(cmd: list[str], cwd: Path, timeout: int) -> subprocess.CompletedProcess:
    return subprocess.run(
        cmd,
        cwd=str(cwd),
        env=_node_env(),
        capture_output=True,
        text=True,
        timeout=timeout,
        creationflags=CREATE_NO_WINDOW if os.name == "nt" else 0,
    )


def _http_status(url: str) -> int | None:
    try:
        req = urllib.request.Request(url, method="GET", headers={"User-Agent": "AVA-CORE-site-update"})
        with urllib.request.urlopen(req, timeout=20) as r:
            return int(r.status)
    except urllib.error.HTTPError as e:
        return int(e.code)
    except Exception as e:
        log(f"http {url} failed: {type(e).__name__}")
        return None


def _sync_files(dry: bool) -> bool:
    if not HTML.is_file():
        log("skip: missing canonical maintenance.html")
        return False
    src = HTML.read_text(encoding="utf-8")
    if (not HOLDING.is_file()) or HOLDING.read_text(encoding="utf-8") != src:
        if dry:
            log("dry-run: would write Sites/Holding/index.html")
        else:
            HOLDING.parent.mkdir(parents=True, exist_ok=True)
            HOLDING.write_text(src, encoding="utf-8", newline="\n")
            log("wrote Sites/Holding/index.html")
    if dry:
        log("dry-run: would run sync_maintenance_html.py")
        return True
    py = REPO / ".venv" / "Scripts" / "python.exe"
    r = subprocess.run(
        [str(py if py.is_file() else sys.executable), str(SYNC_PY)],
        cwd=str(REPO),
        capture_output=True,
        text=True,
        timeout=30,
        creationflags=CREATE_NO_WINDOW if os.name == "nt" else 0,
    )
    if r.returncode != 0:
        log("sync_maintenance_html failed")
        return False
    log((r.stdout or "").strip() or "sync_maintenance_html ok")
    return True


def _verify_public() -> int:
    home = _http_status("https://rootrecord.cloud/")
    ops = _http_status("https://rootrecord.cloud/ops")
    log(f"public /={home} /ops={ops}")
    if home != 200:
        return 1
    if ops != 404:
        return 1
    return 0


def main(argv: list[str]) -> int:
    dry = "--dry-run" in argv
    force = "--force" in argv
    if os.environ.get("AVA_SITE_UPDATE", "1").lower() in {"0", "false", "no"}:
        return 0
    if not TOML.is_file():
        log("skip: missing wrangler.rootrecord-cloud.toml")
        return 1
    if not _sync_files(dry):
        return 1
    digest = _sources_hash()
    prev = STAMP.read_text(encoding="utf-8").strip() if STAMP.is_file() else ""
    if digest == prev and not force:
        log("unchanged: skip wrangler deploy")
        return _verify_public() if not dry else 0
    cmd = _wrangler_cmd() + ["deploy", "-c", "wrangler.rootrecord-cloud.toml"]
    if dry:
        log("dry-run: would " + " ".join(cmd))
        return 0
    log("deploy rootrecord-cloud")
    r = _run(cmd, WORKER_DIR, timeout=480)
    out = ((r.stdout or "") + "\n" + (r.stderr or "")).strip().splitlines()
    safe = [ln for ln in out if "oauth_token" not in ln.lower() and "api_token" not in ln.lower() and "cfoat_" not in ln]
    for ln in safe[-8:]:
        if ln.strip():
            log("wrangler: " + ln.strip()[:240])
    if r.returncode != 0:
        log("wrangler deploy failed")
        return 1
    STAMP.write_text(digest + "\n", encoding="utf-8")
    log("deployed rootrecord-cloud")
    return _verify_public()


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
