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

# Official xAI vs third-party GrokAPI (grok-api.com)
XAI_CHAT_URL = "https://api.x.ai/v1/chat/completions"
GROKAPI_CHAT_URL = "https://grok-api.com/v1/chat/completions"
DEFAULT_MODEL_XAI = "grok-4"
DEFAULT_MODEL_GROKAPI = "grok-4"

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


def load_merged_credentials() -> dict[str, str]:
    merged: dict[str, str] = {}
    for p in CREDENTIAL_CANDIDATES:
        merged.update(load_env_file(p))
    # Environment overrides file values
    for k in (
        "ECOSYSTEM_REPORT_API",
        "ECOSYSTEM_REPORT_API_BASE",
        "ECOSYSTEM_REPORT_MODEL",
    ):
        v = os.environ.get(k, "").strip()
        if v:
            merged[k] = v
    return merged


def resolve_api_config() -> tuple[str, str, str]:
    """
    Returns (token, chat_completions_url, model).

    Key routing:
      - starts with xai-  → official https://api.x.ai
      - starts with sk-   → third-party https://grok-api.com  (your dashboard)
      - ECOSYSTEM_REPORT_API_BASE overrides either
    """
    creds = load_merged_credentials()
    tok = (creds.get("ECOSYSTEM_REPORT_API") or "").strip()
    if not tok:
        print(
            "ERROR: ECOSYSTEM_REPORT_API not found in environment or "
            f"{CREDENTIALS_ENV}",
            file=sys.stderr,
        )
        sys.exit(2)

    base_override = (creds.get("ECOSYSTEM_REPORT_API_BASE") or "").strip().rstrip("/")
    model_override = (creds.get("ECOSYSTEM_REPORT_MODEL") or "").strip()

    if base_override:
        # Accept full URL or origin; normalize to .../v1/chat/completions
        if base_override.endswith("/chat/completions"):
            url = base_override
        elif base_override.endswith("/v1"):
            url = base_override + "/chat/completions"
        else:
            url = base_override.rstrip("/") + "/v1/chat/completions"
        model = model_override or (
            DEFAULT_MODEL_GROKAPI if "grok-api.com" in url else DEFAULT_MODEL_XAI
        )
    elif tok.startswith("xai-"):
        url = XAI_CHAT_URL
        model = model_override or DEFAULT_MODEL_XAI
    elif tok.startswith("sk-"):
        # Keys from https://grok-api.com/en/dashboard/tokens
        url = GROKAPI_CHAT_URL
        model = model_override or DEFAULT_MODEL_GROKAPI
    else:
        print(
            "WARN: API key prefix not recognized (expected xai- or sk-). "
            "Defaulting to api.x.ai. Set ECOSYSTEM_REPORT_API_BASE to override.",
            file=sys.stderr,
        )
        url = XAI_CHAT_URL
        model = model_override or DEFAULT_MODEL_XAI

    return tok, url, model


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

SOURCES (authoritative — list these in the report header)
- https://avaivy.cloud/api/energy/now
- https://avaivy.cloud/api/energy/history?window=24h
- https://avaivy.cloud/api/status

LIVE DATA (already fetched and pre-aggregated from the sources above)
The block includes:
- energy_now (live snapshot)
- day_summary (PRE-COMPUTED HST calendar-day totals — use these numbers as authoritative for sections 2–4; do not re-sum raw rows and do not replace them with — when present)
- core_status
- errors (if any)

<<<LIVE_DATA>>>

HARD RULES (non-negotiable)
1. Never include serial numbers, device IDs, SNs, or hardware identifiers of any kind.
2. Always use the exact uniform structure below, in the same order, every time.
3. Timezone for “today,” coverage windows, and timestamps is always Pacific/Honolulu (HST).
4. Watts → whole numbers. Energy → kWh to 3 decimal places. SoC → whole percent.
5. Use day_summary for DAY TOTALS, BY UNIT, and HOURLY HIGHLIGHT whenever those fields are non-null. Only use “—” if day_summary itself marks them null/missing.
6. Prefer the live data block above over any prior knowledge.
7. Spoken scripts must never end with “Ava out,” “Ava signing off,” or any sign-off phrase. Audio clips will be concatenated into larger continuous YouTube segments; closings create jarring cuts.
8. Text report must include the three source URLs. Spoken script may say “from Ava’s live energy desk” without reading URLs.

