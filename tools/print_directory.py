#!/usr/bin/env python3
"""
Print Directory - Cross-Platform Self-Installing Directory Context Collector

Creates a recursive files.log containing every reachable directory and file.
Text files show metadata plus the first 20 lines only.
Binary files are inventoried without dumping binary data.

Usage:
    python3 print_directory.py
    python3 print_directory.py /path/to/folder
    python3 print_directory.py --install
    python3 print_directory.py --check
    python3 print_directory.py --uninstall
    python3 print_directory.py --scan-only /path/to/folder
"""

from __future__ import annotations

import argparse
import hashlib
import mimetypes
import os
import platform
import shutil
import stat
import subprocess
import sys
from datetime import datetime
from pathlib import Path

APP_NAME = "Print Directory"
SCRIPT_NAME = "print_directory.py"
OUTPUT_FILE = "files.log"

SYSTEM = platform.system().lower()
CURRENT_SCRIPT = Path(__file__).resolve()

HASH_CHUNK_SIZE = 1024 * 1024
TEXT_SAMPLE_BYTES = 64 * 1024
TEXT_PREVIEW_MAX_LINES = 20
TEXT_PREVIEW_MAX_CHARS = 12000
TEXT_LINE_SCAN_LIMIT = 16 * 1024 * 1024

TEXT_EXTENSIONS = {
    ".py", ".pyw", ".pyi", ".js", ".mjs", ".cjs", ".ts", ".tsx", ".jsx",
    ".json", ".jsonl", ".yaml", ".yml", ".toml", ".ini", ".cfg", ".conf",
    ".txt", ".md", ".rst", ".csv", ".tsv", ".xml", ".html", ".htm",
    ".css", ".scss", ".sass", ".less", ".sh", ".bash", ".zsh", ".fish",
    ".ps1", ".bat", ".cmd", ".sql", ".r", ".rb", ".php", ".java", ".c",
    ".h", ".hpp", ".cpp", ".cc", ".cs", ".go", ".rs", ".swift", ".kt",
    ".kts", ".lua", ".pl", ".pm", ".tex", ".dockerfile", ".gitignore",
    ".env", ".properties", ".service", ".desktop",
}

TEXT_FILENAMES = {
    "readme", "readme.md", "license", "copying", "makefile", "dockerfile",
    "gemfile", "rakefile", "procfile", ".gitignore", ".dockerignore",
    ".env", "requirements.txt", "package.json", "pyproject.toml",
}

def _ava_root() -> Path:
    """Resolve the live Ava tree. Never resolves to the removable archive disk."""
    candidates = [
        os.environ.get("AVA_HOME"),
        os.environ.get("AVA_HANDOFF"),
        "/run/media/ava-core/6B6C97406BF24558/ava-core-v2",
        str(Path.home() / "ava"),
    ]
    for candidate in candidates:
        if not candidate:
            continue
        path = Path(candidate).expanduser()
        if (path / "tools").is_dir() or (path / "apps").is_dir():
            return path
    return Path.home() / "ava"


if SYSTEM == "windows":
    INSTALL_DIR = Path(os.environ.get("LOCALAPPDATA", Path.home() / "AppData/Local")) / APP_NAME
else:
    INSTALL_DIR = _ava_root() / "tools"

INSTALLED_SCRIPT = INSTALL_DIR / SCRIPT_NAME
LINUX_NAUTILUS_SCRIPT = Path.home() / ".local" / "share" / "nautilus" / "scripts" / APP_NAME


def human_size(num_bytes):
    if num_bytes is None:
        return "N/A"
    try:
        value = float(num_bytes)
    except (TypeError, ValueError):
        return "N/A"
    for unit in ("B", "KB", "MB", "GB", "TB", "PB"):
        if value < 1024.0 or unit == "PB":
            return f"{value:.1f} {unit}"
        value /= 1024.0


def safe_time(timestamp):
    try:
        return datetime.fromtimestamp(timestamp).isoformat(sep=" ", timespec="seconds")
    except Exception:
        return "N/A"


def get_owner(st):
    if SYSTEM == "windows":
        return str(getattr(st, "st_uid", "N/A"))
    try:
        import pwd
        return pwd.getpwuid(st.st_uid).pw_name
    except Exception:
        return str(getattr(st, "st_uid", "N/A"))


def shell_quote(value):
    value = str(value)
    return "'" + value.replace("'", "'\"'\"'") + "'"


