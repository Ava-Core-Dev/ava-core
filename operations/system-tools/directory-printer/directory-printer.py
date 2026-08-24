#!/usr/bin/env python3
"""
Directory Printer - Ava Ops Tool
Produces two outputs:
  1. Detailed report (foldername.txt) – metadata + previews
  2. Tree report   (foldername_tree.txt) – clean list of paths for AI context

Hardened for large trees (home directories, etc.)
"""

import os
import sys
import argparse
import subprocess
import mimetypes
from datetime import datetime, timezone
from pathlib import Path

# ---------------------------------------------------------------------------
# Heavy / useless paths – always skipped unless the scan starts inside them
# ---------------------------------------------------------------------------
ALWAYS_SKIP = [
    # Snap
    Path.home() / "snap",
    Path("/home/ava-ivy/snap"),
    Path("/home/ava-core/snap"),
    Path("/var/lib/snapd"),

    # Caches & trash
    Path.home() / ".cache",
    Path.home() / ".local/share/Trash",
    Path.home() / ".local/share/gvfs-metadata",
    Path.home() / ".thumbnails",
    Path.home() / ".npm",
    Path.home() / ".cargo/registry",
    Path.home() / ".cargo/git",
    Path.home() / ".rustup",
    Path.home() / ".gradle",
    Path.home() / ".m2",
    Path.home() / ".ivy2",
    Path.home() / ".nuget",
    Path.home() / ".vscode/extensions",
    Path.home() / ".cursor",
    Path.home() / ".config/Code/Cache",
    Path.home() / ".config/Code/CachedData",
    Path.home() / ".config/Code/CachedExtensionVSIXs",
    Path.home() / ".config/google-chrome",
    Path.home() / ".config/chromium",
    Path.home() / ".mozilla",
    Path.home() / ".var",               # flatpak

    # System
    Path("/tmp"),
    Path("/var/tmp"),
    Path("/proc"),
    Path("/sys"),
    Path("/dev"),
    Path("/run"),
    Path("/lost+found"),
]

# Names that are almost always noise at any level
SKIP_DIR_NAMES = {
    "__pycache__", ".git", ".svn", ".hg", "node_modules",
    ".tox", ".venv", "venv", "env", ".mypy_cache", ".pytest_cache",
    ".eggs", "*.egg-info", ".ruff_cache", ".parcel-cache",
    "dist", "build", ".next", ".nuxt", "coverage",
}

def should_skip(path: Path, scan_root: Path) -> bool:
    try:
        path = path.resolve()
        scan_root = scan_root.resolve()
    except Exception:
        return True          # unreadable → skip

    # Skip by directory name
    if path.name in SKIP_DIR_NAMES or path.name.endswith(".egg-info"):
        return True

    for blocked in ALWAYS_SKIP:
        try:
            blocked = blocked.expanduser().resolve()
        except Exception:
            continue

        # If scan started inside the blocked tree → allow
        try:
            scan_root.relative_to(blocked)
            return False
        except ValueError:
            pass

        # If current path is inside blocked tree → skip
        try:
            path.relative_to(blocked)
            return True
        except ValueError:
            pass

    return False


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def is_binary(file_path: Path, sample_size: int = 4096) -> bool:
    try:
        with open(file_path, "rb") as f:
            chunk = f.read(sample_size)
        if b"\x00" in chunk:
            return True
        text_chars = bytearray({7, 8, 9, 10, 12, 13, 27} | set(range(0x20, 0x100)))
        nontext = chunk.translate(None, text_chars)
        return float(len(nontext)) / max(len(chunk), 1) > 0.30
    except Exception:
        return True


def get_timestamps(path: Path) -> dict:
    try:
        st = path.stat()
        mtime = datetime.fromtimestamp(st.st_mtime, tz=timezone.utc).strftime("%Y-%m-%d %H:%M:%S UTC")
        atime = datetime.fromtimestamp(st.st_atime, tz=timezone.utc).strftime("%Y-%m-%d %H:%M:%S UTC")
        ctime = datetime.fromtimestamp(st.st_ctime, tz=timezone.utc).strftime("%Y-%m-%d %H:%M:%S UTC")
        birth = None
        if hasattr(st, "st_birthtime"):
            birth = datetime.fromtimestamp(st.st_birthtime, tz=timezone.utc).strftime("%Y-%m-%d %H:%M:%S UTC")
        return {
            "modified": mtime,
            "accessed": atime,
            "changed": ctime,
            "created": birth or "N/A",
        }
    except Exception as e:
        return {"modified": "?", "accessed": "?", "changed": "?", "created": "?"}


