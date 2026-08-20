"""Manage drop-in Python scripts with visible terminal windows."""

from __future__ import annotations

import asyncio
import json
import logging
import os
import shlex
import signal
import shutil
import time
from dataclasses import dataclass
from pathlib import Path

from apps.core import config

log = logging.getLogger("ava.python_drop_runner")

CONFIG_NAME = "python-script-autostart.json"
SHORT_RUN_S = 15
MAX_SHORT_RESTARTS = 2


def _now() -> int:
    return int(time.time())


def _term_cmd(title: str, script: Path) -> list[str]:
    quoted = shlex.quote(str(script))
    run = (
        f"cd {shlex.quote(str(script.parent))} && "
        f"python3 {quoted}; "
        f"rc=$?; "
        f"echo; echo '[ava] process exited with code' $rc; "
        f"echo '[ava] window auto-closes in 8s'; sleep 8"
    )
    term = (
        shutil.which("x-terminal-emulator")
        or shutil.which("gnome-terminal")
        or shutil.which("konsole")
        or shutil.which("xfce4-terminal")
    )
    if not term:
        return ["bash", "-lc", run]
    if term.endswith("gnome-terminal"):
        return [term, "--title", title, "--", "bash", "-lc", run]
    if term.endswith("konsole"):
        return [term, "--new-tab", "-p", f"tabtitle={title}", "-e", "bash", "-lc", run]
    if term.endswith("xfce4-terminal"):
        return [term, "--title", title, "-e", f"bash -lc {shlex.quote(run)}"]
    return [term, "-T", title, "-e", "bash", "-lc", run]


@dataclass
class ProcState:
    proc: asyncio.subprocess.Process
    started_at: float
    restarts_short: int = 0


