"""Morning Boot Report — file facts only. No Grok. No spend.

Written after boot prelims (NOAA, Kīlauea, …) so the summary uses fresh
samples. Lives next to other morning markdown under REPORTS_DIR.
"""
from __future__ import annotations

import json
import logging
from datetime import datetime, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

from apps.core import config

log = logging.getLogger("ava.boot_report")
HST = ZoneInfo("Pacific/Honolulu")

CURRENT_NAME = "morning-boot-current.md"


def _read_json(path: Path) -> dict:
    if not path.is_file():
        return {}
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return {}
    return data if isinstance(data, dict) else {}


def _iso_hst(raw: str | None) -> str:
    if not raw:
        return "unknown"
    try:
        t = datetime.fromisoformat(str(raw).replace("Z", "+00:00"))
        return t.astimezone(HST).strftime("%Y-%m-%d %H:%M HST")
    except Exception:
        return str(raw)[:40]


def _gap_line(stopped_at: str | None, restored_at: str | None) -> str:
    if not stopped_at and not restored_at:
        return "Overnight downtime: no net-gate stop/restore stamps on file."
    bits = []
    if stopped_at:
        bits.append(f"stopped {_iso_hst(stopped_at)}")
    if restored_at:
        bits.append(f"restored {_iso_hst(restored_at)}")
    try:
        a = datetime.fromisoformat(str(stopped_at).replace("Z", "+00:00"))
        b = datetime.fromisoformat(str(restored_at).replace("Z", "+00:00"))
        mins = max(0, int((b - a).total_seconds() // 60))
        bits.append(f"gap ~{mins} min")
    except Exception:
        pass
    return "Overnight downtime (net-gate): " + " · ".join(bits)


def _ollama_line() -> str:
    try:
        import urllib.request

        req = urllib.request.Request(
            "http://127.0.0.1:11434/api/tags",
            headers={"User-Agent": "AvaIvy-boot-report"},
            method="GET",
        )
        with urllib.request.urlopen(req, timeout=3) as resp:
            raw = json.loads(resp.read().decode("utf-8", "replace"))
        models = [m.get("name") for m in (raw.get("models") or []) if isinstance(m, dict)]
        names = ", ".join(n for n in models[:6] if n) or "tags empty"
        return f"Ollama: UP ({names})"
    except Exception as e:
        return f"Ollama: DOWN ({type(e).__name__})"


def _origin_line() -> str:
    try:
        import urllib.request

        req = urllib.request.Request(
            "http://127.0.0.1:8787/health",
            headers={"User-Agent": "AvaIvy-boot-report"},
            method="GET",
        )
        with urllib.request.urlopen(req, timeout=3) as resp:
            code = resp.status
        return f"Origin :8787: UP (HTTP {code})"
    except Exception as e:
        return f"Origin :8787: DOWN ({type(e).__name__})"


def _kilauea_block() -> str:
    state = config.DATA_DIR / "state"
    alert = _read_json(state / "kilauea-alert.json")
    if not alert:
        return "Kīlauea: no alert file."
    bits = [
        str(alert.get("alert_level") or alert.get("alert") or "unknown"),
        str(alert.get("color") or ""),
        str(alert.get("updated") or alert.get("at") or alert.get("updated_at") or ""),
    ]
    return "Kīlauea: " + " · ".join(b for b in bits if b)


def _weather_block() -> list[str]:
    try:
        from apps.core.services import live_wx

        return live_wx.weather_lines_sync()
    except Exception as e:
        return [f"Weather: DOWN ({type(e).__name__})"]


def _grok_line() -> str:
    st = _read_json(config.DATA_DIR / "state" / "grok-status.json")
    if st.get("halt"):
        return "Grok/xAI: OFF (operator halt). Boot report is file-only."
    if st.get("ok") is False:
        return f"Grok/xAI: down — {str(st.get('reason') or 'circuit')[:120]}"
    return "Grok/xAI: not used for this boot report."


def build_text(*, source: str = "boot") -> str:
    """Assemble the extensive factual Boot Report body."""
    now = datetime.now(HST)
    stamp = now.strftime("%Y-%m-%d %H:%M HST")
    net = _read_json(config.DATA_DIR / "state" / "net-gate.json")
    uptime = _read_json(config.DATA_DIR / "state" / "uptime-marker.json")
    startup = _read_json(config.DATA_DIR / "state" / "startup-voice.json")

    lines: list[str] = [
        f"**Ava morning Boot Report** — {stamp}",
        "",
        f"_Source: {source}. File facts only. No Grok._",
        "",
        "## Overnight / restore",
        _gap_line(net.get("stopped_at"), net.get("restored_at")),
        f"Net-gate online: {net.get('online')} · origin_seen: {net.get('origin_seen')} · "
        f"desk_was_open: {net.get('desk_was_open')} · ollama_was_up: {net.get('ollama_was_up')}",
        f"Boot/restore clock: {_iso_hst(net.get('restored_at') or uptime.get('last_start_at') or uptime.get('origin_started_at'))}",
    ]
    if startup.get("last_seen_down_iso") or startup.get("last_clip"):
        lines.append(
            f"Startup voice: last down {startup.get('last_seen_down_iso') or '?'} · "
            f"last clip {startup.get('last_clip') or '?'}"
        )

    lines.extend(["", "## Readiness", _origin_line(), _ollama_line(), _grok_line()])

    try:
        from apps.core.services import db_facts

        lines.extend(["", "## Host / bank", db_facts.host_line(), db_facts.ecoflow_line()])
    except Exception as e:
        lines.extend(["", "## Host / bank", f"Host/EcoFlow: {type(e).__name__}"])

    lines.extend(["", "## Weather", *_weather_block()])
    lines.extend(["", "## Kīlauea", _kilauea_block()])

    try:
        from apps.core.services import live_wx

        lines.extend(["", "## Storms", live_wx.hurricane_line()])
    except Exception:
        lines.extend(["", "## Storms", "Hurricanes: unknown"])

    solar = sorted(
        config.REPORTS_DIR.glob("solar-weather-*.md"),
        key=lambda p: p.stat().st_mtime,
        reverse=True,
    )
    if solar:
        body = solar[0].read_text(encoding="utf-8", errors="replace").strip()
        if len(body) > 700:
            body = body[:700].rstrip() + "\n…"
        lines.extend(["", f"## Latest solar+weather file ({solar[0].name})", body])

    return "\n".join(lines).rstrip() + "\n"


def write_boot_report(*, source: str = "boot") -> dict:
    """Write dated + current Boot Report. Never calls Grok or Ollama for prose."""
    text = build_text(source=source)
    now = datetime.now(HST)
    day = now.strftime("%Y-%m-%d")
    config.REPORTS_DIR.mkdir(parents=True, exist_ok=True)
    dated = config.REPORTS_DIR / f"morning-boot-{day}.md"
    current = config.REPORTS_DIR / CURRENT_NAME
    dated.write_text(text, encoding="utf-8")
    current.write_text(text, encoding="utf-8")
    log.info("boot report written source=%s dated=%s", source, dated.name)
    return {
        "ok": True,
        "source": source,
        "day": day,
        "stamp": now.strftime("%Y-%m-%d %H:%M HST"),
        "dated": str(dated),
        "current": str(current),
        "bytes": len(text.encode("utf-8")),
        "grok": False,
    }
