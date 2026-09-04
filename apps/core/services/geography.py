"""Collected geography boards. Measured/stored rows only — no invented events."""

from __future__ import annotations

import sqlite3
from pathlib import Path

from apps.core import config

_QUAKE_CANDIDATES = (
    config.DATA_DIR / "weather" / "quakes.db",
    config.DATA_DIR / "earthquakes.db",
    Path(config.AVA_HOME) / "Data" / "earthquakes.db",
)


def _quakes_db() -> Path | None:
    for p in _QUAKE_CANDIDATES:
        try:
            if p.is_file():
                return p
        except OSError:
            continue
    return None


def _pretty(slug: str) -> str:
    return " ".join(part.replace("-", " ").title() for part in (slug or "").split("/") if part)


def earthquakes(country: str = "", state: str = "", location: str = "") -> dict:
    db = _quakes_db()
    name = _pretty(location or state or country or "region")
    if not db:
        return {"ok": False, "name": name, "events": [], "detail": "no_quake_db"}
    place_bits = [b for b in (location, state, country) if b]
    like = f"%{place_bits[0].replace('-', ' ')}%" if place_bits else "%"
    events: list[dict] = []
    try:
        con = sqlite3.connect(f"file:{db}?mode=ro", uri=True)
        con.row_factory = sqlite3.Row
        tables = [r[0] for r in con.execute("SELECT name FROM sqlite_master WHERE type='table'")]
        table = next((t for t in tables if "quake" in t.lower() or "event" in t.lower()), tables[0] if tables else "")
        if not table:
            con.close()
            return {"ok": False, "name": name, "events": [], "detail": "empty_db"}
        cols = [r[1] for r in con.execute(f'PRAGMA table_info("{table}")')]
        colset = {c.lower() for c in cols}
        place_col = next((c for c in cols if c.lower() in ("place", "location", "region")), None)
        mag_col = next((c for c in cols if c.lower() in ("magnitude", "mag")), None)
        url_col = next((c for c in cols if c.lower() in ("url", "source_url", "link")), None)
        sql = f'SELECT * FROM "{table}"'
        args: list = []
        if place_col and like != "%":
            sql += f' WHERE LOWER("{place_col}") LIKE LOWER(?)'
            args.append(like)
        sql += " LIMIT 40"
        for row in con.execute(sql, args):
            rec = dict(row)
            events.append(
                {
                    "magnitude": rec.get(mag_col) if mag_col else rec.get("mag"),
                    "place": rec.get(place_col) if place_col else name,
                    "source_url": rec.get(url_col) if url_col else "",
                }
            )
        con.close()
    except Exception as e:
        return {"ok": False, "name": name, "events": [], "detail": str(e)[:160]}
    return {"ok": True, "name": name, "country_name": _pretty(country), "events": events, "observations": len(events)}


def weather(country: str = "", state: str = "", location: str = "") -> dict:
    name = _pretty(location or state or country or "region")
    return {
        "ok": True,
        "name": name,
        "country_name": _pretty(country),
        "admin1_name": _pretty(state),
        "weather": {"current": {}},
        "observations": 0,
        "avg_temp_c": None,
        "providers": 0,
    }


def news(country: str = "", state: str = "", location: str = "") -> dict:
    name = _pretty(location or state or country or "region")
    return {"ok": True, "name": name, "items": []}
