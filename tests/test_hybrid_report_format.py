from __future__ import annotations

import re
from datetime import datetime
from pathlib import Path

import apps.core.services.hybrid_reports as solar_weather
from apps.core.crons.since_last_fire import solar_weather as solar_cron


def test_update_solar_notes_preserves_existing_text_and_appends(tmp_path, monkeypatch):
    report_path = tmp_path / "hybrid.md"
    report_path.write_text(
        """
#Predicted Forcast for today:
# 
#
This is a HYBRID manual report.
#1000, WEATHER — stale legacy weather
AUTO 0945, ECOFLOW STATUS - stale legacy ecoflow
>0930, CHARGE STATUS — Charging | Host battery: 41% | CPU: 22% | RAM: 88% | Temp: 69C | iGPU: 10% | NPU: present | Uptime: 1h 20m

+++Automation Cut Off
--------------------Daily To-Do-------------------------------
""".strip()
        + "\n",
        encoding="utf-8",
    )

    weather_path = tmp_path / "weather.md"
    weather_path.write_text("### Weather\n78°F — Frequent showers and thunderstorms\n", encoding="utf-8")

    monkeypatch.setattr(solar_weather, "_ecoflow_roots", lambda: [])
    monkeypatch.setattr(solar_weather, "_charge_status_insert", lambda now, report_body=None: ">0945, CHARGE STATUS — Charging | Host battery: 41% | CPU: 22% | RAM: 88% | Temp: 69C | iGPU: 10% | NPU: present | Uptime: 1h 20m")
    monkeypatch.setattr(
        "apps.core.services.reports.latest_report",
        lambda pattern: weather_path if pattern == "nws-weather-*.md" else None,
    )

    result = solar_weather.update_solar_notes(datetime(2026, 9, 7, 9, 45), path=report_path)

    assert result["ok"] is True
    body = report_path.read_text(encoding="utf-8")
    assert "> ◇ **0945** — WEATHER — 78°F — Frequent showers and thunderstorms" in body
    assert "> ◇ **0945** — ECOFLOW STATUS - DELTA 2:" in body
    assert "> ◇ **0945** — ECOFLOW STATUS - RIVER 2 PRO:" in body
    assert "#1000, WEATHER — stale legacy weather" not in body
    assert "AUTO 0945, ECOFLOW STATUS - stale legacy ecoflow" not in body
    assert "#Predicted Forcast for today:\n# \n#" in body
    assert " >" not in body
    assert not any(line.rstrip() != line for line in body.splitlines() if line.startswith(">"))


def test_update_solar_notes_keeps_manual_content_and_adds_power_automation(tmp_path, monkeypatch):
    report_path = tmp_path / "hybrid.md"
    report_path.write_text(
        """
#Predicted Forcast for today:
# 
#
This is a HYBRID manual report.
>0930, CHARGE STATUS — Charging | Host battery: 41% | CPU: 22% | RAM: 88% | Temp: 69C | iGPU: 10% | NPU: present | Uptime: 1h 20m
Manual note line that must survive.
+++Automation Cut Off
--------------------Daily To-Do-------------------------------
""".strip()
        + "\n",
        encoding="utf-8",
    )

    weather_path = tmp_path / "weather.md"
    weather_path.write_text("### Weather\n78°F — Frequent showers and thunderstorms\n", encoding="utf-8")

    monkeypatch.setattr(solar_weather, "_ecoflow_roots", lambda: [])
    monkeypatch.setattr(
        solar_weather,
        "_charge_status_insert",
        lambda now, report_body=None: "> ◇ **0945** — CHARGE STATUS — Charging | Host battery: 41% | CPU: 22% | RAM: 88% | Temp: 69C | iGPU: 10% | NPU: present | Uptime: 1h 20m",
    )
    monkeypatch.setattr(
        solar_weather,
        "_power_automation_insert",
        lambda now: "> ◇ **0945** — POWER AUTOMATION — DELTA 2 AC AUTO ON | status: ON | input 176W | total in 180W | Delta SOC 4% | River feed ACTIVE",
    )
    monkeypatch.setattr(
        "apps.core.services.reports.latest_report",
        lambda pattern: weather_path if pattern == "nws-weather-*.md" else None,
    )

    result = solar_weather.update_solar_notes(datetime(2026, 9, 7, 9, 45), path=report_path)

    assert result["ok"] is True
    body = report_path.read_text(encoding="utf-8")
    assert "Manual note line that must survive." in body
    assert body.count("> ◇ **0945** — CHARGE STATUS") == 1
    assert body.count("> ◇ **0945** — POWER AUTOMATION") == 1
    assert "> ◇ **0945** — POWER AUTOMATION — DELTA 2 AC AUTO ON" in body
    assert re.search(r"(?m)^> ◇ \*\*0945\*\* — CHARGE STATUS.*\n\n> ◇ \*\*0945\*\* — POWER AUTOMATION.*", body) is not None
    assert re.search(
        r"(?m)^> ◇ \*\*0945\*\* — WEATHER — .*$\n\n"
        r"> ◇ \*\*0945\*\* — ECOFLOW STATUS - DELTA 2: .*$\n\n"
        r"> ◇ \*\*0945\*\* — ECOFLOW STATUS - RIVER 2 PRO: .*$\n\n"
        r"\+\+\+Automation Cut Off",
        body,
    ) is not None


