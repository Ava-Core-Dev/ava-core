#!/usr/bin/env python3
"""Convert media library audio to canonical desk format: WAV 44.1 kHz 16-bit PCM.

Uses repo ffmpeg (imageio_ffmpeg / clips.ffmpeg_bin). Skips files already matching
target. Writes a short manifest of converted paths.

Examples:
  python scripts/convert_media_library.py --root Media/public/audio/music --dry-run
  python scripts/convert_media_library.py --root Media/public/audio/words --out-dir /tmp/wav
"""
from __future__ import annotations

import argparse
import json
import subprocess
import sys
import wave
from datetime import datetime, timezone
from pathlib import Path

AUDIO_EXTS = {".mp3", ".wav", ".flac", ".ogg", ".m4a", ".aac", ".wma", ".opus"}


def _repo_root() -> Path:
    return Path(__file__).resolve().parents[1]


def _ffmpeg() -> str | None:
    try:
        sys.path.insert(0, str(_repo_root()))
        from apps.voice.clips import ffmpeg_bin

        return ffmpeg_bin()
    except Exception:
        return None


def _already_target(path: Path, *, rate: int, bit_depth: int, channels: int) -> bool:
    if path.suffix.lower() != ".wav":
        return False
    try:
        with wave.open(str(path), "rb") as wf:
            if wf.getframerate() != rate:
                return False
            if wf.getsampwidth() != max(1, bit_depth // 8):
                return False
            if wf.getnchannels() != channels:
                return False
            return True
    except Exception:
        return False


def _convert_one(
    ff: str,
    src: Path,
    dest: Path,
    *,
    rate: int,
    bit_depth: int,
    channels: int,
    dry_run: bool,
) -> bool:
    dest.parent.mkdir(parents=True, exist_ok=True)
    if dry_run:
        print(f"DRY  {src} -> {dest}")
        return True
    codec = "pcm_s16le" if bit_depth == 16 else f"pcm_s{bit_depth}le"
    cmd = [
        ff,
        "-y",
        "-i",
        str(src.resolve()),
        "-acodec",
        codec,
        "-ar",
        str(rate),
        "-ac",
        str(channels),
        str(dest.resolve()),
    ]
    kwargs: dict = {"capture_output": True, "timeout": 300}
    if sys.platform == "win32":
        kwargs["creationflags"] = 0x08000000  # CREATE_NO_WINDOW
    result = subprocess.run(cmd, **kwargs)
    if result.returncode != 0 or not dest.is_file():
        err = (result.stderr or b"")[-300:].decode("utf-8", errors="ignore")
        print(f"FAIL {src.name}: {err or result.returncode}", file=sys.stderr)
        return False
    print(f"OK   {src} -> {dest}")
    return True


def main() -> int:
    root_default = _repo_root() / "Media" / "public" / "audio" / "music"
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--root", type=Path, default=root_default, help="Scan root")
    ap.add_argument("--target", default="wav", choices=["wav"], help="Output format")
    ap.add_argument("--rate", type=int, default=44100)
    ap.add_argument("--bit-depth", type=int, default=16)
    ap.add_argument(
        "--channels",
        type=int,
        default=1,
        choices=[1, 2],
        help="WAV channel count (voice clips default mono; music may use 2)",
    )
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument(
        "--in-place",
        action="store_true",
        help="Write sidecar .wav next to source (replace if already .wav mismatch)",
    )
    ap.add_argument("--out-dir", type=Path, default=None, help="Mirror tree under this dir")
    ap.add_argument(
        "--manifest",
        type=Path,
        default=None,
        help="Write JSON list of converted paths (default: under data/state when not dry-run)",
    )
    args = ap.parse_args()

    root = args.root.resolve()
    if not root.is_dir():
        print(f"root missing: {root}", file=sys.stderr)
        return 2

    ff = _ffmpeg()
    if not ff and not args.dry_run:
        print("ffmpeg not found", file=sys.stderr)
        return 2
    if not ff:
        print("ffmpeg not found (dry-run continues; convert would fail)", file=sys.stderr)

    converted: list[str] = []
    skipped = 0
    would = 0
    for path in sorted(root.rglob("*")):
        if not path.is_file() or path.suffix.lower() not in AUDIO_EXTS:
            continue
        if _already_target(
            path, rate=args.rate, bit_depth=args.bit_depth, channels=args.channels
        ):
            skipped += 1
            continue
        if args.out_dir:
            rel = path.relative_to(root)
            dest = args.out_dir.resolve() / rel.with_suffix(".wav")
        elif args.in_place:
            dest = path if path.suffix.lower() == ".wav" else path.with_suffix(".wav")
        else:
            # Default: sidecar .wav next to source (same as in-place for non-wav)
            dest = path if path.suffix.lower() == ".wav" else path.with_suffix(".wav")

        would += 1
        if not ff and not args.dry_run:
            continue
        if args.dry_run:
            print(f"DRY  {path} -> {dest}")
            converted.append(str(path))
            continue
        assert ff
        if _convert_one(
            ff,
            path,
            dest,
            rate=args.rate,
            bit_depth=args.bit_depth,
            channels=args.channels,
            dry_run=False,
        ):
            converted.append(str(dest))

    print(
        f"done  scanned_root={root}  skip_ok={skipped}  "
        f"need={would}  converted={len(converted)}  dry_run={args.dry_run}"
    )

    if args.manifest or (converted and not args.dry_run):
        man = args.manifest
        if man is None:
            man = _repo_root() / "data" / "state" / "convert-media-manifest.json"
        man.parent.mkdir(parents=True, exist_ok=True)
        payload = {
            "at": datetime.now(timezone.utc).isoformat(),
            "root": str(root),
            "target": args.target,
            "rate": args.rate,
            "bit_depth": args.bit_depth,
            "channels": args.channels,
            "dry_run": args.dry_run,
            "converted": converted,
            "skipped_ok": skipped,
        }
        man.write_text(json.dumps(payload, indent=2), encoding="utf-8")
        print(f"manifest  {man}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
