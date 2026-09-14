from __future__ import annotations

from datetime import datetime
from zoneinfo import ZoneInfo

from apps.core.services import earthquake_hourly_processor as earthquakes
from apps.core.services import kilauea


HST = ZoneInfo("Pacific/Honolulu")


def test_kilauea_daily_path_uses_report_root():
    path = kilauea._daily_report_dir(datetime(2026, 9, 7, tzinfo=HST))
    assert str(path).endswith("Reports\\2026\\September\\September 7th, 2026")


def test_earthquake_daily_path_uses_report_root():
    path = earthquakes._daily_report_dir(datetime(2026, 9, 7, tzinfo=HST))
    assert str(path).endswith("Reports\\2026\\September\\September 7th, 2026")
