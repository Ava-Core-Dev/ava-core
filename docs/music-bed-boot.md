# Music bed on AVA-CORE (Windows)

What actually works on this PC (OmniBook / Session 1 desktop audio):

## Player

- **Use** `apps/voice/play_music_bed_pygame.py` (subprocess) + `desk_audio.py` for
  volume duck. Origin never loads pygame for the bed — large WAVs held the GIL and
  wedged `/health`.
- Voice: winsound helper (`play_music_bed.py` + `AVA_VOICE_CLIP`).
- Library under `Media/public/audio/music` is WAV (often 48 kHz on this tree).
  Recursive shuffle across folders (e.g. `Dub`, `Relax Work`).
- Command line includes `AVA_MUSIC_BED` so orphan cleanup can find the process.

## Levels (duck under Ava)

| State | Music | Ava voice |
|-------|-------|-----------|
| Idle (no Ava) | 0.50 | — |
| 1s before + while Ava talks | 0.20 | winsound (system) |
| Operator pause / bed off | stopped | — |

Constants: `desk_audio.MUSIC_IDLE`, `MUSIC_DUCKED`, `VOICE_LEVEL` (kept for channel
tests), `DUCK_LEAD_S=1.0`.

Reports/chimes **duck** the bed — they do **not** kill it. Bed uses pygame
`mixer.music` (stream). Voice stays on the winsound helper so long clips do not
load into `Sound` and wedge origin. Keep **one** uvicorn on :8787.

## Advance / shuffle

- Duration from the WAV header (`wave` module) in `director._music_wait_seconds`.
- Flat recursive list + `random.shuffle` each pass; log line includes
  `folders=Dub,Relax Work` (cross-folder mix).
- Inter-track: next file starts when the channel ends (no kill-on-report).

## Why it kept stopping (2026-09-04)

1. **Origin recycle cleared the bed.** Autostart was env-only (`AVA_MUSIC_BED`, default off). After watchdog/recycle the director came back with `music bed OFF` until someone hit start again.
2. **Fix:** `data/state/music-bed-wanted.txt` — `start` writes `1`, `stop` writes `0`. Lifespan calls `music_bed_wanted()` (env **or** file). Pause does not clear wanted. Director timeout supervisor restarts the loop if wanted and the task died.
3. Dual uvicorn on :8787 historically caused kill storms; keep **one** origin.
4. **Kill-on-report** made cut/resume harsh; replaced with duck (this doc).

## Controls

- Desk / `POST /api/voice/music` — `start` | `pause` | `resume` | `stop`.
- Autostart: `AVA_MUSIC_BED=1` **or** `music-bed-wanted.txt` = `1`.
- `start` must **not** unduck under a live REPORT/chime.

## Format tool

- `scripts/convert_media_library.py` — WAV 44.1 kHz 16-bit target. Music library on
  this PC was measured at **48 kHz** 16-bit stereo; dry-run lists those files as needing
  convert. Do not batch-convert until you choose to.

## Verify

- After start: `/api/voice/status` shows one `music.current`, `playing=true`, idle volume.
- Duck test: queue a short status clip → same track stays, `music.ducked=true` ~1s before
  voice, voice audible, then unduck to idle without restarting the track.
- Shuffle log: `Music bed shuffle  n=…  folders=Dub,Relax Work`.
