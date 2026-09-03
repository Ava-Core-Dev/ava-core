"""
YouTube → local MP3 or MP4 via yt-dlp + ffmpeg.

Single video only. Writes into public/audio/youtube or public/video/youtube.
No playlists, no live streams, no other sites.
"""

from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
import sys
from pathlib import Path
from urllib.parse import parse_qs, urlparse

from apps.core import config as _cfg

MAX_DURATION_SEC = int(os.getenv("AVA_YT_MAX_DURATION", str(2 * 60 * 60)))
MAX_FILESIZE = os.getenv("AVA_YT_MAX_FILESIZE", "500M")
TIMEOUT_SEC = int(os.getenv("AVA_YT_TIMEOUT", "480"))

_YT_HOSTS = {
    "youtube.com",
    "youtu.be",
    "youtube-nocookie.com",
    "music.youtube.com",
    "m.youtube.com",
}


def _which(name: str, env_key: str = "") -> str:
    from_env = (os.getenv(env_key) or "").strip()
    if from_env and Path(from_env).exists():
        return from_env
    found = shutil.which(name)
    if found:
        return found
    local = Path.home() / ".local" / "bin" / name
    if local.exists():
        return str(local)
    return ""


def yt_dlp_bin() -> str:
    return _which("yt-dlp", "AVA_YT_DLP")


def ffmpeg_bin() -> str:
    return _which("ffmpeg", "AVA_FFMPEG") or _which("ffmpeg")


def parse_youtube_url(raw: str) -> str | None:
    s = str(raw or "").strip().strip("<>").strip()
    if not s:
        return None
    if re.fullmatch(r"[\w-]{11}", s):
        return f"https://www.youtube.com/watch?v={s}"
    if not re.match(r"^https?://", s, re.I):
        return None
    u = urlparse(s)
    host = (u.hostname or "").lower()
    if host.startswith("www."):
        host = host[4:]
    if host not in _YT_HOSTS:
        return None
    path = u.path or ""
    if host in {"youtu.be"}:
        vid = path.strip("/").split("/")[0]
        if not re.fullmatch(r"[\w-]{11}", vid or ""):
            return None
        return f"https://www.youtube.com/watch?v={vid}"
    if "/playlist" in path or path.startswith("/channel/") or path.startswith("/@"):
        qs = parse_qs(u.query or "")
        vid = (qs.get("v") or [None])[0]
        if vid and re.fullmatch(r"[\w-]{11}", vid):
            return f"https://www.youtube.com/watch?v={vid}"
        return None
    if "/watch" in path or "/shorts/" in path or "/embed/" in path or "/live/" in path:
        qs = parse_qs(u.query or "")
        vid = (qs.get("v") or [None])[0]
        if vid and re.fullmatch(r"[\w-]{11}", vid):
            return f"https://www.youtube.com/watch?v={vid}"
        m = re.search(r"/(?:shorts|embed|live)/([\w-]{11})", path)
        if m:
            return f"https://www.youtube.com/watch?v={m.group(1)}"
        return s.split("&")[0]
    qs = parse_qs(u.query or "")
    vid = (qs.get("v") or [None])[0]
    if vid and re.fullmatch(r"[\w-]{11}", vid):
        return f"https://www.youtube.com/watch?v={vid}"
    return None


def _run(cmd: list[str], timeout: int) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        cmd,
        capture_output=True,
        text=True,
        timeout=timeout,
        check=False,
    )


def _probe(url: str, ytdlp: str) -> dict:
    cmd = [
        ytdlp,
        "--no-playlist",
        "--skip-download",
        "--no-warnings",
        "-J",
        url,
    ]
    cookies = (os.getenv("AVA_YT_COOKIES") or "").strip()
    if cookies and Path(cookies).exists():
        cmd[1:1] = ["--cookies", cookies]
    r = _run(cmd, timeout=90)
    if r.returncode != 0:
        err = (r.stderr or r.stdout or "probe_fail").strip().splitlines()
        raise RuntimeError(err[-1][:240] if err else "probe_fail")
    try:
        return json.loads(r.stdout or "{}")
    except json.JSONDecodeError as exc:
        raise RuntimeError("probe_json") from exc


def _dest_dir(kind: str) -> Path:
    if kind == "mp3":
        d = _cfg.YOUTUBE_AUDIO_DIR
    else:
        d = _cfg.YOUTUBE_VIDEO_DIR
    d.mkdir(parents=True, exist_ok=True)
    return d


