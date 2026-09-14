#!/usr/bin/env python3
"""Rebuild plugins/manifest.json from jars on disk; stage missing suite jars; deploy Pages."""
from __future__ import annotations

import hashlib
import json
import os
import re
import shutil
import subprocess
import time
from datetime import datetime, timezone
from pathlib import Path

WEB = Path("/mnt/e/.1 Work Stations/RootMC/Web Files/rootmc-web")
PUB = WEB / "public" / "plugins"
BUILD_PLUGINS = WEB / "build" / "plugins"
EMERG = Path("/mnt/e/.1 Work Stations/RootMC/emergent-repo/web/public/plugins")
TEST = Path("/home/ava-core/ava/workstations/minecraft-test/plugins")
HANDOFF_TEST = Path("/mnt/e/.1 Work Stations/RootMC/Server Handoffs/3. RootMC - Test Server/plugins")
UPLOAD = Path("/mnt/e/.1 Work Stations/RootMC/Server Handoffs/Upload Staging")
STAMP = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
BASE_URL = "https://rootmc.net/plugins"
JAR_RE = re.compile(
    r"^(?P<id>rootmc-official|rootmc|root-[a-z0-9-]+?)-(?P<ver>\d+(?:\.\d+)*)\.jar$",
    re.I,
)


def ver_key(v: str):
    parts = []
    for p in v.split("."):
        m = re.match(r"(\d+)", p)
        parts.append(int(m.group(1)) if m else 0)
    return tuple(parts)


def load_env():
    env = os.environ.copy()
    for path in [
        Path("/home/ava-core/ava/.env"),
        Path("/mnt/e/.1 Work Stations/RootMC/.env"),
    ]:
        if not path.exists():
            continue
        for line in path.read_text(encoding="utf-8", errors="replace").splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, v = line.split("=", 1)
            k, v = k.strip(), v.strip().strip('"').strip("'")
            if k and k not in env:
                env[k] = v
    # Prefer RootMC cloudflare account ids
    if env.get("ROOTMC_CLOUDFLARE_ACCOUNT_ID"):
        env["CLOUDFLARE_ACCOUNT_ID"] = env["ROOTMC_CLOUDFLARE_ACCOUNT_ID"]
    return env


def stage_newer_sources():
    """Copy known-newer jars into public/plugins if missing or older."""
    candidates = []
    for root in [
        HANDOFF_TEST,
        Path("/mnt/e/.1 Work Stations/RootMC/Server Handoffs/Upload Staging/2026-08-03-newest/plugins"),
        Path("/mnt/e/.1 Work Stations/RootMC/Plugin Building/Minecraft/plugins/root-appreciation/build/libs"),
        Path("/mnt/e/.1 Work Stations/RootMC/Plugin Building/Minecraft/plugins/root-ava-core/build/libs"),
        TEST,
    ]:
        if root.exists():
            candidates.extend(root.glob("*.jar"))

    best: dict[str, Path] = {}
    for jar in candidates:
        m = JAR_RE.match(jar.name)
        if not m:
            continue
        pid, ver = m.group("id").lower(), m.group("ver")
        cur = best.get(pid)
        if cur is None:
            best[pid] = jar
            continue
        cm = JAR_RE.match(cur.name)
        if ver_key(ver) > ver_key(cm.group("ver")):
            best[pid] = jar
        elif ver_key(ver) == ver_key(cm.group("ver")) and jar.stat().st_mtime > cur.stat().st_mtime:
            best[pid] = jar

    staged = []
    for pid, src in sorted(best.items()):
        m = JAR_RE.match(src.name)
        dest = PUB / src.name
        # remove older same-id jars in public
        for old in PUB.glob(f"{pid}-*.jar"):
            om = JAR_RE.match(old.name)
            if not om:
                continue
            if ver_key(om.group("ver")) < ver_key(m.group("ver")):
                print("remove older", old.name)
                old.unlink()
        if not dest.exists() or dest.stat().st_size != src.stat().st_size:
            shutil.copy2(src, dest)
            staged.append(src.name)
            print("staged", src, "->", dest)
        else:
            print("keep", dest.name)
    return staged


