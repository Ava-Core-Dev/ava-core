from __future__ import annotations

import os
import stat
import subprocess
from pathlib import Path


def test_launch_script_runs_with_project_root_as_cwd(tmp_path: Path):
    repo = Path("/home/rootrecord/Ava-Core")
    uvicorn_path = repo / ".venv" / "bin" / "uvicorn"
    backup = tmp_path / "uvicorn.backup"
    backup.write_bytes(uvicorn_path.read_bytes())

    try:
        uvicorn_path.write_text(
            "#!/bin/sh\n"
            "pwd > \"$LAUNCH_CWD_LOG\"\n"
            "printf '%s\\n' \"$PWD\" > \"$LAUNCH_PWD_LOG\"\n"
            "printf '%s\\n' \"$PYTHONPATH\" > \"$LAUNCH_PYTHONPATH_LOG\"\n"
            "exit 0\n",
            encoding="utf-8",
        )
        uvicorn_path.chmod(uvicorn_path.stat().st_mode | stat.S_IXUSR | stat.S_IXGRP | stat.S_IXOTH)

        fake_bin = tmp_path / "bin"
        fake_bin.mkdir()
        (fake_bin / "pgrep").write_text("#!/bin/sh\nexit 0\n", encoding="utf-8")
        (fake_bin / "lsof").write_text("#!/bin/sh\nexit 1\n", encoding="utf-8")
        for command in (fake_bin / "pgrep", fake_bin / "lsof"):
            command.chmod(command.stat().st_mode | stat.S_IXUSR | stat.S_IXGRP | stat.S_IXOTH)

        env = {
            **os.environ,
            "PATH": f"{fake_bin}:{os.environ['PATH']}",
            "LAUNCH_CWD_LOG": str(tmp_path / "cwd.txt"),
            "LAUNCH_PWD_LOG": str(tmp_path / "pwd.txt"),
            "LAUNCH_PYTHONPATH_LOG": str(tmp_path / "pythonpath.txt"),
            "PYTHONPATH": "",
        }

        result = subprocess.run(
            [str(repo / "scripts" / "launch.sh")],
            cwd="/tmp",
            env=env,
            capture_output=True,
            text=True,
            check=False,
        )

        assert result.returncode == 0, result.stderr
        assert (tmp_path / "pwd.txt").read_text(encoding="utf-8").strip() == str(repo)
        assert (tmp_path / "cwd.txt").read_text(encoding="utf-8").strip() == str(repo)
    finally:
        uvicorn_path.write_bytes(backup.read_bytes())
        uvicorn_path.chmod(backup.stat().st_mode)
