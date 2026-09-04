"""Public API price catalog + operator-seeded balances.

Prices: fetch official docs at origin boot and once a day (HST). No tokens spent.
Balances: prepaid APIs (Grok, OpenAI, Gemini) stay unknown until a starting
USD or percent is seeded. Cursor is a monthly usage pool (percent), not dollars.
Spend switches stay off until the operator turns one on. Grok is off on purpose.
"""
from __future__ import annotations

import hashlib
import json
import logging
import re
import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo

import requests

from apps.core import config

log = logging.getLogger("ava.api_ledger")
HST = ZoneInfo("Pacific/Honolulu")

STATE_PATH = config.DATA_DIR / "state" / "api-ledger.json"
LAST_PATH = config.DATA_DIR / "state" / "api-ledger-last.json"

# Operator-reported 2026-09-03 HST. Not live-metered.
CURSOR_SEED_USED_PCT = 73
XAI_SEED_USD = 5.00

SOURCES = (
    {
        "vendor": "cursor",
        "url": "https://cursor.com/docs/models.md",
        "alt": "https://cursor.com/docs/models",
    },
    {
        "vendor": "xai",
        "url": "https://docs.x.ai/docs/models.md",
        "alt": "https://docs.x.ai/docs/models",
    },
    {
        "vendor": "openai",
        "url": "https://developers.openai.com/api/docs/pricing.md",
        "alt": "https://openai.com/api/pricing/",
    },
    {
        "vendor": "gemini",
        "url": "https://ai.google.dev/gemini-api/docs/pricing.md",
        "alt": "https://ai.google.dev/gemini-api/docs/pricing",
    },
)

# Captured 2026-09-03 HST from the official pages above (plus Cursor models table).
# USD per million tokens unless unit says otherwise.
SEED_ROWS: tuple[dict[str, Any], ...] = (
    # Cursor first-party (Auto bills at the routed model's list price)
    {"vendor": "cursor", "model": "grok-4.6", "input": 2.0, "cached": 0.5, "output": 6.0, "notes": "Cursor Models pool; Auto list price when routed here"},
    {"vendor": "cursor", "model": "grok-4.6-fast", "input": 4.0, "cached": 1.0, "output": 12.0, "notes": "Cursor Models pool"},
    {"vendor": "cursor", "model": "grok-4.5", "input": 2.0, "cached": 0.5, "output": 6.0, "notes": "Cursor Models pool"},
    {"vendor": "cursor", "model": "composer-2.5", "input": 0.5, "cached": 0.2, "output": 2.5, "notes": "Cursor Models pool; cheapest first-party"},
    {"vendor": "cursor", "model": "composer-2.5-fast", "input": 3.0, "cached": 0.5, "output": 15.0, "notes": "Cursor Models pool"},
    {"vendor": "cursor", "model": "token-rate-third-party", "input": 0.25, "cached": 0.25, "output": 0.25, "notes": "Teams/Enterprise add-on per million tokens on third-party; first-party exempt"},
    {"vendor": "cursor", "model": "auto", "input": None, "cached": None, "output": None, "notes": "Bills at the routed model list price (Cost/Balance/Intelligence)"},
    # xAI prepaid API
    {"vendor": "xai", "model": "grok-4.6", "input": 2.0, "cached": 0.5, "output": 6.0, "notes": "<200k prompt; ≥200k doubles all three"},
    {"vendor": "xai", "model": "grok-4.6-long", "input": 4.0, "cached": 1.0, "output": 12.0, "notes": "whole request once prompt ≥200k"},
    {"vendor": "xai", "model": "grok-4.5", "input": 2.0, "cached": 0.3, "output": 6.0, "notes": "<200k prompt"},
    {"vendor": "xai", "model": "grok-4.3", "input": 1.25, "cached": 0.2, "output": 2.5, "notes": "<200k prompt"},
    {"vendor": "xai", "model": "grok-imagine-image-2.0", "input": None, "cached": None, "output": 0.04, "unit": "image", "notes": "from $0.04 / image"},
    {"vendor": "xai", "model": "grok-voice-tts", "input": None, "cached": None, "output": 15.0, "unit": "1M chars", "notes": "Text to Speech"},
    # OpenAI
    {"vendor": "openai", "model": "gpt-5.6-sol", "input": 4.0, "cached": 0.4, "output": 20.0, "notes": "short context; promo through 2026-11-21; long context 2x"},
    {"vendor": "openai", "model": "gpt-5.6-terra", "input": 2.0, "cached": 0.2, "output": 12.0, "notes": "short context"},
    {"vendor": "openai", "model": "gpt-5.6-luna", "input": 0.2, "cached": 0.02, "output": 1.2, "notes": "short context"},
    {"vendor": "openai", "model": "gpt-6-astra", "input": 10.0, "cached": 1.0, "output": 50.0, "notes": "Trusted Access; short context"},
    {"vendor": "openai", "model": "gpt-5.3-codex", "input": 1.75, "cached": 0.175, "output": 14.0, "notes": "Codex"},
    # Gemini
    {"vendor": "gemini", "model": "gemini-3.6-flash", "input": 1.5, "cached": 0.15, "output": 7.5, "notes": "Google paid standard"},
    {"vendor": "gemini", "model": "gemini-3.1-pro", "input": 2.0, "cached": 0.2, "output": 12.0, "notes": "≤200k; >200k input $4 / output $18"},
    {"vendor": "gemini", "model": "gemini-2.5-flash-lite", "input": 0.1, "cached": 0.01, "output": 0.4, "notes": "cheapest Gemini paid text"},
    {"vendor": "gemini", "model": "gemini-2.5-pro", "input": 1.25, "cached": 0.125, "output": 10.0, "notes": "≤200k; >200k input $2.50 / output $15"},
    {"vendor": "gemini", "model": "gemini-3.8-flash", "input": 0.75, "cached": 0.075, "output": 3.5, "notes": "as billed inside Cursor Other Models"},
    # Anthropic (linked via Cursor Other Models; no Ava key yet)
    {"vendor": "anthropic", "model": "claude-sonnet-5", "input": 2.0, "cached": 0.2, "output": 10.0, "notes": "Cursor Other Models list"},
    {"vendor": "anthropic", "model": "claude-opus-5", "input": 5.0, "cached": 0.5, "output": 25.0, "notes": "Cursor Other Models list"},
)

