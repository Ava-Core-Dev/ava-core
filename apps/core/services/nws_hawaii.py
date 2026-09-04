"""NWS Hawaiʻi by-county hazards via api.weather.gov.

Poll active HI alerts, map SAME / area text → counties, write state + spoken
script. No scrape unless the API fails. Deterministic speech (no Grok required).
"""
from __future__ import annotations

import hashlib
import json
import logging
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo

import httpx

from apps.core import config

log = logging.getLogger("ava.nws_hawaii")
HST = ZoneInfo("Pacific/Honolulu")

UA = {"User-Agent": "AvaIvy/2.0 (https://avaivy.cloud; nws-hawaii-counties)", "Accept": "application/geo+json"}
ALERTS_URL = "https://api.weather.gov/alerts/active?area=HI"
WATCHWARN_URL = "https://www.weather.gov/hfo/watchwarn"

STATE_NAME = "nws-hawaii.json"
CURRENT_REPORT = "nws-hawaii-counties-current.md"
SPOKEN_CURRENT = "nws-hawaii-counties-spoken.txt"

# County order for speech. Kalawao spoken only when it has products.
COUNTIES: list[dict[str, str]] = [
    {"same": "015003", "key": "honolulu", "speech": "Honolulu County"},
    {"same": "015001", "key": "hawaii", "speech": "Hawaii County"},
    {"same": "015009", "key": "maui", "speech": "Maui County"},
    {"same": "015007", "key": "kauai", "speech": "Kauai County"},
    {"same": "015005", "key": "kalawao", "speech": "Kalawao County"},
]

# areaDesc fallback when SAME is missing
_AREA_PATTERNS: list[tuple[str, re.Pattern[str]]] = [
    (
        "hawaii",
        re.compile(
            r"\b(Big Island|Puna|Hilo|Kona|Kohala|Ka[`ʻ']?u|Volcano|Mountain View)\b",
            re.I,
        ),
    ),
    (
        "honolulu",
        re.compile(
            r"\b(Honolulu|O[`ʻ']?ahu|Waianae|Ewa|Koolau|Olomana|Pearl Harbor)\b",
            re.I,
        ),
    ),
    (
        "maui",
        re.compile(
            r"\b(Maui|Molokai|Lanai|Lana[`ʻ']i|Kahoolawe|Haleakala|Kipahulu)\b",
            re.I,
        ),
    ),
    (
        "kauai",
        re.compile(r"\b(Kauai|Kaua[`ʻ']i|Niihau|Ni[`ʻ']ihau|Lihue|L[`ʻ']ihue)\b", re.I),
    ),
    ("kalawao", re.compile(r"\bKalawao\b", re.I)),
]

SAME_TO_KEY = {c["same"]: c["key"] for c in COUNTIES}
KEY_TO_SPEECH = {c["key"]: c["speech"] for c in COUNTIES}


def state_path() -> Path:
    return config.DATA_DIR / "state" / STATE_NAME


def load_state() -> dict[str, Any]:
    path = state_path()
    if not path.is_file():
        return {}
    try:
        data = json.loads(path.read_text(encoding="utf-8-sig"))
    except Exception:
        return {}
    return data if isinstance(data, dict) else {}


def save_state(data: dict[str, Any]) -> None:
    path = state_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def _county_keys_for_alert(props: dict) -> set[str]:
    keys: set[str] = set()
    geocode = props.get("geocode") or {}
    for code in geocode.get("SAME") or []:
        key = SAME_TO_KEY.get(str(code))
        if key:
            keys.add(key)
    areas = str(props.get("areaDesc") or "")
    if not keys:
        for key, pat in _AREA_PATTERNS:
            if pat.search(areas):
                keys.add(key)
    return keys


def _normalize_alerts(features: list[dict]) -> list[dict]:
    """Dedupe by event + sorted counties; keep newest sent."""
    best: dict[str, dict] = {}
    for f in features:
        props = f.get("properties") or {}
        event = str(props.get("event") or "Alert").strip()
        counties = sorted(_county_keys_for_alert(props))
        if not counties:
            continue
        aid = str(props.get("id") or f.get("id") or "")
        sent = str(props.get("sent") or props.get("effective") or "")
        key = f"{event}|{','.join(counties)}"
        row = {
            "id": aid,
            "event": event,
            "severity": str(props.get("severity") or ""),
            "urgency": str(props.get("urgency") or ""),
            "headline": str(props.get("headline") or ""),
            "areas": str(props.get("areaDesc") or ""),
            "sent": sent,
            "counties": counties,
            "same": list(props.get("geocode", {}).get("SAME") or []),
            "ugc": list(props.get("geocode", {}).get("UGC") or []),
        }
        prev = best.get(key)
        if not prev or sent > str(prev.get("sent") or ""):
            best[key] = row
    rows = list(best.values())
    rows.sort(key=lambda r: (r.get("event") or "", r.get("sent") or ""), reverse=True)
    return rows


