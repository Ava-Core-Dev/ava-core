from __future__ import annotations

from datetime import datetime
from zoneinfo import ZoneInfo

from apps.core.services.weather import daily_report_dir, weather_report_path


HST = ZoneInfo("Pacific/Honolulu")


def test_weather_uses_human_readable_daily_folder():
    now = datetime(2026, 9, 7, 12, 0, tzinfo=HST)

    assert daily_report_dir(now).parts[-4:] == (
        "Reports",
        "2026",
        "September",
        "September 7th, 2026",
    )
    assert weather_report_path(now).parent == daily_report_dir(now)
    assert weather_report_path(now).name.startswith("nws-weather-")


def test_weather_daily_folder_handles_ordinal_suffixes():
    assert daily_report_dir(datetime(2026, 9, 1, tzinfo=HST)).name == "September 1st, 2026"
    assert daily_report_dir(datetime(2026, 9, 2, tzinfo=HST)).name == "September 2nd, 2026"
    assert daily_report_dir(datetime(2026, 9, 3, tzinfo=HST)).name == "September 3rd, 2026"
    assert daily_report_dir(datetime(2026, 9, 11, tzinfo=HST)).name == "September 11th, 2026"