_DEFAULT_ACCOUNT = {
    "spend_allowed": False,
    "starting_usd": None,
    "used_pct": None,
    "note": "",
}


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _db() -> Path:
    return config.DB_DIR / "api-ledger.sqlite"


def connect() -> sqlite3.Connection:
    config.DB_DIR.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(_db()))
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.executescript(
        """
        CREATE TABLE IF NOT EXISTS prices (
          id INTEGER PRIMARY KEY,
          at TEXT NOT NULL,
          source TEXT NOT NULL,
          vendor TEXT NOT NULL,
          model TEXT NOT NULL,
          input_per_m REAL,
          cached_per_m REAL,
          output_per_m REAL,
          unit TEXT,
          notes TEXT,
          live INTEGER NOT NULL DEFAULT 0
        );
        CREATE INDEX IF NOT EXISTS idx_prices_vendor ON prices(vendor, at);
        CREATE TABLE IF NOT EXISTS fetches (
          id INTEGER PRIMARY KEY,
          at TEXT NOT NULL,
          source TEXT NOT NULL,
          vendor TEXT NOT NULL,
          url TEXT,
          ok INTEGER NOT NULL,
          bytes INTEGER,
          sha TEXT,
          detail TEXT
        );
        CREATE TABLE IF NOT EXISTS usage (
          id INTEGER PRIMARY KEY,
          at TEXT NOT NULL,
          vendor TEXT NOT NULL,
          model TEXT,
          input_tokens INTEGER,
          output_tokens INTEGER,
          cached_tokens INTEGER,
          usd REAL,
          surface TEXT,
          note TEXT
        );
        """
    )
    return conn


