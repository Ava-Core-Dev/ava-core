from __future__ import annotations

import asyncio
from pathlib import Path

from apps.core.routes import obs as obs_routes
from apps.core import config
from apps.core.services import obs_studio
from apps.core.services import startup_voice


def test_first_existing_prefers_available_wav(tmp_path: Path):
    missing = tmp_path / "current.mp3"
    wav = tmp_path / "current.wav"
    wav.write_bytes(b"wav")

    assert obs_studio._first_existing(missing, wav) == wav


def test_overlay_routes_are_idle_when_obs_is_closed(monkeypatch):
    monkeypatch.setattr(obs_routes, "obs_process_running", lambda: False)

    speaking = asyncio.run(obs_routes.obs_speaking_overlay())
    card = asyncio.run(obs_routes.obs_overlay_card("weather", "temperature"))
    cards = asyncio.run(obs_routes.obs_overlay_cards_index())

    for response in (speaking, card, cards):
        assert response.status_code == 200
        body = response.body.decode("utf-8")
        assert "EventSource" not in body
        assert "setInterval" not in body
        assert "setTimeout" not in body


def test_official_rotation_defaults_to_ten_seconds(monkeypatch, tmp_path: Path):
    monkeypatch.setattr(obs_studio, "ROTATION_CFG_PATH", tmp_path / "rotation.json")
    config = obs_studio.load_rotation_config()

    assert config["enabled"] is True
    assert config["interval_s"] == 60
    assert config["mode_dwell_s"]["official"] == 10
    assert len(obs_studio.AMBIENT_SCENES) == 10


def test_rotation_config_persists_enabled_and_interval(monkeypatch, tmp_path: Path):
    monkeypatch.setattr(obs_studio, "ROTATION_CFG_PATH", tmp_path / "rotation.json")

    saved = obs_studio.save_rotation_config(enabled=False, interval_s=17)

    assert saved["enabled"] is False
    assert saved["interval_s"] == 17
    assert obs_studio.load_rotation_config()["enabled"] is False
    assert obs_studio.load_rotation_config()["interval_s"] == 17


def test_legacy_rotation_config_uses_daily_interval(monkeypatch, tmp_path: Path):
    path = tmp_path / "rotation.json"
    path.write_text('{"mode_dwell_s": {"daily": 10}}', encoding="utf-8")
    monkeypatch.setattr(obs_studio, "ROTATION_CFG_PATH", path)

    assert obs_studio.load_rotation_config()["interval_s"] == 10


def test_disabled_rotation_short_circuits_before_obs(monkeypatch, tmp_path: Path):
    monkeypatch.setattr(obs_studio, "ROTATION_CFG_PATH", tmp_path / "rotation.json")
    obs_studio.save_rotation_config(enabled=False)

    result = asyncio.run(obs_studio.rotate_loop_scene())

    assert result == {"ok": True, "held": "disabled", "enabled": False}


def test_rotate_scene_ignores_missing_scene_names():
    pool = ["Scene 1 - Weather Board", "Scene 10 - Support Ava", "Scene 9 - Goals Report"]
    available = ["Scene 1 - Weather Board", "Scene 9 - Goals Report"]

    assert obs_studio._resolve_scene_target(pool, available, "Scene 10 - Support Ava") == "Scene 9 - Goals Report"
    assert obs_studio._resolve_scene_target(pool, available, "Scene 9 - Goals Report") == "Scene 1 - Weather Board"


def test_startup_voice_prefers_existing_wav(monkeypatch, tmp_path: Path):
    words = tmp_path / "words"
    words.mkdir()
    cue = words / "phrase_all_systems_running.wav"
    cue.write_bytes(b"wav")

    monkeypatch.setattr(config, "ASSETS_DIR", tmp_path)
    monkeypatch.setattr(startup_voice, "STATE_PATH", tmp_path / "state" / "startup-voice.json")

    assert startup_voice.clip_path("phrase_all_systems_running").suffix == ".wav"
    assert startup_voice.choose_clip(force=True)[1].suffix == ".wav"