UNIFORM REPORT STRUCTURE (emit exactly this)

AVA ECOSYSTEM REPORT
Date: YYYY-MM-DD (Hawaiʻi Standard Time)
Generated: HH:MM HST
Source: live Ava energy endpoints (EcoFlow bank, local SQLite)
  - https://avaivy.cloud/api/energy/now
  - https://avaivy.cloud/api/energy/history?window=24h
  - https://avaivy.cloud/api/status
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
- Mention figures are from Ava’s live energy desk / local EcoFlow bank.
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


def _parse_row_ts(r: dict) -> datetime | None:
    t = r.get("ts") or r.get("bucket_key") or r.get("minute_key")
    if not t:
        return None
    s = str(t).replace(" ", "T")
    if "T" in s and not s.endswith("Z") and "+" not in s:
        s += "+00:00"
    try:
        return datetime.fromisoformat(s.replace("Z", "+00:00"))
    except Exception:
        return None


def compute_day_summary(history: dict | None, now_hst: datetime) -> dict[str, Any]:
    """
    Pre-aggregate HST calendar-day totals from history rows so the model
    cannot leave DAY TOTALS / BY UNIT / peak as dashes when data exists.
    """
    empty: dict[str, Any] = {
        "date_hst": now_hst.strftime("%Y-%m-%d"),
        "coverage_start_hst": None,
        "coverage_end_hst": None,
        "partial": True,
        "combined_solar_kwh": None,
        "combined_energy_in_kwh": None,
        "combined_energy_out_kwh": None,
        "units": {},
        "peak_solar_hour_hst": None,
        "peak_solar_hour_wh": None,
        "row_count": 0,
    }
    if not history or not isinstance(history, dict):
        return empty
    rows = history.get("rows") or []
    if not rows:
        # fall back to API aggregate if present (24h window, not calendar day)
        agg = history.get("aggregate") or {}
        empty["api_aggregate_24h"] = scrub(agg)
        return empty

    day_start = now_hst.replace(hour=0, minute=0, second=0, microsecond=0)
    day_end = day_start + timedelta(days=1)

    today: list[tuple[datetime, dict]] = []
    for r in rows:
        if not isinstance(r, dict):
            continue
        dt = _parse_row_ts(r)
        if dt is None:
            continue
        local = dt.astimezone(HST)
        if day_start <= local < day_end:
            today.append((local, r))

    if not today:
        empty["note"] = "No history rows fell on HST calendar day"
        return empty

    times = [t for t, _ in today]
    empty["coverage_start_hst"] = min(times).strftime("%H:%M")
    empty["coverage_end_hst"] = max(times).strftime("%H:%M")
    empty["partial"] = not (
        min(times).hour == 0 and min(times).minute <= 5
        and max(times).hour >= 23
    )
    empty["row_count"] = len(today)

    solar_wh = sum(float(r.get("energy_solar_wh") or 0) for _, r in today)
    in_wh = sum(float(r.get("energy_in_wh") or 0) for _, r in today)
    out_wh = sum(float(r.get("energy_out_wh") or 0) for _, r in today)
    empty["combined_solar_kwh"] = round(solar_wh / 1000.0, 3)
    empty["combined_energy_in_kwh"] = round(in_wh / 1000.0, 3)
    empty["combined_energy_out_kwh"] = round(out_wh / 1000.0, 3)

    by_name: dict[str, list[dict]] = {}
    for _, r in today:
        name = str(r.get("name") or "Unknown")
        by_name.setdefault(name, []).append(r)

    units: dict[str, Any] = {}
    for name, rs in by_name.items():
        s_wh = sum(float(r.get("energy_solar_wh") or 0) for r in rs)
        socs = [float(r["soc_avg"]) for r in rs if r.get("soc_avg") is not None]
        peaks = [float(r["solar_w_avg"]) for r in rs if r.get("solar_w_avg") is not None]
        units[name] = {
            "solar_kwh": round(s_wh / 1000.0, 3),
            "peak_solar_w": int(round(max(peaks))) if peaks else None,
            "soc_min": int(round(min(socs))) if socs else None,
            "soc_max": int(round(max(socs))) if socs else None,
            "soc_last": int(round(socs[-1])) if socs else None,
        }
    empty["units"] = units

    # hourly combined solar Wh
    hourly: dict[str, float] = {}
    for local, r in today:
        h = local.strftime("%H:00")
        hourly[h] = hourly.get(h, 0.0) + float(r.get("energy_solar_wh") or 0)
    if hourly:
        peak_h = max(hourly, key=hourly.get)
        empty["peak_solar_hour_hst"] = peak_h
        empty["peak_solar_hour_wh"] = int(round(hourly[peak_h]))
        empty["hourly_solar_wh"] = {k: int(round(v)) for k, v in sorted(hourly.items())}

    return empty