def rebuild_manifest():
    entries = {}
    for jar in sorted(PUB.glob("*.jar")):
        m = JAR_RE.match(jar.name)
        if not m:
            continue
        pid, ver = m.group("id").lower(), m.group("ver")
        prev = entries.get(pid)
        if prev and ver_key(prev["version"]) > ver_key(ver):
            continue
        entries[pid] = {
            "version": ver,
            "filename": jar.name,
            "url": f"{BASE_URL}/{jar.name}",
            "sha256": hashlib.sha256(jar.read_bytes()).hexdigest(),
            "bytes": jar.stat().st_size,
        }
    # stable key order
    ordered = {k: entries[k] for k in sorted(entries.keys())}
    # Core updater only needs version/filename/url — keep sha/bytes as extras (parser ignores unknown)
    # Actually PluginManifest only reads version/filename/url — extras OK in JSON objects
    text = json.dumps(ordered, indent=4) + "\n"
    for dest in [PUB / "manifest.json", BUILD_PLUGINS / "manifest.json"]:
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_text(text, encoding="utf-8")
        print("wrote", dest, "plugins=", len(ordered))
    if EMERG.exists():
        (EMERG / "manifest.json").write_text(text, encoding="utf-8")
    # also write slim copy without sha for max compat (same file is fine)
    return ordered


def sync_test_from_manifest(entries: dict):
    """Optional: ensure singular test has catalog jars for ids it already runs."""
    for jar in TEST.glob("root*.jar"):
        m = JAR_RE.match(jar.name)
        if not m:
            continue
        pid = m.group("id").lower()
        if pid not in entries:
            continue
        want = entries[pid]
        if jar.name == want["filename"]:
            continue
        src = PUB / want["filename"]
        if not src.exists():
            continue
        # replace older version on test
        if ver_key(want["version"]) > ver_key(m.group("ver")):
            print("test upgrade", jar.name, "->", want["filename"])
            jar.unlink()
            shutil.copy2(src, TEST / want["filename"])


def make_upload_staging(entries: dict):
    """Streamline singular server plugins into SFTP-ready Upload Staging folder."""
    stage = UPLOAD / f"singular-{STAMP}"
    plug = stage / "plugins"
    plug.mkdir(parents=True, exist_ok=True)
    # copy current test root jars + matching catalog
    copied = []
    for jar in sorted(TEST.glob("*.jar")):
        shutil.copy2(jar, plug / jar.name)
        copied.append(jar.name)
    # include manifest pointer
    (stage / "manifest.json").write_text(
        json.dumps({k: {"version": v["version"], "filename": v["filename"], "url": v["url"]} for k, v in entries.items()}, indent=4)
        + "\n",
        encoding="utf-8",
    )
    (stage / "README-SFTP.md").write_text(
        f"""# Singular host upload staging — {STAMP}

## What this is
SFTP/FileZilla-ready snapshot of the **singular** Paper test plugins + the catalog manifest.

## SFTP target (production / former Towny)
- Host IP: `15.204.13.9` (Shockbyte panel SFTP — use panel credentials)
- Remote path: usually `/plugins` (confirm in Multicraft/Shockbyte)
- RCON after cutover: same password/port as test (`25575`)

## Steps
1. SFTP upload jars from `plugins/` (replace same names; remove older `root-*-1.7.*.jar` / duplicate versions).
2. Ensure live site has current `https://rootmc.net/plugins/manifest.json` (deployed with this stamp).
3. Restart Paper once.
4. Do **not** migrate Towny worlds/playerdata/DB — fresh singular only; votes already on absolute core.

## Manifest
See `manifest.json` in this folder (mirrors rootmc.net catalog).
""",
        encoding="utf-8",
    )
    latest = UPLOAD / "singular-latest"
    if latest.exists() or latest.is_symlink():
        if latest.is_symlink() or latest.is_file():
            latest.unlink()
        else:
            shutil.rmtree(latest)
    shutil.copytree(stage, latest)
    print("upload staging", stage, "jars", len(copied))
    return stage


