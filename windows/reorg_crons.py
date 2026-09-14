"""Move cron modules into always_on / since_last_fire / on_time (backup method)."""
from __future__ import annotations

import shutil
import sys
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8")

CRONS = Path(r"C:\Users\rootr\ava\apps\core\crons")

ALWAYS_ON = [
    "broadcast_loop.py",
    "minecraft_live.py",
    "ecoflow_quota.py",
    "kilauea_cams.py",
    "d1_sync.py",
    "vercel_builds.py",
]
SINCE_LAST = [
    "noaa.py",
    "kilauea.py",
    "hourly_chime.py",
    "solar_weather.py",
    "system_perf.py",
    "player_economy.py",
    "hurricane_tracker.py",
    "nhc_media.py",
    "user_qrcodes.py",
]
ON_TIME = [
    "morning_report.py",
    "merged_morning.py",
    "cursor_fallback.py",
    "economy_brief.py",
    "adsense_report.py",
    "admob_report.py",
    "overnight.py",
    "log_cleanup.py",
]

INIT = '"""Cron bucket. See apps/core/crons/README.md."""\n'


def move_into(names: list[str], dest: Path) -> None:
    dest.mkdir(parents=True, exist_ok=True)
    (dest / "__init__.py").write_text(INIT, encoding="utf-8")
    for name in names:
        src = CRONS / name
        if src.is_file():
            shutil.move(str(src), str(dest / name))
            print("moved", name, "->", dest.name)
        elif (dest / name).is_file():
            print("already", dest.name, name)
        else:
            print("missing", name)


def main() -> None:
    move_into(ALWAYS_ON, CRONS / "always_on")
    move_into(SINCE_LAST, CRONS / "since_last_fire")
    move_into(ON_TIME, CRONS / "on_time")
    boot = CRONS / "in_order_on_boot"
    boot.mkdir(exist_ok=True)
    (boot / "__init__.py").write_text(INIT, encoding="utf-8")
    (boot / "README.md").write_text(
        "Boot order lives in origin lifespan (heartbeat, AdSense/AdMob boot).\n"
        "Jobs here would run once, in name order, at start — same as the old backup.\n",
        encoding="utf-8",
    )
    print("done")


if __name__ == "__main__":
    main()
