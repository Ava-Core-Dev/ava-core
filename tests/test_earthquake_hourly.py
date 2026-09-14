from apps.core.services.earthquake_hourly import (
    _event_report_lines,
    _new_events,
    _twenty_four_hour_lines,
)


def test_earthquake_report_lists_only_unseen_events():
    events = [
        {"id": "new", "mag": 2.7, "place": "10 km south of Hilo"},
        {"id": "old", "mag": 3.1, "place": "20 km west of Hilo"},
    ]

    fresh = _new_events(events, {"old"})

    assert [event["id"] for event in fresh] == ["new"]
    assert _event_report_lines("Hawaii", fresh) == [
        "## Hawaii Changes Since Last Report",
        "- M2.7 10 km south of Hilo",
    ]


def test_earthquake_report_keeps_magnitude_2_5_24_hour_sum():
    events = [
        {"id": "small", "mag": 2.4, "place": "small"},
        {"id": "one", "mag": 2.5, "place": "one"},
        {"id": "two", "mag": 3.2, "place": "two"},
    ]

    assert _twenty_four_hour_lines("Global", events) == [
        "## Global 24-Hour M2.5+ Summary",
        "- 2 earthquakes; largest M3.2.",
    ]