def deploy_pages(env: dict):
    # build
    subprocess.run(["node", "scripts/build.mjs"], cwd=str(WEB), check=True, env=env)
    # ensure build plugins manifest/jars synced from public
    if PUB.exists():
        BUILD_PLUGINS.mkdir(parents=True, exist_ok=True)
        for f in PUB.iterdir():
            if f.is_file():
                shutil.copy2(f, BUILD_PLUGINS / f.name)
    cmd = [
        "npx",
        "--yes",
        "wrangler",
        "pages",
        "deploy",
        "build",
        "--project-name",
        "rootmc-web",
        "--branch",
        "main",
        "--commit-dirty=true",
    ]
    print("deploying...", " ".join(cmd))
    r = subprocess.run(cmd, cwd=str(WEB), env=env, text=True, capture_output=True)
    print(r.stdout[-2000:] if r.stdout else "")
    print(r.stderr[-2000:] if r.stderr else "")
    if r.returncode != 0:
        raise SystemExit(f"wrangler deploy failed rc={r.returncode}")
    return True


def write_updater_script():
    script = Path("/home/ava-core/ava/core/scripts/update-plugins-manifest.py")
    script.write_text(Path(__file__).read_text(encoding="utf-8"), encoding="utf-8")
    script.chmod(0o755)
    # also under web scripts
    dest = WEB / "scripts" / "update-plugins-manifest.py"
    dest.write_text(Path(__file__).read_text(encoding="utf-8"), encoding="utf-8")
    print("saved reusable script", script)


def main():
    env = load_env()
    print("=== stage jars ===")
    staged = stage_newer_sources()
    print("=== rebuild manifest ===")
    entries = rebuild_manifest()
    print("skills ->", entries.get("root-skills"))
    print("appreciation ->", entries.get("root-appreciation"))
    print("ava-core ->", entries.get("root-ava-core"))
    print("=== sync test upgrades ===")
    sync_test_from_manifest(entries)
    print("=== upload staging ===")
    stage = make_upload_staging(entries)
    write_updater_script()
    print("=== deploy pages ===")
    try:
        deploy_pages(env)
    except Exception as e:
        print("DEPLOY_ERROR", e)
        print("Manifest updated on disk; deploy manually: cd rootmc-web && node scripts/build.mjs && npx wrangler pages deploy build --project-name rootmc-web")
        raise

    # verify live
    time.sleep(3)
    import urllib.request

    live = urllib.request.urlopen("https://rootmc.net/plugins/manifest.json", timeout=20).read()
    live_j = json.loads(live.decode("utf-8"))
    print("LIVE root-skills", live_j.get("root-skills"))
    print("LIVE root-appreciation", live_j.get("root-appreciation"))
    print("LIVE root-ava-core", live_j.get("root-ava-core"))
    print("plugin count", len(live_j))
    status = {
        "at": datetime.now(timezone.utc).isoformat(),
        "staged": staged,
        "count": len(entries),
        "upload_staging": str(stage),
        "live_skills": live_j.get("root-skills"),
        "live_appreciation": live_j.get("root-appreciation"),
        "live_ava_core": live_j.get("root-ava-core"),
    }
    Path("/home/ava-core/ava/data/notes/dev/MANIFEST-STATUS.json").write_text(
        json.dumps(status, indent=2), encoding="utf-8"
    )
    print(json.dumps(status, indent=2))
    print("MANIFEST_DEPLOY_DONE")


if __name__ == "__main__":
    main()
