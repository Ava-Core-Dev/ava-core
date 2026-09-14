"""One-shot desktop play via winsound (WAV). No MediaPlayer."""
from __future__ import annotations

import sys
import winsound
from pathlib import Path


def main() -> int:
    if len(sys.argv) < 2:
        print("usage: _play_wav_once.py <file.wav>", file=sys.stderr)
        return 2
    path = Path(sys.argv[1])
    if not path.is_file():
        print(f"missing: {path}", file=sys.stderr)
        return 1
    winsound.PlaySound(str(path.resolve()), winsound.SND_FILENAME)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
