"""Host-side morning broadcast helpers: Ara TTS + spoken script.

The Node poller shells out here so Python does the heavy lifting.
"""

from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

from . import config
from .mp4_converter import convert_if_needed, daily_thumbnail
from .services.xai import tts as xai_tts, chat as xai_chat

HST = ZoneInfo("Pacific/Honolulu")
SCRIPT_SYSTEM = (
    "You are Ara, Ava Ivy's calm broadcast voice. Turn the morning report into "
    "ONE spoken script, 45–70 seconds (about 120–170 words). No markdown, no lists, "
    "no vendor names. Start with the local Hawaii morning date/time if present. End cleanly."
)


def _stamp() -> str:
    return datetime.now(timezone.utc).strftime("%Y%m%dT%H")


def synthesize(text: str, out_path: Path | None = None, voice: str | None = None) -> Path:
    spoken = " ".join(str(text or "").split()).strip()
    if not spoken:
        raise ValueError("empty_text")
    dest = Path(out_path) if out_path else (
        config.GENERATED_DIR / f"morning-report-{_stamp()}.mp3"
    )
    dest.parent.mkdir(parents=True, exist_ok=True)
    xai_tts(spoken[:4500], dest, voice=voice or config.TTS_VOICE or "ara")
    current = dest.parent / "morning-report-current.mp3"
    try:
        current.write_bytes(dest.read_bytes())
    except OSError:
        current = dest
    return dest


def spoken_script(report: str) -> str:
    plain = " ".join(str(report or "").split()).strip()[:3500]
    if not plain:
        return ""
    try:
        text = xai_chat(
            [
                {"role": "system", "content": SCRIPT_SYSTEM},
                {"role": "user", "content": f"Spoken broadcast only:\n\n{plain}"},
            ],
            temperature=0.3,
            max_tokens=280,
        )
        return (text or "").strip() or plain[:900]
    except Exception:
        return plain[:900]


def _cmd_tts(args: argparse.Namespace) -> dict:
    text = args.text or ""
    if args.text_file:
        text = Path(args.text_file).read_text(encoding="utf-8")
    dest = synthesize(text, Path(args.out) if args.out else None, voice=args.voice or None)
    current = dest.parent / "morning-report-current.mp3"
    return {
        "ok": True,
        "mp3": str(dest),
        "current": str(current if current.exists() else dest),
        "voice": args.voice or config.TTS_VOICE or "ara",
        "bytes": dest.stat().st_size,
    }


def _cmd_script(args: argparse.Namespace) -> dict:
    report = args.text or ""
    if args.text_file:
        report = Path(args.text_file).read_text(encoding="utf-8")
    script = spoken_script(report)
    return {"ok": bool(script), "script": script}


def _cmd_convert(args: argparse.Namespace) -> dict:
    out = Path(args.out) if args.out else None
    thumb = Path(args.thumb) if args.thumb else None
    current = Path(args.current) if args.current else (
        config.MP4_DIR / "Morning_Broadcast_Current.mp4" if out else None
    )
    dest = convert_if_needed(
        Path(args.mp3),
        thumbnail=thumb,
        out_path=out,
        current_path=current,
    )
    if not dest:
        return {"ok": False, "reason": "convert_failed"}
    return {
        "ok": True,
        "mp4": str(dest),
        "thumbnail": str(daily_thumbnail(thumb) or ""),
        "current": str(current) if current and Path(current).exists() else None,
        "hst": datetime.now(HST).strftime("%Y-%m-%d %H:%M"),
    }


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description="Ava host broadcast render")
    sub = p.add_subparsers(dest="cmd", required=True)

    t = sub.add_parser("tts", help="Ara TTS → MP3 in audio/voice/generated")
    t.add_argument("--text", default="")
    t.add_argument("--text-file", default="")
    t.add_argument("--out", default="")
    t.add_argument("--voice", default="")

    s = sub.add_parser("script", help="Spoken 45–70s script from a morning report")
    s.add_argument("--text", default="")
    s.add_argument("--text-file", default="")

    c = sub.add_parser("convert", help="Still-image MP3 → MP4")
    c.add_argument("--mp3", required=True)
    c.add_argument("--out", default="")
    c.add_argument("--thumb", default="")
    c.add_argument("--current", default="")

    args = p.parse_args(argv)
    try:
        if args.cmd == "tts":
            out = _cmd_tts(args)
        elif args.cmd == "script":
            out = _cmd_script(args)
        else:
            out = _cmd_convert(args)
    except Exception as e:
        print(json.dumps({"ok": False, "reason": str(e)[:300]}))
        return 1
    print(json.dumps(out))
    return 0 if out.get("ok") else 1


if __name__ == "__main__":
    sys.exit(main())
