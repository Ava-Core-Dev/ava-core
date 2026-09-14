from __future__ import annotations

import json
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from apps.voice import director
from apps.voice import desk_audio


def test_windows_music_sweep_keeps_active_bed_and_kills_duplicates():
    rows = [
        {"ProcessId": 1001, "CommandLine": "pythonw play_music_bed_pygame.py AVA_MUSIC_BED a.wav"},
        {"ProcessId": 1002, "CommandLine": "pythonw play_music_bed_pygame.py AVA_MUSIC_BED b.wav"},
    ]
    query = SimpleNamespace(stdout=json.dumps(rows))
    kill = SimpleNamespace(stdout="", returncode=0)

    with patch.object(director.os, "name", "nt"), patch.object(
        director.subprocess, "run", side_effect=[query, kill]
    ) as run:
        assert director.kill_stray_music_players(keep_pid=1001) == 1

    assert run.call_args_list[1].args[0] == ["taskkill", "/PID", "1002", "/T", "/F"]


def test_windows_bed_uses_python_executable_not_pythonw_launcher():
    pythonw = Path(desk_audio.sys.executable).with_name("pythonw.exe")
    with patch.object(desk_audio.os, "name", "nt"), patch.object(
        desk_audio.sys, "executable", str(pythonw)
    ):
        assert desk_audio._python().endswith(r"Scripts\python.exe")