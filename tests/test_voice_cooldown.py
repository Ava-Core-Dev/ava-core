from __future__ import annotations

from apps.core.services import report_periodic_audio, voice_events


def test_global_voice_cooldown_is_ten_minutes(monkeypatch, tmp_path):
    monkeypatch.setattr(voice_events, "STATE_PATH", tmp_path / "voice-events.json")
    voice_events._mark_global_played()
    remaining = voice_events._global_cooldown_remaining()

    assert 0 < remaining <= voice_events.GLOBAL_COOLDOWN_S
    assert voice_events.GLOBAL_COOLDOWN_S == 600
    assert report_periodic_audio.REPLAY_S == 600