def format_size(num_bytes: int) -> str:
    for unit in ["B", "KB", "MB", "GB", "TB"]:
        if num_bytes < 1024:
            return f"{num_bytes:.1f}{unit}"
        num_bytes /= 1024
    return f"{num_bytes:.1f}PB"


def detect_kind(path: Path) -> str:
    if path.is_dir():
        return "DIR"
    mime, _ = mimetypes.guess_type(str(path))
    if mime:
        if mime.startswith("image/"): return "IMAGE"
        if mime.startswith("video/"): return "VIDEO"
        if mime.startswith("audio/"): return "AUDIO"
        if mime == "application/pdf": return "PDF"
        if mime.startswith("text/"): return "TEXT"
        if "zip" in mime or "tar" in mime or "gzip" in mime or "compressed" in mime:
            return "ARCHIVE"
    ext = path.suffix.lower()
    if ext in {".jpg",".jpeg",".png",".gif",".webp",".bmp",".tiff",".tif",".svg",".ico",".heic",".avif"}: return "IMAGE"
    if ext in {".mp4",".mkv",".avi",".mov",".webm",".flv",".wmv",".m4v"}: return "VIDEO"
    if ext in {".mp3",".wav",".flac",".aac",".ogg",".m4a",".wma",".opus"}: return "AUDIO"
    if ext in {".zip",".tar",".gz",".tgz",".7z",".rar",".bz2",".xz"}: return "ARCHIVE"
    if ext == ".pdf": return "PDF"
    return "FILE"


def get_media_extra(path: Path, kind: str) -> str | None:
    # Keep media probing light – skip on huge scans if needed
    try:
        if kind == "IMAGE":
            result = subprocess.run(
                ["identify", "-format", "%wx%h %m", str(path)],
                capture_output=True, text=True, timeout=2
            )
            if result.returncode == 0 and result.stdout.strip():
                return result.stdout.strip()
        elif kind in ("VIDEO", "AUDIO"):
            result = subprocess.run(
                ["ffprobe", "-v", "error",
                 "-show_entries", "format=duration",
                 "-of", "default=noprint_wrappers=1:nokey=1", str(path)],
                capture_output=True, text=True, timeout=3
            )
            if result.returncode == 0 and result.stdout.strip():
                try:
                    secs = float(result.stdout.strip())
                    if secs >= 3600: return f"{secs/3600:.1f}h"
                    if secs >= 60:   return f"{secs/60:.1f}m"
                    return f"{secs:.1f}s"
                except ValueError:
                    pass
    except Exception:
        pass
    return None


def get_file_preview(path: Path, lines: int = 3) -> list[str]:
    if not path.is_file():
        return []
    kind = detect_kind(path)
    if kind in ("IMAGE", "VIDEO", "AUDIO", "PDF", "ARCHIVE") or is_binary(path):
        return ["[binary/media]"]
    try:
        with open(path, "r", encoding="utf-8", errors="replace") as f:
            result = []
            for i, line in enumerate(f):
                if i >= lines: break
                result.append(line.rstrip("\n\r")[:200])   # hard truncate long lines
            return result or ["[empty]"]
    except Exception:
        return ["[unreadable]"]


# ---------------------------------------------------------------------------
# Writers
# ---------------------------------------------------------------------------