def _empty_accounts() -> dict[str, dict]:
    return {
        "cursor": {
            **_DEFAULT_ACCOUNT,
            "kind": "percent_pool",
            "label": "Cursor",
            "used_pct": CURSOR_SEED_USED_PCT,
            "note": "Operator 2026-09-03: ~73% used. Self-update stays off.",
        },
        "xai": {
            **_DEFAULT_ACCOUNT,
            "kind": "usd_prepaid",
            "label": "xAI / Grok",
            "starting_usd": XAI_SEED_USD,
            "note": "Operator 2026-09-03: $5 prepaid. Key not given to Ava yet. Spend off.",
        },
        "openai": {**_DEFAULT_ACCOUNT, "kind": "usd_prepaid", "label": "OpenAI"},
        "gemini": {**_DEFAULT_ACCOUNT, "kind": "usd_prepaid", "label": "Gemini"},
        "anthropic": {**_DEFAULT_ACCOUNT, "kind": "usd_prepaid", "label": "Anthropic"},
    }


def flags() -> dict:
    STATE_PATH.parent.mkdir(parents=True, exist_ok=True)
    base = {
        "capture_enabled": True,
        "spend_master": False,
        "accounts": _empty_accounts(),
        "seeded_at": None,
    }
    if not STATE_PATH.is_file():
        base["seeded_at"] = _now()
        STATE_PATH.write_text(json.dumps(base, indent=2) + "\n", encoding="utf-8")
        return base
    try:
        data = json.loads(STATE_PATH.read_text(encoding="utf-8"))
        if not isinstance(data, dict):
            return base
    except Exception:
        return base
    out = dict(base)
    out["capture_enabled"] = bool(data.get("capture_enabled", True))
    out["spend_master"] = bool(data.get("spend_master"))
    out["seeded_at"] = data.get("seeded_at") or base["seeded_at"]
    accounts = _empty_accounts()
    raw = data.get("accounts") if isinstance(data.get("accounts"), dict) else {}
    for key, acc in accounts.items():
        got = raw.get(key) if isinstance(raw.get(key), dict) else {}
        acc["spend_allowed"] = bool(got.get("spend_allowed"))
        if got.get("starting_usd") is not None and got.get("starting_usd") != "":
            try:
                acc["starting_usd"] = max(0.0, float(got["starting_usd"]))
            except (TypeError, ValueError):
                pass
        if got.get("used_pct") is not None and got.get("used_pct") != "":
            try:
                acc["used_pct"] = max(0, min(100, int(got["used_pct"])))
            except (TypeError, ValueError):
                pass
        if got.get("note"):
            acc["note"] = str(got["note"])[:240]
        accounts[key] = acc
    out["accounts"] = accounts
    return out


def write_flags(patch: dict) -> dict:
    cur = flags()
    if "capture_enabled" in patch:
        cur["capture_enabled"] = bool(patch["capture_enabled"])
    if "spend_master" in patch:
        cur["spend_master"] = bool(patch["spend_master"])
    acc_patch = patch.get("accounts")
    if isinstance(acc_patch, dict):
        for key, blob in acc_patch.items():
            if key not in cur["accounts"] or not isinstance(blob, dict):
                continue
            dst = cur["accounts"][key]
            if "spend_allowed" in blob:
                dst["spend_allowed"] = bool(blob["spend_allowed"])
            if "starting_usd" in blob:
                raw = blob["starting_usd"]
                if raw is None or raw == "":
                    dst["starting_usd"] = None
                else:
                    try:
                        dst["starting_usd"] = max(0.0, float(raw))
                    except (TypeError, ValueError):
                        pass
            if "used_pct" in blob:
                raw = blob["used_pct"]
                if raw is None or raw == "":
                    dst["used_pct"] = None
                else:
                    try:
                        dst["used_pct"] = max(0, min(100, int(raw)))
                    except (TypeError, ValueError):
                        pass
            if "note" in blob and blob["note"] is not None:
                dst["note"] = str(blob["note"])[:240]
    if not cur.get("seeded_at"):
        cur["seeded_at"] = _now()
    STATE_PATH.write_text(json.dumps(cur, indent=2) + "\n", encoding="utf-8")
    return cur


