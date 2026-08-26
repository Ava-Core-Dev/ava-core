#!/usr/bin/env python3
"""
Ava Ivy — Ecosystem energy/solar report runner.

Reads Grok API key from:
  /home/ava-core/credentials/credentials.env
  key name: ECOSYSTEM_REPORT_API

Never prints, logs, or embeds the token.
Drop-in path: /home/ava-core/operations/ecosystem_report.py
"""

from __future__ import annotations

import json
import os
import sys
import urllib.error
import urllib.request
from datetime import datetime, timezone, timedelta
from pathlib import Path
from typing import Any

# ---------------------------------------------------------------------------
# Paths (canonical Ava Core)
# ---------------------------------------------------------------------------
AVA_ROOT = Path("/home/ava-core")
CREDENTIALS_ENV = AVA_ROOT / "credentials" / "credentials.env"
# Fallbacks if the primary name differs on host
CREDENTIAL_CANDIDATES = [
    CREDENTIALS_ENV,
    AVA_ROOT / "credentials" / "Credentials.txt",
    AVA_ROOT / "credentials" / "credentials.txt",
]

OUTPUT_DIR = AVA_ROOT / "operations" / "reports" / "ecosystem"
HST = timezone(timedelta(hours=-10))

GROK_API_URL = "https://api.x.ai/v1/chat/completions"
GROK_MODEL = "grok-4"  # adjust on host if a specific model id is required

ENERGY_NOW = "https://avaivy.cloud/api/energy/now"
ENERGY_HISTORY = "https://avaivy.cloud/api/energy/history?window=24h"
STATUS_URL = "https://avaivy.cloud/api/status"


# ---------------------------------------------------------------------------
# Credential load (token never echoed)
# ---------------------------------------------------------------------------
def load_env_file(path: Path) -> dict[str, str]:
    out: dict[str, str] = {}
    if not path.is_file():
        return out
    try:
        text = path.read_text(encoding="utf-8", errors="replace")
    except OSError:
        return out
    for line in text.splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        if "=" not in line:
            continue
        key, _, val = line.partition("=")
        key = key.strip()
        val = val.strip().strip("'").strip('"')
        if key:
            out[key] = val
    return out


def load_api_token() -> str:
    # Environment overrides file (useful for testing)
    env_tok = os.environ.get("ECOSYSTEM_REPORT_API", "").strip()
    if env_tok:
        return env_tok

    merged: dict[str, str] = {}
    for p in CREDENTIAL_CANDIDATES:
        merged.update(load_env_file(p))

    tok = (merged.get("ECOSYSTEM_REPORT_API") or "").strip()
    if not tok:
        print(
            "ERROR: ECOSYSTEM_REPORT_API not found in environment or "
            f"{CREDENTIALS_ENV}",
            file=sys.stderr,
        )
        sys.exit(2)
    return tok


# ---------------------------------------------------------------------------
# HTTP helpers
# ---------------------------------------------------------------------------
def http_get_json(url: str, timeout: float = 30.0) -> Any:
    req = urllib.request.Request(
        url,
        headers={"User-Agent": "Ava-Core-ecosystem-report/1.0", "Accept": "application/json"},
        method="GET",
    )
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read().decode("utf-8"))


def http_post_json(url: str, payload: dict, token: str, timeout: float = 120.0) -> Any:
    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=data,
        headers={
            "User-Agent": "Ava-Core-ecosystem-report/1.0",
            "Content-Type": "application/json",
            "Authorization": f"Bearer {token}",
        },
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read().decode("utf-8"))


# ---------------------------------------------------------------------------
# Prompt (full automated report prompt)
# ---------------------------------------------------------------------------
REPORT_PROMPT = """You are Ava Ivy, the local-first runtime for the Root Record / RootMC ecosystem, running on a solar-powered Root Server with an EcoFlow battery bank in Hawaiʻi.

TASK
Produce today’s full energy/solar ecosystem report from live data only, then:
1. A short first-person spoken script of the same report suitable for TTS (Ara voice, as Ava).
2. An SEO chapter/timestamp list for the resulting MP3, suitable for YouTube description and chapters.

LIVE DATA (already fetched; use only these facts — do not invent values)
<<<LIVE_DATA>>>

HARD RULES (non-negotiable)
1. Never include serial numbers, device IDs, SNs, or hardware identifiers of any kind.
2. Always use the exact uniform structure below, in the same order, every time.
3. Timezone for “today,” coverage windows, and timestamps is always Pacific/Honolulu (HST).
4. Watts → whole numbers. Energy → kWh to 3 decimal places. SoC → whole percent.
5. If history does not cover the full calendar day, state the actual coverage window. Never pad or invent missing hours.
6. Prefer the live data block above over any prior knowledge.
7. Spoken scripts must never end with “Ava out,” “Ava signing off,” or any sign-off phrase. Audio clips will be concatenated into larger continuous YouTube segments; closings create jarring cuts.

UNIFORM REPORT STRUCTURE (emit exactly this)

AVA ECOSYSTEM REPORT
Date: YYYY-MM-DD (Hawaiʻi Standard Time)
Generated: HH:MM HST
Source: live Ava energy endpoints (EcoFlow bank, local SQLite)
Core: ONLINE | OFFLINE

1. LIVE SNAPSHOT
   Primary — SoC X% | Solar X W | In X W | Out X W | Net ±X W
   Backup  — SoC X% | Solar X W | In X W | Out X W | Net ±X W

2. DAY TOTALS (calendar day HST; note coverage if partial)
   Combined solar: X.XXX kWh
   Combined energy in: X.XXX kWh
   Combined energy out: X.XXX kWh
   Coverage: HH:MM → HH:MM HST

3. BY UNIT
   Primary — solar X.XXX kWh | peak X W | SoC min–max% (last X%)
   Backup  — solar X.XXX kWh | peak X W | SoC min–max% (last X%)

4. HOURLY HIGHLIGHT
   Peak solar hour: HH:00 HST (~X Wh)

5. NOTES
   Brief factual notes only (partial coverage, offline units, anomalies, etc.).

SPOKEN SCRIPT
- First-person Ava voice, ≤180 words.
- Same facts, no tables, no serial numbers, no markdown.
- Open with a short greeting that names Ava and the date.
- End on the final factual statement only. No sign-off of any kind.

SEO CHAPTER / TIMESTAMP LIST (for the MP3)
After the spoken script, output a clean YouTube-ready chapter list using estimated relative times from the start of the spoken audio (0:00). Use this exact format so it pastes directly into a YouTube description:

0:00 Intro — Ava energy report [date]
0:XX Live snapshot — Primary and Backup
0:XX Day totals — combined solar, in, out
0:XX By unit — Primary and Backup production
0:XX Peak hour and notes

Rules for the SEO list:
- Times are approximate relative offsets from the start of the spoken script (not wall-clock HST).
- Keep titles short, keyword-rich, and consistent across days (same section names every report).
- Include the calendar date in the first chapter title only.
- No serial numbers, no URLs, no extra commentary under the list.
- Aim for 4–6 chapters maximum so they remain useful when clips are later concatenated.

OUTPUT ORDER
1. The uniform text report.
2. A blank line.
3. The spoken script only.
4. A blank line.
5. The SEO chapter/timestamp list only (no heading required beyond the list itself).

If data is incomplete, state Core or Energy status factually in section 5 and still emit the structure with available fields marked “—” rather than inventing data.
"""