def download_youtube(url: str, kind: str = "mp3") -> dict:
    kind = str(kind or "mp3").strip().lower()
    if kind not in {"mp3", "mp4"}:
        return {"ok": False, "reason": "format"}
    parsed = parse_youtube_url(url)
    if not parsed:
        return {"ok": False, "reason": "youtube_url_only"}
    ytdlp = yt_dlp_bin()
    if not ytdlp:
        return {"ok": False, "reason": "no_yt_dlp"}
    if kind == "mp3" and not ffmpeg_bin():
        return {"ok": False, "reason": "no_ffmpeg"}

    try:
        info = _probe(parsed, ytdlp)
    except subprocess.TimeoutExpired:
        return {"ok": False, "reason": "probe_timeout"}
    except RuntimeError as err:
        return {"ok": False, "reason": "probe_fail", "detail": str(err)[:240]}

    if info.get("_type") == "playlist":
        return {"ok": False, "reason": "single_video_only"}
    if info.get("is_live") or info.get("live_status") in {"is_live", "is_upcoming"}:
        return {"ok": False, "reason": "no_live"}
    duration = info.get("duration")
    if duration is not None:
        try:
            if float(duration) > MAX_DURATION_SEC:
                return {"ok": False, "reason": "too_long", "duration": int(float(duration))}
        except (TypeError, ValueError):
            pass

    vid = str(info.get("id") or "").strip()
    title = str(info.get("title") or vid or "youtube").strip()
    if not vid:
        return {"ok": False, "reason": "no_id"}

    dest = _dest_dir(kind)
    tmpl = str(dest / f"{vid}.%(ext)s")
    cmd = [
        ytdlp,
        "--no-playlist",
        "--no-warnings",
        "--newline",
        "--retries",
        "3",
        "--socket-timeout",
        "30",
        "--max-filesize",
        MAX_FILESIZE,
        "-o",
        tmpl,
    ]
    cookies = (os.getenv("AVA_YT_COOKIES") or "").strip()
    if cookies and Path(cookies).exists():
        cmd.extend(["--cookies", cookies])
    ff = ffmpeg_bin()
    if ff:
        cmd.extend(["--ffmpeg-location", str(Path(ff).parent)])

    if kind == "mp3":
        cmd.extend(
            [
                "-f",
                "bestaudio/best",
                "-x",
                "--audio-format",
                "mp3",
                "--audio-quality",
                "0",
                "--embed-metadata",
            ]
        )
        expect = dest / f"{vid}.mp3"
    else:
        cmd.extend(
            [
                "-f",
                "bv*[height<=1080][ext=mp4]+ba[ext=m4a]/bv*[height<=1080]+ba/b[ext=mp4]/b",
                "--merge-output-format",
                "mp4",
                "--embed-metadata",
            ]
        )
        expect = dest / f"{vid}.mp4"

    cmd.append(parsed)
    try:
        r = _run(cmd, timeout=TIMEOUT_SEC)
    except subprocess.TimeoutExpired:
        return {"ok": False, "reason": "timeout", "id": vid, "title": title}

    if expect.exists() and expect.stat().st_size > 0:
        return {
            "ok": True,
            "id": vid,
            "title": title,
            "format": kind,
            "path": str(expect.resolve()),
            "bytes": expect.stat().st_size,
            "url": parsed,
        }

    matches = sorted(
        [p for p in dest.glob(f"{vid}.*") if p.is_file() and p.stat().st_size > 0],
        key=lambda p: p.stat().st_mtime,
        reverse=True,
    )
    if matches:
        got = matches[0]
        return {
            "ok": True,
            "id": vid,
            "title": title,
            "format": kind,
            "path": str(got.resolve()),
            "bytes": got.stat().st_size,
            "url": parsed,
        }

    err = (r.stderr or r.stdout or "download_fail").strip().splitlines()
    detail = err[-1][:240] if err else "download_fail"
    return {"ok": False, "reason": "download_fail", "detail": detail, "id": vid, "title": title}


def main(argv: list[str] | None = None) -> int:
    import argparse

    p = argparse.ArgumentParser(description="YouTube → MP3 or MP4 in the media library")
    p.add_argument("--url", required=True)
    p.add_argument("--format", choices=("mp3", "mp4"), default="mp3")
    args = p.parse_args(argv)
    out = download_youtube(args.url, args.format)
    print(json.dumps(out, ensure_ascii=False))
    return 0 if out.get("ok") else 1


if __name__ == "__main__":
    sys.exit(main())