def test_update_solar_notes_ignores_shared_delta_ac_output_as_river_input(tmp_path, monkeypatch):
    report_path = tmp_path / "hybrid.md"
    report_path.write_text(
        "# HYBRID TRACKING REPORT\n## SEPTEMBER 7, 2026\n\n+++Automation Cut Off\n",
        encoding="utf-8",
    )
    eco_dir = tmp_path / "ecoflow"
    hist_dir = eco_dir / "history"
    hist_dir.mkdir(parents=True)
    (hist_dir / "R331ZAB5SG6S2858.jsonl").write_text(
        '{"at": 1788849720000, "deviceOnline": true, "soc": 60, "solarW": 0, "inW": 0, "outW": 12}\n',
        encoding="utf-8",
    )
    (hist_dir / "R621ZA16XH6K1155.jsonl").write_text(
        '{"at": 1788849721000, "deviceOnline": true, "soc": 17, "solarW": 0, "inW": 174, "outW": 0}\n',
        encoding="utf-8",
    )
    monkeypatch.setattr(solar_weather, "_ecoflow_roots", lambda: [eco_dir])
    monkeypatch.setattr(solar_weather, "_charge_status_insert", lambda now, report_body=None: None)
    monkeypatch.setattr(solar_weather, "_power_automation_insert", lambda now: None)

    result = solar_weather.update_solar_notes(datetime(2026, 9, 7, 20, 45), path=report_path)

    assert result["ok"] is True
    body = report_path.read_text(encoding="utf-8")
    assert "ECOFLOW STATUS - DELTA 2: Average 15-minute In/Out 0 W / 12 W | Current 60%" in body
    assert "ECOFLOW STATUS - RIVER 2 PRO: Average 15-minute In/Out 0 W / 0 W | Current 17%" in body
    assert "RIVER 2 PRO: Average 15-minute In/Out 174 W / 0 W" not in body


def test_ecoflow_history_keeps_delta_ac_output(tmp_path, monkeypatch):
    monkeypatch.setattr(solar_cron, "ecoflow_dir", lambda: tmp_path)
    monkeypatch.setattr(solar_cron, "ensure_data_layout", lambda: None)
    monkeypatch.setattr(solar_cron, "ecoflow_sn_public", lambda sn: True)

    solar_cron._append_ecoflow_history(
        "R331ZAB5SG6S2858",
        soc=17,
        pwr={"pv_w": 0, "ac_in_w": 0, "dc_out_w": 11, "discharge_w": 137},
        online=True,
    )

    row = __import__("json").loads((tmp_path / "history" / "R331ZAB5SG6S2858.jsonl").read_text())
    assert row["inW"] == 0
    assert row["outW"] == 137