def may_spend(vendor: str) -> tuple[bool, str]:
    st = flags()
    if not st.get("spend_master"):
        return False, "spend_master_off"
    acc = (st.get("accounts") or {}).get(vendor) or {}
    if not acc.get("spend_allowed"):
        return False, f"{vendor}_off"
    return True, "ok"


def _key_present(vendor: str) -> bool:
    if vendor == "xai":
        return bool(config.XAI_API_KEY)
    if vendor == "cursor":
        return bool(getattr(config, "CURSOR_API_KEY", "") or "")
    if vendor == "openai":
        return bool(getattr(config, "OPENAI_API_KEY", "") or "")
    if vendor == "gemini":
        return bool(getattr(config, "GEMINI_API_KEY", "") or "")
    if vendor == "anthropic":
        return bool(getattr(config, "ANTHROPIC_API_KEY", "") or "")
    return False


def _mgmt_ready(vendor: str) -> bool:
    if vendor == "xai":
        return bool(getattr(config, "XAI_MGMT_KEY", "") or "") and bool(
            getattr(config, "XAI_TEAM_ID", "") or ""
        )
    return False


def estimate_usd(vendor: str, model: str, *, input_tokens: int = 0, output_tokens: int = 0, cached_tokens: int = 0) -> float | None:
    row = latest_price(vendor, model)
    if not row:
        return None
    inp = row.get("input_per_m")
    out = row.get("output_per_m")
    cached = row.get("cached_per_m")
    usd = 0.0
    known = False
    if inp is not None:
        usd += (max(0, int(input_tokens)) / 1_000_000) * float(inp)
        known = True
    if cached is not None:
        usd += (max(0, int(cached_tokens)) / 1_000_000) * float(cached)
        known = True
    if out is not None:
        usd += (max(0, int(output_tokens)) / 1_000_000) * float(out)
        known = True
    return round(usd, 6) if known else None


def auto_turn_estimates() -> dict:
    """Typical Cursor Auto cost if the router lands on Cursor Grok 4.6 (this desk's model)."""
    grok = latest_price("cursor", "grok-4.6") or {
        "input_per_m": 2.0,
        "cached_per_m": 0.5,
        "output_per_m": 6.0,
    }
    composer = latest_price("cursor", "composer-2.5") or {
        "input_per_m": 0.5,
        "cached_per_m": 0.2,
        "output_per_m": 2.5,
    }

    def _cost(row: dict, inn: int, cache: int, out: int) -> float:
        return round(
            (inn / 1_000_000) * float(row["input_per_m"] or 0)
            + (cache / 1_000_000) * float(row["cached_per_m"] or 0)
            + (out / 1_000_000) * float(row["output_per_m"] or 0),
            4,
        )

    modest_g = _cost(grok, 20_000, 20_000, 4_000)
    heavy_g = _cost(grok, 60_000, 40_000, 8_000)
    catalog_g = _cost(grok, 12_000, 0, 1_500)
    modest_c = _cost(composer, 20_000, 20_000, 4_000)
    return {
        "basis": "Cursor Auto bills the routed model. These assume Grok 4.6 vs Composer 2.5.",
        "captured": "cursor.com/docs/models 2026-09-03",
        "modest_turn_grok46_usd": modest_g,
        "heavy_turn_grok46_usd": heavy_g,
        "catalog_job_if_auto_usd": catalog_g,
        "modest_turn_composer25_usd": modest_c,
        "typical_range_usd": [modest_g, heavy_g],
        "note": (
            "A daily-agent Cursor user is listed at $60–$100/mo on cursor.com/docs/models. "
            "That is about $0.08–$0.17 per turn at 20–40 turns/day — same band as Grok 4.6. "
            "This price-capture job is Python HTTP, not Auto, so it costs $0 in tokens."
        ),
    }


