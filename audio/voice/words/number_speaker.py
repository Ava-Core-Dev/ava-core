#!/usr/bin/env python3
"""
Number Speaker - Combines pre-recorded MP3 voice clips to speak numbers.
Uses only the Python standard library + ffmpeg (no pydub required).

Expected directory structure (relative to this script or --base-dir):
  numbers/1.mp3 ... numbers/100.mp3
  numbers/hundred.mp3
  numbers/thousand.mp3  numbers/thousands.mp3
  numbers/million.mp3   numbers/millions.mp3
  numbers/billion.mp3   numbers/billions.mp3
  numbers/trillion.mp3  numbers/trillions.mp3
  function words/and.mp3
  responses/yes.mp3  responses/no.mp3  responses/maybe.mp3

Usage:
  python3 number_speaker.py 1403
  python3 number_speaker.py 42 --play
  python3 number_speaker.py --interactive
  python3 number_speaker.py yes
"""

import argparse
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path


# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

DEFAULT_BASE_DIR = Path(__file__).resolve().parent
OUTPUT_DIR = DEFAULT_BASE_DIR / "generated"
GAP_MS = 50                 # small natural pause between words (ms)
SPEED = 1.0                 # keep original speaking speed
SILENCE_THRESH = "-45dB"    # only treat truly quiet parts as silence
SILENCE_MIN = 0.12          # require longer silence before trimming


# ---------------------------------------------------------------------------
# Number → list of clip names
# ---------------------------------------------------------------------------

ONES = {
    1: "1", 2: "2", 3: "3", 4: "4", 5: "5",
    6: "6", 7: "7", 8: "8", 9: "9",
}

TEENS = {
    10: "10", 11: "11", 12: "12", 13: "13", 14: "14",
    15: "15", 16: "16", 17: "17", 18: "18", 19: "19",
}

TENS = {
    20: "20", 30: "30", 40: "40", 50: "50",
    60: "60", 70: "70", 80: "80", 90: "90",
}