def write_detailed(root: Path, scan_ts: str, out_path: Path, max_depth: int | None = None):
    lines = []
    lines.append("=" * 72)
    lines.append("DIRECTORY PRINTER — Detailed Report")
    lines.append(f"Root        : {root}")
    lines.append(f"Scan started: {scan_ts}")
    lines.append("=" * 72)
    lines.append("")

    count = [0]

    def add_entry(path: Path, depth: int):
        count[0] += 1
        if count[0] % 500 == 0:
            print(f"  … {count[0]} entries processed", file=sys.stderr, flush=True)

        kind = detect_kind(path)
        ts = get_timestamps(path)
        indent = "  " * depth
        name = path.name if path != root else str(path)

        size_extra = ""
        if path.is_file():
            try:
                size_extra = f"  {format_size(path.stat().st_size)}"
            except Exception:
                size_extra = "  ?"
            media = get_media_extra(path, kind)
            if media:
                size_extra += f"  {media}"

        lines.append(f"{indent}[{kind}] {name}{size_extra}")
        lines.append(f"{indent}  path     : {path}")
        lines.append(f"{indent}  modified : {ts['modified']}")
        lines.append(f"{indent}  created  : {ts['created']}")
        lines.append(f"{indent}  accessed : {ts['accessed']}")
        lines.append(f"{indent}  changed  : {ts['changed']}")
        lines.append(f"{indent}  scanned  : {scan_ts}")

        if path.is_file():
            preview = get_file_preview(path)
            if preview:
                lines.append(f"{indent}  preview  :")
                for p in preview:
                    lines.append(f"{indent}    {p}")
        lines.append("")

    add_entry(root, 0)

    def walk(current: Path, depth: int):
        if max_depth is not None and depth > max_depth:
            return
        try:
            entries = sorted(current.iterdir(), key=lambda p: (not p.is_dir(), p.name.lower()))
        except PermissionError:
            lines.append(f"{'  '*depth}[permission denied]")
            return
        except Exception as e:
            lines.append(f"{'  '*depth}[error: {e}]")
            return

        for entry in entries:
            if should_skip(entry, root):
                continue
            add_entry(entry, depth)
            if entry.is_dir():
                walk(entry, depth + 1)

    walk(root, 1)

    lines.append("=" * 72)
    lines.append(f"Scan finished: {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M:%S UTC')}")
    lines.append(f"Total entries: {count[0]}")
    lines.append("=" * 72)

    out_path.write_text("\n".join(lines), encoding="utf-8")
    print(f"  Detailed: {count[0]} entries", file=sys.stderr)


def write_tree(root: Path, out_path: Path, max_depth: int | None = None):
    lines = []
    lines.append(f"# TREE: {root}")
    lines.append(f"# Generated: {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M:%S UTC')}")
    lines.append("")

    count = [0]

    def walk(current: Path, prefix: str = "", depth: int = 0):
        if max_depth is not None and depth > max_depth:
            return
        try:
            entries = sorted(current.iterdir(), key=lambda p: (not p.is_dir(), p.name.lower()))
        except PermissionError:
            lines.append(f"{prefix}[permission denied]")
            return
        except Exception as e:
            lines.append(f"{prefix}[error: {e}]")
            return

        visible = [e for e in entries if not should_skip(e, root)]

        for i, entry in enumerate(visible):
            count[0] += 1
            is_last = (i == len(visible) - 1)
            connector = "└── " if is_last else "├── "
            kind = "DIR " if entry.is_dir() else "FILE"
            lines.append(f"{prefix}{connector}[{kind}] {entry.name}")
            lines.append(f"{prefix}{'    ' if is_last else '│   '}    {entry}")

            if entry.is_dir():
                extension = "    " if is_last else "│   "
                walk(entry, prefix + extension, depth + 1)

    lines.append(f"[DIR] {root.name or root}")
    lines.append(f"    {root}")
    walk(root, "", 0)

    lines.append("")
    lines.append(f"# Total entries: {count[0]}")

    out_path.write_text("\n".join(lines), encoding="utf-8")
    print(f"  Tree: {count[0]} entries", file=sys.stderr)


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(description="Directory Printer – detailed + tree reports")
    parser.add_argument("path", nargs="?", default=".", help="Directory to scan")
    parser.add_argument("-o", "--output", help="Base output path (without extension)")
    parser.add_argument("--max-depth", type=int, default=None, help="Limit recursion depth")
    parser.add_argument("--detailed-only", action="store_true")
    parser.add_argument("--tree-only", action="store_true")
    parser.add_argument("--fast", action="store_true",
                        help="Tree only + no media probing (recommended for home / large trees)")

    args = parser.parse_args()
    target = Path(args.path).expanduser().resolve()

    if not target.exists() or not target.is_dir():
        print(f"Error: not a directory → {target}", file=sys.stderr)
        sys.exit(1)

    scan_ts = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S UTC")
    print(f"Scanning: {target}", file=sys.stderr)

    if args.output:
        base = Path(args.output).expanduser()
        if base.suffix.lower() == ".txt":
            base = base.with_suffix("")
        detailed_path = base.with_name(base.name + ".txt")
        tree_path = base.with_name(base.name + "_tree.txt")
    else:
        folder_name = target.name or "root"
        detailed_path = target / f"{folder_name}.txt"
        tree_path = target / f"{folder_name}_tree.txt"

    # --fast forces tree-only behaviour for speed
    if args.fast:
        args.tree_only = True

    if not args.tree_only:
        write_detailed(target, scan_ts, detailed_path, max_depth=args.max_depth)
        print(f"✓ Detailed → {detailed_path}")

    if not args.detailed_only:
        write_tree(target, tree_path, max_depth=args.max_depth)
        print(f"✓ Tree     → {tree_path}")


if __name__ == "__main__":
    main()