def latest_price(vendor: str, model: str) -> dict | None:
    conn = connect()
    try:
        row = conn.execute(
            """SELECT vendor, model, input_per_m, cached_per_m, output_per_m, unit, notes, at, live
               FROM prices WHERE vendor=? AND model=? ORDER BY id DESC LIMIT 1""",
            (vendor, model),
        ).fetchone()
    finally:
        conn.close()
    if not row:
        for seed in SEED_ROWS:
            if seed["vendor"] == vendor and seed["model"] == model:
                return {
                    "vendor": vendor,
                    "model": model,
                    "input_per_m": seed.get("input"),
                    "cached_per_m": seed.get("cached"),
                    "output_per_m": seed.get("output"),
                    "unit": seed.get("unit") or "1M tokens",
                    "notes": seed.get("notes"),
                    "at": None,
                    "live": 0,
                }
        return None
    return dict(row)


def spent_usd(vendor: str) -> float:
    conn = connect()
    try:
        row = conn.execute(
            "SELECT COALESCE(SUM(usd), 0) AS n FROM usage WHERE vendor=?",
            (vendor,),
        ).fetchone()
    finally:
        conn.close()
    return float(row["n"] if row else 0)


def record_usage(
    vendor: str,
    *,
    model: str | None = None,
    input_tokens: int = 0,
    output_tokens: int = 0,
    cached_tokens: int = 0,
    usd: float | None = None,
    surface: str = "",
    note: str = "",
) -> None:
    if usd is None:
        usd = estimate_usd(
            vendor,
            model or "",
            input_tokens=input_tokens,
            output_tokens=output_tokens,
            cached_tokens=cached_tokens,
        )
    conn = connect()
    try:
        conn.execute(
            """INSERT INTO usage (at, vendor, model, input_tokens, output_tokens, cached_tokens, usd, surface, note)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                _now(),
                vendor,
                model,
                int(input_tokens or 0),
                int(output_tokens or 0),
                int(cached_tokens or 0),
                usd,
                surface[:40],
                note[:240],
            ),
        )
        conn.commit()
    finally:
        conn.close()


def _insert_price(conn: sqlite3.Connection, source: str, row: dict, live: int) -> None:
    conn.execute(
        """INSERT INTO prices (at, source, vendor, model, input_per_m, cached_per_m, output_per_m, unit, notes, live)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
        (
            _now(),
            source,
            row["vendor"],
            row["model"],
            row.get("input") if "input" in row else row.get("input_per_m"),
            row.get("cached") if "cached" in row else row.get("cached_per_m"),
            row.get("output") if "output" in row else row.get("output_per_m"),
            row.get("unit") or "1M tokens",
            row.get("notes") or "",
            int(live),
        ),
    )


def _seed_prices(source: str) -> int:
    conn = connect()
    try:
        n = conn.execute("SELECT COUNT(*) AS n FROM prices").fetchone()["n"]
        if n:
            return 0
        for row in SEED_ROWS:
            _insert_price(conn, source, row, live=0)
        conn.commit()
        return len(SEED_ROWS)
    finally:
        conn.close()


def _fetch(url: str, alt: str | None) -> tuple[str, str, bytes]:
    headers = {"User-Agent": "RootRecord-ava-ledger/1.0 (price catalog; no inference)"}
    last_err = ""
    for candidate in (url, alt):
        if not candidate:
            continue
        try:
            r = requests.get(candidate, headers=headers, timeout=12)
            if r.status_code >= 400:
                last_err = f"HTTP {r.status_code}"
                continue
            return candidate, "", r.content
        except Exception as e:
            last_err = str(e)[:200]
    return url, last_err or "fetch_failed", b""


_MONEY = re.compile(r"\$([0-9]+(?:\.[0-9]+)?)")