def sha256_file(path):
    digest = hashlib.sha256()
    try:
        with open(path, "rb") as handle:
            while True:
                chunk = handle.read(HASH_CHUNK_SIZE)
                if not chunk:
                    break
                digest.update(chunk)
        return digest.hexdigest(), None
    except Exception as exc:
        return None, str(exc)


def looks_like_text_name(path):
    name = path.name.lower()
    if name in TEXT_FILENAMES:
        return True
    suffixes = "".join(path.suffixes).lower()
    return suffixes in TEXT_EXTENSIONS or path.suffix.lower() in TEXT_EXTENSIONS


def detect_text(path):
    """Return (is_text, encoding, error)."""
    try:
        with open(path, "rb") as handle:
            sample = handle.read(TEXT_SAMPLE_BYTES)
    except Exception as exc:
        return False, None, str(exc)

    if not sample:
        return True, "utf-8", None

    if b"\x00" in sample:
        return False, None, None

    for encoding in ("utf-8-sig", "utf-8", "utf-16", "utf-16-le", "utf-16-be"):
        try:
            decoded = sample.decode(encoding)
            controls = sum(
                1 for char in decoded
                if ord(char) < 32 and char not in "\n\r\t\f\b"
            )
            if controls <= max(8, len(decoded) // 100):
                return True, encoding, None
        except UnicodeDecodeError:
            pass

    if looks_like_text_name(path):
        return True, "utf-8", None

    return False, None, None


def get_text_details(path, encoding):
    result = {
        "line_count": None,
        "line_count_note": None,
        "preview": [],
        "preview_truncated": False,
        "error": None,
    }

    try:
        size = path.stat().st_size
    except Exception:
        size = None

    clean_encoding = encoding.replace(" (replacement)", "") if encoding else "utf-8"

    try:
        if size is not None and size <= TEXT_LINE_SCAN_LIMIT:
            count = 0
            with open(path, "r", encoding=clean_encoding, errors="replace", newline="") as handle:
                for count, _ in enumerate(handle, start=1):
                    pass
            result["line_count"] = count
        else:
            result["line_count_note"] = (
                f"Not counted: file exceeds {human_size(TEXT_LINE_SCAN_LIMIT)} scan limit"
            )

        chars = 0
        with open(path, "r", encoding=clean_encoding, errors="replace") as handle:
            for index, line in enumerate(handle):
                if index >= TEXT_PREVIEW_MAX_LINES:
                    result["preview_truncated"] = True
                    break

                line = line.rstrip("\r\n")
                remaining = TEXT_PREVIEW_MAX_CHARS - chars
                if remaining <= 0:
                    result["preview_truncated"] = True
                    break

                if len(line) > remaining:
                    result["preview"].append(line[:remaining])
                    result["preview_truncated"] = True
                    break

                result["preview"].append(line)
                chars += len(line) + 1

        if result["line_count"] is not None and result["line_count"] > len(result["preview"]):
            result["preview_truncated"] = True

    except Exception as exc:
        result["error"] = str(exc)

    return result


def image_details(path):
    try:
        from PIL import Image
    except Exception:
        return None

    try:
        with Image.open(path) as image:
            return {"size": f"{image.width} x {image.height}", "format": image.format}
    except Exception:
        return None


def write_directory(out, path, kind="DIRECTORY"):
    try:
        st = os.lstat(path)
        out.write(f"{kind}\n")
        out.write(f"  Path: {path}\n")
        out.write(f"  Modified: {safe_time(st.st_mtime)}\n")
        out.write(f"  Permissions: {oct(stat.S_IMODE(st.st_mode))}\n")
        out.write(f"  Owner: {get_owner(st)}\n\n")
        return True
    except Exception as exc:
        out.write(f"{kind}-ERROR\n  Path: {path}\n  Error: {exc}\n\n")
        return False


def write_file(out, path):
    try:
        st = os.lstat(path)
    except Exception as exc:
        out.write(f"FILE-ERROR\n  Path: {path}\n  Error: {exc}\n\n")
        return False, 1

    if stat.S_ISLNK(st.st_mode):
        try:
            target = os.readlink(path)
        except Exception:
            target = "N/A"
        out.write("SYMLINK\n")
        out.write(f"  Path: {path}\n")
        out.write(f"  Target: {target}\n")
        out.write(f"  Modified: {safe_time(st.st_mtime)}\n")
        out.write(f"  Permissions: {oct(stat.S_IMODE(st.st_mode))}\n")
        out.write(f"  Owner: {get_owner(st)}\n\n")
        return True, 0

    if not stat.S_ISREG(st.st_mode):
        out.write("SPECIAL\n")
        out.write(f"  Path: {path}\n")
        out.write(f"  Mode: {oct(stat.S_IMODE(st.st_mode))}\n")
        out.write(f"  Owner: {get_owner(st)}\n\n")
        return True, 0

    mime = mimetypes.guess_type(path.name)[0] or "unknown"
    digest, hash_error = sha256_file(path)
    is_text, encoding, detect_error = detect_text(path)

    out.write("FILE\n")
    out.write(f"  Path: {path}\n")
    out.write(f"  Name: {path.name}\n")
    out.write(f"  Extension: {path.suffix or '(none)'}\n")
    out.write(f"  MIME: {mime}\n")
    out.write(f"  Size: {human_size(st.st_size)}\n")
    out.write(f"  Modified: {safe_time(st.st_mtime)}\n")
    out.write(f"  Created/Changed: {safe_time(st.st_ctime)}\n")
    out.write(f"  Accessed: {safe_time(st.st_atime)}\n")
    out.write(f"  Permissions: {oct(stat.S_IMODE(st.st_mode))}\n")
    out.write(f"  Owner: {get_owner(st)}\n")
    out.write(f"  SHA256: {digest if digest else 'ERROR: ' + str(hash_error)}\n")

    if detect_error:
        out.write(f"  Content Detection Error: {detect_error}\n")
        out.write("  Content Type: unknown\n\n")
        return True, 0

    if not is_text:
        out.write("  Content Type: binary\n")
        details = image_details(path)
        if details:
            out.write(f"  Image Dimensions: {details['size']}\n")
            out.write(f"  Image Format: {details['format']}\n")
        out.write("\n")
        return True, 0

    out.write("  Content Type: text\n")
    out.write(f"  Encoding: {encoding}\n")

    details = get_text_details(path, encoding)
    if details["line_count"] is not None:
        out.write(f"  Lines: {details['line_count']}\n")
    elif details["line_count_note"]:
        out.write(f"  Lines: {details['line_count_note']}\n")

    if details["error"]:
        out.write(f"  Preview Error: {details['error']}\n\n")
        return True, 0

    out.write("\n  --- CONTENT PREVIEW: FIRST 20 LINES ---\n")
    if details["preview"]:
        for index, line in enumerate(details["preview"], start=1):
            out.write(f"  {index:>2}: {line}\n")
    else:
        out.write("  (empty file)\n")

    if details["preview_truncated"]:
        out.write(
            f"  [Preview truncated after {TEXT_PREVIEW_MAX_LINES} lines; "
            "full file remains unchanged on disk]\n"
        )

    out.write("  --- END CONTENT PREVIEW ---\n\n")
    return True, 0


def scan_directory(start):
    start = Path(start).expanduser().resolve()

    if not start.exists():
        raise FileNotFoundError(f"Directory does not exist: {start}")
    if not start.is_dir():
        raise NotADirectoryError(f"Not a directory: {start}")

    output_path = start / OUTPUT_FILE
    output_real = output_path.resolve()

    totals = {"entries": 0, "directories": 0, "files": 0, "errors": 0}

    with open(output_path, "w", encoding="utf-8", errors="replace") as out:
        out.write("# PRINT DIRECTORY - FULL FILE CONTEXT\n")
        out.write(f"# Generated: {datetime.now().isoformat()}\n")
        out.write(f"# Platform: {platform.platform()}\n")
        out.write(f"# Root: {start}\n#\n")
        out.write("# Every reachable file and directory is listed recursively.\n")
        out.write("# Text content preview is limited to the first 20 lines.\n")
        out.write("# Binary files are inventoried without binary dumps.\n")
        out.write("#" + "=" * 100 + "\n\n")

        if write_directory(out, start, "ROOT"):
            totals["entries"] += 1
            totals["directories"] += 1
        else:
            totals["errors"] += 1

        def walk_error(exc):
            totals["errors"] += 1
            out.write("DIRECTORY-ERROR\n")
            out.write(f"  Path: {getattr(exc, 'filename', 'unknown')}\n")
            out.write(f"  Error: {exc}\n\n")

        for root, dirs, files in os.walk(
            start,
            topdown=True,
            followlinks=False,
            onerror=walk_error,
        ):
            root_path = Path(root)

            # Deterministic ordering and explicit recursion. Do not descend through symlinks.
            dirs[:] = sorted(
                d for d in dirs
                if not (root_path / d).is_symlink()
            )
            files = sorted(files)

            # IMPORTANT: os.walk gives us every subdirectory. Log each one here.
            for dirname in dirs:
                dpath = root_path / dirname
                totals["entries"] += 1
                totals["directories"] += 1
                if not write_directory(out, dpath, "DIRECTORY"):
                    totals["errors"] += 1

            # Log all regular files and symlinks. Skip the output currently being written.
            for filename in files:
                fpath = root_path / filename
                try:
                    if fpath.resolve() == output_real:
                        continue
                except Exception:
                    if fpath == output_path:
                        continue

                totals["entries"] += 1
                totals["files"] += 1
                _, errors = write_file(out, fpath)
                totals["errors"] += errors

            out.flush()

        out.write("#" + "=" * 100 + "\n")
        out.write("# SCAN COMPLETE\n")
        out.write(f"# Total entries: {totals['entries']}\n")
        out.write(f"# Directories: {totals['directories']}\n")
        out.write(f"# Files: {totals['files']}\n")
        out.write(f"# Errors: {totals['errors']}\n")
        out.write(f"# Finished: {datetime.now().isoformat()}\n")

    return output_path, totals


def linux_launcher_content():
    """Nautilus wrapper.

    Nautilus passes basenames in "$@" relative to the viewed folder, so absolute
    paths from NAUTILUS_SCRIPT_SELECTED_FILE_PATHS are preferred. With nothing
    selected (background right-click) the viewed folder itself is scanned.
    """
    return (
        "#!/bin/bash\n"
        "# Auto-generated by Print Directory (--install). Do not hand-edit.\n"
        "SCRIPT=" + shell_quote(INSTALLED_SCRIPT) + "\n"
        "AVA_TOOLS_DIR=" + shell_quote(INSTALL_DIR) + "\n"
        "\n"
        "PY=python3\n"
        'for cand in "${AVA_HOME:-}/.venv/bin/python" '
        '"${AVA_TOOLS_DIR%/tools}/.venv/bin/python"; do\n'
        '  if [ -x "$cand" ]; then PY="$cand"; break; fi\n'
        "done\n"
        "\n"
        "targets=()\n"
        'if [ -n "${NAUTILUS_SCRIPT_SELECTED_FILE_PATHS:-}" ]; then\n'
        "  while IFS= read -r line; do\n"
        '    [ -n "$line" ] && targets+=("$line")\n'
        '  done <<< "$NAUTILUS_SCRIPT_SELECTED_FILE_PATHS"\n'
        "else\n"
        '  for f in "$@"; do\n'
        '    case "$f" in\n'
        '      /*) targets+=("$f") ;;\n'
        '      *)  targets+=("$PWD/$f") ;;\n'
        "    esac\n"
        "  done\n"
        "fi\n"
        "\n"
        "# Background right-click (nothing selected) scans the folder in view\n"
        'if [ "${#targets[@]}" -eq 0 ]; then\n'
        '  targets+=("$PWD")\n'
        "fi\n"
        "\n"
        "count=0\n"
        "fails=0\n"
        'for folder in "${targets[@]}"; do\n'
        '  if [ -d "$folder" ]; then\n'
        '    if "$PY" "$SCRIPT" --scan-only "$folder"; then\n'
        "      count=$((count + 1))\n"
        "    else\n"
        "      fails=$((fails + 1))\n"
        "    fi\n"
        "  fi\n"
        "done\n"
        "\n"
        "if command -v notify-send >/dev/null 2>&1; then\n"
        '  if [ "$count" -gt 0 ] && [ "$fails" -eq 0 ]; then\n'
        '    notify-send "Print Directory" "files.log written in $count folder(s)"\n'
        '  elif [ "$count" -gt 0 ]; then\n'
        '    notify-send "Print Directory" "$count done, $fails failed"\n'
        "  else\n"
        '    notify-send -u critical "Print Directory" "No folder scanned"\n'
        "  fi\n"
        "fi\n"
    )


def install_linux():
    INSTALL_DIR.mkdir(parents=True, exist_ok=True)

    if CURRENT_SCRIPT.resolve() != INSTALLED_SCRIPT.resolve():
        shutil.copy2(CURRENT_SCRIPT, INSTALLED_SCRIPT)

    LINUX_NAUTILUS_SCRIPT.parent.mkdir(parents=True, exist_ok=True)
    LINUX_NAUTILUS_SCRIPT.write_text(linux_launcher_content(), encoding="utf-8")
    LINUX_NAUTILUS_SCRIPT.chmod(0o755)

    try:
        subprocess.run(["nautilus", "-q"], check=False, capture_output=True)
    except Exception:
        pass

    return True


def install_windows():
    INSTALL_DIR.mkdir(parents=True, exist_ok=True)
    if CURRENT_SCRIPT.resolve() != INSTALLED_SCRIPT.resolve():
        shutil.copy2(CURRENT_SCRIPT, INSTALLED_SCRIPT)

    # Per-user Explorer context-menu entry. Uses Python launcher when available.
    try:
        import winreg
        key_path = r"Software\Classes\Directory\shell\Print Directory"
        key = winreg.CreateKey(winreg.HKEY_CURRENT_USER, key_path)
        winreg.SetValueEx(key, "", 0, winreg.REG_SZ, "Print Directory")
        command = winreg.CreateKey(key, "command")
        command_text = f'"{sys.executable}" "{INSTALLED_SCRIPT}" --scan-only "%1"'
        winreg.SetValueEx(command, "", 0, winreg.REG_SZ, command_text)
        winreg.CloseKey(command)
        winreg.CloseKey(key)
        return True
    except Exception as exc:
        print(f"Windows context-menu setup failed: {exc}", file=sys.stderr)
        return False


def install_or_repair():
    print("=" * 72)
    print("PRINT DIRECTORY INSTALLER")
    print("=" * 72)
    print(f"Platform: {platform.system()}")
    print(f"Permanent installation: {INSTALL_DIR}")
    print("")

    if SYSTEM == "windows":
        success = install_windows()
    else:
        success = install_linux()

    if success:
        print("Installation complete.")
        if SYSTEM == "linux":
            print("Right-click a folder -> Scripts -> Print Directory")
        else:
            print("Right-click a folder -> Print Directory")
    return success


def check_install():
    print("PRINT DIRECTORY INSTALLATION CHECK")
    print(f"Platform: {platform.system()}")
    print(f"Installed script: {INSTALLED_SCRIPT}")
    print(f"Installed: {'YES' if INSTALLED_SCRIPT.is_file() else 'NO'}")

    if SYSTEM == "linux":
        print(f"Nautilus launcher: {LINUX_NAUTILUS_SCRIPT}")
        print(f"Launcher present: {'YES' if LINUX_NAUTILUS_SCRIPT.is_file() else 'NO'}")
        valid = INSTALLED_SCRIPT.is_file() and LINUX_NAUTILUS_SCRIPT.is_file()
    else:
        valid = INSTALLED_SCRIPT.is_file()

    print(f"Status: {'VALID' if valid else 'MISSING OR INVALID'}")
    return valid


def uninstall():
    removed = []

    for path in (LINUX_NAUTILUS_SCRIPT, INSTALLED_SCRIPT):
        try:
            if path.is_file() or path.is_symlink():
                path.unlink()
                removed.append(str(path))
        except Exception as exc:
            print(f"Could not remove {path}: {exc}", file=sys.stderr)

    print("Removed:")
    for item in removed:
        print(f"  {item}")

    return True


def main():
    parser = argparse.ArgumentParser(
        description="Recursively print a directory with file details and 20-line text previews."
    )
    parser.add_argument("path", nargs="?", help="Directory to scan")
    parser.add_argument("--install", action="store_true", help="Install or repair integration")
    parser.add_argument("--check", action="store_true", help="Check installation")
    parser.add_argument("--uninstall", action="store_true", help="Remove integration")
    parser.add_argument("--scan-only", metavar="PATH", help="Scan without installing")

    args = parser.parse_args()

    if args.install:
        return 0 if install_or_repair() else 1

    if args.check:
        return 0 if check_install() else 1

    if args.uninstall:
        return 0 if uninstall() else 1

    if args.scan_only:
        target = args.scan_only
    elif args.path:
        target = args.path
    else:
        target = CURRENT_SCRIPT.parent

    # If run from a random copied location, auto-install the permanent integration,
    # but the requested scan still targets the selected folder.
    if not check_install():
        print("\nInstallation missing or invalid. Running automatic installation...\n")
        install_or_repair()
        print("")

    output, totals = scan_directory(target)
    print(f"Created: {output}")
    print(
        f"Entries: {totals['entries']} | "
        f"Directories: {totals['directories']} | "
        f"Files: {totals['files']} | Errors: {totals['errors']}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
