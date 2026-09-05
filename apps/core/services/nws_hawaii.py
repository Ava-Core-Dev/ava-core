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
    as_of: datetime | None = None,
    alerts: list[dict] | None = None,
) -> str:
    """Plain spoken script. Clock = NWS product sent time when alerts exist — never wall-now."""
    when = as_of or product_as_of(alerts or [])
    if stamp and when is None:
        # Legacy override only when no product timestamps.
        clock = stamp
        time_bit = f"about {clock} Hawaiian Standard Time"
    elif when is not None:
        clock = _hst_clock_label(when)
        time_bit = f"as of {clock} Hawaiian Standard Time"
    else:
        clock = _hst_clock_label(datetime.now(HST))
        time_bit = f"checked about {clock} Hawaiian Standard Time"
    lead = (
        f"NWS Hawaii by county, {time_bit}."
        if reason == "boot"
        else f"NWS Hawaii hazard update, {time_bit}."
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


def _parse_nws_time(raw: str) -> datetime | None:
    s = (raw or "").strip()
    if not s:
        return None
    try:
        if s.endswith("Z"):
            s = s[:-1] + "+00:00"
        dt = datetime.fromisoformat(s)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt
    except Exception:
        return None


def product_as_of(alerts: list[dict]) -> datetime | None:
    """Newest CAP `sent` among alerts. None if empty/unparseable — never invent now."""
    best: datetime | None = None
    for a in alerts:
        dt = _parse_nws_time(str(a.get("sent") or ""))
        if dt is None:
            continue
        if best is None or dt > best:
            best = dt
    return best


def _hst_clock_label(dt: datetime) -> str:
    local = dt.astimezone(HST)
    return local.strftime("%I:%M %p").lstrip("0").replace(" 0", " ")


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
    as_of: datetime | None = None,
) -> dict[str, str]:
    """Write markdown + spoken text under Media reports."""
    reports = config.REPORTS_DIR
    reports.mkdir(parents=True, exist_ok=True)
    now = datetime.now(HST)
    stamp = now.strftime("%Y-%m-%dT%H%M")
    when = as_of or product_as_of(alerts)
    as_of_line = (
        f"NWS product as of: {when.astimezone(HST).strftime('%Y-%m-%d %H:%M')} Hawaiian Standard Time"
        if when is not None
        else "NWS product as of: (none — quiet or untimed)"
    )
    lines = [
        "# NWS Hawaii by county",
        "",
        f"Sampled: {now.strftime('%Y-%m-%d %H:%M')} Hawaiian Standard Time",
        as_of_line,
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


def _event_to_clip(event: str) -> str | None:
    """Map CAP event title to a words/nws stem when present."""
    from apps.voice.clips import _find_clip

    raw = re.sub(r"[^a-z0-9]+", "_", (event or "").strip().lower()).strip("_")
    if not raw:
        return None
    if _find_clip(raw):
        return raw
    return None


def build_clip_script(
    by_county: dict[str, list[str]],
    *,
    as_of: datetime | None = None,
    alerts: list[dict] | None = None,
) -> str:
    """Space-separated local clip tokens for NWS rollup (no cloud).

    Clock tokens use NWS product `sent` time when available — never boot wall clock.
    No silent pause clips — word files already carry tails, and concat adds a
    short gap. Shared products are spoken once, then counties, not four times.
    """
    from apps.voice.clips import _find_clip
    from apps.voice.local_tts import clock_tokens

    when = as_of or product_as_of(alerts or [])
    toks: list[str] = []
    lead = "nws_hawaii_hazard_update" if _find_clip("nws_hawaii_hazard_update") else None
    if lead:
        toks.append(lead)
    else:
        for t in ("nws", "hawaii", "all_hazards", "update"):
            if _find_clip(t):
                toks.append(t)
    if when is not None:
        # Prefer “as of” / issued wording over lying with “about <now>”.
        if _find_clip("as_of"):
            toks.append("as_of")
        elif _find_clip("issued"):
            toks.append("issued")
        elif _find_clip("about"):
            toks.append("about")
        local = when.astimezone(HST)
        toks += clock_tokens(local.hour, local.minute)
    elif _find_clip("about"):
        # Quiet board: no product clock — skip inventing a fake issue time in clips.
        pass

    # Group counties by event set so we do not repeat the same advisory 4×.
    groups: dict[tuple[str, ...], list[str]] = {}
    quiet: list[str] = []
    for c in COUNTIES:
        key = c["key"]
        events = [str(e) for e in (by_county.get(key) or [])]
        if key == "kalawao" and not events:
            continue
        county_clip = f"{key}_county"
        if not _find_clip(county_clip):
            if key == "kalawao" and _find_clip("kalawao"):
                county_clip = "kalawao"
            else:
                continue
        if not events:
            quiet.append(county_clip)
            continue
        sig = tuple(sorted(events))
        groups.setdefault(sig, []).append(county_clip)

    if not groups and quiet:
        if _find_clip("no_active_watches_or_warnings"):
            toks.append("no_active_watches_or_warnings")
        elif _find_clip("no_active_warnings"):
            toks.append("no_active_warnings")
        elif _find_clip("no_alerts"):
            toks.append("no_alerts")
    else:
        for sig, counties in groups.items():
            for ev in sig:
                clip = _event_to_clip(ev)
                if clip:
                    toks.append(clip)
            if _find_clip("in_effect"):
                toks.append("in_effect")
            toks.extend(counties)
        # Quiet counties only if some other county is active (skip all-quiet case above).
        if groups and quiet:
            for county_clip in quiet:
                toks.append(county_clip)
                if _find_clip("no_alerts"):
                    toks.append("no_alerts")

    if _find_clip("by_nws_honolulu"):
        toks.append("by_nws_honolulu")
    # Drop consecutive dupes.
    out: list[str] = []
    for t in toks:
        if out and out[-1] == t:
            continue
        out.append(t)
    return " ".join(out)


async def stitch_and_play_local(
    *,
    by_county: dict[str, list[str]],
    force_restitch: bool = False,
    play: bool = True,
    as_of: datetime | None = None,
    alerts: list[dict] | None = None,
) -> dict[str, Any]:
    """Build/queue nws-hawaii-current.wav via local_tts. Never paid TTS."""
    from apps.voice.local_tts import speak_script
    from apps.core.services import voice_events

    dest = config.GENERATED_DIR / "nws-hawaii-current.wav"
    dest.parent.mkdir(parents=True, exist_ok=True)
    legacy_mp3 = dest.with_suffix(".mp3")
    need = (
        force_restitch
        or (not dest.is_file())
        or dest.stat().st_size < 1000
    )
    stitch: dict[str, Any] = {"ok": True, "skipped_stitch": not need}
    if need:
        script = build_clip_script(by_county, as_of=as_of, alerts=alerts)
        # Tight concat — clip tails already leave space; 50ms gaps sound choppy.
        stitch = speak_script(script, dest, silence_ms=0)
        stitch["script"] = script
        if not stitch.get("ok"):
            return {"ok": False, "detail": "stitch_failed", "stitch": stitch}
        try:
            import shutil

            pub = Path(config.AUDIO_CURRENT_DIR) / "nws-hawaii-current.wav"
            pub.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(dest, pub)
            # Drop stale MP3 siblings so play prefers WAV.
            for stale in (legacy_mp3, Path(config.AUDIO_CURRENT_DIR) / "nws-hawaii-current.mp3"):
                if stale.is_file():
                    try:
                        stale.unlink()
                    except OSError:
                        pass
        except Exception:
            pass
    play_path = dest if dest.is_file() else legacy_mp3
    if not play_path.is_file():
        return {"ok": False, "detail": "mp3_missing", "stitch": stitch}
    if not play:
        return {
            "ok": True,
            "stitch": stitch,
            "play": {"ok": True, "skipped": True},
            "mp3": str(play_path),
            "wav": str(dest) if dest.is_file() else None,
        }
    play_out = await voice_events.play_report_mp3(
        dest,
        legacy_mp3,
        name="nws_hawaii",
        kind=None,
    )
    return {
        "ok": bool(play_out.get("ok")),
        "stitch": stitch,
        "play": play_out,
        "mp3": str(play_path),
        "wav": str(dest) if dest.is_file() else None,
    }


async def refresh(
    *,
    reason: str = "poll",
    force_speak: bool = False,
    speak_on_change: bool = True,
) -> dict[str, Any]:
    """Poll API, update state, write reports. Speak only after a verified pull.

    Boot / change announce rules:
    - API must succeed this call (no announce from disk-only stale state).
    - Clock spoken = newest CAP `sent`, never wall-clock now.
    - Boot speaks only when hash is new vs last_spoken_hash (or force).
    - last_spoken_* updates only after a successful restitch+play.
    """
    prev = load_state()
    alerts, source = await fetch_alerts()
    api_ok = source == "api.weather.gov"
    if not api_ok:
        # Smallest ship: record failure; scrape left for a later Grok path.
        # Do NOT announce — would replay stale warnings with a fake “now” clock.
        out = {
            "ok": False,
            "source": source,
            "watchwarn": WATCHWARN_URL,
            "scrape_needed": True,
            "reason": reason,
            "alerts": [],
            "changed": False,
            "pull_verified": False,
            "spoken": None,
        }
        prev.update(
            {
                "ok": False,
                "source": source,
                "scrape_needed": True,
                "last_poll_at": datetime.now(timezone.utc).isoformat(),
                "last_poll_reason": reason,
                "pull_verified": False,
            }
        )
        save_state(prev)
        log.warning("NWS Hawaii pull failed source=%s — no announce", source)
        return out

    by_county = _by_county(alerts)
    fp = fingerprint(alerts)
    changed = fp != str(prev.get("hash") or "")
    as_of = product_as_of(alerts)
    # Boot: announce only if this hash was never spoken (or forced). Do not
    # re-speak the same advisory on every origin recycle.
    boot_needs = reason == "boot" and (
        force_speak or str(prev.get("last_spoken_hash") or "") != fp
    )
    should_speak = bool(force_speak or (speak_on_change and changed) or boot_needs)
    spoken = build_spoken(
        by_county,
        reason="boot" if reason == "boot" else "update",
        as_of=as_of,
        alerts=alerts,
    )
    paths = write_reports(
        alerts=alerts,
        by_county=by_county,
        spoken=spoken,
        source=source,
        changed=changed,
        as_of=as_of,
    )

    now_iso = datetime.now(timezone.utc).isoformat()
    now_hst = datetime.now(HST).isoformat()
    as_of_iso = as_of.isoformat() if as_of is not None else None
    state = {
        "ok": True,
        "source": source,
        "scrape_needed": False,
        "pull_verified": True,
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
        "product_as_of": as_of_iso,
        "last_poll_at": now_iso,
        "last_poll_hst": now_hst,
        "last_poll_reason": reason,
        "last_changed_at": now_iso if changed else prev.get("last_changed_at"),
        # Keep prior spoken markers until announce succeeds.
        "last_spoken_at": prev.get("last_spoken_at"),
        "last_spoken_reason": prev.get("last_spoken_reason"),
        "last_spoken_hash": prev.get("last_spoken_hash"),
        "reports": paths,
    }
    save_state(state)

    # Restitch when products change; play only when announcing (not every 15m poll).
    # Speaking requires a fresh restitch after this verified pull — never play a
    # leftover wav from a prior clock/script.
    play_out: dict[str, Any] | None = None
    if should_speak:
        try:
            play_out = await stitch_and_play_local(
                by_county=by_county,
                force_restitch=True,
                play=True,
                as_of=as_of,
                alerts=alerts,
            )
        except Exception as e:
            log.warning("NWS local stitch/play failed: %s", e)
            play_out = {"ok": False, "detail": str(e)[:160]}
        announced = bool(play_out and play_out.get("ok"))
        stitch_meta = (play_out or {}).get("stitch") if isinstance(play_out, dict) else None
        if isinstance(stitch_meta, dict) and stitch_meta.get("ok") is False:
            announced = False
        if announced:
            state["last_spoken_at"] = now_iso
            state["last_spoken_reason"] = reason
            state["last_spoken_hash"] = fp
            state["last_spoken_product_as_of"] = as_of_iso
            save_state(state)
            try:
                from apps.core.services import reports

                reports.queue_public_draft(
                    "weather",
                    spoken,
                    source=f"nws_hawaii_{reason}",
                )
            except Exception as e:
                log.debug("NWS county draft queue skipped: %s", e)
        else:
            log.warning(
                "NWS Hawaii verified pull but announce failed — not marking spoken hash reason=%s play=%s",
                reason,
                play_out,
            )
    else:
        # Still refresh the on-disk wav when products changed (no play).
        if changed:
            try:
                play_out = await stitch_and_play_local(
                    by_county=by_county,
                    force_restitch=True,
                    play=False,
                    as_of=as_of,
                    alerts=alerts,
                )
            except Exception as e:
                log.warning("NWS restitch (no play) failed: %s", e)
                play_out = {"ok": False, "detail": str(e)[:160]}

    log.info(
        "NWS Hawaii counties source=%s alerts=%d changed=%s speak=%s reason=%s as_of=%s play=%s",
        source,
        len(alerts),
        changed,
        should_speak,
        reason,
        as_of_iso,
        (play_out or {}).get("ok"),
    )
    return {
        "ok": True,
        "source": source,
        "pull_verified": True,
        "alerts": len(alerts),
        "changed": changed,
        "product_as_of": as_of_iso,
        "spoken": spoken if should_speak and (play_out or {}).get("ok") else None,
        "spoken_always": spoken,
        "by_county": by_county,
        "hash": fp,
        "paths": paths,
        "reason": reason,
        "play": play_out,
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
    if st.get("product_as_of"):
        lines.append(f"NWS county product as of: {st.get('product_as_of')}.")
    if st.get("last_poll_hst"):
        lines.append(f"NWS county last poll: {st.get('last_poll_hst')}.")
    return lines


def spoken_section_for_boot() -> str:
    st = load_state()
    text = str(st.get("spoken") or "").strip()
    if text:
        return text
    return "NWS Hawaii by county is not on file."
