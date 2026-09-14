from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone
from pathlib import Path

from apps.core import config
from apps.core.services import boot_report, reports


def _write_json(path: Path, payload: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload), encoding="utf-8")


def test_report_metrics_freshness_checks_recent_state(monkeypatch, tmp_path):
    monkeypatch.setattr(config, "DATA_DIR", tmp_path / "data")
    state_dir = tmp_path / "data" / "state"
    now = datetime.now(timezone.utc)

    _write_json(state_dir / "net-gate.json", {"online": True, "restored_at": now.isoformat(), "updated_at": now.isoformat()})
    _write_json(state_dir / "uptime-marker.json", {"updated_at": now.isoformat()})
    _write_json(state_dir / "startup-voice.json", {"ok": True, "mode": "local", "updated_at": now.isoformat()})
    _write_json(state_dir / "grok-status.json", {"halt": False, "updated_at": now.isoformat()})
    _write_json(state_dir / "kilauea-alert.json", {"alert_level": "advisory", "erupting": False, "updated_at": now.isoformat()})
    _write_json(state_dir / "minecraft-live.json", {"players_online": 0, "updated_at": now.isoformat()})
    _write_json(state_dir / "nws-hawaii.json", {"updated_at": now.isoformat(), "counties": {"oahu": "normal"}})

    fresh = boot_report.report_metrics_fresh_within(max_age_s=3600)
    assert fresh["ok"] is True
    assert fresh["stale"] == []

    stale_now = now - timedelta(hours=2)
    _write_json(state_dir / "net-gate.json", {"online": True, "restored_at": stale_now.isoformat(), "updated_at": stale_now.isoformat()})
    _write_json(state_dir / "kilauea-alert.json", {"alert_level": "advisory", "erupting": False, "updated_at": stale_now.isoformat()})

    stale = boot_report.report_metrics_fresh_within(max_age_s=3600)
    assert stale["ok"] is False
    assert "net-gate" in stale["stale"]
    assert "kilauea-alert" in stale["stale"]


def test_write_current_replaces_previous_generated_report(monkeypatch, tmp_path):
    monkeypatch.setattr(config, "REPORTS_DIR", tmp_path / "reports")
    report_dir = tmp_path / "reports"
    report_dir.mkdir(parents=True, exist_ok=True)
    current = report_dir / "morning-report-current.md"
    current.write_text("old report\n", encoding="utf-8")

    result = reports.write_current("new report text", kind="morning", source="manual_update")

    assert result["ok"] is True
    assert "new report text" in current.read_text(encoding="utf-8")
    assert "old report" not in current.read_text(encoding="utf-8")