def test_charge_status_insert_detects_plug_change_only(tmp_path, monkeypatch):
    state_path = tmp_path / "hybrid-charge-status.json"
    state_path.write_text('{"status": "Battery", "battery_pct": 41, "updated_at": "2026-09-07T09:00:00-10:00"}\n', encoding="utf-8")

    monkeypatch.setattr(solar_weather, "HYBRID_CHARGE_STATE_PATH", state_path)
    monkeypatch.setattr(
        "apps.core.host_metrics.snapshot",
        lambda home=None: {
            "battery_plugged": True,
            "battery_pct": 56,
            "cpu_pct": 25,
            "mem_pct": 90,
            "temp_c": 63,
            "gpu_pct": 11,
            "npu_present": True,
            "uptime_s": 5400,
        },
    )

    line = solar_weather._charge_status_insert(datetime(2026, 9, 7, 9, 45))

    assert line is not None
    assert "CHARGE STATUS — Charging" in line
    assert "Host battery: 56%" in line

    line = solar_weather._charge_status_insert(datetime(2026, 9, 7, 9, 46))
    assert line is None


def test_update_hybrid_charge_status_inserts_at_current_minute(tmp_path, monkeypatch):
    report_root = tmp_path / "reports"
    report_path = report_root / "2026" / "September" / "September 7th, 2026" / "hybrid-manual-daily-report-2026-09-07.md"
    report_path.parent.mkdir(parents=True)
    report_path.write_text(
        "Manual note at 1100, panels positioned to midday position\n"
        "> ◇ **1115** — CHARGE STATUS — Battery | Host battery: 52%\n\n"
        "+++Automation Cut Off\n",
        encoding="utf-8",
    )
    state_path = tmp_path / "hybrid-charge-status.json"
    state_path.write_text('{"status": "Battery", "battery_pct": 52}\n', encoding="utf-8")

    monkeypatch.setattr(solar_weather, "HYBRID_REPORT_ROOT", report_root)
    monkeypatch.setattr(solar_weather, "HYBRID_CHARGE_STATE_PATH", state_path)
    monkeypatch.setattr(
        "apps.core.host_metrics.snapshot",
        lambda home=None: {"battery_plugged": True, "battery_pct": 49, "cpu_pct": 4, "mem_pct": 78, "uptime_s": 100},
    )

    result = solar_weather.update_hybrid_charge_status(datetime(2026, 9, 7, 11, 20))

    body = report_path.read_text(encoding="utf-8")
    assert result["detail"] == "inserted"
    assert "Manual note at 1100, panels positioned to midday position" in body
    assert "> ◇ **1120** — CHARGE STATUS — Charging | Host battery: 49%" in body
    assert "WEATHER" not in body
    assert "ECOFLOW STATUS" not in body


def test_hybrid_daily_report_path_uses_report_daily_folders():
    expected = Path.home() / "RootRecord Core Ops" / "Reports" / "2026" / "September" / "September 7th, 2026" / "hybrid-manual-daily-report-2026-09-07.md"
    assert solar_weather.hybrid_daily_report_path(datetime(2026, 9, 7)) == expected


def test_new_hybrid_report_template_is_complete_and_laptop_safe():
    template = solar_weather._hybrid_report_template(datetime(2026, 9, 8))

    assert "# HYBRID TRACKING REPORT" in template
    assert "## HYBRID NOTES FOR SEPTEMBER 8, 2026" in template
    assert "+++END WEATHER FORECAST" in template
    assert "+++END KILAUEA PREDICTION" in template
    assert "+++Automation Cut Off" in template
    assert all(len(line) <= 111 for line in template.splitlines())


def test_prediction_sections_format_multiline_content_once(tmp_path, monkeypatch):
    weather = tmp_path / "nws-weather-test.md"
    weather.write_text(
        "### Tonight\n73°F — Frequent Rain Showers\nFrequent rain showers. Cloudy, with a low near 73.\n\n"
        "### Tuesday\n82°F — Frequent Rain Showers\nFrequent rain showers before noon.\n\n"
        "**Flash Flood Warning**\nIssued until 1:30AM HST\n",
        encoding="utf-8",
    )
    kilauea = tmp_path / "kilauea-test.md"
    kilauea.write_text("Kīlauea status update. Alert level watch.", encoding="utf-8")
    monkeypatch.setattr(
        "apps.core.services.reports.latest_report",
        lambda pattern: weather if pattern == "nws-weather-*.md" else kilauea,
    )

    weather_insert, kilauea_insert = solar_weather._hybrid_prediction_inserts("0000")

    assert weather_insert is not None
    assert weather_insert.count("> ◇ **0000**") == 1
    assert "**Tonight: 73°F — Frequent Rain Showers**" in weather_insert
    assert "**ALERT — Flash Flood Warning**" in weather_insert
    assert kilauea_insert is not None
    assert kilauea_insert.count("> ◇ **0000**") == 1


