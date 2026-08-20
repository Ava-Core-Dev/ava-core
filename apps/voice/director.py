"""
Stream Director — centralized audio/video manager for Ava streams.

Priority queue with pause/resume. Higher priority pauses current playback,
plays to completion, then resumes the paused track where it left off.
OBS WebSocket 5.x integration for scene/source switching and media control.

Priority tiers:
  P3 Critical  — earthquake alert, eruption alert (interrupts immediately)
  P2 Scheduled — hourly chime, time announcement
  P1 Report    — voice reports (weather, solar, economy, volcano) — queued FIFO
  P0 Ambient   — rotating background MP4 playlist (paused by everything)
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import pwd
import shutil
import subprocess
import time
from dataclasses import dataclass, field
from enum import IntEnum
from pathlib import Path
from typing import Any

import websockets


def _find_audio_player() -> list[str] | None:
    """Return command prefix for the best available headless MP3 player."""
    if shutil.which("mpg123"):
        return ["mpg123", "-q"]
    if shutil.which("mpv"):
        return ["mpv", "--no-video", "--really-quiet"]
    if shutil.which("ffplay"):
        return ["ffplay", "-nodisp", "-autoexit", "-loglevel", "quiet"]
    if shutil.which("cvlc"):
        return ["cvlc", "--play-and-exit", "--quiet"]
    return None

log = logging.getLogger("ava.director")


class Priority(IntEnum):
    AMBIENT   = 0
    REPORT    = 1
    SCHEDULED = 2
    CRITICAL  = 3


@dataclass(order=True)
class AudioItem:
    priority: int
    ts: float = field(compare=False, default_factory=time.monotonic)
    path: Path = field(compare=False, default=None)
    name: str = field(compare=False, default="")
    scene: str | None = field(compare=False, default=None)   # OBS scene to switch to

    def to_sse(self) -> dict:
        return {
            "src": f"/data/generated/{self.path.name}",
            "name": self.name,
            "priority": self.priority,
        }


# ── OBS Scene Configuration ───────────────────────────────────────────────────
# These must match scene names exactly as they appear in OBS Studio.
# Update here first; OBS scene names should match these strings.

# Scene shown when nothing specific is active
DEFAULT_SCENE = "Main"

# Scene shown during planned downtime / solar night
BRB_SCENE = "Be right back"

# Scene map — keyword → OBS scene name
# Keywords are matched against AudioItem.name (lowercased).
# First match wins. "default" is the fallback if no keyword matches.
SCENE_MAP: dict[str, str] = {
    # Geologic / emergency alerts — switch immediately
    "kilauea":       "Kilauea Watch",
    "eruption":      "Kilauea Watch",
    "volcano":       "Kilauea Watch",
    "earthquake":    "Quake Overlay",
    "quake":         "Quake Overlay",
    "tsunami":       "Quake Overlay",
    # Weather
    "weather":       "Weather Board",
    "noaa":          "Weather Board",
    "tropical":      "Weather Board",
    "hurricane":     "Weather Board",
    "storm":         "Weather Board",
    # Solar / power
    "solar":         "Solar Dashboard",
    "battery":       "Solar Dashboard",
    "power":         "Solar Dashboard",
    "ecoflow":       "Solar Dashboard",
    # Economy / RootMC
    "economy":       "Economy Board",
    "finance":       "Economy Board",
    "gold":          "Economy Board",
    "rootmc":        "RootMC Live",
    "minecraft":     "RootMC Live",
    "server":        "RootMC Live",
    # Reports / status
    "morning":       "Main",
    "report":        "Main",
    "status":        "Main",
    "overnight":     "Main",
    # Hourly / ambient
    "chime":         "Main",
    "hourly":        "Main",
    "ambient":       "Ambient Playlist",
    # Fallback
    "default":       DEFAULT_SCENE,
}

def scene_for(name: str) -> str:
    """Return the OBS scene name for a given audio item name."""
    name_lower = name.lower()
    for keyword, scene in SCENE_MAP.items():
        if keyword == "default":
            continue
        if keyword in name_lower:
            return scene
    return DEFAULT_SCENE


class StreamDirector:
    def __init__(self):
        self._queue: asyncio.PriorityQueue = asyncio.PriorityQueue()
        self._current: AudioItem | None = None
        self._paused: AudioItem | None = None
        self._paused_position: float = 0.0
        self._running = False
        self._obs_ws: Any | None = None
        self._sse_listeners: list[asyncio.Queue] = []

    # ── Public API ────────────────────────────────────────────────────────────

    async def queue(self, path: Path, name: str = "", priority: int = Priority.REPORT,
                    scene: str | None = None) -> None:
        """Submit audio to the queue. Higher priority pauses current playback."""
        resolved_scene = scene if scene is not None else scene_for(name)
        item = AudioItem(priority=-(priority), path=path, name=name, scene=resolved_scene)
        await self._queue.put(item)
        log.info("Queued: %s  priority=%s", name or path.name, priority)

    async def queue_chime(self, path: Path) -> None:
        await self.queue(path, name="Hourly Chime", priority=Priority.SCHEDULED, scene="Main")

    async def queue_report(self, path: Path, name: str, report_type: str = "") -> None:
        scene = SCENE_MAP.get(report_type.lower())
        await self.queue(path, name=name, priority=Priority.REPORT, scene=scene)

    async def queue_alert(self, path: Path, name: str) -> None:
        await self.queue(path, name=name, priority=Priority.CRITICAL, scene="Kilauea Watch")

    def get_status(self) -> dict:
        return {
            "running": self._running,
            "current": self._current.name if self._current else None,
            "paused": self._paused.name if self._paused else None,
            "queue_depth": self._queue.qsize(),
            "obs_connected": self._obs_ws is not None,
        }

    # ── OBS WebSocket ─────────────────────────────────────────────────────────

    async def _connect_obs(self) -> bool:
        from apps.core import config
        if not config.OBS_WS_URL:
            return False
        try:
            self._obs_ws = await websockets.connect(config.OBS_WS_URL, ping_interval=20)
            # OBS WebSocket 5.x Hello → Identify handshake
            hello = json.loads(await self._obs_ws.recv())
            auth = hello.get("d", {}).get("authentication")
            identify: dict = {"op": 1, "d": {"rpcVersion": 1}}
            if auth and config.OBS_WS_PASSWORD:
                import base64, hashlib
                challenge = auth["challenge"]
                salt = auth["salt"]
                secret = base64.b64encode(
                    hashlib.sha256((config.OBS_WS_PASSWORD + salt).encode()).digest()
                ).decode()
                auth_str = base64.b64encode(
                    hashlib.sha256((secret + challenge).encode()).digest()
                ).decode()
                identify["d"]["authentication"] = auth_str
            await self._obs_ws.send(json.dumps(identify))
            identified = json.loads(await self._obs_ws.recv())
            log.info("OBS WebSocket connected  op=%s", identified.get("op"))
            return True
        except Exception as e:
            log.warning("OBS WebSocket connect failed: %s", e)
            self._obs_ws = None
            return False

    async def _obs_request(self, request_type: str, data: dict | None = None) -> dict | None:
        if not self._obs_ws:
            return None
        try:
            import uuid
            req_id = str(uuid.uuid4())[:8]
            payload = {"op": 6, "d": {"requestType": request_type,
                                       "requestId": req_id,
                                       "requestData": data or {}}}
            await self._obs_ws.send(json.dumps(payload))
            resp = json.loads(await asyncio.wait_for(self._obs_ws.recv(), timeout=5))
            return resp.get("d", {})
        except Exception as e:
            log.warning("OBS request %s failed: %s", request_type, e)
            self._obs_ws = None
            return None

    async def _switch_scene(self, scene_name: str) -> None:
        await self._obs_request("SetCurrentProgramScene", {"sceneName": scene_name})
        try:
            from apps.core.services.obs_overlay_gen import bump_overlay_gen

            bump_overlay_gen(scene_name, "director")
        except Exception:
            pass
        log.debug("OBS scene → %s", scene_name)

    # ── SSE broadcast ─────────────────────────────────────────────────────────

    def _broadcast(self, item: AudioItem) -> None:
        payload = json.dumps(item.to_sse())
        for q in list(self._sse_listeners):
            try:
                q.put_nowait(payload)
            except asyncio.QueueFull:
                pass
        try:
            from apps.core.routes.obs import broadcast_audio_event

            broadcast_audio_event(item.to_sse())
        except Exception:
            pass

    def register_listener(self, q: asyncio.Queue) -> None:
        self._sse_listeners.append(q)

    def unregister_listener(self, q: asyncio.Queue) -> None:
        try:
            self._sse_listeners.remove(q)
        except ValueError:
            pass

    # ── Main loop ─────────────────────────────────────────────────────────────

    async def run(self) -> None:
        self._running = True
        await self._connect_obs()
        log.info("Stream Director running")

        while self._running:
            try:
                item: AudioItem = await asyncio.wait_for(self._queue.get(), timeout=5)
                item.priority = -item.priority  # restore natural priority
                await self._play(item)
            except asyncio.TimeoutError:
                continue
            except Exception:
                log.exception("Stream Director loop error")

    async def _play(self, item: AudioItem) -> None:
        if self._current and item.priority > self._current.priority:
            self._paused = self._current
            log.info("Pausing %s for %s (higher priority)", self._current.name, item.name)

        self._current = item
        if item.scene:
            await self._switch_scene(item.scene)

        self._broadcast(item)
        log.info("Playing: %s  priority=%s  file=%s",
                 item.name, item.priority, item.path.name if item.path else "?")

        # ── Local desktop audio (always fires) ───────────────────────────────
        await self._play_local(item.path)

        self._current = None

        if self._paused:
            log.info("Resuming %s", self._paused.name)
            resumed = self._paused
            self._paused = None
            await self._play(resumed)

    async def _play_local(self, path: Path | None) -> None:
        """Play MP3 through desktop audio (PulseAudio/PipeWire) via subprocess."""
        if not path or not path.exists():
            await asyncio.sleep(2.0)
            return

        player_cmd = _find_audio_player()
        if not player_cmd:
            log.warning("No local audio player found (install mpg123) — skipping desktop audio")
            duration = self._estimate_duration(path)
            await asyncio.sleep(duration)
            return

        cmd = player_cmd + [str(path)]
        # Ensure PulseAudio/PipeWire user socket is reachable from system service context
        env = dict(os.environ)
        try:
            uid = pwd.getpwnam("ava-core").pw_uid
        except KeyError:
            uid = os.getuid()
        pulse_sock = f"/run/user/{uid}/pulse/native"
        if os.path.exists(pulse_sock):
            env.setdefault("PULSE_SERVER", f"unix:{pulse_sock}")
        env.setdefault("XDG_RUNTIME_DIR", f"/run/user/{uid}")
        try:
            proc = await asyncio.create_subprocess_exec(
                *cmd,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                env=env,
            )
            await proc.wait()
            log.debug("Local audio done: %s (exit %s)", path.name, proc.returncode)
        except Exception as e:
            log.warning("Local audio failed (%s): %s — falling back to sleep", cmd[0], e)
            await asyncio.sleep(self._estimate_duration(path))

    @staticmethod
    def _estimate_duration(path: Path | None) -> float:
        if not path or not path.exists():
            return 5.0
        try:
            size_bytes = path.stat().st_size
            return max(1.5, size_bytes / 16000)
        except Exception:
            return 5.0

    async def stop(self) -> None:
        self._running = False
        if self._obs_ws:
            await self._obs_ws.close()


# Singleton
_director: StreamDirector | None = None


def get_director() -> StreamDirector:
    global _director
    if _director is None:
        _director = StreamDirector()
    return _director


_director_task: asyncio.Task | None = None


def ensure_running() -> asyncio.Task:
    """Start the consumer loop in this process if it is not already going.

    The queue lives on the singleton, so it is per-process: whichever process
    enqueues audio has to drain it too. Without this, callers queue clips into
    a queue nobody reads and playback is silently dropped.
    """
    global _director_task
    if _director_task is None or _director_task.done():
        _director_task = asyncio.create_task(get_director().run())
        log.info("Stream Director loop started in-process")
    return _director_task


def cli():
    """Entry point for ava-voice CLI."""
    import sys
    logging.basicConfig(level=logging.INFO,
                        format="%(asctime)s  %(name)s  %(levelname)s  %(message)s")
    asyncio.run(get_director().run())


if __name__ == "__main__":
    cli()
