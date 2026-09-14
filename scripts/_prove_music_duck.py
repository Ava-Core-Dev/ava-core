"""Prove music duck under a short status clip. Run against live origin :8787."""
from __future__ import annotations

import json
import time
import urllib.request


def http(method: str, url: str, body: dict | None = None, timeout: float = 8.0):
    data = None
    headers = {}
    if body is not None:
        data = json.dumps(body).encode()
        headers["Content-Type"] = "application/json"
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode())


def main() -> int:
    st = http("GET", "http://127.0.0.1:8787/api/voice/status")
    m = st.get("music") or {}
    track_before = m.get("current")
    print(
        "BEFORE",
        track_before,
        "playing",
        (st.get("currently_playing") or {}).get("music"),
        "pid",
        m.get("player_pid"),
    )
    out = http(
        "POST",
        "http://127.0.0.1:8787/api/voice/play",
        {"clip": "status", "priority": "REPORT"},
        timeout=5,
    )
    print("QUEUE", out)

    saw_duck = False
    same_during = True
    for i in range(16):
        time.sleep(0.35)
        st = http("GET", "http://127.0.0.1:8787/api/voice/status")
        m = st.get("music") or {}
        cp = (st.get("currently_playing") or {}).get("music") or {}
        ducked = bool(m.get("ducked") or cp.get("ducked"))
        if ducked:
            saw_duck = True
        cur = m.get("current")
        if cur and track_before and cur != track_before:
            same_during = False
        print(
            f"t+{0.35 * (i + 1):.1f}s track={cur} playing={cp.get('playing')} "
            f"ducked={ducked} hold={m.get('hold')} voice={st.get('current')}"
        )

    time.sleep(1.5)
    st = http("GET", "http://127.0.0.1:8787/api/voice/status")
    m = st.get("music") or {}
    after = m.get("current")
    print(
        "AFTER",
        after,
        "ducked",
        m.get("ducked"),
        "hold",
        m.get("hold"),
        "playing",
        (st.get("currently_playing") or {}).get("music"),
    )
    print(
        "PROOF",
        {
            "saw_duck": saw_duck,
            "track_before": track_before,
            "track_after": after,
            "same_track_or_still_playing": bool(after),
            "unducked_after": not bool(m.get("ducked") or m.get("hold")),
            "same_during_poll": same_during,
        },
    )
    return 0 if saw_duck and after else 1


if __name__ == "__main__":
    raise SystemExit(main())
