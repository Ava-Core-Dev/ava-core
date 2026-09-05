"""Manual morning / midday / evening report MP3 selection.

Operator picks existing files under Media audio trees. Cron auto-plays them
on schedule without Ara/Grok TTS spend.
"""

from __future__ import annotations

import json
import logging
from datetime import datetime, timezone
from pathlib import Path

log = logging.getLogger("ava.report_audio_manual")

KINDS = ("morning", "midday", "evening", "late")
STATE_NAME = "report-audio-manual.json"


def _state_path() -> Path:
    from apps.core import config

    return config.DATA_DIR / "state" / STATE_NAME


def _default_row() -> dict:
    return {"path": "", "auto_play": False, "label": ""}


def _default_state() -> dict:
    return {
        "version": 1,
        "slots": {k: _default_row() for k in KINDS},
        "updated_at": None,
        "note": "Pick existing report MP3s. auto_play=true queues them at morning/midday/evening cron — no TTS.",
    }


def load() -> dict:
    p = _state_path()
    base = _default_state()
    if not p.is_file():
        return base
    try:
        raw = json.loads(p.read_text(encoding="utf-8-sig"))
    except Exception:
        return base
    if not isinstance(raw, dict):
        return base
    slots = dict(base["slots"])
    src = raw.get("slots") if isinstance(raw.get("slots"), dict) else raw
    for kind in KINDS:
        row = src.get(kind) if isinstance(src, dict) else None
        if not isinstance(row, dict):
            continue
        slots[kind] = {
            "path": str(row.get("path") or "").strip(),
            "auto_play": bool(row.get("auto_play")),
            "label": str(row.get("label") or "").strip(),
        }
    out = {**base, **{k: v for k, v in raw.items() if k != "slots"}}
    out["slots"] = slots
    return out


def save(data: dict) -> dict:
    p = _state_path()
    p.parent.mkdir(parents=True, exist_ok=True)
    data = dict(data)
    data["updated_at"] = datetime.now(timezone.utc).isoformat()
    p.write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")
    return data


def _audio_roots() -> list[Path]:
    from apps.core import config

    pub = Path(config.PUBLIC_MEDIA) / "audio"
    return [
        Path(config.GENERATED_DIR),
        pub / "reports",
        pub / "current",
        pub / "voice" / "generated",
    ]


def _allowed_roots() -> list[Path]:
    roots = []
    for r in _audio_roots():
        try:
            roots.append(r.resolve())
        except Exception:
            pass
    return roots


def _safe_resolve(raw: str | Path | None) -> Path | None:
    if not raw:
        return None
    try:
        p = Path(str(raw)).expanduser()
        if not p.is_absolute():
            from apps.core import config

            p = (Path(config.AVA_HOME) / p).resolve()
        else:
            p = p.resolve()
    except Exception:
        return None
    if p.suffix.lower() != ".mp3" or not p.is_file():
        return None
    allowed = _allowed_roots()
    for root in allowed:
        try:
            p.relative_to(root)
            return p
        except ValueError:
            continue
    return None


def list_candidates(*, limit: int = 80) -> list[dict]:
    """Recent report-ish MP3s under allowed audio dirs."""
    seen: set[str] = set()
    rows: list[tuple[float, dict]] = []
    keys = (
        "morning",
        "midday",
        "evening",
        "boot",
        "report",
        "noon",
    )
    for root in _audio_roots():
        if not root.is_dir():
            continue
        try:
            files = list(root.rglob("*.mp3"))
        except Exception:
            continue
        for p in files:
            name = p.name.lower()
            if not any(k in name for k in keys):
                continue
            try:
                rp = p.resolve()
                key = str(rp).lower()
            except Exception:
                continue
            if key in seen:
                continue
            seen.add(key)
            try:
                st = rp.stat()
            except Exception:
                continue
            try:
                from apps.core import config

                rel = str(rp.relative_to(Path(config.AVA_HOME)))
            except Exception:
                rel = str(rp)
            rows.append(
                (
                    st.st_mtime,
                    {
                        "path": str(rp),
                        "rel": rel.replace("\\", "/"),
                        "name": rp.name,
                        "bytes": int(st.st_size),
                        "mtime": datetime.fromtimestamp(
                            st.st_mtime, tz=timezone.utc
                        ).isoformat(),
                    },
                )
            )
    rows.sort(key=lambda t: t[0], reverse=True)
    return [r for _, r in rows[: max(1, min(200, limit))]]