def under_100(n: int) -> list[str]:
    """Return clip name(s) for a number 0–100."""
    if n == 0:
        return []
    if 1 <= n <= 100:
        return [str(n)]
    # Fallback (should not be reached)
    if n < 10:
        return [ONES[n]]
    if n < 20:
        return [TEENS[n]]
    tens = (n // 10) * 10
    ones = n % 10
    parts = [str(tens)]
    if ones:
        parts.append(str(ones))
    return parts


def under_1000(n: int, use_and: bool = True) -> list[str]:
    """
    Handle 0–999 using the 'hundred' clip.
    Example: 403 → ["4", "hundred", "and", "3"]
    """
    if n < 100:
        return under_100(n)

    hundreds = n // 100
    remainder = n % 100

    parts = []
    if hundreds == 1:
        parts.append("100")          # full "one hundred"
    else:
        parts.append(str(hundreds))
        parts.append("hundred")

    if remainder:
        if use_and:
            parts.append("and")
        parts.extend(under_100(remainder))

    return parts


def number_to_clips(n: int) -> list[str]:
    """
    Convert a non-negative integer into a list of clip basenames.
    Style: 1403 → 1 + thousand + 4 + hundred + and + 3
    """
    if n < 0:
        raise ValueError("Negative numbers are not supported yet")

    if n == 0:
        return []

    if n <= 100:
        return [str(n)]

    # Always use the singular form when speaking full numbers
    # ("four thousand", never "four thousands")
    scales = [
        (10**12, "trillion"),
        (10**9,  "billion"),
        (10**6,  "million"),
        (10**3,  "thousand"),
    ]

    parts = []
    remaining = n
    used_higher_scale = False

    for value, scale_word in scales:
        count = remaining // value
        if count:
            if count <= 100:
                parts.append(str(count))
            else:
                parts.extend(under_1000(count, use_and=True))

            parts.append(scale_word)

            remaining %= value
            used_higher_scale = True

    if remaining:
        if used_higher_scale and remaining < 100:
            parts.append("and")
            parts.extend(under_100(remaining))
        else:
            parts.extend(under_1000(remaining, use_and=True))

    return parts


# ---------------------------------------------------------------------------
# Audio assembly (ffmpeg only)
# ---------------------------------------------------------------------------

def find_clip(base_dir: Path, name: str) -> Path:
    """Locate a single MP3 clip by basename."""
    candidates = [
        base_dir / "numbers" / f"{name}.mp3",
        base_dir / "function words" / f"{name}.mp3",
        base_dir / "responses" / f"{name}.mp3",
        base_dir / f"{name}.mp3",
    ]
    for path in candidates:
        if path.exists():
            return path
    raise FileNotFoundError(
        f"Missing voice clip: {name}.mp3\n"
        f"  looked in: numbers/, function words/, responses/"
    )


def check_ffmpeg() -> str:
    """Return path to ffmpeg or raise a clear error."""
    path = shutil.which("ffmpeg")
    if not path:
        raise RuntimeError(
            "ffmpeg is required but was not found on PATH.\n"
            "Install it with:  sudo apt install ffmpeg"
        )
    return path


def combine_clips(base_dir: Path, clip_names: list[str], output_path: Path, gap_ms: int = GAP_MS) -> Path:
    """
    Trim leading/trailing silence from each clip, then concatenate
    with a short natural gap. Uses only ffmpeg.
    """
    if not clip_names:
        raise ValueError("No clips to combine")

    ffmpeg = check_ffmpeg()
    output_path = output_path.resolve()
    output_path.parent.mkdir(parents=True, exist_ok=True)

    clip_paths = [find_clip(base_dir, name) for name in clip_names]

    with tempfile.TemporaryDirectory() as tmp:
        tmpdir = Path(tmp)

        # 1. Trim silence from every individual clip
        trimmed_paths = []
        for i, src in enumerate(clip_paths):
            trimmed = tmpdir / f"trim_{i}.mp3"
            # silenceremove strips quiet parts from start and end
            filter_str = (
                f"silenceremove="
                f"start_periods=1:start_duration={SILENCE_MIN}:start_threshold={SILENCE_THRESH}:"
                f"stop_periods=1:stop_duration={SILENCE_MIN}:stop_threshold={SILENCE_THRESH}"
            )
            result = subprocess.run(
                [
                    ffmpeg, "-y",
                    "-i", str(src),
                    "-af", filter_str,
                    "-q:a", "2",
                    str(trimmed),
                ],
                capture_output=True,
                text=True,
            )
            if result.returncode != 0:
                # If trimming fails for any reason, just use the original
                trimmed = src
            trimmed_paths.append(trimmed)

        # 2. Optional short silence between words
        silence_path = tmpdir / "silence.mp3"
        if gap_ms > 0 and len(trimmed_paths) > 1:
            subprocess.run(
                [
                    ffmpeg, "-y",
                    "-f", "lavfi",
                    "-i", "anullsrc=r=44100:cl=mono",
                    "-t", f"{gap_ms / 1000.0}",
                    "-q:a", "9",
                    str(silence_path),
                ],
                check=True,
                capture_output=True,
            )

        # 3. Build concat list
        list_file = tmpdir / "concat.txt"
        with open(list_file, "w", encoding="utf-8") as f:
            for i, path in enumerate(trimmed_paths):
                escaped = str(path).replace("'", "'\\''")
                f.write(f"file '{escaped}'\n")
                if gap_ms > 0 and i < len(trimmed_paths) - 1:
                    f.write(f"file '{silence_path}'\n")

        # 4. Concatenate (and optional overall speed change)
        cmd = [
            ffmpeg, "-y",
            "-f", "concat",
            "-safe", "0",
            "-i", str(list_file),
        ]

        if SPEED != 1.0:
            tempo = SPEED
            filters = []
            while tempo > 2.0:
                filters.append("atempo=2.0")
                tempo /= 2.0
            while tempo < 0.5:
                filters.append("atempo=0.5")
                tempo /= 0.5
            filters.append(f"atempo={tempo:.4f}")
            cmd += ["-filter:a", ",".join(filters)]

        cmd += ["-q:a", "2", str(output_path)]

        result = subprocess.run(cmd, capture_output=True, text=True)
        if result.returncode != 0:
            raise RuntimeError(f"ffmpeg failed:\n{result.stderr}")

    return output_path


def play_audio(path: Path) -> None:
    """Try to play the resulting MP3 with common tools."""
    players = [
        ["ffplay", "-nodisp", "-autoexit", str(path)],
        ["mpv", "--no-video", str(path)],
        ["vlc", "--play-and-exit", str(path)],
        ["aplay", str(path)],          # may not work for mp3
    ]
    for cmd in players:
        if shutil.which(cmd[0]):
            try:
                subprocess.run(cmd, check=True, capture_output=True)
                return
            except subprocess.CalledProcessError:
                continue
    print("(No audio player found – install ffplay, mpv or vlc to use --play)")


# ---------------------------------------------------------------------------
# Main interface
# ---------------------------------------------------------------------------

def speak_number(number: int, base_dir: Path, output_path: Path | None = None, do_play: bool = False) -> Path:
    clips = number_to_clips(number)
    if not clips:
        raise ValueError("Nothing to say for this number (zero is not supported)")

    print(f"Number : {number}")
    print(f"Clips  : {' + '.join(clips)}")

    if output_path is None:
        OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
        output_path = OUTPUT_DIR / f"{number}.mp3"

    combine_clips(base_dir, clips, output_path)
    print(f"Saved  : {output_path}")

    if do_play:
        print("Playing...")
        play_audio(output_path)

    return output_path


def speak_word(word: str, base_dir: Path, output_path: Path | None = None, do_play: bool = False) -> Path:
    word = word.lower().strip()
    # Just copy the single clip
    src = find_clip(base_dir, word)

    if output_path is None:
        OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
        output_path = OUTPUT_DIR / f"{word}.mp3"

    output_path = output_path.resolve()
    output_path.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(src, output_path)
    print(f"Saved  : {output_path}")

    if do_play:
        print("Playing...")
        play_audio(output_path)

    return output_path


def interactive_mode(base_dir: Path):
    print("Number Speaker – interactive mode")
    print("Enter a number (or yes/no/maybe), or 'q' to quit.\n")

    while True:
        try:
            user_input = input("> ").strip()
        except (EOFError, KeyboardInterrupt):
            print("\nBye!")
            break

        if not user_input or user_input.lower() in {"q", "quit", "exit"}:
            print("Bye!")
            break

        try:
            if user_input.lower() in {"yes", "no", "maybe"}:
                speak_word(user_input, base_dir, do_play=True)
            else:
                cleaned = user_input.replace(",", "").replace("_", "")
                number = int(cleaned)
                speak_number(number, base_dir, do_play=True)
        except ValueError as e:
            print(f"Error: {e}")
        except FileNotFoundError as e:
            print(f"Error: {e}")
        except RuntimeError as e:
            print(f"Error: {e}")
        print()


def main():
    global SPEED

    parser = argparse.ArgumentParser(
        description="Combine pre-recorded number voice clips into a single spoken number."
    )
    parser.add_argument(
        "value",
        nargs="?",
        help="Number to speak, or one of: yes, no, maybe"
    )
    parser.add_argument(
        "--base-dir",
        type=Path,
        default=DEFAULT_BASE_DIR,
        help=f"Directory containing numbers/ and responses/ (default: {DEFAULT_BASE_DIR})"
    )
    parser.add_argument(
        "-o", "--output",
        type=Path,
        help="Output MP3 path (default: generated/<number>.mp3)"
    )
    parser.add_argument(
        "--play",
        action="store_true",
        help="Play the result after generating it"
    )
    parser.add_argument(
        "--interactive", "-i",
        action="store_true",
        help="Enter interactive mode"
    )
    parser.add_argument(
        "--list-clips",
        action="store_true",
        help="Show which clips will be used (no audio generated)"
    )
    parser.add_argument(
        "--speed",
        type=float,
        default=None,
        help=f"Playback speed multiplier (default: {SPEED}). 1.0 = original, 2.0 = twice as fast"
    )

    args = parser.parse_args()
    base_dir = args.base_dir.resolve()

    # Allow overriding the global speed from the command line
    if args.speed is not None:
        SPEED = args.speed

    if args.interactive or args.value is None:
        interactive_mode(base_dir)
        return

    value = args.value.lower().strip()

    if value in {"yes", "no", "maybe"}:
        speak_word(value, base_dir, args.output, args.play)
        return

    try:
        number = int(value.replace(",", "").replace("_", ""))
    except ValueError:
        print(f"Invalid input: {args.value}")
        sys.exit(1)

    if args.list_clips:
        clips = number_to_clips(number)
        print(" + ".join(clips))
        return

    try:
        speak_number(number, base_dir, args.output, args.play)
    except (FileNotFoundError, RuntimeError, ValueError) as e:
        print(f"Error: {e}")
        sys.exit(1)


if __name__ == "__main__":
    main()