def _parse_live(vendor: str, text: str) -> list[dict]:
    """Pull a few known rows out of official markdown/HTML. Misses are fine — seed remains."""
    low = text.lower()
    found: list[dict] = []

    def grab(model: str, *needles: str) -> None:
        idx = -1
        hit = ""
        for n in needles:
            i = low.find(n.lower())
            if i >= 0:
                idx = i
                hit = n
                break
        if idx < 0:
            return
        window = text[idx : idx + 900]
        money = [float(x) for x in _MONEY.findall(window)[:6]]
        if len(money) < 2:
            return
        inp = money[0]
        # Cursor/xAI tables: input, (cache write?), cache read, output
        if len(money) >= 4:
            cached, out = money[2], money[3]
        elif len(money) >= 3:
            cached, out = money[1], money[2]
        else:
            cached, out = None, money[1]
        found.append(
            {
                "vendor": vendor,
                "model": model,
                "input": inp,
                "cached": cached,
                "output": out,
                "notes": f"live parse near {hit!r}",
            }
        )

    if vendor == "xai":
        grab("grok-4.6", "grok-4.6 (< 200k", "grok-4.6")
        grab("grok-4.5", "grok-4.5 (< 200k", "grok-4.5")
    elif vendor == "cursor":
        grab("grok-4.6", "Grok 4.6")
        grab("composer-2.5", "Composer 2.5")
    elif vendor == "openai":
        grab("gpt-5.6-sol", "gpt-5.6-sol", "GPT-5.6 Sol")
        grab("gpt-5.6-terra", "gpt-5.6-terra", "GPT-5.6 Terra")
        grab("gpt-5.6-luna", "gpt-5.6-luna", "GPT-5.6 Luna")
    elif vendor == "gemini":
        grab("gemini-2.5-flash", "Gemini 2.5 Flash")
        grab("gemini-3.1-pro", "Gemini 3.1 Pro")
        grab("gemini-3.6-flash", "Gemini 3.6 Flash")
    return found


def _probe_xai_prepaid() -> dict:
    key = getattr(config, "XAI_MGMT_KEY", "") or ""
    team = getattr(config, "XAI_TEAM_ID", "") or ""
    if not key or not team:
        return {"ok": False, "detail": "no_mgmt_key"}
    url = f"https://management-api.x.ai/v1/billing/teams/{team}/prepaid/balance"
    try:
        r = requests.get(
            url,
            headers={"Authorization": f"Bearer {key}", "User-Agent": "RootRecord-ava-ledger/1.0"},
            timeout=15,
        )
    except Exception as e:
        return {"ok": False, "detail": str(e)[:160]}
    if r.status_code >= 400:
        return {"ok": False, "detail": f"HTTP {r.status_code}"}
    try:
        data = r.json()
    except Exception:
        return {"ok": False, "detail": "bad_json"}
    # Docs: total.val is USD cents as a string; prepaid ledger is inverted (top-up negative).
    raw = None
    total = data.get("total") if isinstance(data, dict) else None
    if isinstance(total, dict):
        raw = total.get("val")
    elif isinstance(total, (str, int, float)):
        raw = total
    try:
        cents = int(str(raw).strip())
        usd = abs(cents) / 100.0
    except (TypeError, ValueError):
        return {"ok": False, "detail": "no_total"}
    return {"ok": True, "usd": usd, "detail": "mgmt_prepaid"}