def status() -> dict:
    st = load()
    slots_out = {}
    for kind in KINDS:
        row = dict(st["slots"].get(kind) or _default_row())
        resolved = _safe_resolve(row.get("path"))
        row["resolved"] = str(resolved) if resolved else None
        row["exists"] = bool(resolved)
        slots_out[kind] = row
    return {
        "ok": True,
        "slots": slots_out,
        "candidates": list_candidates(),
        "updated_at": st.get("updated_at"),
        "note": st.get("note"),
        "kinds": list(KINDS),
    }


def set_slot(
    kind: str,
    *,
    path: str | None = None,
    auto_play: bool | None = None,
    label: str | None = None,
    clear: bool = False,
) -> dict:
    kind = (kind or "").strip().lower()
    if kind not in KINDS:
        return {"ok": False, "detail": "bad_kind", "kinds": list(KINDS)}
    st = load()
    row = dict(st["slots"].get(kind) or _default_row())
    if clear:
        row = _default_row()
    else:
        if path is not None:
            raw = str(path).strip()
            if not raw:
                row["path"] = ""
            else:
                resolved = _safe_resolve(raw)
                if resolved is None:
                    return {
                        "ok": False,
                        "detail": "path_not_allowed_or_missing",
                        "path": raw,
                    }
                row["path"] = str(resolved)
        if auto_play is not None:
            row["auto_play"] = bool(auto_play)
        if label is not None:
            row["label"] = str(label).strip()[:120]
    st["slots"][kind] = row
    save(st)
    return {"ok": True, "kind": kind, "slot": status()["slots"][kind]}


def resolve_play_path(kind: str) -> Path | None:
    kind = (kind or "").strip().lower()
    if kind not in KINDS:
        return None
    st = load()
    row = st["slots"].get(kind) or {}
    if not row.get("auto_play"):
        return None
    return _safe_resolve(row.get("path"))


async def play_scheduled(kind: str) -> dict:
    """Play manual file for kind if auto_play + path set. No TTS."""
    kind = (kind or "").strip().lower()
    path = resolve_play_path(kind)
    if path is None:
        st = load()
        row = (st.get("slots") or {}).get(kind) or {}
        return {
            "ok": True,
            "skipped": True,
            "kind": kind,
            "detail": "manual_off_or_missing",
            "auto_play": bool(row.get("auto_play")),
            "path": row.get("path") or None,
        }
    from apps.core.services import voice_events

    out = await voice_events.play_report_mp3(
        path,
        name=f"{kind}_manual",
        kind=kind,
    )
    out["manual"] = True
    out["kind"] = kind
    return out


async def play_now(kind: str, path: str | None = None) -> dict:
    """Operator test play — ignores auto_play flag; optional override path."""
    kind = (kind or "").strip().lower()
    if kind not in KINDS:
        return {"ok": False, "detail": "bad_kind"}
    target = _safe_resolve(path) if path else None
    if target is None:
        st = load()
        target = _safe_resolve((st.get("slots") or {}).get(kind, {}).get("path"))
    if target is None:
        return {"ok": False, "detail": "mp3_missing", "kind": kind}
    from apps.core.services import voice_events

    out = await voice_events.play_report_mp3(
        target,
        name=f"{kind}_manual",
        kind=kind,
    )
    out["manual"] = True
    out["kind"] = kind
    return out
