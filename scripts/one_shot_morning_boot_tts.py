"""One-shot operator Ara TTS for morning-boot. Restores Grok spend OFF after."""
from __future__ import annotations

import json
import shutil
import sys
import traceback
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

HST = ZoneInfo("Pacific/Honolulu")
DAY = "2026-09-04"


def main() -> int:
    from apps.core import config
    from apps.core.services import api_ledger, xai

    script_path = config.DATA_DIR / "state" / f"morning-boot-{DAY}-script.txt"
    text = " ".join(script_path.read_text(encoding="utf-8").split()).strip()
    if not text:
        print(json.dumps({"ok": False, "reason": "empty_script"}))
        return 1

    dated = config.GENERATED_DIR / f"morning-boot-{DAY}.mp3"
    current_gen = config.GENERATED_DIR / "morning-boot-current.mp3"
    current_pub = config.AUDIO_CURRENT_DIR / "morning-boot-current.mp3"
    reports_dir = config.PUBLIC_MEDIA / "audio" / "reports"
    reports_dated = reports_dir / f"morning-boot-{DAY}.mp3"
    reports_current = reports_dir / "morning-boot-current.mp3"

    grok_path = config.DATA_DIR / "state" / "grok-status.json"
    prior_grok = grok_path.read_text(encoding="utf-8") if grok_path.is_file() else None
    prior_flags = api_ledger.flags()

    result: dict = {
        "ok": False,
        "chars": len(text),
        "voice": "ara",
        "paths": {},
        "spend_restored": False,
    }

    try:
        # Temporary allow: this call only.
        grok_path.parent.mkdir(parents=True, exist_ok=True)
        grok_path.write_text(
            json.dumps(
                {
                    "ok": True,
                    "halt": False,
                    "at": datetime.now(HST).isoformat(),
                    "note": "temp one-shot morning-boot TTS",
                },
                indent=2,
            )
            + "\n",
            encoding="utf-8",
        )
        api_ledger.write_flags(
            {
                "spend_master": True,
                "accounts": {"xai": {"spend_allowed": True}},
            }
        )

        dated.parent.mkdir(parents=True, exist_ok=True)
        tmp = dated.with_suffix(".mp3.tmp")
        if tmp.is_file():
            try:
                tmp.unlink()
            except OSError:
                pass
        xai.tts(text, tmp, voice="ara", language="en", timeout=180)
        size = tmp.stat().st_size
        if size < 1000:
            raise xai.XAIError(f"TTS returned tiny file ({size} bytes)")
        # Atomic-ish replace so a locked destination fails after bytes land on disk.
        try:
            tmp.replace(dated)
        except OSError:
            shutil.copy2(tmp, dated)
            try:
                tmp.unlink()
            except OSError:
                pass
        size = dated.stat().st_size
        if size < 1000:
            raise xai.XAIError(f"TTS dated copy tiny ({size} bytes)")

        for dest in (current_gen, current_pub, reports_dated, reports_current):
            dest.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(dated, dest)

        until = datetime(2026, 9, 4, 12, 0, 0, tzinfo=HST)
        replay = {
            "enabled": True,
            "play_once": True,
            "mp3": str(dated),
            "current": str(current_pub),
            "until": until.isoformat(),
            "voice": "ara",
            "created_at": datetime.now(HST).isoformat(),
            "note": "Replay same MP3 every :30 HST until noon; no further TTS.",
        }
        (config.DATA_DIR / "state" / "morning-boot-replay.json").write_text(
            json.dumps(replay, indent=2) + "\n", encoding="utf-8"
        )

        result.update(
            {
                "ok": True,
                "bytes": size,
                "paths": {
                    "dated": str(dated),
                    "generated_current": str(current_gen),
                    "audio_current": str(current_pub),
                    "reports_dated": str(reports_dated),
                    "reports_current": str(reports_current),
                },
                "replay": replay,
            }
        )
    except Exception as e:
        result["reason"] = str(e)[:400]
        result["error_type"] = type(e).__name__
        result["trace"] = traceback.format_exc()[-800:]
    finally:
        # Always restore operator halt / spend OFF.
        try:
            if prior_grok is not None:
                grok_path.write_text(prior_grok, encoding="utf-8")
            else:
                grok_path.write_text(
                    json.dumps(
                        {
                            "ok": False,
                            "halt": True,
                            "reason": "operator spend halt",
                            "at": datetime.now(HST).isoformat(),
                        },
                        indent=2,
                    )
                    + "\n",
                    encoding="utf-8",
                )
            api_ledger.write_flags(
                {
                    "spend_master": False,
                    "capture_enabled": bool(prior_flags.get("capture_enabled")),
                    "accounts": {
                        "xai": {
                            "spend_allowed": False,
                            "starting_usd": (prior_flags.get("accounts") or {})
                            .get("xai", {})
                            .get("starting_usd"),
                            "note": (prior_flags.get("accounts") or {})
                            .get("xai", {})
                            .get("note"),
                        }
                    },
                }
            )
            # Re-assert hard off even if write_flags merged oddly.
            st = api_ledger.flags()
            if st.get("spend_master") or (st.get("accounts") or {}).get("xai", {}).get(
                "spend_allowed"
            ):
                api_ledger.write_flags(
                    {
                        "spend_master": False,
                        "accounts": {"xai": {"spend_allowed": False}},
                    }
                )
            grok_now = json.loads(grok_path.read_text(encoding="utf-8"))
            result["spend_restored"] = (not api_ledger.flags().get("spend_master")) and bool(
                grok_now.get("halt")
            )
            result["halt"] = bool(grok_now.get("halt"))
            result["spend_master"] = bool(api_ledger.flags().get("spend_master"))
            result["xai_spend_allowed"] = bool(
                (api_ledger.flags().get("accounts") or {}).get("xai", {}).get("spend_allowed")
            )
        except Exception as restore_err:
            result["spend_restored"] = False
            result["restore_error"] = str(restore_err)[:300]

    print(json.dumps(result, indent=2))
    return 0 if result.get("ok") else 1


if __name__ == "__main__":
    sys.exit(main())
