"""
Stream Director — centralized audio/video manager for Ava streams.

Priority queue with pause/resume. Higher priority pauses current playback,
plays to completion, then resumes the paused track where it left off.
OBS WebSocket 5.x integration for scene/source switching and media control.

Priority tiers:
  P3 Critical  — earthquake alert, eruption alert (interrupts immediately)
  P2 Scheduled — hourly chime, time announcement
  P1 Report    — voice reports (weather, solar, economy, volcano) — queued FIFO
  P0 Ambient   — shuffled music bed under Media/public/audio/music (paused by everything)
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import random
import shutil
import subprocess
import time
from dataclasses import dataclass, field
from enum import IntEnum
from pathlib import Path
from typing import Any

import websockets

# Desktop music bed — recursive under public/audio/music (mp3/wav/etc.)
MUSIC_AUDIO_EXTS = {
    ".mp3", ".wav", ".flac", ".ogg", ".m4a", ".aac", ".wma", ".opus",
}


CREATE_NO_WINDOW = 0x08000000


def _windows_hidden() -> dict:
    if os.name != "nt":
        return {}
    si = subprocess.STARTUPINFO()
    si.dwFlags |= subprocess.STARTF_USESHOWWINDOW
    si.wShowWindow = 0
    return {"creationflags": CREATE_NO_WINDOW, "startupinfo": si}


def _ffplay_cmd() -> list[str] | None:
    found = shutil.which("ffplay")
    if found:
        return [found, "-nodisp", "-autoexit", "-loglevel", "quiet"]
    try:
        from apps.voice.clips import ffmpeg_bin

        ff = ffmpeg_bin()
    except Exception:
        ff = None
    if not ff:
        return None
    sibling = Path(ff).parent / ("ffplay.exe" if os.name == "nt" else "ffplay")
    if sibling.is_file():
        return [str(sibling), "-nodisp", "-autoexit", "-loglevel", "quiet"]
    return None


def _find_audio_player() -> list[str] | None:
    """Return command prefix for the best available headless MP3 player."""
    if shutil.which("mpg123"):
        return ["mpg123", "-q"]
    if shutil.which("mpv"):
        return ["mpv", "--no-video", "--really-quiet", "--no-terminal"]
    ffplay = _ffplay_cmd()
    if ffplay:
        return ffplay
    if shutil.which("cvlc"):
        return ["cvlc", "--play-and-exit", "--quiet"]
    # Windows: WPF MediaPlayer via PowerShell (no extra install).
    if os.name == "nt":
        ps = shutil.which("powershell") or shutil.which("pwsh")
        if ps:
            return [ps, "-NoProfile", "-WindowStyle", "Hidden", "-ExecutionPolicy", "Bypass", "-Command", "_AVA_PLAY_MP3_"]
    return None


def _windows_play_mp3(path: Path) -> list[str]:
    """Build a PowerShell one-shot that opens, plays, and waits for an MP3."""
    p = str(path.resolve()).replace("'", "''")
    dur = 20.0
    try:
        from apps.voice.clips import mp3_duration_s

        got = mp3_duration_s(path)
        if got and got > 0.5:
            dur = min(120.0, max(3.0, got + 0.6))
        else:
            size = path.stat().st_size
            dur = min(120.0, max(12.0, size / 8000.0))
    except Exception:
        pass
    script = (
        "Add-Type -AssemblyName PresentationCore; "
        "$m = New-Object System.Windows.Media.MediaPlayer; "
        f"$m.Open([Uri]'{p}'); $m.Play(); "
        "Start-Sleep -Milliseconds 400; "
        "$guard = 0; "
        "while ($m.NaturalDuration.HasTimeSpan -eq $false -and $guard -lt 50) { "
        "  Start-Sleep -Milliseconds 100; $guard++ }; "
        "if ($m.NaturalDuration.HasTimeSpan) { "
        "  while ($m.Position -lt $m.NaturalDuration.TimeSpan) { Start-Sleep -Milliseconds 200 } "
        f"}} else {{ Start-Sleep -Seconds {dur:.1f} }}"
    )
    ps = shutil.which("powershell") or shutil.which("pwsh") or "powershell"
    return [ps, "-NoProfile", "-WindowStyle", "Hidden", "-ExecutionPolicy", "Bypass", "-Command", script]


def _windows_play_music(path: Path) -> list[str]:
    """PowerShell MediaPlayer for long bed tracks (wav/mp3). No 120s report cap."""
    p = str(path.resolve()).replace("'", "''")
    try:
        size = path.stat().st_size
        # Rough PCM wav ~176 KB/s; mp3 ~16 KB/s — pick the longer estimate.
        dur = min(7200.0, max(60.0, size / 16000.0 + 5.0))
    except Exception:
        dur = 600.0
    script = (
        "Add-Type -AssemblyName PresentationCore; "
        "$m = New-Object System.Windows.Media.MediaPlayer; "
        f"$m.Open([Uri]'{p}'); $m.Play(); "
        "Start-Sleep -Milliseconds 500; "
        "$guard = 0; "
        "while ($m.NaturalDuration.HasTimeSpan -eq $false -and $guard -lt 80) { "
        "  Start-Sleep -Milliseconds 100; $guard++ }; "
        "if ($m.NaturalDuration.HasTimeSpan) { "
        "  while ($m.Position -lt $m.NaturalDuration.TimeSpan) { Start-Sleep -Milliseconds 250 } "
        f"}} else {{ Start-Sleep -Seconds {dur:.1f} }}"
    )
    ps = shutil.which("powershell") or shutil.which("pwsh") or "powershell"
    return [ps, "-NoProfile", "-WindowStyle", "Hidden", "-ExecutionPolicy", "Bypass", "-Command", script]


def music_dir() -> Path:
    try:
        from apps.core import config

        return Path(config.ASSETS_DIR) / "music"
    except Exception:
        return Path.home() / "ava" / "Media" / "public" / "audio" / "music"


def list_music_tracks(root: Path | None = None) -> list[Path]:
    """All audio files under the music tree (recursive). Does not invent files."""
    base = root or music_dir()
    if not base.is_dir():
        return []
    out: list[Path] = []
    for p in base.rglob("*"):
        if p.is_file() and p.suffix.lower() in MUSIC_AUDIO_EXTS:
            out.append(p)
    return out



def kill_stray_music_players(*, keep_pid: int | None = None) -> int:
    """Kill OS players whose command line points at the music bed folder.

    Origin force-kill orphans PowerShell MediaPlayer / ffplay children; without a
    sweep, each recycle stacks another track until everything plays at once.
    """
    try:
        root = music_dir().resolve()
        _ = str(root)
    except Exception:
        return 0

    killed = 0
    if os.name == "nt":
        ps = shutil.which("powershell") or shutil.which("pwsh") or "powershell"
        list_script = (
            "$procs = Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | "
            "Where-Object { $_.CommandLine -and ("
            "  $_.Name -match '^(powershell|pwsh|ffplay|ffmpeg|mpg123|mpv|vlc)' -or "
            "  $_.CommandLine -match 'MediaPlayer'"
            ") -and ("
            "  $_.CommandLine -like '*Media*public*audio*music*' -or "
            "  $_.CommandLine -like '*\\\\audio\\\\music\\\\*'"
            ") }; "
            "$procs | ForEach-Object { $_.ProcessId }"
        )
        try:
            out = subprocess.run(
                [
                    ps,
                    "-NoProfile",
                    "-WindowStyle",
                    "Hidden",
                    "-ExecutionPolicy",
                    "Bypass",
                    "-Command",
                    list_script,
                ],
                capture_output=True,
                text=True,
                timeout=15,
                creationflags=CREATE_NO_WINDOW,
            )
        except Exception:
            out = None
        pids: list[int] = []
        if out and out.stdout:
            for line in out.stdout.splitlines():
                line = line.strip()
                if line.isdigit():
                    pids.append(int(line))
        for pid in pids:
            if keep_pid is not None and pid == keep_pid:
                continue
            try:
                subprocess.run(
                    ["taskkill", "/PID", str(pid), "/T", "/F"],
                    capture_output=True,
                    timeout=10,
                    creationflags=CREATE_NO_WINDOW,
                )
                killed += 1
            except Exception:
                try:
                    os.kill(pid, 9)
                    killed += 1
                except Exception:
                    pass
    else:
        try:
            marker = str(music_dir())
            for pat in ("ffplay", "ffmpeg", "mpg123", "mpv", "cvlc"):
                subprocess.run(
                    ["pkill", "-f", f"{pat}.*{marker}"],
                    capture_output=True,
                    timeout=5,
                )
        except Exception:
            pass
    if killed:
        logging.getLogger("ava.director").info(
            "Music bed swept stray players  killed=%s", killed
        )
    return killed



log = logging.getLogger("ava.director")

# ── OBS auto-switch toggle (injected by obs_switcher_setup) ─────────────────
# Flag: $DATA_DIR/obs_auto_switch.enabled  (1/on = enabled, 0/off = disabled)
# Env override: AVA_OBS_AUTO_SWITCH=0|1 wins over the flag file.
# Default when flag is missing: ON (preserves previous behaviour).

def obs_auto_switch_enabled() -> bool:
    import os
    from pathlib import Path
    env = os.getenv("AVA_OBS_AUTO_SWITCH", "").strip().lower()
    if env in {"0", "false", "no", "off"}:
        return False
    if env in {"1", "true", "yes", "on"}:
        return True
    try:
        from apps.core import config
        flag = config.DATA_DIR / "obs_auto_switch.enabled"
        if not flag.exists():
            return True
        raw = flag.read_text(encoding="utf-8", errors="ignore").strip().lower()
        return raw not in {"0", "false", "no", "off"}
    except Exception:
        # Fallback if config not importable from this process
        data = Path(os.getenv("DATA_DIR", str(Path.home() / "Ava" / "Data")))
        flag = data / "obs_auto_switch.enabled"
        if not flag.exists():
            return True
        raw = flag.read_text(encoding="utf-8", errors="ignore").strip().lower()
        return raw not in {"0", "false", "no", "off"}



class Priority(IntEnum):
    AMBIENT   = 0
    REPORT    = 1
    SCHEDULED = 2
    CRITICAL  = 3


_SCENE_RESOLVE = object()  # sentinel: resolve scene from SCENE_MAP


@dataclass(order=True)
class AudioItem:
    priority: int
    ts: float = field(compare=False, default_factory=time.monotonic)
    path: Path = field(compare=False, default=None)
    name: str = field(compare=False, default="")
    scene: str | None = field(compare=False, default=None)   # OBS scene to switch to

    def to_sse(self) -> dict:
        """Stage clip into GENERATED_DIR so OBS Ava Audio can fetch it over HTTP."""
        src = "/data/generated/missing.mp3"
        if self.path and self.path.exists():
            try:
                from apps.core import config

                config.GENERATED_DIR.mkdir(parents=True, exist_ok=True)
                dest = config.GENERATED_DIR / self.path.name
                if (
                    not dest.exists()
                    or dest.stat().st_mtime < self.path.stat().st_mtime
                    or dest.stat().st_size != self.path.stat().st_size
                ):
                    shutil.copy2(self.path, dest)
                src = f"/data/generated/{self.path.name}"
            except Exception:
                src = f"/data/generated/{self.path.name}"
        return {
            "src": src,
            "name": self.name,
            "priority": self.priority,
        }


# ── OBS Scene Configuration ───────────────────────────────────────────────────
# These must match scene names exactly as they appear in OBS Studio.
# Update here first; OBS scene names should match these strings.

# Stay on current program scene for chimes / generic clips (no phantom "Main").
DEFAULT_SCENE = None

# Scene shown during planned downtime / solar night
BRB_SCENE = "Be right back"

# Scene map — keyword → OBS scene name
# Keywords are matched against AudioItem.name (lowercased).
# First match wins. "default" is the fallback if no keyword matches.
SCENE_MAP: dict[str, str | None] = {
    # Geologic / emergency alerts — switch immediately
    "kilauea":       "Scene 3 - Kilauea Watch",
    "eruption":      "Scene 3 - Kilauea Watch",
    "volcano":       "Scene 3 - Kilauea Watch",
    "earthquake":    "Scene 4 - Quake Desk",
    "quake":         "Scene 4 - Quake Desk",
    "tsunami":       "Scene 4 - Quake Desk",
    # Weather
    "weather":       "Scene 1 - Weather Board",
    "noaa":          "Scene 1 - Weather Board",
    "tropical":      "Scene 2 - Storm Desk",
    "hurricane":     "Scene 2 - Storm Desk",
    "storm":         "Scene 2 - Storm Desk",
    # Solar / power
    "solar":         "Scene 5 - Solar Dashboard",
    "battery":       "Scene 5 - Solar Dashboard",
    "power":         "Scene 5 - Solar Dashboard",
    "ecoflow":       "Scene 5 - Solar Dashboard",
    # Economy / RootMC
    "economy":       "Scene 6 - Economy Board",
    "finance":       "Scene 6 - Economy Board",
    "gold":          "Scene 6 - Economy Board",
    "rootmc":        "Scene 7 - RootMC Live",
    "minecraft":     "Scene 7 - RootMC Live",
    "server":        "Scene 7 - RootMC Live",
    # Reports / status — stay on whatever is live
    "morning":       None,
    "report":        None,
    "status":        None,
    "overnight":     None,
    "startup":       None,
    # Hourly / ambient — never yank the daily loop to a missing Main scene
    "chime":         None,
    "hourly":        None,
    "time_":         None,
    "ambient":       None,
    # Fallback
    "default":       DEFAULT_SCENE,
}

def scene_for(name: str) -> str | None:
    """Return the OBS scene name for a given audio item name (or None = stay put)."""
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
        self._obs_lock = asyncio.Lock()
        self._sse_listeners: list[asyncio.Queue] = []
        # Shuffled recursive music bed (P0 ambient) — paused by REPORT+
        self._music_enabled = False
        self._music_hold = False
        self._music_task: asyncio.Task | None = None
        self._music_proc: asyncio.subprocess.Process | None = None
        self._music_proc_pid: int | None = None
        self._music_current: Path | None = None
        self._music_tracks_n = 0
        self._music_start_lock = asyncio.Lock()

    # ── Public API ────────────────────────────────────────────────────────────

    async def queue(
        self,
        path: Path,
        name: str = "",
        priority: int = Priority.REPORT,
        scene: str | None | object = _SCENE_RESOLVE,
    ) -> None:
        """Submit audio to the queue. Higher priority pauses current playback.

        Pass scene=None to stay on the current OBS scene.
        Omit scene to resolve from SCENE_MAP / scene_for(name).
        """
        resolved_scene = scene_for(name) if scene is _SCENE_RESOLVE else scene  # type: ignore[arg-type]
        item = AudioItem(priority=-(priority), path=path, name=name, scene=resolved_scene)  # type: ignore[arg-type]
        await self._queue.put(item)
        log.info("Queued: %s  priority=%s", name or path.name, priority)

    async def queue_number(self, n: int, *, name: str = "", priority: int = Priority.REPORT) -> Path | None:
        """Speak an integer from Ara clips. Concatenate when ffmpeg exists; else queue each clip."""
        from apps.core import config as _cfg
        from apps.voice.clips import _find_clip, _number_to_clips, speak_number

        dest = Path(_cfg.GENERATED_DIR) / f"spoken-{int(n)}.mp3"
        dest.parent.mkdir(parents=True, exist_ok=True)
        got = speak_number(int(n), dest)
        if got:
            await self.queue(got, name=name or f"number_{n}", priority=priority, scene=None)
            return got
        parts = [_find_clip(x) for x in _number_to_clips(int(n))]
        parts = [p for p in parts if p]
        if not parts:
            log.warning("No number clips for %s", n)
            return None
        for i, p in enumerate(parts):
            await self.queue(p, name=f"{name or f'number_{n}'}_{i}", priority=priority, scene=None)
        return parts[0]

    async def queue_report(self, path: Path, name: str, report_type: str = "") -> None:
        scene = SCENE_MAP.get(report_type.lower())
        await self.queue(path, name=name, priority=Priority.REPORT, scene=scene)

    async def queue_alert(self, path: Path, name: str) -> None:
        await self.queue(
            path,
            name=name,
            priority=Priority.CRITICAL,
            scene="Scene 3 - Kilauea Watch",
        )

    def get_status(self) -> dict:
        return {
            "running": self._running,
            "current": self._current.name if self._current else None,
            "paused": self._paused.name if self._paused else None,
            "queue_depth": self._queue.qsize(),
            "obs_connected": self._obs_ws is not None,
            "music": {
                "enabled": self._music_enabled,
                "hold": self._music_hold,
                "tracks": self._music_tracks_n,
                "current": self._music_current.name if self._music_current else None,
                "dir": str(music_dir()),
            },
        }

    async def start_music_bed(self) -> dict:
        """Start shuffled recursive playlist under public/audio/music. Loop forever.

        Only one bed loop and one OS player at a time. Sweeps orphan players left by
        prior origin kills before starting.
        """
        async with self._music_start_lock:
            tracks = list_music_tracks()
            self._music_tracks_n = len(tracks)
            if not tracks:
                log.warning("Music bed: no audio under %s", music_dir())
                return {"ok": False, "detail": "no_tracks", "dir": str(music_dir())}
            if self._music_task is not None and not self._music_task.done():
                return {
                    "ok": True,
                    "detail": "already_running",
                    "tracks": len(tracks),
                    "dir": str(music_dir()),
                }
            # Silence leftovers from dead uvicorn / double spawn before first track.
            kill_stray_music_players()
            self._music_enabled = True
            self._music_hold = False
            self._music_task = asyncio.create_task(self._music_loop(), name="ava-music-bed")
            log.info("Music bed started  tracks=%s  dir=%s", len(tracks), music_dir())
            return {"ok": True, "tracks": len(tracks), "dir": str(music_dir())}

    def _hold_music(self) -> None:
        """Pause bed for reports / chimes / alerts (kill current track process)."""
        if not self._music_hold:
            log.info(
                "Music bed hold for voice  was=%s",
                self._music_current.name if self._music_current else None,
            )
        self._music_hold = True
        self._kill_music_proc()

    def _release_music_if_idle(self) -> None:
        if not self._queue.empty() or self._current is not None:
            return
        if self._music_hold:
            log.info("Music bed resume")
        self._music_hold = False

    def _kill_music_proc(self) -> None:
        """Stop the single bed player (process tree) and sweep any orphans."""
        proc = self._music_proc
        self._music_proc = None
        pid = self._music_proc_pid
        self._music_proc_pid = None
        if proc is not None:
            try:
                pid = pid or proc.pid
            except Exception:
                pass
            try:
                if proc.returncode is None:
                    if os.name == "nt" and pid:
                        subprocess.run(
                            ["taskkill", "/PID", str(pid), "/T", "/F"],
                            capture_output=True,
                            timeout=10,
                            creationflags=CREATE_NO_WINDOW,
                        )
                    else:
                        proc.kill()
            except Exception:
                try:
                    proc.kill()
                except Exception:
                    pass
        # Always sweep: force-killed origins leave MediaPlayer powershell orphans.
        kill_stray_music_players()

    async def _music_loop(self) -> None:
        """Shuffle all recursive tracks, play through, reshuffle, repeat."""
        while self._music_enabled and self._running:
            tracks = list_music_tracks()
            self._music_tracks_n = len(tracks)
            if not tracks:
                await asyncio.sleep(30)
                continue
            random.shuffle(tracks)
            log.info("Music bed shuffle  n=%s", len(tracks))
            for path in tracks:
                if not self._music_enabled or not self._running:
                    return
                while self._music_hold:
                    await asyncio.sleep(0.25)
                    if not self._music_enabled or not self._running:
                        return
                if not path.is_file():
                    continue
                finished = await self._play_music_track(path)
                # Voice interrupt: wait for clear, then restart same track from the top.
                if not finished and self._music_hold:
                    while self._music_hold:
                        await asyncio.sleep(0.25)
                        if not self._music_enabled or not self._running:
                            return
                    if path.is_file() and self._music_enabled and self._running:
                        await self._play_music_track(path)

    async def _play_music_track(self, path: Path) -> bool:
        """Play one bed track. Returns True if it finished; False if voice hold aborted it."""
        self._music_current = path
        player_cmd = _find_audio_player()
        if not player_cmd:
            log.warning("Music bed: no audio player — skipping %s", path.name)
            await asyncio.sleep(2.0)
            self._music_current = None
            return True

        if player_cmd[-1] == "_AVA_PLAY_MP3_":
            cmd = _windows_play_music(path)
        else:
            cmd = list(player_cmd) + [str(path)]

        env = dict(os.environ)
        if os.name != "nt":
            import pwd

            try:
                uid = pwd.getpwnam("ava-core").pw_uid
            except KeyError:
                uid = os.getuid()
            pulse_sock = f"/run/user/{uid}/pulse/native"
            if os.path.exists(pulse_sock):
                env.setdefault("PULSE_SERVER", f"unix:{pulse_sock}")
            env.setdefault("XDG_RUNTIME_DIR", f"/run/user/{uid}")

        proc: asyncio.subprocess.Process | None = None
        aborted = False
        try:
            # One stream only — clear orphans before spawning this track.
            kill_stray_music_players()
            proc = await asyncio.create_subprocess_exec(
                *cmd,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                env=env,
                **_windows_hidden(),
            )
            self._music_proc = proc
            try:
                self._music_proc_pid = proc.pid
            except Exception:
                self._music_proc_pid = None
            log.info("Music bed playing: %s", path.name)
            while proc.returncode is None:
                if self._music_hold or not self._music_enabled:
                    aborted = True
                    self._kill_music_proc()
                    break
                try:
                    await asyncio.wait_for(proc.wait(), timeout=0.4)
                except asyncio.TimeoutError:
                    continue
        except Exception as e:
            log.warning("Music bed play failed (%s): %s", path.name, e)
            aborted = False
        finally:
            if proc is not None and self._music_proc is proc:
                self._music_proc = None
                self._music_proc_pid = None
            self._music_current = None
        return not aborted

    # ── OBS WebSocket ─────────────────────────────────────────────────────────

    async def _connect_obs(self) -> bool:
        if not obs_auto_switch_enabled():
            log.debug("OBS auto-switch disabled — skipping connect")
            return False
        from apps.core import config
        if not config.ENABLE_OBS:
            return False
        if not config.OBS_WS_URL:
            return False
        async with self._obs_lock:
            if self._obs_ws is not None:
                return True
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
            async with self._obs_lock:
                if not self._obs_ws:
                    return None
                await self._obs_ws.send(json.dumps(payload))
                while True:
                    raw = json.loads(await asyncio.wait_for(self._obs_ws.recv(), timeout=5))
                    if raw.get("op") != 7:
                        continue
                    body = raw.get("d", {})
                    if body.get("requestId") != req_id:
                        continue
                    return body
        except Exception as e:
            log.warning("OBS request %s failed: %s", request_type, e)
            self._obs_ws = None
            return None

    async def _switch_scene(self, scene_name: str) -> None:
        if not obs_auto_switch_enabled():
            log.debug("OBS auto-switch disabled — not switching to %s", scene_name)
            return
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
        # Reports / chimes / alerts pause the music bed until the director is idle.
        if item.priority > Priority.AMBIENT:
            self._hold_music()

        if self._current and item.priority > self._current.priority:
            self._paused = self._current
            log.info("Pausing %s for %s (higher priority)", self._current.name, item.name)

        self._current = item
        if item.scene:
            await self._switch_scene(item.scene)

        self._broadcast(item)
        # Also drive OBS ffmpeg "Ava Voice Bus" — reliable when browser autoplay fails.
        await self._play_obs_voice_bus(item.path)
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
        else:
            self._release_music_if_idle()

    async def _play_obs_voice_bus(self, path: Path | None) -> None:
        """Point the shared OBS ffmpeg source at this clip and restart playback."""
        if not path or not path.exists():
            return
        if not self._obs_ws:
            await self._connect_obs()
        if not self._obs_ws:
            return
        try:
            await self._obs_request(
                "SetInputSettings",
                {
                    "inputName": "Ava Voice Bus",
                    "inputSettings": {
                        "is_local_file": True,
                        "local_file": str(path),
                        "looping": False,
                        "restart_on_activate": True,
                        "close_when_inactive": False,
                        "clear_on_media_end": False,
                    },
                },
            )
            await self._obs_request(
                "SetInputMute",
                {"inputName": "Ava Voice Bus", "inputMuted": False},
            )
            await self._obs_request(
                "TriggerMediaInputAction",
                {
                    "inputName": "Ava Voice Bus",
                    "mediaAction": "OBS_WEBSOCKET_MEDIA_INPUT_ACTION_RESTART",
                },
            )
        except Exception as e:
            log.warning("OBS Ava Voice Bus play failed: %s", e)

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

        if player_cmd[-1] == "_AVA_PLAY_MP3_":
            cmd = _windows_play_mp3(path)
        else:
            cmd = player_cmd + [str(path)]
        env = dict(os.environ)
        if os.name != "nt":
            import pwd
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
                **_windows_hidden(),
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
        self._music_enabled = False
        self._kill_music_proc()
        if self._music_task and not self._music_task.done():
            self._music_task.cancel()
            try:
                await self._music_task
            except (asyncio.CancelledError, Exception):
                pass
        self._music_task = None
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


def ensure_music_bed() -> asyncio.Task | None:
    """Start the shuffled music bed once the director loop is up."""
    ensure_running()
    d = get_director()
    # Mark running early so the bed loop does not exit before run() sets it.
    d._running = True
    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        return None

    async def _start():
        await d.start_music_bed()

    return loop.create_task(_start())


def cli():
    """Entry point for ava-voice CLI."""
    import sys
    logging.basicConfig(level=logging.INFO,
                        format="%(asctime)s  %(name)s  %(levelname)s  %(message)s")
    asyncio.run(get_director().run())


if __name__ == "__main__":
    cli()