# ---------------------------------------------------------------------------
# Strip serials / sensitive keys from payloads before prompt injection
# ---------------------------------------------------------------------------
SENSITIVE_KEYS = {"sn", "serial", "serial_number", "device_id", "mac", "imei"}


def scrub(obj: Any) -> Any:
    if isinstance(obj, dict):
        return {
            k: scrub(v)
            for k, v in obj.items()
            if k.lower() not in SENSITIVE_KEYS and not k.lower().endswith("_sn")
        }
    if isinstance(obj, list):
        return [scrub(x) for x in obj]
    return obj


def fetch_live_bundle() -> dict[str, Any]:
    bundle: dict[str, Any] = {
        "fetched_at_utc": datetime.now(timezone.utc).isoformat(),
        "fetched_at_hst": datetime.now(HST).isoformat(),
        "energy_now": None,
        "energy_history_24h": None,
        "core_status": None,
        "errors": [],
    }
    try:
        bundle["energy_now"] = scrub(http_get_json(ENERGY_NOW))
    except Exception as e:
        bundle["errors"].append(f"energy/now: {type(e).__name__}: {e}")
    try:
        bundle["energy_history_24h"] = scrub(http_get_json(ENERGY_HISTORY))
    except Exception as e:
        bundle["errors"].append(f"energy/history: {type(e).__name__}: {e}")
    try:
        st = http_get_json(STATUS_URL)
        # Keep only high-level status, not process dumps
        bundle["core_status"] = {
            "ok": st.get("ok"),
            "ts": st.get("ts"),
            "host": st.get("host"),
            "energy_summary": scrub(st.get("energy")),
        }
    except Exception as e:
        bundle["errors"].append(f"status: {type(e).__name__}: {e}")
    return bundle


def call_grok(token: str, live_data: dict[str, Any]) -> str:
    prompt = REPORT_PROMPT.replace(
        "<<<LIVE_DATA>>>", json.dumps(live_data, indent=2, default=str)[:120000]
    )
    payload = {
        "model": GROK_MODEL,
        "messages": [
            {
                "role": "system",
                "content": "You are Ava Ivy. Follow the user prompt rules exactly. No serial numbers. No sign-offs in spoken script.",
            },
            {"role": "user", "content": prompt},
        ],
        "temperature": 0.2,
    }
    try:
        result = http_post_json(GROK_API_URL, payload, token)
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", errors="replace")[:500]
        print(f"ERROR: Grok API HTTP {e.code}: {body}", file=sys.stderr)
        sys.exit(3)
    except Exception as e:
        print(f"ERROR: Grok API request failed: {type(e).__name__}: {e}", file=sys.stderr)
        sys.exit(3)

    try:
        return result["choices"][0]["message"]["content"].strip()
    except (KeyError, IndexError, TypeError):
        print("ERROR: unexpected Grok API response shape", file=sys.stderr)
        print(json.dumps(result, indent=2)[:1000], file=sys.stderr)
        sys.exit(4)


def write_outputs(text: str) -> Path:
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    now = datetime.now(HST)
    stamp = now.strftime("%Y-%m-%d_%H%M%S")
    day = now.strftime("%Y-%m-%d")
    out = OUTPUT_DIR / f"ecosystem_report_{day}_{stamp}.txt"
    latest = OUTPUT_DIR / "ecosystem_report_latest.txt"
    out.write_text(text + "\n", encoding="utf-8")
    latest.write_text(text + "\n", encoding="utf-8")
    return out


def main() -> int:
    token = load_api_token()
    live = fetch_live_bundle()
    report = call_grok(token, live)
    path = write_outputs(report)
    # Safe status only — never token
    print(f"OK wrote {path}")
    print(f"OK also {OUTPUT_DIR / 'ecosystem_report_latest.txt'}")
    if live.get("errors"):
        print("WARN live fetch issues:", "; ".join(live["errors"]), file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