class PythonDropRunner:
    def __init__(self) -> None:
        self.drop_dir = config.AUTOMATION_DROP_DIR
        self.cfg_path = self.drop_dir / CONFIG_NAME
        self._task: asyncio.Task | None = None
        self._stop = asyncio.Event()
        self._procs: dict[str, ProcState] = {}

    def ensure_bootstrap(self) -> None:
        self.drop_dir.mkdir(parents=True, exist_ok=True)
        if not self.cfg_path.exists():
            self._write_cfg({"version": 1, "scripts": {}, "updated_at": _now()})

    def _read_cfg(self) -> dict:
        self.ensure_bootstrap()
        try:
            return json.loads(self.cfg_path.read_text(encoding="utf-8"))
        except Exception:
            data = {"version": 1, "scripts": {}, "updated_at": _now()}
            self._write_cfg(data)
            return data

    def _write_cfg(self, data: dict) -> None:
        data["updated_at"] = _now()
        self.cfg_path.write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")

    def _discover(self, cfg: dict) -> dict:
        scripts = dict(cfg.get("scripts") or {})
        py_files = sorted(self.drop_dir.glob("*.py"))
        seen = set()
        for p in py_files:
            key = p.name
            seen.add(key)
            if key not in scripts:
                scripts[key] = {
                    "enabled": True,
                    "autostart": True,
                    "window": True,
                    "restart_on_exit": True,
                    "short_restart_limit": MAX_SHORT_RESTARTS,
                    "short_restarts": 0,
                    "disabled_reason": "",
                    "last_start_ts": None,
                    "last_exit_ts": None,
                    "last_exit_code": None,
                }
        for key in list(scripts.keys()):
            if key not in seen:
                scripts[key]["enabled"] = False
                scripts[key]["disabled_reason"] = "file_missing"
        cfg["scripts"] = scripts
        self._write_cfg(cfg)
        return cfg

    def rescan(self) -> dict:
        return self._discover(self._read_cfg())

    def status(self) -> dict:
        cfg = self.rescan()
        scripts = dict(cfg.get("scripts") or {})
        running = {
            name: {
                "pid": st.proc.pid,
                "started_at": int(st.started_at),
                "alive": st.proc.returncode is None,
                "short_restarts_live": st.restarts_short,
            }
            for name, st in self._procs.items()
        }
        return {
            "ok": True,
            "drop_dir": str(self.drop_dir),
            "config_path": str(self.cfg_path),
            "scripts": scripts,
            "running": running,
        }

    def update_script(self, name: str, *, enabled: bool | None = None, autostart: bool | None = None, restart_on_exit: bool | None = None) -> dict:
        cfg = self.rescan()
        scripts = dict(cfg.get("scripts") or {})
        if name not in scripts:
            return {"ok": False, "detail": "script_not_found", "name": name}
        row = dict(scripts[name])
        if enabled is not None:
            row["enabled"] = bool(enabled)
            if enabled:
                row["disabled_reason"] = ""
                row["short_restarts"] = 0
        if autostart is not None:
            row["autostart"] = bool(autostart)
        if restart_on_exit is not None:
            row["restart_on_exit"] = bool(restart_on_exit)
        scripts[name] = row
        cfg["scripts"] = scripts
        self._write_cfg(cfg)
        return {"ok": True, "script": {name: row}}

    async def _spawn(self, script: Path, meta: dict) -> asyncio.subprocess.Process | None:
        title = f"Ava Script: {script.name}"
        cmd = _term_cmd(title, script)
        env = os.environ.copy()
        try:
            proc = await asyncio.create_subprocess_exec(
                *cmd,
                cwd=str(script.parent),
                env=env,
                start_new_session=True,
            )
            meta["last_start_ts"] = _now()
            log.info("started drop script %s pid=%s", script.name, proc.pid)
            return proc
        except Exception as e:
            meta["last_exit_code"] = -1
            meta["disabled_reason"] = f"spawn_failed:{e}"
            log.warning("spawn failed %s: %s", script, e)
            return None

    async def _stop_one(self, name: str) -> None:
        st = self._procs.get(name)
        if not st:
            return
        try:
            st.proc.send_signal(signal.SIGTERM)
        except Exception:
            pass
        self._procs.pop(name, None)

    async def _loop(self) -> None:
        self.ensure_bootstrap()
        while not self._stop.is_set():
            cfg = self._discover(self._read_cfg())
            scripts: dict = cfg.get("scripts") or {}
            for name, meta in scripts.items():
                script = self.drop_dir / name
                enabled = bool(meta.get("enabled", True) and meta.get("autostart", True))
                cur = self._procs.get(name)
                if not enabled:
                    if cur:
                        await self._stop_one(name)
                    continue
                if not script.exists():
                    continue
                if not cur:
                    proc = await self._spawn(script, meta)
                    if proc is not None:
                        self._procs[name] = ProcState(proc=proc, started_at=time.time(), restarts_short=int(meta.get("short_restarts") or 0))
                    continue
                if cur.proc.returncode is None:
                    continue
                runtime = time.time() - cur.started_at
                meta["last_exit_ts"] = _now()
                meta["last_exit_code"] = cur.proc.returncode
                self._procs.pop(name, None)
                if runtime < SHORT_RUN_S:
                    cur.restarts_short += 1
                    meta["short_restarts"] = cur.restarts_short
                else:
                    meta["short_restarts"] = 0
                    cur.restarts_short = 0
                limit = int(meta.get("short_restart_limit") or MAX_SHORT_RESTARTS)
                if int(meta.get("short_restarts") or 0) > limit:
                    meta["enabled"] = False
                    meta["disabled_reason"] = "too_many_short_restarts"
                    log.warning("auto-disabled %s after short restarts", name)
                    continue
                if bool(meta.get("restart_on_exit", True)):
                    proc = await self._spawn(script, meta)
                    if proc is not None:
                        self._procs[name] = ProcState(
                            proc=proc,
                            started_at=time.time(),
                            restarts_short=int(meta.get("short_restarts") or 0),
                        )
            self._write_cfg(cfg)
            try:
                await asyncio.wait_for(self._stop.wait(), timeout=4.0)
            except asyncio.TimeoutError:
                pass

    def start(self) -> None:
        if self._task and not self._task.done():
            return
        self._stop.clear()
        self._task = asyncio.create_task(self._loop(), name="python-drop-runner")

    async def stop(self) -> None:
        self._stop.set()
        if self._task:
            try:
                await asyncio.wait_for(self._task, timeout=5.0)
            except Exception:
                self._task.cancel()
        for name in list(self._procs.keys()):
            await self._stop_one(name)


_runner = PythonDropRunner()


def get_runner() -> PythonDropRunner:
    return _runner


def ensure_running() -> None:
    _runner.start()