def refresh(*, source: str = "daily") -> dict:
    st = flags()
    seeded = _seed_prices(source)
    out: dict[str, Any] = {
        "ok": True,
        "source": source,
        "at": datetime.now(HST).isoformat(),
        "seeded_rows": seeded,
        "fetches": [],
        "live_rows": 0,
        "balances": {},
    }
    if not st.get("capture_enabled"):
        out["detail"] = "capture_off"
        LAST_PATH.write_text(json.dumps(out, indent=2) + "\n", encoding="utf-8")
        return out

    conn = connect()
    live_n = 0
    try:
        for src in SOURCES:
            url, err, body = _fetch(src["url"], src.get("alt"))
            sha = hashlib.sha256(body).hexdigest()[:16] if body else ""
            ok = bool(body) and not err
            conn.execute(
                """INSERT INTO fetches (at, source, vendor, url, ok, bytes, sha, detail)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
                (_now(), source, src["vendor"], url, int(ok), len(body), sha, err[:200]),
            )
            parsed = _parse_live(src["vendor"], body.decode("utf-8", "replace")) if body else []
            for row in parsed:
                _insert_price(conn, source, row, live=1)
                live_n += 1
            out["fetches"].append(
                {
                    "vendor": src["vendor"],
                    "url": url,
                    "ok": ok,
                    "bytes": len(body),
                    "parsed": len(parsed),
                    "detail": err or "ok",
                }
            )
        conn.commit()
    finally:
        conn.close()
    out["live_rows"] = live_n
    out["balances"] = _balance_block(st)
    LAST_PATH.write_text(json.dumps(out, indent=2, default=str) + "\n", encoding="utf-8")
    log.info(
        "api-ledger %s fetches=%s live_rows=%s",
        source,
        len(out["fetches"]),
        live_n,
    )
    return out


def _balance_block(st: dict | None = None) -> dict:
    st = st or flags()
    xai_live = {"ok": False, "detail": "spend_off"}
    if st.get("spend_master") and _mgmt_ready("xai"):
        xai_live = _probe_xai_prepaid()
    out = {}
    for key, acc in (st.get("accounts") or {}).items():
        spent = spent_usd(key)
        starting = acc.get("starting_usd")
        used_pct = acc.get("used_pct")
        remaining_usd = None
        remaining_pct = None
        status = "needs_seed"
        live = None
        if key == "xai" and xai_live.get("ok"):
            live = xai_live.get("usd")
            remaining_usd = live
            status = "live"
        elif acc.get("kind") == "percent_pool":
            if used_pct is None:
                status = "needs_seed"
            else:
                remaining_pct = max(0, 100 - int(used_pct))
                status = "seeded"
        elif starting is None:
            status = "needs_seed"
        else:
            remaining_usd = round(float(starting) - spent, 4)
            status = "seeded_minus_tracked"
        out[key] = {
            "label": acc.get("label") or key,
            "kind": acc.get("kind"),
            "spend_allowed": bool(acc.get("spend_allowed")),
            "key_present": _key_present(key),
            "mgmt_ready": _mgmt_ready(key),
            "starting_usd": starting,
            "used_pct": used_pct,
            "remaining_pct": remaining_pct,
            "tracked_spend_usd": round(spent, 4),
            "remaining_usd": remaining_usd,
            "live_usd": live,
            "status": status,
            "note": acc.get("note") or "",
        }
        if key == "xai" and not xai_live.get("ok"):
            out[key]["live_detail"] = xai_live.get("detail")
    return out


def latest_catalog(limit: int = 80) -> list[dict]:
    conn = connect()
    try:
        rows = conn.execute(
            """SELECT vendor, model, input_per_m, cached_per_m, output_per_m, unit, notes, at, live
               FROM prices ORDER BY id DESC LIMIT ?""",
            (max(20, int(limit)),),
        ).fetchall()
    finally:
        conn.close()
    seen: set[tuple[str, str]] = set()
    out = []
    for row in rows:
        key = (row["vendor"], row["model"])
        if key in seen:
            continue
        seen.add(key)
        out.append(dict(row))
    out.sort(key=lambda r: (r["vendor"], r["model"]))
    return out


def snapshot() -> dict:
    st = flags()
    last = {}
    if LAST_PATH.is_file():
        try:
            last = json.loads(LAST_PATH.read_text(encoding="utf-8"))
        except Exception:
            last = {}
    if not st.get("seeded_at"):
        write_flags({})
        st = flags()
    _seed_prices("snapshot")
    from apps.core.services import model_pick

    return {
        "ok": True,
        "capture_enabled": st["capture_enabled"],
        "spend_master": st["spend_master"],
        "accounts": st["accounts"],
        "balances": _balance_block(st),
        "prices": latest_catalog(),
        "auto": auto_turn_estimates(),
        "defaults": {v: model_pick.pick(v) for v in ("xai", "openai", "gemini", "cursor", "anthropic")},
        "last": last,
        "self_update": {
            "on": False,
            "reason": "operator_hold",
            "cursor_used_pct": (st.get("accounts") or {}).get("cursor", {}).get("used_pct"),
            "cursor_min_free_pct": 25,
        },
    }