def _by_county(alerts: list[dict]) -> dict[str, list[str]]:
    out: dict[str, list[str]] = {c["key"]: [] for c in COUNTIES}
    for a in alerts:
        event = a.get("event") or "Alert"
        for key in a.get("counties") or []:
            if key in out and event not in out[key]:
                out[key].append(event)
    return out


def build_spoken(
    by_county: dict[str, list[str]],
    *,
    stamp: str | None = None,
    reason: str = "update",
) -> str:
    """Plain spoken script. Quiet counties get one short no-warning line."""
    now = datetime.now(HST)
    clock = stamp or now.strftime("%I:%M %p").lstrip("0").replace(" 0", " ")
    lead = (
        f"NWS Hawaii by county, about {clock} Hawaiian Standard Time."
        if reason == "boot"
        else f"NWS Hawaii hazard update, about {clock} Hawaiian Standard Time."
    )
    parts = [lead]
    any_active = False
    for c in COUNTIES:
        key = c["key"]
        events = by_county.get(key) or []
        if key == "kalawao" and not events:
            continue
        if events:
            any_active = True
            parts.append(f"{c['speech']}: {', '.join(events)}.")
        else:
            parts.append(f"{c['speech']}: no active warnings.")
    if not any_active:
        parts = [
            lead,
            "No active National Weather Service watches or warnings for Honolulu, Hawaii, Maui, or Kauai counties.",
        ]
    return " ".join(parts)


def fingerprint(alerts: list[dict]) -> str:
    rows = [
        {
            "id": a.get("id"),
            "event": a.get("event"),
            "counties": a.get("counties"),
            "sent": a.get("sent"),
        }
        for a in alerts
    ]
    blob = json.dumps(rows, sort_keys=True, ensure_ascii=False)
    return hashlib.sha256(blob.encode("utf-8")).hexdigest()[:32]


async def fetch_alerts(*, client: httpx.AsyncClient | None = None) -> tuple[list[dict], str]:
    """Return normalized alerts and source tag. Empty list + scrape_needed if API empty/fail."""
    own = client is None
    if own:
        client = httpx.AsyncClient(timeout=20, headers=UA, follow_redirects=True)
    assert client is not None
    try:
        r = await client.get(ALERTS_URL)
        if r.status_code != 200:
            log.warning("NWS alerts API status %s", r.status_code)
            return [], "api_fail"
        features = r.json().get("features") or []
        return _normalize_alerts(features), "api.weather.gov"
    except Exception as e:
        log.warning("NWS alerts API error: %s", e)
        return [], "api_error"
    finally:
        if own:
            await client.aclose()


def write_reports(
    *,
    alerts: list[dict],
    by_county: dict[str, list[str]],
    spoken: str,
    source: str,
    changed: bool,
) -> dict[str, str]:
    """Write markdown + spoken text under Media reports."""
    reports = config.REPORTS_DIR
    reports.mkdir(parents=True, exist_ok=True)
    now = datetime.now(HST)
    stamp = now.strftime("%Y-%m-%dT%H%M")
    lines = [
        "# NWS Hawaii by county",
        "",
        f"Sampled: {now.strftime('%Y-%m-%d %H:%M')} Hawaiian Standard Time",
        f"Source: {source}",
        f"Changed: {str(changed).lower()}",
        "",
        "## Spoken",
        "",
        spoken,
        "",
        "## By county",
        "",
    ]
    for c in COUNTIES:
        events = by_county.get(c["key"]) or []
        if c["key"] == "kalawao" and not events:
            continue
        label = ", ".join(events) if events else "none"
        lines.append(f"- **{c['speech']}**: {label}")
    lines.append("")
    lines.append("## Products")
    lines.append("")
    if not alerts:
        lines.append("No active HI alerts from the API sample.")
    else:
        for a in alerts:
            counties = ", ".join(KEY_TO_SPEECH.get(k, k) for k in (a.get("counties") or []))
            lines.append(
                f"- **{a.get('event')}** ({a.get('severity') or '?'}) — {counties}\n"
                f"  {(a.get('headline') or '')[:200]}"
            )
    body = "\n".join(lines) + "\n"
    dated = reports / f"nws-hawaii-counties-{stamp}.md"
    current = reports / CURRENT_REPORT
    spoken_path = reports / SPOKEN_CURRENT
    dated.write_text(body, encoding="utf-8")
    current.write_text(body, encoding="utf-8")
    spoken_path.write_text(spoken.strip() + "\n", encoding="utf-8")
    return {
        "dated": str(dated),
        "current": str(current),
        "spoken": str(spoken_path),
    }