def fetch_live_bundle() -> dict[str, Any]:
    now_hst = datetime.now(HST)
    bundle: dict[str, Any] = {
        "fetched_at_utc": datetime.now(timezone.utc).isoformat(),
        "fetched_at_hst": now_hst.isoformat(),
        "sources": [
            ENERGY_NOW,
            ENERGY_HISTORY,
            STATUS_URL,
        ],
        "energy_now": None,
        "day_summary": None,
        "core_status": None,
        "errors": [],
    }
    history_raw = None
    try:
        bundle["energy_now"] = scrub(http_get_json(ENERGY_NOW))
    except Exception as e:
        bundle["errors"].append(f"energy/now: {type(e).__name__}: {e}")
    try:
        history_raw = http_get_json(ENERGY_HISTORY)
        # Do not send hundreds of raw rows to the model — only pre-aggregates
        if isinstance(history_raw, dict):
            slim = {
                "window": history_raw.get("window"),
                "aggregate": scrub(history_raw.get("aggregate")),
                "row_count": len(history_raw.get("rows") or []),
            }
            bundle["energy_history_meta"] = slim
    except Exception as e:
        bundle["errors"].append(f"energy/history: {type(e).__name__}: {e}")
    try:
        st = http_get_json(STATUS_URL)
        bundle["core_status"] = {
            "ok": st.get("ok"),
            "ts": st.get("ts"),
            "host": st.get("host"),
            "energy_summary": scrub(st.get("energy")),
        }
    except Exception as e:
        bundle["errors"].append(f"status: {type(e).__name__}: {e}")

    bundle["day_summary"] = compute_day_summary(history_raw, now_hst)
    return bundle


def call_grok(token: str, api_url: str, model: str, live_data: dict[str, Any]) -> str:
    prompt = REPORT_PROMPT.replace(
        "<<<LIVE_DATA>>>", json.dumps(live_data, indent=2, default=str)[:120000]
    )
    payload = {
        "model": model,
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
        result = http_post_json(api_url, payload, token)
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", errors="replace")[:500]
        print(f"ERROR: Grok API HTTP {e.code} at {api_url}: {body}", file=sys.stderr)
        sys.exit(3)
    except Exception as e:
        print(f"ERROR: Grok API request failed ({api_url}): {type(e).__name__}: {e}", file=sys.stderr)
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
    token, api_url, model = resolve_api_config()
    # Safe status only — never token
    print(f"Using endpoint: {api_url}")
    print(f"Using model:    {model}")
    live = fetch_live_bundle()
    report = call_grok(token, api_url, model, live)
    path = write_outputs(report)
    print(f"OK wrote {path}")
    print(f"OK also {OUTPUT_DIR / 'ecosystem_report_latest.txt'}")
    if live.get("errors"):
        print("WARN live fetch issues:", "; ".join(live["errors"]), file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
