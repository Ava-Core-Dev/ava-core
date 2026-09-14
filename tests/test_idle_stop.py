from __future__ import annotations

import os
import stat
import subprocess
from pathlib import Path


def test_idle_stop_dry_run_discovers_services_audio_and_ports(tmp_path: Path):
    fake_bin = tmp_path / "bin"
    fake_bin.mkdir()
    (fake_bin / "ps").write_text(
        "#!/bin/sh\n"
        "printf '%s\\n' '1001 uvicorn apps.core.main:app'\n"
        "printf '%s\\n' '1002 python -m apps.voice.director'\n"
        "printf '%s\\n' '1003 ollama serve'\n"
        "printf '%s\\n' '1004 ffplay AVA_MUSIC_BED track.wav'\n"
        "printf '%s\\n' '1005 node server.mjs'\n",
        encoding="ascii",
    )
    (fake_bin / "lsof").write_text(
        "#!/bin/sh\n"
        "case \"$2\" in\n"
        "  tcp:8787) printf '%s\\n' 2001 ;;\n"
        "  tcp:8791) printf '%s\\n' 2002 ;;\n"
        "  tcp:11434) printf '%s\\n' 2003 ;;\n"
        "esac\n",
        encoding="ascii",
    )
    for command in (fake_bin / "ps", fake_bin / "lsof"):
        command.chmod(command.stat().st_mode | stat.S_IXUSR)

    result = subprocess.run(
        ["/home/rootrecord/Ava-Core/scripts/idle-stop.sh"],
        env={
            **os.environ,
            "HOME": str(tmp_path),
            "PATH": f"{fake_bin}:{os.environ['PATH']}",
            "IDLE_STOP_DRY_RUN": "1",
        },
        capture_output=True,
        text=True,
        check=True,
    )

    output = result.stdout
    for pid in (1001, 1002, 1003, 1004, 1005, 2001, 2002, 2003):
        assert f"would stop PID {pid}" in output
    assert "desk returned to idle state" in output