async def refresh(
    *,
    reason: str = "poll",
    force_speak: bool = False,
    speak_on_change: bool = True,
) -> dict[str, Any]:
    """Poll API, update state, write reports. Speak text on boot or product change."""
    prev = load_state()
    alerts, source = await fetch_alerts()
    api_ok = source == "api.weather.gov"
    if not api_ok:
        # Smallest ship: record failure; scrape left for a later Grok path.
        out = {
            "ok": False,
            "source": source,
            "watchwarn": WATCHWARN_URL,
            "scrape_needed": True,
            "reason": reason,
            "alerts": [],
            "changed": False,
        }
        prev.update(
            {
                "ok": False,
                "source": source,
                "scrape_needed": True,
                "last_poll_at": datetime.now(timezone.utc).isoformat(),
                "last_poll_reason": reason,
            }
        )
        save_state(prev)
        return out

    by_county = _by_county(alerts)
    fp = fingerprint(alerts)
    changed = fp != str(prev.get("hash") or "")
    should_speak = force_speak or (speak_on_change and changed) or reason == "boot"
    spoken = build_spoken(by_county, reason="boot" if reason == "boot" else "update")
    paths = write_reports(
        alerts=alerts,
        by_county=by_county,
        spoken=spoken,
        source=source,
        changed=changed,
    )

    now_iso = datetime.now(timezone.utc).isoformat()
    now_hst = datetime.now(HST).isoformat()
    state = {
        "ok": True,
        "source": source,
        "scrape_needed": False,
        "hash": fp,
        "alert_count": len(alerts),
        "by_county": by_county,
        "products": [
            {
                "id": a.get("id"),
                "event": a.get("event"),
                "severity": a.get("severity"),
                "counties": a.get("counties"),
                "sent": a.get("sent"),
            }
            for a in alerts
        ],
        "spoken": spoken,
        "last_poll_at": now_iso,
        "last_poll_hst": now_hst,
        "last_poll_reason": reason,
        "last_changed_at": now_iso if changed else prev.get("last_changed_at"),
        "last_spoken_at": now_iso if should_speak else prev.get("last_spoken_at"),
        "last_spoken_reason": reason if should_speak else prev.get("last_spoken_reason"),
        "last_spoken_hash": fp if should_speak else prev.get("last_spoken_hash"),
        "reports": paths,
    }
    save_state(state)

    if should_speak and (changed or force_speak or reason == "boot"):
        try:
            from apps.core.services import reports

            reports.queue_public_draft(
                "weather",
                spoken,
                source=f"nws_hawaii_{reason}",
            )
        except Exception as e:
            log.debug("NWS county draft queue skipped: %s", e)

    log.info(
        "NWS Hawaii counties source=%s alerts=%d changed=%s speak=%s reason=%s",
        source,
        len(alerts),
        changed,
        should_speak,
        reason,
    )
    return {
        "ok": True,
        "source": source,
        "alerts": len(alerts),
        "changed": changed,
        "spoken": spoken if should_speak else None,
        "spoken_always": spoken,
        "by_county": by_county,
        "hash": fp,
        "paths": paths,
        "reason": reason,
    }


def facts_lines() -> list[str]:
    """Lines for boot / midday FACTS blocks."""
    st = load_state()
    if not st:
        return ["NWS Hawaii by county: no state file yet."]
    lines = [
        f"NWS Hawaii by county source: {st.get('source') or 'unknown'}.",
        f"NWS Hawaii alert products on file: {st.get('alert_count', 0)}.",
    ]
    by = st.get("by_county") if isinstance(st.get("by_county"), dict) else {}
    for c in COUNTIES:
        events = by.get(c["key"]) or []
        if c["key"] == "kalawao" and not events:
            continue
        if events:
            lines.append(f"NWS {c['speech']}: {', '.join(events)}.")
        else:
            lines.append(f"NWS {c['speech']}: no active warnings.")
    spoken = str(st.get("spoken") or "").strip()
    if spoken:
        lines.append(f"NWS county spoken script: {spoken}")
    if st.get("last_poll_hst"):
        lines.append(f"NWS county last poll: {st.get('last_poll_hst')}.")
    return lines


def spoken_section_for_boot() -> str:
    st = load_state()
    text = str(st.get("spoken") or "").strip()
    if text:
        return text
    return "NWS Hawaii by county is not on file."
