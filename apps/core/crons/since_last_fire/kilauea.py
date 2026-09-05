"""
Kīlauea / USGS + HVO cron.
Hourly poll. Hash ignores the clock so unchanged data does not republish.
Grok/Cursor polish is queued; facts still go out immediately.
"""

from __future__ import annotations

import hashlib
import json
import logging
import re
from datetime import datetime, timezone

import httpx

log = logging.getLogger("ava.cron.kilauea")

USGS_QUAKE_URL = (
    "https://earthquake.usgs.gov/fdsnws/event/1/query"
    "?format=geojson&minmagnitude=1&maxradiuskm=150"
    "&latitude=19.421&longitude=-155.287&orderby=time&limit=20"
)
HANS_LIST = "https://volcanoes.usgs.gov/hans-public/"
HANS_NOTICE = "https://volcanoes.usgs.gov/hans-public/notice/{id}"
HVO_UA = {"User-Agent": "AvaIvy/2.0 rootmc.net"}

_last_hash: str = ""

MULTIPLIERS = {
    "normal":   1.0,
    "advisory": 2.0,
    "watch":    2.5,
    "eruption": 3.0,
}


def _event_fingerprint(features: list) -> str:
    rows = []
    for f in features[:8]:
        props = f.get("properties") or {}
        rows.append(f"{f.get('id')}|{props.get('mag')}|{props.get('place')}")
    return "\n".join(rows)


async def _fetch_hvo(client: httpx.AsyncClient) -> tuple[str, str]:
    r = await client.get(HANS_LIST)
    r.raise_for_status()
    ids = re.findall(r"DOI-USGS-HVO-[\dT:+\-]+", r.text)
    if not ids:
        return "", ""
    notice_id = ids[0]
    r2 = await client.get(HANS_NOTICE.format(id=notice_id))
    r2.raise_for_status()
    text = re.sub(r"<script[^>]*>.*?</script>", " ", r2.text, flags=re.S | re.I)
    text = re.sub(r"<style[^>]*>.*?</style>", " ", text, flags=re.S | re.I)
    text = re.sub(r"<[^>]+>", "\n", text)
    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r"\n{3,}", "\n\n", text).strip()
    m = re.search(r"(KĪLAUEA|Kilauea).*", text, re.S)
    if m:
        text = m.group(0)[:4000]
    return notice_id, text


async def run():
    global _last_hash
    log.info("Kīlauea cron running  %s", datetime.now(timezone.utc).isoformat())
    try:
        async with httpx.AsyncClient(timeout=20, headers=HVO_UA) as client:
            r = await client.get(USGS_QUAKE_URL)
            if r.status_code != 200:
                log.warning("USGS quake fetch failed: %s", r.status_code)
                return
            features = r.json().get("features", [])
            notice_id, hvo_text = "", ""
            try:
                notice_id, hvo_text = await _fetch_hvo(client)
            except Exception as e:
                log.warning("HVO fetch failed: %s", e)

            from apps.core import config

            fp = hashlib.md5(f"{notice_id}\n{_event_fingerprint(features)}".encode()).hexdigest()
            if fp == _last_hash:
                log.debug("Kīlauea: no change since last run")
                alert_level = _infer_alert_level(features, hvo_text)
                _write_alert_state(config, alert_level, hvo_text, features)
                return
            _last_hash = fp

            from apps.core.services import reports, synth

            lines = [
                f"# Kīlauea\n",
                f"HVO notice: {notice_id or 'none'}\n",
                f"USGS events M≥1 ≤150km: {len(features)}\n",
            ]
            for f in features[:5]:
                props = f.get("properties") or {}
                lines.append(
                    f"- M{props.get('mag', '?')} {props.get('place', '?')} — {props.get('type', '?')}"
                )
            if hvo_text:
                lines.append("\n## HVO excerpt\n")
                lines.append(hvo_text[:1800])
            factual = "\n".join(lines)

            # Notice-only Grok → text + WAV + blog when toggles/spend allow.
            notice_out: dict = {}
            try:
                from apps.core.services import report_generation

                # Inject HVO text into a temp facts note for the package.
                notice_facts = config.DATA_DIR / "state" / "kilauea-notice-facts.txt"
                notice_facts.write_text(factual[:6000], encoding="utf-8")
                notice_out = report_generation.generate(
                    "kilauea",
                    dry_run=False,
                    allow_tts=True,
                    publish=True,
                    update_board=False,
                    play_after=False,
                )
            except Exception as e:
                log.warning("Kīlauea notice generate failed: %s", e)
                notice_out = {"ok": False, "detail": type(e).__name__}

            system = (
                "You are Ava Ivy. Write a short public Kīlauea status for Discord. "
                "Use only the source text. No invented alert levels or numbers. "
                "Cover: alert/aviation if stated, erupting or paused, last episode if given, "
                "one hazard note. Under 220 words. No vendor names."
            )
            user = factual[:4500]
            content = None
            if notice_out.get("ok") and notice_out.get("text"):
                content = str(notice_out["text"])
            else:
                content = synth.polish(
                    "kilauea", system, user, factual=factual[:1900], channel="kilauea"
                )
            body = (content or "").strip() or factual
            if not body.strip():
                log.warning("Kīlauea: skip empty report")
                alert_level = _infer_alert_level(features, hvo_text)
                _write_alert_state(config, alert_level, hvo_text, features)
                return

            alert_level = _infer_alert_level(features, hvo_text)
            _write_alert_state(config, alert_level, hvo_text, features)

            report_path = config.REPORTS_DIR / f"kilauea-{datetime.now(timezone.utc).strftime('%Y-%m-%dT%H')}.md"
            report_path.write_text(body, encoding="utf-8")
            log.info("Kīlauea report written: %s", report_path.name)
            reports.queue_public_draft("kilauea", body[:1900], source="cron")
            log.info("Kīlauea draft queued for operator review")

    except Exception:
        log.exception("Kīlauea cron failed")


