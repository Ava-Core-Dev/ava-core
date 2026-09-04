"""Boot prelims — refresh live facts BEFORE morning Boot Report / day-board.

Order: NOAA → NWS Hawaii by county → Kīlauea → Boot Report (file-only). Does not call Grok.
"""
from __future__ import annotations

import logging
from datetime import datetime, timezone

log = logging.getLogger("ava.cron.boot_prelims")


async def run(*, write_report: bool = True) -> dict:
    """Pull weather + volcano first, then write the morning Boot Report."""
    log.info("Boot prelims start  %s", datetime.now(timezone.utc).isoformat())
    out: dict = {"ok": True, "steps": {}, "grok": False}

    try:
        from apps.core.crons.since_last_fire import noaa

        await noaa.run()
        out["steps"]["noaa"] = "ok"
    except Exception as e:
        log.exception("boot prelims NOAA failed")
        out["steps"]["noaa"] = f"fail:{type(e).__name__}"
        out["ok"] = False

    try:
        from apps.core.crons.since_last_fire import nws_hawaii as nws_hawaii_cron

        nws_out = await nws_hawaii_cron.run(reason="boot", force_speak=True)
        out["steps"]["nws_hawaii"] = {
            "ok": bool(nws_out.get("ok")),
            "alerts": nws_out.get("alerts"),
            "changed": nws_out.get("changed"),
            "source": nws_out.get("source"),
        }
    except Exception as e:
        log.exception("boot prelims NWS Hawaii counties failed")
        out["steps"]["nws_hawaii"] = f"fail:{type(e).__name__}"
        out["ok"] = False

    try:
        from apps.core.crons.since_last_fire import kilauea

        await kilauea.run()
        out["steps"]["kilauea"] = "ok"
    except Exception as e:
        log.exception("boot prelims Kīlauea failed")
        out["steps"]["kilauea"] = f"fail:{type(e).__name__}"
        out["ok"] = False

    # Clear live_wx cache so the Boot Report / chat see the new file + API.
    try:
        from apps.core.services import live_wx

        live_wx._cache = None
        await live_wx.weather_lines()
        out["steps"]["live_wx"] = "ok"
    except Exception as e:
        log.warning("boot prelims live_wx: %s", e)
        out["steps"]["live_wx"] = f"fail:{type(e).__name__}"

    if write_report:
        try:
            from apps.core.services import boot_report

            # Local on-device Boot Report path. Automation flag is advisory for ops;
            # boot prelims always write the file when write_report=True (no Grok/TTS).
            written = boot_report.write_boot_report(source="boot_prelims")
            out["steps"]["boot_report"] = {
                "ok": written.get("ok"),
                "dated": written.get("dated"),
                "current": written.get("current"),
                "bytes": written.get("bytes"),
                "engine": written.get("engine"),
                "scrub": written.get("scrub"),
                "automation": boot_report.morning_automation_enabled(),
                "grok": False,
                "tts": False,
            }
        except Exception as e:
            log.exception("boot prelims report write failed")
            out["steps"]["boot_report"] = f"fail:{type(e).__name__}"
            out["ok"] = False

    log.info("Boot prelims done ok=%s steps=%s", out["ok"], list(out["steps"]))
    return out
