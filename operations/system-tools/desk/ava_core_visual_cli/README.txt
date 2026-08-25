AVA CORE VISUAL CLI — AUDIO UPDATE

INSTALL
1. Extract this ZIP.
2. Run:
   bash install_ava_core_visual_cli_audio.sh

This installs:
- Ava Core Visual CLI with OPERATIONS and AUDIO pages.
- ava_core_audio_player.py into:
  /home/ava-core/operations/cronologicals/always-on/
- A desktop launcher.

AUDIO
Drop MP3 files anywhere under:
  /home/ava-core/operations/cronologicals/

State is controlled by filename:
  track.mp3            = ON
  track.mp3.disabled   = OFF

The Audio page recursively discovers all tracks, excluding always-on and
__pycache__, shows ON/OFF state, and supports double-click or TOGGLE SELECTED.

The audio player is supervised by Ava-Core as an always-on process, so audio
continues even when the Visual CLI is closed.

Supported player backends are detected automatically:
1. ffplay
2. mpg123
3. cvlc
4. vlc

LOG
/home/ava-core/database/logs/ava-core-audio.log

CLI COMMANDS
audio
audio-log
audio-toggle <audio-path>