def test_append_hybrid_lifecycle_event_is_append_only_and_deduplicated(tmp_path, monkeypatch):
    report_root = tmp_path / "reports"
    report_path = report_root / "2026" / "September" / "September 7th, 2026" / "hybrid-manual-daily-report-2026-09-07.md"
    report_path.parent.mkdir(parents=True)
    report_path.write_text(
        "Manual note at 1130, Laptop power state automation built and working\n"
        "> ◇ **1135** — AVA STARTED\n"
        "+++Automation Cut Off\n",
        encoding="utf-8",
    )
    monkeypatch.setattr(solar_weather, "HYBRID_REPORT_ROOT", report_root)

    result = solar_weather.append_hybrid_lifecycle_event("STOPPED", datetime(2026, 9, 7, 11, 36))
    duplicate = solar_weather.append_hybrid_lifecycle_event("STOPPED", datetime(2026, 9, 7, 11, 36))

    body = report_path.read_text(encoding="utf-8")
    assert result["detail"] == "inserted"
    assert duplicate["detail"] == "already_present"
    assert body.count("> ◇ **1136** — AVA STOPPED") == 1
    assert "Manual note at 1130, Laptop power state automation built and working" in body


def test_update_solar_notes_replaces_prediction_sections_in_place(tmp_path, monkeypatch):
    report_path = tmp_path / "hybrid.md"
    report_path.write_text(
        "### Weather Forecast\n> old forecast\n\n"
        "### Kilauea Prediction\n> [KILAUEA_PREDICTION - INSERT ON AVA BOOT]\n\n"
        "## HYBRID NOTES FOR SEPTEMBER 7, 2026\n"
        "Manual observation\n"
        ">1000, WEATHER WINDOWS — old appended block\n"
        ">1000, KILAUEA PREDICTION — old appended block\n"
        "+++Automation Cut Off\n",
        encoding="utf-8",
    )
    weather_path = tmp_path / "weather.md"
    weather_path.write_text(
        "### Labor Day\n78°F — Frequent Showers And Thunderstorms\n"
        "Frequent showers and thunderstorms. Some of the storms could produce heavy rain.\n"
        "### Tonight\n73°F — Frequent Rain Showers\nFrequent rain showers. Cloudy.\n",
        encoding="utf-8",
    )
    kilauea_path = tmp_path / "kilauea.md"
    kilauea_path.write_text(
        "Kīlauea is not erupting; the summit eruption is paused.", encoding="utf-8"
    )

    monkeypatch.setattr(solar_weather, "_ecoflow_roots", lambda: [])
    monkeypatch.setattr(solar_weather, "_charge_status_insert", lambda now, report_body=None: None)
    monkeypatch.setattr(solar_weather, "_power_automation_insert", lambda now: None)
    monkeypatch.setattr(
        "apps.core.services.reports.latest_report",
        lambda pattern: weather_path if pattern == "nws-weather-*.md" else kilauea_path,
    )

    result = solar_weather.update_solar_notes(datetime(2026, 9, 7, 11, 59), path=report_path)

    body = report_path.read_text(encoding="utf-8")
    assert result["ok"] is True
    assert "> ◇ **1159** — WEATHER WINDOWS" in body
    assert "**Labor Day: 78°F — Frequent Showers And Thunderstorms**" in body
    assert "heavy rain." in body
    assert "**Tonight: 73°F — Frequent Rain Showers**" in body
    assert "> ◇ **1159** — KILAUEA PREDICTION" in body
    assert "Kīlauea is not erupting; the summit eruption is paused." in body
    assert "old forecast" not in body
    assert "KILAUEA_PREDICTION - INSERT ON AVA BOOT" not in body
    assert "old appended block" not in body
    assert body.count("### Weather Forecast") == 1
    assert body.count("### Kilauea Prediction") == 1
    assert body.count("+++END WEATHER FORECAST") == 1
    assert body.count("+++END KILAUEA PREDICTION") == 1

    solar_weather.update_solar_notes(datetime(2026, 9, 7, 11, 59), path=report_path)
    body = report_path.read_text(encoding="utf-8")
    assert body.count("+++END WEATHER FORECAST") == 1
    assert body.count("+++END KILAUEA PREDICTION") == 1
