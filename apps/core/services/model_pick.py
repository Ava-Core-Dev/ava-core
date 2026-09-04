"""Cheapest chat model per vendor, unless a call hard-codes one.

Default: pick the lowest list-price text model from the price catalog.
Pin: pass model= at the call site, set USE[vendor] below, or set
AVA_XAI_USE_MODEL / AVA_OPENAI_USE_MODEL / AVA_GEMINI_USE_MODEL /
AVA_CURSOR_USE_MODEL / AVA_ANTHROPIC_USE_MODEL.

.env GROK_MODEL=grok-4.6 is not a pin — that was the old blanket default.
"""
from __future__ import annotations

from apps.core import config

# Hard pins for a specific build. Leave empty to stay on cheapest.
# Example: USE["xai"] = "grok-4.6"
USE: dict[str, str] = {
    "xai": "",
    "openai": "",
    "gemini": "",
    "cursor": "",
    "anthropic": "",
}

# If the catalog is empty, these are the official cheap chat IDs (2026-09-03).
_FALLBACK = {
    "xai": "grok-4.3",
    "openai": "gpt-5.6-luna",
    "gemini": "gemini-2.5-flash",
    "cursor": "composer-2.5",
    "anthropic": "claude-sonnet-5",
}

_SKIP = (
    "-long",
    "-fast",
    "imagine",
    "voice",
    "tts",
    "auto",
    "token-rate",
    "build",
    "astra",
    "cyber",
    "opus",
    "pro",
    "sol",
    "terra",
)

_ENV_PIN = {
    "xai": "GROK_USE_MODEL",
    "openai": "OPENAI_USE_MODEL",
    "gemini": "GEMINI_USE_MODEL",
    "cursor": "CURSOR_USE_MODEL",
    "anthropic": "ANTHROPIC_USE_MODEL",
}


def _env_pin(vendor: str) -> str:
    attr = _ENV_PIN.get(vendor) or ""
    raw = str(getattr(config, attr, "") or "").strip()
    return raw


def pin(vendor: str) -> str:
    """Hard pin from USE dict or env. Empty means cheapest."""
    hard = str(USE.get(vendor) or "").strip()
    if hard:
        return hard
    return _env_pin(vendor)


def _eligible(row: dict) -> bool:
    name = str(row.get("model") or "").lower()
    if not name:
        return False
    unit = str(row.get("unit") or "1M tokens")
    if unit not in {"1M tokens", ""}:
        return False
    if row.get("input_per_m") is None or row.get("output_per_m") is None:
        return False
    return not any(s in name for s in _SKIP)


def cheapest(vendor: str) -> str:
    from apps.core.services import api_ledger

    rows = list(api_ledger.latest_catalog())
    seen = {(r.get("vendor"), r.get("model")) for r in rows}
    for seed in api_ledger.SEED_ROWS:
        key = (seed.get("vendor"), seed.get("model"))
        if key in seen:
            continue
        rows.append(
            {
                "vendor": seed["vendor"],
                "model": seed["model"],
                "input_per_m": seed.get("input"),
                "output_per_m": seed.get("output"),
                "unit": seed.get("unit") or "1M tokens",
            }
        )
    scored: list[tuple[float, int, str]] = []
    for row in rows:
        if row.get("vendor") != vendor or not _eligible(row):
            continue
        blend = 0.5 * float(row["input_per_m"]) + 0.5 * float(row["output_per_m"])
        name = str(row["model"])
        scored.append((blend, len(name), name))
    if scored:
        scored.sort()
        return scored[0][2]
    return _FALLBACK.get(vendor) or _FALLBACK["xai"]


def pick(vendor: str, *, model: str | None = None) -> str:
    """Call-site model= wins, then USE/env pin, then cheapest."""
    explicit = str(model or "").strip()
    if explicit:
        return explicit
    pinned = pin(vendor)
    if pinned:
        return pinned
    return cheapest(vendor)
