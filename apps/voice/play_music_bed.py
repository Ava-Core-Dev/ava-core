"""One-shot winsound player for Windows (AVA-CORE).

Fallback / orphan-debug helper. Live desk bed uses apps/voice/desk_audio.py
(pygame) so volume can duck under Ava. This script has no volume control.

Argv must include AVA_MUSIC_BED (music bed) or AVA_VOICE_CLIP (report/chime).
kill_stray only matches AVA_MUSIC_BED, so voice clips are not swept with the bed.

Plays WAV via winsound (sync, full file). Non-WAV is rejected here — convert
upstream (director ffmpeg) before calling.
"""

from __future__ import annotations

import sys


MUSIC_MARKER = "AVA_MUSIC_BED"
VOICE_MARKER = "AVA_VOICE_CLIP"
MARKERS = (MUSIC_MARKER, VOICE_MARKER)


def main(argv: list[str]) -> int:
    marker = next((m for m in MARKERS if m in argv), None)
    if not marker:
        print(f"missing marker ({MUSIC_MARKER} or {VOICE_MARKER})", file=sys.stderr)
        return 2
    # Last non-marker arg is the audio path (paths may contain spaces as one argv).
    paths = [a for a in argv[1:] if a not in MARKERS]
    if not paths:
        print("missing audio path", file=sys.stderr)
        return 2
    path = paths[-1]
    suffix = path[path.rfind(".") :].lower() if "." in path else ""
    if suffix != ".wav":
        print(f"unsupported format: {suffix or '(none)'}", file=sys.stderr)
        return 3
    import winsound

    # SND_FILENAME sync — blocks until natural end. No MediaPlayer.
    winsound.PlaySound(path, winsound.SND_FILENAME)
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