def _infer_alert_level(features: list, hvo_text: str) -> str:
    """Official USGS/HVO levels only. Do not treat the word 'eruption' in
    'eruption is paused' / 'not erupting' as a live eruption."""
    blob = hvo_text or ""
    low = blob.lower()

    m = re.search(r"current volcano alert level:\s*(warning|watch|advisory|normal)", low)
    if m:
        return m.group(1)

    m = re.search(r"current aviation color code:\s*(red|orange|yellow|green)", low)
    if m:
        return {
            "red": "warning",
            "orange": "watch",
            "yellow": "advisory",
            "green": "normal",
        }[m.group(1)]

    paused = bool(
        re.search(r"not erupting|is paused|eruption (is )?paused|currently paused", low)
    )
    if paused:
        return "advisory" if ("advisory" in low or "yellow" in low) else "normal"

    if re.search(r"\bis erupting\b", low) or "aviation color code red" in low:
        return "warning"
    if "watch" in low or "orange" in low:
        return "watch"
    if "advisory" in low or "yellow" in low:
        return "advisory"
    if not features:
        return "normal"
    max_mag = max((f.get("properties", {}).get("mag") or 0 for f in features), default=0)
    if max_mag >= 5.0:
        return "watch"
    if max_mag >= 4.0:
        return "advisory"
    return "normal"


def _headline(hvo_text: str, alert_level: str) -> str:
    low = (hvo_text or "").lower()
    if re.search(r"not erupting|is paused|eruption (is )?paused", low):
        return "not erupting — Halemaʻumaʻu paused"
    if alert_level == "warning":
        return "WARNING — check HVO daily update"
    if alert_level == "watch":
        return "WATCH — elevated unrest"
    if alert_level == "advisory":
        return "ADVISORY — unrest, not a live fountain"
    return "quiet"


def _write_alert_state(
    config, alert_level: str, hvo_text: str = "", features: list | None = None
) -> None:
    try:
        state_dir = config.DATA_DIR / "state"
        state_dir.mkdir(parents=True, exist_ok=True)
        state_path = state_dir / "kilauea-alert.json"
        erupting = alert_level in {"warning"} or bool(
            re.search(r"\bis erupting\b", (hvo_text or "").lower())
            and not re.search(r"not erupting|is paused", (hvo_text or "").lower())
        )
        now = datetime.now(timezone.utc).isoformat()
        headline = _headline(hvo_text, alert_level)
        alert = {
            "alert_level": alert_level,
            "multiplier": get_multiplier(alert_level),
            "erupting": erupting,
            "headline": headline,
            "updated_at": now,
        }
        state_path.write_text(json.dumps(alert, ensure_ascii=False) + "\n", encoding="utf-8")

        (state_dir / "kilauea-situation.json").write_text(
            json.dumps(
                {
                    "situation": {
                        "id": "current",
                        "name": headline[:80],
                        "enabled": alert_level not in {"", "normal"} or erupting,
                        "body": (hvo_text or headline)[:2000],
                        "updated_at": now,
                    }
                },
                ensure_ascii=False,
            )
            + "\n",
            encoding="utf-8",
        )
        from apps.core.services.kilauea_cams import DEFAULT_CAMS

        streams = []
        for cam in DEFAULT_CAMS:
            vid = cam.get("youtube_video_id") or ""
            streams.append(
                {
                    "id": cam["id"],
                    "title": cam.get("title") or cam["id"],
                    "description": "USGS official cam",
                    "youtube_video_id": vid,
                    "watch_url": f"https://www.youtube.com/watch?v={vid}",
                    "embed_url": (
                        f"https://www.youtube.com/embed/{vid}"
                        "?autoplay=1&playsinline=1&rel=0&modestbranding=1"
                    ),
                }
            )
        (state_dir / "kilauea-live-streams.json").write_text(
            json.dumps(
                {"streams": streams, "updated_at": now, "source": "cron"},
                ensure_ascii=False,
            )
            + "\n",
            encoding="utf-8",
        )
        quakes = []
        for f in (features or [])[:20]:
            props = f.get("properties") or {}
            geom = f.get("geometry") or {}
            coords = geom.get("coordinates") or [None, None, None]
            quakes.append(
                {
                    "id": f.get("id"),
                    "mag": props.get("mag"),
                    "place": props.get("place"),
                    "time": props.get("time"),
                    "lon": coords[0],
                    "lat": coords[1],
                    "depth_km": coords[2],
                }
            )
        (state_dir / "kilauea-quakes.json").write_text(
            json.dumps(
                {"quakes": quakes, "updated_at": now, "source": "usgs"},
                ensure_ascii=False,
            )
            + "\n",
            encoding="utf-8",
        )
        (state_dir / "kilauea-dashboard.json").write_text(
            json.dumps(
                {
                    "ok": True,
                    "kilauea": alert,
                    "quakes_n": len(quakes),
                    "updated_at": now,
                    "source": "cron",
                },
                ensure_ascii=False,
            )
            + "\n",
            encoding="utf-8",
        )
        log.info("Kīlauea alert state written: %s erupting=%s", alert_level, erupting)
    except Exception as e:
        log.warning("Could not write kilauea alert state: %s", e)


def get_multiplier(alert_level: str) -> float:
    level = alert_level.lower().strip()
    if "erupt" in level or "red" in level or "warning" in level:
        return MULTIPLIERS["eruption"]
    if "watch" in level or "orange" in level:
        return MULTIPLIERS["watch"]
    if "advisory" in level or "yellow" in level:
        return MULTIPLIERS["advisory"]
    return MULTIPLIERS["normal"]
